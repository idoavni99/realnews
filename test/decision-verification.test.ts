import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {decisionVerifier} from '../src/decision-verification.ts';
import {summaryCache,summarizeStories,summaryFingerprint} from '../src/summary-runner.ts';
import {attachSummaryMembership} from '../src/synthesis.ts';
import type {DecisionClient} from '../src/decisions.ts';
import type {FeedItem} from '../src/rss.ts';

const items:FeedItem[]=[{source:'a',sourceName:'A',side:'center',title:'מקור',url:'https://example.com/a',summary:'נפצעו שני אנשים לכאורה',published:''}];
const prose={sides:{left:'',center:'נפצעו שני אנשים לכאורה',right:''}};
const candidate={id:'summary',summary:attachSummaryMembership(prose,items)};
function client(failed?:string):DecisionClient{
  return {async decide(request){return {answers:Object.fromEntries(Object.keys(request.questions).map(key=>[key,key.endsWith('_'+failed)?0.1:0.99])),diagnostics:{requested_model:'mock',content_chars:0}};}};
}

test('every named check can reject independently and reasons are fixed labels, not invented model explanations',async()=>{
  const accepted=await decisionVerifier(client(),0.9)(items,[candidate]);
  assert.deepEqual(accepted,[{id:'summary',supported:true,reasons:[]}]);
  for(const failed of ['same_event','source_support','side_attribution','negation','uncertainty','quantities','readable']){
    assert.deepEqual(await decisionVerifier(client(failed),0.9)(items,[candidate]),[{id:'summary',supported:false,reasons:[`decision_check_not_accepted:${failed}`]}]);
  }
});

test('missing answer fails closed instead of passing the other predicates',async()=>{
  const missing:DecisionClient={async decide(){return {answers:{},diagnostics:{requested_model:'mock',content_chars:0}};}};
  await assert.rejects(()=>decisionVerifier(missing,0.9)(items,[candidate]));
});

test('deterministic quantity and side-membership validation runs before model acceptance',async()=>{
  let calls=0;
  const never:DecisionClient={async decide(){calls++;throw new Error('must not call');}};
  const malformed=structuredClone(candidate);malformed.summary.sides.center.summary[0].text='נפצעו 99 אנשים';
  await assert.rejects(()=>decisionVerifier(never,0.9)(items,[malformed]),/Unsupported number/);
  const wrong=structuredClone(candidate);wrong.summary.sides.center.summary[0].article_ids=[999];
  await assert.rejects(()=>decisionVerifier(never,0.9)(items,[wrong]));assert.equal(calls,0);
});

test('model and threshold identity separate verification caches from old and differently calibrated policies',()=>{
  assert.notEqual(summaryFingerprint(items),summaryFingerprint(items,'decisions:model-a:0.9'));
  assert.notEqual(summaryFingerprint(items,'decisions:model-a:0.9'),summaryFingerprint(items,'decisions:model-b:0.9'));
  assert.notEqual(summaryFingerprint(items,'decisions:model-a:0.9'),summaryFingerprint(items,'decisions:model-a:0.95'));
});

test('runner keeps synthesis generative but never calls old LLM verification, and rechecks old cached output',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'decision-summary-'));
  try{
    const cache=summaryCache(join(dir,'cache.json'));cache.save(summaryFingerprint(items),candidate.summary);
    let synthesis=0,verification=0;
    const result=await summarizeStories([{items}],{enabled:true,maxCalls:2,cache,verificationIdentity:'decisions:mock:0.9',pause:async()=>{},
      llm:{async generateJson(request){assert.equal(request.label,'Synthesis');synthesis++;return {json:prose};}},
      verify:async(rows,candidates)=>{verification++;return decisionVerifier(client(),0.9)(rows,candidates);}});
    assert.equal(result[0].status,'ready');assert.equal(synthesis,1);assert.equal(verification,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
