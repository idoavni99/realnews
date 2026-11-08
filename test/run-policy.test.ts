import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runPolicy} from '../src/run-policy.ts';
import {publicationGate} from '../scripts/publication-gate.ts';
import {createHash} from 'node:crypto';
test('grouping and synthesis are independent, missing provider and bad call cap fail',()=>{
 assert.deepEqual(runPolicy({}),{grouping:false,synthesis:false,maxCalls:60});
 assert.equal(runPolicy({REALNEWS_GROUPING:'model',OPENROUTER_API_KEY:'mock'}).synthesis,false);
 assert.equal(runPolicy({REALNEWS_SYNTHESIS_ENABLED:'true',OPENROUTER_API_KEY:'mock'}).grouping,false);
 assert.throws(()=>runPolicy({REALNEWS_GROUPING:'model'}),/no configured/);
 assert.throws(()=>runPolicy({REALNEWS_MAX_CALLS:'NaN'}),/Invalid/);
});
test('publication fails closed on incomplete membership, failed summaries and unapproved experiment',()=>{
 publicationGate({stories:[]});
 for(const data of [{grouping:{complete:false},stories:[]},{stories:[{grouping_status:'unvalidated'}]},{stories:[{synthesis_status:'rejected',synthesis:{}}]},{grouping:{complete:true},stories:[]}])assert.throws(()=>publicationGate(data),/Publication blocked/);
 const data={grouping:{complete:true},stories:[]};
 const approval={data_sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex'),grouping_quality_approved:true,summary_quality_approved:true};
 publicationGate(data,approval);
 assert.throws(()=>publicationGate({...data,generated_at:'changed'},approval),/missing exact-data/);
});


test('explicit unattended grouping opt-in never approves summaries or incomplete membership',()=>{
 publicationGate({grouping:{complete:true},stories:[{synthesis_status:'not_configured'}]},undefined,true);
 for(const data of [{grouping:{complete:false},stories:[]},{grouping:{complete:true},stories:[{grouping_status:'unvalidated'}]},{grouping:{complete:true},stories:[{synthesis_status:'ready'}]}])assert.throws(()=>publicationGate(data,undefined,true),/Publication blocked/);
});
