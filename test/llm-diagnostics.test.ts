import { test } from 'node:test';
import assert from 'node:assert/strict';
import {createOpenRouterClient, LlmOutputError} from '../src/llm.ts';
const req = {label:'Grouping',system:'s',input:{},schema:{type:'OBJECT'},temperature:0,maxOutputTokens:200} as const;
test('structured-output route requires parameter support and retains safe model metadata', async()=>{
 const old=globalThis.fetch;
 try {
  globalThis.fetch=async(_u,init)=>{
   const b=JSON.parse(String(init?.body));assert.equal(b.provider.require_parameters,true);assert.deepEqual(b.reasoning,{effort:'low'});
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

test('flat grouping schema reaches transport with required article and target enums',async()=>{
 const {groupingSchema}=await import('../src/grouping.ts');const old=globalThis.fetch;
 try{
  globalThis.fetch=async(_u,init)=>{
   const b=JSON.parse(String(init?.body));const row=b.response_format.json_schema.schema.properties.assignments.items;
   assert.deepEqual(row.required,['article_id','target']);assert.deepEqual(row.properties.article_id.enum,['a']);
   assert.deepEqual(row.properties.target.enum,['s1','new:1']);assert.equal(row.oneOf,undefined);assert.equal(row.additionalProperties,false);
   return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"assignments":[{"article_id":"a","target":"s1"}]}'}}]}));
  };
  await createOpenRouterClient('not-real','openrouter/free').generateJson({...req,schema:groupingSchema(['s1'],['a'])});
 }finally{globalThis.fetch=old;}
});

test('HTTP errors retain bounded retry metadata without raw provider body',async()=>{
 const old=globalThis.fetch;
 try {globalThis.fetch=async()=>new Response('private provider body',{status:429,headers:{'retry-after':'60'}});
 await assert.rejects(createOpenRouterClient('not-real').generateJson(req),e=>{
 assert.ok(e instanceof LlmOutputError);assert.equal(e.diagnostics?.http_status,429);assert.equal(e.diagnostics?.retry_after,'60');assert.ok(!e.message.includes('private'));return true;});
 }finally{globalThis.fetch=old;}
});
