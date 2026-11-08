import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publishableGroups} from '../src/grouping-publication.ts';
import {articleId} from '../src/article-registry.ts';
import {publicationGate} from '../scripts/publication-gate.ts';
import type {FeedItem} from '../src/rss.ts';
import type {GroupingResult} from '../src/grouping.ts';
const items=['a','b','c','d'].map(id=>({url:'https://example.com/'+id,source:id,sourceName:id,
  side:'center',title:id,summary:'source text',published:'2026-11-08T18:00:00Z'})) as FeedItem[];
function result(): GroupingResult {
  return {complete:false,unvalidated_articles:1,calls:2,batches:[],groups:[
    {id:'good',articleIds:items.slice(0,2).map(a=>articleId(a.url)),items:items.slice(0,2),grouping:'schema_assigned'},
    {id:'mixed',articleIds:items.slice(2).map(a=>articleId(a.url)),items:items.slice(2),grouping:'unvalidated'},
  ]};
}
test('omit entire mixed final group, retain exact successful group and honest counts',()=>{
  const source=result();const selected=publishableGroups(source,items);
  assert.deepEqual(selected.groups,[source.groups[0]]);
  assert.deepEqual(selected.manifest,{mode:'model',complete:false,partial:true,unvalidated_articles:1,
    input_articles:4,published_articles:2,omitted_articles:2,omitted_groups:1});
  assert.equal(source.groups.length,2);
  const data={grouping:selected.manifest,stories:[{grouping_status:'schema_assigned',synthesis_status:'unavailable',
    articles:items.slice(0,2).map(a=>({...a,article_id:articleId(a.url)}))}]};
  assert.equal(publicationGate(data,true).stories.length,1);
  assert.throws(()=>publicationGate(data),/not enabled/);
  for(const grouping of [{...selected.manifest,published_articles:3},{...selected.manifest,partial:false}])
    assert.throws(()=>publicationGate({...data,grouping},true),/partial manifest/);
  assert.throws(()=>publicationGate({...data,stories:[{...data.stories[0],grouping_status:'unvalidated'}]},true),/Publication blocked/);
});
test('unknown, duplicate, missing article or provenance corruption still blocks globally',()=>{
  const duplicate=result();duplicate.groups[1].articleIds[0]=duplicate.groups[0].articleIds[0];
  const missing=result();missing.groups.pop();
  const unknown=result();unknown.groups[1].articleIds[0]='a_unknown';
  const mismatch=result();mismatch.groups[0].items=[items[2],items[3]];
  const claimedComplete={...result(),complete:true};
  for(const bad of [duplicate,missing,unknown,mismatch,claimedComplete])
    assert.throws(()=>publishableGroups(bad,items));
});
test('all failed groups produce empty partial digest, not unvalidated fallback singletons',()=>{
  const source=result();source.groups.forEach(g=>g.grouping='unvalidated');
  const selected=publishableGroups(source,items);
  assert.equal(selected.groups.length,0);assert.equal(selected.manifest.omitted_articles,4);
  assert.equal(publicationGate({grouping:selected.manifest,stories:[]},true).stories.length,0);
});
