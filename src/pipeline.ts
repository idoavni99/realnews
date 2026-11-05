/**
 * Daily news pipeline: fetch RSS -> extract full text -> cluster stories -> site/data.json.
 * Dependency-free TypeScript; runs directly on Node >= 22.18 (built-in type stripping).
 *
 * Coverage semantics (product contract):
 * - A source's political side comes only from sources.yaml, confirmed by the owner.
 * - monitored_sides = confirmed sides with at least one source that fetched OK this run.
 * - A monitored side with no articles on a story is "no coverage found".
 * - A side with no healthy sources (or no confirmed label) is NOT part of the
 *   percentage at all - the UI shows it as "not monitored", never as 0%.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, CONFIRMED_SIDES, weightedCoverage } from './config.ts';
import { httpGet, sleep } from './http.ts';
import { parseFeed, parseI24News, type FeedItem } from './rss.ts';
import { extractFulltext } from './extract.ts';
import { clusterItems, type Cluster } from './cluster.ts';
import { runPolicy } from './run-policy.ts';
import { createLlmClient } from './llm.ts';
import { auditedClient } from './call-audit.ts';
import {articleRegistry,resolveArticles,articleId} from './article-registry.ts';
import {createArticleSnapshot} from './article-snapshot.ts';
import { groupArticles, validateGroupingConfig, type GroupingResult } from './grouping.ts';
import { verifyCandidates } from './verification.ts';
import { createHash } from 'node:crypto';
import { synthesizeStory, accessCaveats, synthesisInput, validateSynthesis, type StorySynthesis } from './synthesis.ts';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

interface StoryArticle {
  source: string; side: string; title: string; url: string;
  extraction: string; summary: string;
}

interface Story {
  headline: string; summary: string; counts: Record<string, number>;
  total: number; articles: StoryArticle[]; synthesis?: StorySynthesis; synthesis_status?: string; caveats?: string[];
}

/** Trim to ~max chars at a sentence boundary, never mid-word. */
function trimSentence(text: string, max = 400): string {
  const t = text.slice(0, max);
  if (text.length <= max) return t;
  const cut = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '), t.lastIndexOf('। '));
  if (cut > max * 0.4) return t.slice(0, cut + 1);
  const sp = t.lastIndexOf(' ');
  return (sp > max * 0.5 ? t.slice(0, sp) : t) + '…';
}

function storySummary(items: FeedItem[]): string {
  const best = items.reduce((a, b) =>
    ((b.fulltext || b.summary).length > (a.fulltext || a.summary).length ? b : a));
  return trimSentence(best.fulltext || best.summary);
}

