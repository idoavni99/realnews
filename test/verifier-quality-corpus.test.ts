import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {attachSummaryMembership} from '../src/synthesis.ts';
const corpus=JSON.parse(readFileSync(new URL('./fixtures/verifier-quality-bezeq.json',import.meta.url),'utf8'));
test('human-labeled quality corpus includes positive and single semantic errors, all passing local guards',()=>{
 assert.equal(corpus.cases.length,6);assert.equal(corpus.cases.filter((c:any)=>c.expected_supported).length,1);
 for(const c of corpus.cases){assert.doesNotThrow(()=>attachSummaryMembership(c.model_prose,corpus.articles));assert.ok(c.expected_reason.length>20);}
 assert.deepEqual(new Set(corpus.cases.slice(1).map((c:any)=>c.mutation)),new Set(['wrong_place','lost_mou_uncertainty','source_swap','negated_extension','wrong_existing_number']));
});
test('three genuine saved story subsets cover political sides and all semantic cases pass local shape/number guards',()=>{
 const multi=JSON.parse(readFileSync(new URL('./fixtures/verifier-quality-multistory.json',import.meta.url),'utf8'));
 assert.equal(multi.stories.length,3);let count=0;
 for(const s of multi.stories){assert.ok(new Set(s.articles.map((a:any)=>a.source)).size>=2);for(const c of s.cases){assert.doesNotThrow(()=>attachSummaryMembership(c.model_prose,s.articles),s.id+'/'+c.id);count++;}}
 assert.equal(count,12);assert.equal(multi.stories.flatMap((s:any)=>s.cases).filter((c:any)=>c.expected_supported).length,3);
});
