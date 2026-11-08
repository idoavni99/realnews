import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {orderedEvidence, summaryCache, summaryFingerprint, summarizeStories} from '../src/summary-runner.ts';
import {attachSummaryMembership} from '../src/synthesis.ts';
import {publicationGate} from '../scripts/publication-gate.ts';
import type {FeedItem} from '../src/rss.ts';
import type {LlmClient} from '../src/llm.ts';

const item=(id: string): FeedItem=>({source:id,sourceName:id,side:'center',title:'כותרת',
  url:'https://example.com/'+id,summary:'טקסט מקור',published:'2026-11-08T12:00:00Z'});
const stories=['a','b','c'].map(id=>({items:[item(id)]}));
const draft={sides:{left:'',center:'טקסט מקור',right:''}};
const pause=async()=>{};
function setup() {
  const dir=mkdtempSync(join(tmpdir(),'realnews-summary-'));
  const path=join(dir,'synthesis.json');
  return {path,cache:summaryCache(path),cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}

test('three rounds only retry failures; successful stories never repeat',async()=>{
  const state=setup();const order:string[]=[];const attempts:Record<string,number>={};
  const llm:LlmClient={async generateJson(req){
    if (req.label==='Synthesis') {
      const id=(req.input as any)[0].source;order.push(id);attempts[id]=(attempts[id]??0)+1;
      if (id==='c' || (id==='b' && attempts[id]===1)) throw new Error('Transient error');
      return {json:draft};
    }
    return {json:{verdicts:[{id:'summary',supported:true,reasons:[]}]}};
  }};
  try {
    const result=await summarizeStories(stories,{enabled:true,llm,maxCalls:60,cache:state.cache,pause});
    assert.deepEqual(order,['a','b','c','b','c','c']);
    assert.deepEqual(result.map(r=>r.status),['ready','ready','exhausted']);
    assert.deepEqual(result.map(r=>r.attempts.length),[1,2,3]);
    assert.equal(result[2].synthesis,undefined);
    assert.equal(Object.keys(JSON.parse(readFileSync(state.path,'utf8'))).length,2);
  } finally { state.cleanup(); }
});

test('rejected verification is retried, only accepted summaries are cached',async()=>{
  const state=setup();let verification=0;
  try {
    const result=await summarizeStories(stories.slice(0,1),{enabled:true,maxCalls:6,cache:state.cache,pause,
      llm:{async generateJson(req){
        if(req.label==='Synthesis') return {json:draft};
        return {json:{verdicts:[{id:'summary',supported:++verification===3,reasons:['Check']}]}};
      }}});
    assert.equal(result[0].status,'ready');assert.equal(result[0].attempts.length,3);
  } finally { state.cleanup(); }
});

test('success survives a fresh cache instance, other absent stories, disabled runs and provider change',async()=>{
  const state=setup();let calls=0;
  const llm:LlmClient={async generateJson(req){calls++;return {json:req.label==='Synthesis'?draft:
    {verdicts:[{id:'summary',supported:true,reasons:[]}]}};}};
  try {
    await summarizeStories(stories.slice(0,1),{enabled:true,llm,maxCalls:2,cache:state.cache,pause});
    await summarizeStories(stories.slice(1),{enabled:false,maxCalls:0,cache:summaryCache(state.path),pause});
    const result=await summarizeStories(stories.slice(0,1),{enabled:true,llm,maxCalls:0,cache:summaryCache(state.path),pause});
    assert.equal(result[0].status,'ready');assert.equal(calls,2);assert.equal(result[0].attempts.length,0);
  } finally { state.cleanup(); }
});

test('missing body and lead skip all attempts; RSS lead is still valid source text',async()=>{
  const state=setup();let calls=0;
  try {
    const result=await summarizeStories([{items:[{...item('a'),summary:' ',fulltext:'\n'}]},
      {items:[item('b'),{...item('c'),summary:''}]}],{enabled:true,maxCalls:20,cache:state.cache,pause,
      llm:{async generateJson(){calls++;throw new Error('must not call');}}});
    assert.deepEqual(result.map(r=>r.status),['missing_text','missing_text']);
    assert.equal(calls,0);assert.ok(result.every(r=>r.attempts.length===0));
  } finally { state.cleanup(); }
});

test('rate-limit stops later paid requests; call cap bounds all rounds',async()=>{
  for (const error of ['HTTP 429','HTTP 503','HTTP 403','Transient']) {
    const state=setup();let calls=0;
    try {
      const result=await summarizeStories(stories,{enabled:true,maxCalls:2,cache:state.cache,pause,
        llm:{async generateJson(){calls++;throw new Error(error);}}});
      assert.equal(calls,1);
      assert.ok(result.every(r=>!r.synthesis));
    } finally {state.cleanup();}
  }
});

test('stable source order keeps cache key and citation membership deterministic',()=>{
  const a=orderedEvidence([item('b'),item('a')]);const b=orderedEvidence([item('a'),item('b')]);
  assert.equal(summaryFingerprint(a),summaryFingerprint(b));
  assert.notEqual(summaryFingerprint(a),summaryFingerprint([{...a[0],summary:'changed'},a[1]]));
});

test('missing and exhausted summaries do not discard articles or bypass summary review',()=>{
  publicationGate({stories:[{synthesis_status:'exhausted'},{synthesis_status:'missing_text'},{synthesis_status:'unavailable'}]});
  const synthesis=attachSummaryMembership(draft,[item('a')]);
  assert.throws(()=>publicationGate({stories:[{synthesis_status:'ready',synthesis}]}),/human quality approval/);
  assert.throws(()=>publicationGate({stories:[{synthesis_status:'exhausted',synthesis}]}),/unverified summary/);
});

test('unvalidated grouping never calls summary or reuses cached prose',async()=>{
  const state=setup();
  try {
    state.cache.save(summaryFingerprint(stories[0].items),attachSummaryMembership(draft,stories[0].items));
    const result=await summarizeStories([{...stories[0],heldBack:true}],{enabled:true,maxCalls:60,cache:state.cache,pause,
      llm:{async generateJson(){throw new Error('must not call');}}});
    assert.equal(result[0].status,'grouping_unvalidated');assert.equal(result[0].synthesis,undefined);
  } finally {state.cleanup();}
});
