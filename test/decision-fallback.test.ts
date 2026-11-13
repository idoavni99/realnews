import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decisionFallback,requestBudget,budgetedLlm} from '../src/decision-fallback.ts';
import {LlmOutputError} from '../src/llm.ts';
import type {DecisionClient} from '../src/decisions.ts';

const request={label:'Grouping' as const,state:{},questions:{same:{type:'noul' as const,instructions:'Same?'}}};
const fail=(status:number):DecisionClient=>({async decide(){throw new LlmOutputError('HTTP '+status,{requested_model:'mock',http_status:status,content_chars:0});}});
const answer=(value:number):DecisionClient=>({async decide(){return {answers:{same:value},diagnostics:{requested_model:'mock',content_chars:0}};}});
const budgets=()=>({Grouping:requestBudget(30),Verification:requestBudget(60)});

test('confirmed primary-Liquid-Jev order advances on unavailable/rate-limited HTTP only',async()=>{
  for(const status of [408,429,500,502,503,504]){
    const order:string[]=[];
    const wrap=(name:string,client:DecisionClient):DecisionClient=>({decide(request){order.push(name);return client.decide(request);}});
    const client=decisionFallback([wrap('Perplexity',fail(status)),wrap('Liquid',fail(503)),wrap('Jev',answer(0.99))],budgets());
    assert.equal((await client.decide(request)).answers.same,0.99);
    assert.deepEqual(order,['Perplexity','Liquid','Jev']);
  }
});

test('valid no and uncertainty are terminal, never shopping for a better opinion',async()=>{
  for(const value of [0,0.1,0.5,0.89]){
    let later=0;
    const client=decisionFallback([answer(value),{async decide(){later++;throw new Error('must not call');}}],budgets());
    assert.equal((await client.decide(request)).answers.same,value);assert.equal(later,0);
  }
});

test('invalid requests, authentication, credits, content filtering and malformed answers do not fail over',async()=>{
  for(const status of [400,401,402,403,404,413,422]){
    let later=0;
    const client=decisionFallback([fail(status),{async decide(){later++;return answer(1).decide(request);}}],budgets());
    await assert.rejects(()=>client.decide(request));assert.equal(later,0);
  }
  for(const error of [new Error('Invalid decision probability'),new Error('Size exceeded'),new TypeError('fetch failed'),new DOMException('timeout','TimeoutError')]){
    let later=0;
    const client=decisionFallback([{async decide(){throw error;}},{async decide(){later++;return answer(1).decide(request);}}],budgets());
    await assert.rejects(()=>client.decide(request));assert.equal(later,0);
  }
});

test('every fallback attempt consumes budget, cap stops before next provider and remains exhausted across articles',async()=>{
  let calls=0;
  const counter:DecisionClient={async decide(){calls++;return fail(429).decide(request);}};
  const client=decisionFallback([counter,counter,counter],{Grouping:requestBudget(2),Verification:requestBudget(60)});
  await assert.rejects(()=>client.decide(request),/budget exhausted/);assert.equal(calls,2);
  await assert.rejects(()=>client.decide(request),/budget exhausted/);assert.equal(calls,2);
});

test('synthesis and verification share physical attempt cap including failed fallback attempts',async()=>{
  const consume=requestBudget(3);let synthesis=0;
  const llm=budgetedLlm({async generateJson(){synthesis++;return {json:{}};}},consume);
  const client=decisionFallback([fail(429),answer(0.99)],{Grouping:requestBudget(30),Verification:consume});
  const synthesisRequest={label:'Synthesis' as const,system:'',input:{},schema:{},temperature:0,maxOutputTokens:1};
  await llm.generateJson(synthesisRequest);
  await client.decide({...request,label:'Verification'});
  await assert.rejects(()=>llm.generateJson(synthesisRequest),/budget exhausted/);assert.equal(synthesis,1);
});
