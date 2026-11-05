import test from 'node:test';
import assert from 'node:assert/strict';
import {verificationOutputTokenBudget,verifyCandidates} from '../src/verification.ts';
import {attachSummaryMembership} from '../src/synthesis.ts';
import {readFileSync} from 'node:fs';
test('verification budget is exactly 2000 per merged article, not candidate or distinct outlet',async()=>{
 const corpus=JSON.parse(readFileSync('test/fixtures/verifier-quality-multistory.json','utf8'));
 for(const count of [1,2,3,8]){
  const articles=Array.from({length:count},()=>corpus.stories[0].articles[0]); // all one outlet
  for(const candidateCount of [1,3]){
   const candidates=Array.from({length:candidateCount},(_,i)=>({id:String(i),summary:attachSummaryMembership({sides:{left:'',center:'חוות שרתים בפתח תקווה',right:''}},articles)}));let request:any;
   await verifyCandidates(articles,candidates,{async generateJson(req){request=req;return {json:{verdicts:candidates.map(c=>({id:c.id,supported:true,reasons:['test']}))}};}});
   assert.equal(request.maxOutputTokens,2000*count);
  }
 }
});
test('invalid/empty article count fails before any inference; no hidden minimum or cap',async()=>{
 for(const count of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER])assert.throws(()=>verificationOutputTokenBudget(count),/Invalid/);
 assert.equal(verificationOutputTokenBudget(100),200000);
 let called=false;await assert.rejects(()=>verifyCandidates([],[],{async generateJson(){called=true;return {json:{}};}}),/Invalid/);assert.equal(called,false);
});
