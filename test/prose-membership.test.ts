import {test} from 'node:test';import assert from 'node:assert/strict';
import {attachSummaryMembership,synthesizeStory,SYNTHESIS_SCHEMA} from '../src/synthesis.ts';
import {verifyCandidates} from '../src/verification.ts';
const items=[{source:'a',sourceName:'a',side:'center',url:'https://example.com/a',title:'כותרת',summary:'פתיח',published:''},{source:'b',sourceName:'b',side:'center',url:'https://example.com/b',title:'כותרת',summary:'פתיח',published:''}];
test('model returns per-side prose only and code attaches exact known side membership',async()=>{
 let request:any;const result=await synthesizeStory(items,{async generateJson(req){request=req;return {json:{sides:{left:'',center:'פתיח',right:''}}};}});
 assert.deepEqual(result.sides.center.summary,[{text:'פתיח',article_ids:[0,1],evidence_kind:'side_membership'}]);
 assert.equal(SYNTHESIS_SCHEMA.properties.sides.properties.center.type,'STRING');assert.ok(!JSON.stringify(request.schema).includes('article_ids'));assert.match(request.system,/Do not output article IDs/);
});
test('extra citation fields, absent-side prose, unsupported numbers and modified membership fail closed',()=>{
 for(const bad of [{sides:{left:'',center:{text:'פתיח',article_ids:[0]},right:''}},{sides:{left:'פתיח',center:'',right:''}},{sides:{left:'',center:'987654',right:''}},{sides:{left:'',center:'פתיח',right:''},headline:'x'}])assert.throws(()=>attachSummaryMembership(bad,items));
});
test('verifier sees actual source text and is told membership is not per-claim citation proof',async()=>{
 const summary=attachSummaryMembership({sides:{left:'',center:'פתיח',right:''}},items);let request:any;
 await verifyCandidates(items,[{id:'summary',summary}],{async generateJson(req){request=req;return {json:{verdicts:[{id:'summary',supported:false,reasons:['Different events']}]}};}});
 assert.match(request.system,/NOT model-selected claim citations/);assert.match(request.system,/SAME specific event/);assert.equal(request.input.articles.length,2);assert.equal(request.input.candidates[0].summary.sides.center.summary[0].evidence_kind,'side_membership');
});
test('owner categories map to sides independently of weighted coverage, including absent and unknown sides',()=>{
 const sources=['left','center_left','center','right','center_right','unknown'].map((side,i)=>({...items[0],side,url:'https://example.com/'+i}));
 const result=attachSummaryMembership({sides:{left:'פתיח',center:'פתיח',right:'פתיח'}},sources);
 assert.deepEqual(result.sides.left.summary[0].article_ids,[0,1]);assert.deepEqual(result.sides.center.summary[0].article_ids,[2]);assert.deepEqual(result.sides.right.summary[0].article_ids,[3,4]);
 assert.ok(Object.values(result.sides).every(s=>!s.summary[0].article_ids.includes(5)));
});
