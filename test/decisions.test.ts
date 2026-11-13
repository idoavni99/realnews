import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDecisionClient,decisionBody,DECISION_REQUEST_BYTES} from '../src/decisions.ts';
import {decisionPolicy,SELECTED_DECISION_MODEL,DISABLED_FALLBACK_CANDIDATES} from '../src/decision-policy.ts';

const request={label:'Grouping' as const,state:{text:'מקור'},questions:{same:{type:'noul' as const,instructions:'Same event?'}}};
const model='typesafe/jev-1.14';

test('transport uses Decisions not chat and preserves typed state without generation parameters',async()=>{
  let seen=false;
  const transport:typeof fetch=async(url,options)=>{
    seen=true;assert.equal(url,'https://openrouter.ai/api/alpha/decisions');
    const body=JSON.parse(options!.body as string);
    assert.deepEqual(body,{model,state:request.state,questions:request.questions});
    assert.equal((options!.headers as any).Authorization,'Bearer mock');
    return Response.json({model:'resolved-build',answers:{same:{type:'noul',noul:0.98}},usage:{cost:0.001}});
  };
  const response=await createDecisionClient('mock',model,transport).decide(request);
  assert.equal(seen,true);assert.equal(response.answers.same,0.98);
  assert.equal(response.diagnostics.requested_model,model);assert.equal(response.diagnostics.model,'resolved-build');
});

test('missing, wrong-type, string, nonfinite and out-of-range probabilities cannot become acceptance',async()=>{
  for(const answer of [undefined,{type:'choice',noul:1},{type:'noul',noul:'1'},{type:'noul',noul:null},{type:'noul',noul:-0.1},{type:'noul',noul:1.01}]){
    const client=createDecisionClient('mock',model,async()=>Response.json({answers:{same:answer}}));
    await assert.rejects(()=>client.decide(request));
  }
});

test('HTTP failures are not retried or silently rerouted and preserve unknown billing',async()=>{
  let calls=0;
  const client=createDecisionClient('mock',model,async()=>{calls++;return new Response('untrusted body',{status:429});});
  await assert.rejects(()=>client.decide(request),/HTTP 429/);assert.equal(calls,1);
});

test('oversized evidence is rejected before network rather than silently truncated',async()=>{
  let calls=0;
  const client=createDecisionClient('mock',model,async()=>{calls++;throw new Error('Unexpected network');});
  await assert.rejects(()=>client.decide({...request,state:'א'.repeat(DECISION_REQUEST_BYTES)}),/not truncated/);
  assert.equal(calls,0);
});

test('configuration defaults off, selects approved Perplexity model, requires calibrated policy and rejects auto',()=>{
  assert.equal(decisionPolicy({}),undefined);
  assert.deepEqual(DISABLED_FALLBACK_CANDIDATES,['liquid/d1.1','typesafe/jev-1.14']);
  const env={REALNEWS_GROUPING:'decisions',OPENROUTER_API_KEY:'mock',REALNEWS_DECISION_MODEL:model,REALNEWS_DECISION_THRESHOLD:'0.9'};
  assert.equal(decisionPolicy(env)?.model,model);
  assert.equal(SELECTED_DECISION_MODEL,'perplexity/pplx-decider-v1.3:free');
  assert.equal(decisionPolicy({...env,REALNEWS_DECISION_MODEL:undefined})?.model,SELECTED_DECISION_MODEL);
  assert.equal(decisionPolicy({...env,REALNEWS_DECISION_MODEL:undefined})?.verification,false);
  assert.equal(decisionPolicy({...env,REALNEWS_GROUPING:'lexical',REALNEWS_VERIFICATION:'decisions',REALNEWS_DECISION_MODEL:undefined})?.model,SELECTED_DECISION_MODEL);
  for(const threshold of [undefined,'NaN','0.5','1','-1'])assert.throws(()=>decisionPolicy({...env,REALNEWS_DECISION_THRESHOLD:threshold}));
  for(const value of ['', 'openrouter/auto']){
    assert.throws(()=>decisionPolicy({...env,REALNEWS_DECISION_MODEL:value}));
    assert.throws(()=>decisionBody(value,request));
  }
  assert.throws(()=>decisionPolicy({...env,OPENROUTER_API_KEY:undefined}));
});
