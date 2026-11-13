import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runPolicy} from '../src/run-policy.ts';
import {publicationGate} from '../scripts/publication-gate.ts';
test('grouping and synthesis are independent, missing provider and bad call cap fail',()=>{
 assert.throws(()=>runPolicy({}),/no configured/);
 assert.deepEqual(runPolicy({OPENROUTER_API_KEY:'mock'}),{grouping:true,synthesis:false,maxCalls:60});
 assert.equal(runPolicy({REALNEWS_GROUPING:'model',OPENROUTER_API_KEY:'mock'}).synthesis,false);
 assert.equal(runPolicy({REALNEWS_SYNTHESIS_ENABLED:'true',OPENROUTER_API_KEY:'mock'}).grouping,true);
 assert.throws(()=>runPolicy({REALNEWS_GROUPING:'model'}),/no configured/);
 assert.throws(()=>runPolicy({REALNEWS_MAX_CALLS:'NaN',OPENROUTER_API_KEY:'mock'}),/Invalid/);
});
test('publication still blocks malformed and incomplete grouping without a manual approval path',()=>{
 for(const data of [null,{}, {stories:[null]}, {grouping:{complete:false},stories:[]},
  {stories:[{grouping_status:'unvalidated'}]}, {stories:[{synthesis_status:'grouping_unvalidated'}]}]) {
  assert.throws(()=>publicationGate(data,true),/Publication blocked/);
 }
 publicationGate({stories:[]});
 assert.throws(()=>publicationGate({grouping:{complete:true},stories:[]}),/model grouping not enabled/);
 publicationGate({grouping:{complete:true},stories:[]},true);
});
