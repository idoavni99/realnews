import { test } from 'node:test';
import assert from 'node:assert/strict';
import {createOpenRouterClient, LlmOutputError} from '../src/llm.ts';
const req = {label:'Grouping',system:'s',input:{},schema:{type:'OBJECT'},temperature:0,maxOutputTokens:200} as const;
test('structured-output route requires parameter support and retains safe model metadata', async()=>{
 const old=globalThis.fetch;
 try {
  globalThis.fetch=async(_u,init)=>{
   const b=JSON.parse(String(init?.body));assert.equal(b.provider.require_parameters,true);
   assert.equal(b.model,'openrouter/free');assert.equal(b.response_format.json_schema.strict,true);
   return new Response(JSON.stringify({model:'selected/free',provider:'example',usage:{cost:0},choices:[{finish_reason:'stop',message:{content:'{"assignments":[]}'}}]}));
  };
  const r=await createOpenRouterClient('not-real','openrouter/free').generateJson(req);
  assert.equal(r.diagnostics?.model,'selected/free');assert.equal(r.diagnostics?.finish_reason,'stop');assert.equal(r.usage?.cost,0);
 }finally{globalThis.fetch=old;}
});
test('malformed, empty and truncated outputs fail with metadata, never raw response text',async()=>{
 const old=globalThis.fetch;
 try {
  for(const [text,finish,kind] of [['**private raw content**','stop','Invalid JSON'],['','stop','Empty'],['{}','length','Truncated']]){
   globalThis.fetch=async()=>new Response(JSON.stringify({model:'selected/free',usage:{cost:0},choices:[{finish_reason:finish,message:{content:text}}]}));
   await assert.rejects(createOpenRouterClient('not-real','openrouter/free').generateJson(req),e=>{assert.ok(e instanceof LlmOutputError);assert.ok(e.message.startsWith(kind));assert.ok(!e.message.includes('private raw'));assert.equal(e.diagnostics?.model,'selected/free');return true;});
  }
 }finally{globalThis.fetch=old;}
});
