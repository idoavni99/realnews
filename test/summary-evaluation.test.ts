import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateSummary} from '../src/summary-evaluation.ts';
import {LlmOutputError} from '../src/llm.ts';
const items=JSON.parse(readFileSync(new URL('./fixtures/fullfeed-semantic-failure.json',import.meta.url),'utf8')).articles;
const draft={sides:{left:{summary:[]},center:{summary:[]},right:{summary:[{text:items[0].title,article_ids:[0]}]}}};
test('fixed known different-event input passes through BOTH stages and fails closed on verifier rejection',async()=>{
 const labels:string[]=[];const r=await evaluateSummary(items,{async generateJson(req){labels.push(req.label);return {json:req.label==='Synthesis'?draft:{verdicts:[{id:'summary',supported:false,reasons:['Different incidents']}]},usage:{cost:0.01}};}});
 assert.deepEqual(labels,['Synthesis','Verification']);assert.equal(r.status,'rejected');assert.equal(r.accounting.reported_cost_usd,0.02);assert.equal(r.accounting.missing_cost_records,0);assert.ok(r.calls.every(x=>x.duration_ms>=0));assert.ok(!('headline' in r.draft!));
});
test('invalid citations stop before verifier; record returned model cost despite local rejection',async()=>{
 const bad=structuredClone(draft);bad.sides.right.summary[0].article_ids=[999];
 const r=await evaluateSummary(items,{async generateJson(){return {json:bad,usage:{cost:0.03}};}});
 assert.equal(r.phase,'synthesis');assert.equal(r.status,'error');assert.match(r.error!,/citation/);assert.equal(r.calls.length,1);assert.equal(r.accounting.reported_cost_usd,0.03);
});
test('truncated synthesis and verification independently retain diagnostic usage',async()=>{
 for(const stage of ['Synthesis','Verification']){
  const r=await evaluateSummary(items,{async generateJson(req){if(req.label===stage)throw new LlmOutputError('Truncated '+stage,{requested_model:'auto',content_chars:0,finish_reason:'length',usage:{cost:0.04}});return {json:draft};}});
  assert.equal(r.status,'error');assert.match(r.error!,/Truncated/);assert.equal(r.accounting.reported_cost_usd,0.04);assert.equal(r.calls.at(-1).diagnostics.finish_reason,'length');
 }
});
test('incomplete verdict fails; no cost is silently treated as a known zero',async()=>{
 const r=await evaluateSummary(items,{async generateJson(req){return {json:req.label==='Synthesis'?draft:{verdicts:[]}};}});
 assert.equal(r.status,'error');assert.equal(r.phase,'verification');assert.match(r.error!,/Incomplete/);assert.equal(r.accounting.missing_cost_records,2);
});
test('supported verdict retained separately from known event ground truth',async()=>{
 const r=await evaluateSummary(items,{async generateJson(req){return {json:req.label==='Synthesis'?draft:{verdicts:[{id:'summary',supported:true,reasons:[]}]}};}});
 assert.equal(r.status,'supported');assert.match(r.caveat,/not independent proof/);
});
test('isolated local contract rejects cross-side, absent-side, unsupported number and overall headline',async()=>{
 const cases=[
  ()=>{const d=structuredClone(draft);d.sides.left.summary=d.sides.right.summary;d.sides.right.summary=[];return d;},
  ()=>{const d=structuredClone(draft);d.sides.right.summary[0].text='נפגעו 987654 אנשים';return d;},
  ()=>({...draft,headline:'Generated headline'}),
 ];
 for(const make of cases){
  const r=await evaluateSummary(items,{async generateJson(){return {json:make()};}});
  assert.equal(r.status,'error');assert.equal(r.phase,'synthesis');assert.equal(r.calls.length,1);
 }
});

test('production pacing is two seconds and rate-limit errors still stop later calls',()=>{
 const pipeline=readFileSync(new URL('../src/pipeline.ts',import.meta.url),'utf8');
 assert.match(pipeline,/await sleep\(2000\)/);assert.ok(!pipeline.includes('await sleep(10000)'));
 assert.ok(pipeline.includes('if(/HTTP (429|503|403)/.test'));
});
test('number beyond exact model evidence prefix is rejected before verification',async()=>{
 const article={...items[0],title:'כותרת',fulltext:'א'.repeat(4100)+' 987654'};
 const d={sides:{left:{summary:[]},center:{summary:[]},right:{summary:[{text:'987654',article_ids:[0]}]}}};
 const r=await evaluateSummary([article],{async generateJson(){return {json:d};}});
 assert.equal(r.status,'error');assert.equal(r.phase,'synthesis');assert.match(r.error!,/Unsupported number/);assert.equal(r.calls.length,1);
});
test('summary prompt states the same active token ceiling as the request without changing output contract',async()=>{
 const {synthesizeStory,SYNTHESIS_OUTPUT_TOKENS}=await import('../src/synthesis.ts');let request:any;
 const value={sides:{left:{summary:[]},center:{summary:[]},right:{summary:[]}}};
 await synthesizeStory(items,{async generateJson(req){request=req;return {json:value};}});
 assert.equal(request.maxOutputTokens,3000);assert.equal(request.maxOutputTokens,SYNTHESIS_OUTPUT_TOKENS);
 assert.ok(request.system.includes(`${request.maxOutputTokens} tokens`));assert.match(request.system,/including any reasoning/);assert.match(request.system,/one complete JSON object only/);assert.match(request.system,/Do not generate a headline/);
});