async function main() {
  const policy=runPolicy(process.env);
  const groupingConfig=validateGroupingConfig({
    delayMs:Number(process.env.REALNEWS_LLM_DELAY_MS??5000),
    maxCalls:Number(process.env.REALNEWS_GROUPING_MAX_CALLS??30),
    batchTokens:Number(process.env.REALNEWS_GROUPING_BATCH_TOKENS??24000),
    maxArticlesPerBatch:Number(process.env.REALNEWS_GROUPING_MAX_ARTICLES??6),
    maxOutputTokens:Number(process.env.REALNEWS_GROUPING_OUTPUT_TOKENS??4000),
    reconcile:process.env.REALNEWS_GROUPING_RECONCILE==='true',
  });
  const cfg = loadConfig(ROOT);
  const only = process.env.REALNEWS_SOURCES?.split(',').map(s => s.trim()).filter(Boolean);
  const sources = only?.length ? cfg.sources.filter(s => only.includes(s.id)) : cfg.sources;
  const sourceHealth: Record<string, { ok: boolean; items: number; side: string; name: string; status: string }> = {};
  // Feeds are independent: fetch them together. One failure stays that source's.
  const fetched = await Promise.all(sources.map(async (s) => {
    try {
      const payload = await httpGet(s.rss);
      const got = (s.format === 'i24_json' ? parseI24News(payload, s) : parseFeed(payload, s))
        .filter(i => { const age = Date.now() - Date.parse(i.published); return Number.isFinite(age) && age >= -300000 && age <= cfg.windowHours * 3600000; })
        .slice(0, cfg.maxArticlesPerSource);
      sourceHealth[s.id] = { ok: got.length > 0, items: got.length, side: s.side, name: s.name, status: got.length ? 'ok' : 'no_recent_items' };
      console.error(`${s.id}: ${got.length} items`);
      return got;
    } catch (e) {
      sourceHealth[s.id] = { ok: false, items: 0, side: s.side, name: s.name, status: 'fetch_failed' };
      console.error(`${s.id}: FAILED ${(e as Error).message}`);
      return [];
    }
  }));
  const items: FeedItem[] = fetched.flat();
  for (const it of items) {
    const rssOnly = cfg.sources.find(s => s.id === it.source)?.extraction === 'rss_only';
    const { text, status } = rssOnly ? { text: '', status: 'lead_only' as const } : await extractFulltext(it.url, it.title);
    it.fulltext = text;
    it.extraction = status;
    await sleep(400);
  }
  const monitoredSides = [...new Set(
    Object.values(sourceHealth)
      .filter((h) => h.ok && (CONFIRMED_SIDES as readonly string[]).includes(h.side))
      .map((h) => h.side),
  )].sort();
  const stories: Story[] = [];
  const reviewDir=join(ROOT,'.review'); mkdirSync(reviewDir,{recursive:true});
  const registry=articleRegistry(items);
  const articleSnapshot=createArticleSnapshot(items);
  writeFileSync(join(reviewDir,'articles.json'),JSON.stringify(articleSnapshot),{mode:0o600});
  const provider=createLlmClient(process.env);
  const callAudit:unknown[]=[];
  // Persist before/after every attempted call, including failed validation and cancellation.
  const llm=provider?auditedClient(provider,join(reviewDir,'calls.json'),callAudit):undefined;
  // Model-led grouping is an independent opt-in; summaries are separately enabled.
  // Otherwise the conservative exact-headline clustering is used. Nothing here publishes anything by itself.
  let grouping:GroupingResult|undefined;
  let rawClusters:(Cluster&{unvalidated?:boolean})[];
  if(policy.grouping) {
    grouping=await groupArticles(items,llm!,groupingConfig);
    // Private completed grouping checkpoint, never an approval to publish.
    writeFileSync(join(reviewDir,'grouping.json'),JSON.stringify({...grouping,snapshot_run_id:articleSnapshot.run_id,snapshot_sha256:articleSnapshot.content_sha256}));
    rawClusters=grouping.groups.map(g=>({tokens:new Set<string>(),items:resolveArticles(g.articleIds,registry),unvalidated:g.grouping==='unvalidated'}));
    console.error(`grouping: ${grouping.batches.length} batches, ${grouping.calls} calls, ${rawClusters.length} stories, complete=${grouping.complete}, unvalidated articles=${grouping.unvalidated_articles}; batch statuses ${grouping.batches.map(b=>b.status).join(',')}`);
  } else rawClusters=clusterItems(items);
  const clusters=rawClusters.sort((a,b)=>b.items.length-a.items.length || Date.parse(b.items[0].published)-Date.parse(a.items[0].published));
  const cacheDir=join(ROOT,'.cache'); mkdirSync(cacheDir,{recursive:true});
  const cachePath=join(cacheDir,'synthesis.json');
  let cache: Record<string,StorySynthesis>={};
  try { if(existsSync(cachePath)) cache=JSON.parse(readFileSync(cachePath,'utf8')); } catch { console.error('Ignoring invalid synthesis cache'); }
  const nextCache:Record<string,StorySynthesis>={};
  const review:unknown[]=[];
  let calls=0, unavailable=false;
  const maxCalls=policy.maxCalls; // Bounded free-only standard API calls. No paid or alternate-provider fallback.
  for (const c of clusters) {
    let synthesis:StorySynthesis|undefined;
    let synthesis_status='not_configured';
    const fingerprint=createHash('sha256').update('v8-route-bound:'+ (process.env.OPENROUTER_MODEL||'openrouter/auto') + ':'+JSON.stringify(synthesisInput(c.items))).digest('hex');
    const heldBack=!!(c as {unvalidated?:boolean}).unvalidated; // not grouped by a validated model answer: no generated summary
    if(heldBack) synthesis_status='grouping_unvalidated';
    if(!heldBack && process.env.REALNEWS_SYNTHESIS_ENABLED === 'true' && process.env.REALNEWS_SYNTHESIS_CACHE_REUSE==='true' && cache[fingerprint]) { try { synthesis=validateSynthesis(cache[fingerprint],c.items); synthesis_status='ready'; } catch {} }
    const audit:{story:number;fingerprint:string;evidence:ReturnType<typeof synthesisInput>;draft?:StorySynthesis;verdicts?:unknown;error?:string;status?:string}={story:stories.length,fingerprint,evidence:synthesisInput(c.items)};
    if(!heldBack && !synthesis && llm && process.env.REALNEWS_SYNTHESIS_ENABLED === 'true') {
      synthesis_status='unavailable';
      if(!unavailable && calls+2<=maxCalls) {
        calls++;
        try {
          const draft=await synthesizeStory(c.items,llm); audit.draft=draft;
          calls++;
          const verdicts=await verifyCandidates(c.items,[{id:'summary',summary:draft}],llm);
          audit.verdicts=verdicts;
          if(!verdicts[0]?.supported) throw new Error('Verification rejected summary');
          synthesis=draft; synthesis_status='ready';
        }
        catch(e) { audit.error=(e as Error).message.slice(0,250); synthesis_status=/Verification rejected|Invalid|Unsupported|Unexpected/.test((e as Error).message)?'rejected':'unavailable'; console.error(`Synthesis rejected/unavailable for story ${stories.length}: ${(e as Error).message.slice(0,180)}`); if(/HTTP (429|503|403)/.test((e as Error).message)) unavailable=true; }
        await sleep(2000); // Owner-selected per-story pacing; HTTP rate limits still stop further calls.
      }
    }
    audit.status=synthesis_status; review.push(audit);
    if(synthesis) nextCache[fingerprint]=synthesis;
    const counts: Record<string, number> = {};
    for (const i of c.items) {
      if (monitoredSides.includes(i.side)) counts[i.side] = (counts[i.side] ?? 0) + 1;
    }
    stories.push({
      headline: c.items.reduce((a, b) => (b.title.length > a.title.length ? b : a)).title,
      summary: storySummary(c.items), // Existing source text, never a generated event summary.
      synthesis, synthesis_status, caveats: accessCaveats(c.items),
      ...(grouping?{grouping_status:heldBack?'unvalidated':'schema_assigned'}:{}),
      counts, // actual article counts per raw owner label
      coverage_weighted: weightedCoverage(counts), // weighted shares, not article counts
      total: c.items.length,
      articles: c.items.map((i) => ({
        article_id:articleId(i.url),source: i.sourceName, side: i.side, title: i.title, url: i.url,
        extraction: i.extraction ?? 'lead_only', summary: i.summary.slice(0, 300),
      })),
    });
  }
  stories.sort((a, b) => b.total - a.total);
  const out = {
    generated_at: new Date().toISOString(),
    window_hours: cfg.windowHours,
    monitored_sides: monitoredSides,
    source_health: sourceHealth,
    ...(grouping?{grouping:{mode:'model',complete:grouping.complete,unvalidated_articles:grouping.unvalidated_articles}}:{}),
    stories,
  };
  const reportedCost=callAudit.reduce((sum:number,a:any)=>sum+(typeof a.usage?.cost==='number'?a.usage.cost:0),0);
  const missingCost=callAudit.filter((a:any)=>typeof a.usage?.cost!=='number').length;
  console.error(`model accounting: attempts=${callAudit.length}, reported cost USD=${reportedCost.toFixed(8)}, missing cost records=${missingCost}; missing records are NOT zero cost`);
  writeFileSync(join(reviewDir,'evidence.json'),JSON.stringify({generated_at:out.generated_at,grouping,calls:callAudit,accounting:{attempts:callAudit.length,reported_cost_usd:reportedCost,cost_records_missing:missingCost,usage_missing:callAudit.filter((a:any)=>!a.usage).length, note:'Provider usage/cost may be delayed or absent; key ledger remains spending source of truth'},stories:review},null,2));
  writeFileSync(join(reviewDir,'staged-data.json'),JSON.stringify(out,null,2));
  if(grouping&&!grouping.complete)throw new Error('Incomplete grouping: staged data/evidence preserved; primary output unchanged');
  writeFileSync(cachePath,JSON.stringify(nextCache));
  const dest = join(ROOT, process.env.REALNEWS_OUT ?? 'site/data.json');
  writeFileSync(dest, JSON.stringify(out, null, 1));
  const nFull = items.filter((i) => i.extraction === 'full').length;
  console.error(`wrote ${stories.length} stories, ${items.length} items (${nFull} full-text) -> ${dest}`);
}

main();
