/** Re-serialize completed, real grouping evidence only. No network/model calls. */
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {weightedCoverage} from '../src/config.ts';
import {accessCaveats} from '../src/synthesis.ts';
const [evidencePath,dest]=process.argv.slice(2);
if(!evidencePath||!dest)throw new Error('Usage: expand-existing-feed.ts evidence.json data.json');
const evidence=JSON.parse(readFileSync(evidencePath,'utf8')),data=JSON.parse(readFileSync(dest,'utf8'));
assert.equal(evidence.generated_at,data.generated_at,'Evidence must match the live digest');
assert.equal(evidence.grouping.complete,true);assert.equal(evidence.grouping.unvalidated_articles,0);
assert.ok(evidence.grouping.groups.every((g:any)=>g.grouping==='schema_assigned'));
const trimSentence=(text:string,max=400)=>{
 const t=text.slice(0,max);if(text.length<=max)return t;
 const cut=Math.max(t.lastIndexOf('. '),t.lastIndexOf('! '),t.lastIndexOf('? '),t.lastIndexOf('। '));
 if(cut>max*.4)return t.slice(0,cut+1);const sp=t.lastIndexOf(' ');return (sp>max*.5?t.slice(0,sp):t)+'…';
};
const identity=(articles:any[])=>articles.map(a=>a.url).sort().join('\n');
const old=new Map(data.stories.map((s:any)=>[identity(s.articles),s]));
const groups=evidence.grouping.groups.map((g:any)=>({items:g.items})).sort((a:any,b:any)=>b.items.length-a.items.length||Date.parse(b.items[0].published)-Date.parse(a.items[0].published));
const stories=groups.map((g:any)=>{
 const items=g.items;const counts:Record<string,number>={};for(const it of items)if(data.monitored_sides.includes(it.side))counts[it.side]=(counts[it.side]??0)+1;
 const best=items.reduce((a:any,b:any)=>(b.fulltext||b.summary).length>(a.fulltext||a.summary).length?b:a);
 const story={headline:items.reduce((a:any,b:any)=>b.title.length>a.title.length?b:a).title,summary:trimSentence(best.fulltext||best.summary),synthesis_status:'not_configured',caveats:accessCaveats(items),grouping_status:'schema_assigned',counts,coverage_weighted:weightedCoverage(counts),total:items.length,articles:items.map((i:any)=>({source:i.sourceName,side:i.side,title:i.title,url:i.url,extraction:i.extraction??'lead_only',summary:i.summary.slice(0,300)}))};
 const previous=old.get(identity(story.articles));if(previous)assert.deepEqual(story,previous,'Existing published story must stay unchanged');
 return previous||story;
});
assert.equal(old.size,data.stories.length);assert.equal(stories.filter((s:any)=>old.has(identity(s.articles))).length,old.size);
const ids=stories.flatMap((s:any)=>s.articles.map((a:any)=>a.url));assert.equal(new Set(ids).size,ids.length,'No duplicates');
assert.equal(ids.length,evidence.grouping.groups.reduce((n:number,g:any)=>n+g.items.length,0));
writeFileSync(dest,JSON.stringify({...data,stories},null,1));
console.log(JSON.stringify({stories:stories.length,articles:ids.length,previous_stories_preserved:old.size,generated_at:data.generated_at,inference_calls:0}));
