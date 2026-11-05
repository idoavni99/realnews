import {test} from 'node:test';import assert from 'node:assert/strict';
import {createArticleSnapshot,validateArticleSnapshot,snapshotStory} from '../src/article-snapshot.ts';
import {articleId} from '../src/article-registry.ts';
const a={source:'s',sourceName:'s',side:'center',title:'title',url:'https://example.com/a',summary:'lead',published:'2026-11-05T06:00:00Z',extraction:'lead_only'} as const;
const b={...a,url:'https://example.com/b'};
function fixture(){const snapshot=createArticleSnapshot([a,b]);return {snapshot,groups:{complete:true,snapshot_run_id:snapshot.run_id,snapshot_sha256:snapshot.content_sha256,groups:[{id:'story',grouping:'schema_assigned',articleIds:[articleId(b.url),articleId(a.url)]}]}};}
test('explicit saved story resolves exact ordered IDs and original evidence, irrespective of age',()=>{
 const {snapshot,groups}=fixture();snapshot.generated_at='2020-01-01T00:00:00Z';
 assert.deepEqual(snapshotStory(snapshot,groups,'story'),[b,a]);
});
test('snapshot rejects changed content, wrong run/hash/version, invalid article and unknown story',()=>{
 const {snapshot,groups}=fixture();const changed=structuredClone(snapshot);changed.articles[articleId(a.url)].summary='changed';assert.throws(()=>validateArticleSnapshot(changed),/hash/);
 for(const field of ['snapshot_run_id','snapshot_sha256'])assert.throws(()=>snapshotStory(snapshot,{...groups,[field]:'wrong'},'story'),/identity/);
 assert.throws(()=>validateArticleSnapshot({...snapshot,version:2}),/manifest/);
 assert.throws(()=>snapshotStory(snapshot,groups,'missing'),/Unknown story/);
});
test('saved grouping fails on duplicate, missing, unknown or unvalidated members',()=>{
 for(const ids of [[articleId(a.url),articleId(a.url)],[articleId(a.url)],['unknown']]){
  const {snapshot,groups}=fixture();groups.groups[0].articleIds=ids;assert.throws(()=>snapshotStory(snapshot,groups,'story'));
 }
 const {snapshot,groups}=fixture();groups.groups[0].grouping='unvalidated';assert.throws(()=>snapshotStory(snapshot,groups,'story'),/membership/);
});
