import {test} from 'node:test';import assert from 'node:assert/strict';
import {synthesisInput,synthesisSchema,synthesizeStory,validateSynthesis} from '../src/synthesis.ts';
import {createOpenRouterClient} from '../src/llm.ts';
const items=[{source:'a',sourceName:'a',side:'center',url:'https://example.com/a',title:'כותרת',summary:'פתיח',published:''},{source:'b',sourceName:'b',side:'right',url:'https://example.com/b',title:'כותרת',summary:'פתיח',published:''}];
const value={sides:{left:{summary:[]},center:{summary:[{text:'פתיח',article_ids:[0]}]},right:{summary:[{text:'פתיח',article_ids:[1]}]}}};
test('model sees one numeric citation identity; schema binds each side and forces absent side empty',()=>{
 assert.deepEqual(synthesisInput(items).map(x=>x.id),[0,1]);assert.ok(synthesisInput(items).every(x=>!('article_id' in x)));
 const s=synthesisSchema(items);assert.deepEqual(s.properties.sides.properties.center.properties.summary.items.properties.article_ids.items.enum,[0]);assert.deepEqual(s.properties.sides.properties.right.properties.summary.items.properties.article_ids.items.enum,[1]);assert.equal(s.properties.sides.properties.left.properties.summary.maxItems,0);
});
test('actual transport schema includes exact per-side integer enum',async()=>{
 const old=globalThis.fetch;let body:any;
 try{globalThis.fetch=async(_u,init)=>{body=JSON.parse(String(init?.body));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));};
 await synthesizeStory(items,createOpenRouterClient('not-a-real-key'));
 assert.deepEqual(body.response_format.json_schema.schema.properties.sides.properties.center.properties.summary.items.properties.article_ids.items.enum,[0]);assert.match(body.messages[0].content,/exact integer id/);
 }finally{globalThis.fetch=old;}
});
test('observed hash-derived IDs, stable strings and cross-side indices fail closed, never reconstructed',()=>{
 for(const id of [552181863348,-2739559,'a_552181863348','0',1]){
  const bad=structuredClone(value);bad.sides.center.summary[0].article_ids=[id] as any;assert.throws(()=>validateSynthesis(bad,items),/citation/);
 }
 assert.doesNotThrow(()=>validateSynthesis(value,items));
});
