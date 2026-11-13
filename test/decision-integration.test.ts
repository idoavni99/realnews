import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditedClient,auditedDecisionClient} from '../src/call-audit.ts';
import {LlmOutputError} from '../src/llm.ts';
import {runPolicy} from '../src/run-policy.ts';

const decisionRequest={label:'Verification' as const,state:{},questions:{accepted:{type:'noul' as const,instructions:'Supported?'}}};

test('decision and generative requests share durable accounting, missing cost is unknown, and errors retain usage',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'decision-audit-'));
  try{
    const path=join(dir,'calls.json');const calls:any[]=[];
    const llm=auditedClient({async generateJson(){return {json:{}};}},path,calls);
    const decision=auditedDecisionClient({async decide(){throw new LlmOutputError('Rejected',{requested_model:'mock',content_chars:0,usage:{cost:0.01}});}},path,calls);
    await llm.generateJson({label:'Synthesis',system:'',input:{},schema:{},temperature:0,maxOutputTokens:1});
    await assert.rejects(()=>decision.decide(decisionRequest));
    const snapshot=JSON.parse(readFileSync(path,'utf8'));
    assert.deepEqual(snapshot.calls.map((call:any)=>[call.stage,call.status]),[['Synthesis','returned'],['Verification','failed']]);
    assert.equal(snapshot.calls[0].usage,undefined);assert.equal(snapshot.calls[1].usage.cost,0.01);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('pipeline imports and decision config reject unsupported auto before fetching feeds or calling any provider',()=>{
  assert.equal(runPolicy({REALNEWS_GROUPING:'decisions',OPENROUTER_API_KEY:'mock'}).grouping,true);
  const result=spawnSync(process.execPath,['src/pipeline.ts'],{encoding:'utf8',env:{...process.env,REALNEWS_GROUPING:'decisions',REALNEWS_DECISION_MODEL:'openrouter/auto',REALNEWS_DECISION_THRESHOLD:'0.9',OPENROUTER_API_KEY:'mock'}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/explicit REALNEWS_DECISION_MODEL/);
  assert.doesNotMatch(result.stderr,/ReferenceError|SyntaxError|FAILED|items\n/);
});

test('default path cannot silently fall back to old grouping/verifier toggles or require old publication enable flag',()=>{
  assert.equal(runPolicy({OPENROUTER_API_KEY:'mock',REALNEWS_GROUPING:'lexical'}).grouping,true);
  const workflow=readFileSync(new URL('../.github/workflows/daily.yml',import.meta.url),'utf8');
  assert.doesNotMatch(workflow,/inputs\.grouping|REALNEWS_AUTOPUBLISH_GROUPING|REALNEWS_GROUPING:/);
  const gate=readFileSync(new URL('../scripts/publication-gate.ts',import.meta.url),'utf8');
  assert.match(gate,/publicationGate\(data,true\)/);
});
