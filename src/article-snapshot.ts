import {createHash,randomUUID} from 'node:crypto';
import {articleId,articleRegistry,resolveArticles} from './article-registry.ts';
import type {FeedItem} from './rss.ts';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createArticleSnapshot(items:FeedItem[]) {
 const articles=Object.fromEntries(articleRegistry(items));
 return {version:1,run_id:randomUUID(),generated_at:new Date().toISOString(),content_sha256:digest(articles),articles};
}
export function validateArticleSnapshot(value:any) {
 if(value?.version!==1||typeof value.run_id!=='string'||!value.run_id||!Number.isFinite(Date.parse(value.generated_at))||!value.articles||Array.isArray(value.articles)||typeof value.articles!=='object')throw new Error('Invalid article snapshot manifest');
 if(digest(value.articles)!==value.content_sha256)throw new Error('Article snapshot content hash mismatch');
 for(const [id,a] of Object.entries(value.articles) as [string,FeedItem][]){
  if(!a||typeof a.url!=='string'||typeof a.title!=='string'||typeof a.summary!=='string'||typeof a.source!=='string'||typeof a.sourceName!=='string'||typeof a.side!=='string'||typeof a.published!=='string'||(a.fulltext!==undefined&&typeof a.fulltext!=='string')||!['full','partial','lead_only'].includes(a.extraction||'lead_only')||articleId(a.url)!==id)throw new Error('Invalid snapshot article: '+id);
 }
 articleRegistry(Object.values(value.articles));return value;
}
/** Explicit historical replay only. Never select by file age or silently fetch a replacement. */
export function snapshotStory(snapshot:any,grouping:any,storyId:string):FeedItem[]{
 validateArticleSnapshot(snapshot);
 if(grouping?.snapshot_run_id!==snapshot.run_id||grouping?.snapshot_sha256!==snapshot.content_sha256)throw new Error('Grouping snapshot identity mismatch');
 if(!Array.isArray(grouping.groups)||grouping.complete!==true)throw new Error('Incomplete grouping snapshot');
 const groups=grouping.groups;const seen=new Set<string>();const names=new Set<string>();
 for(const g of groups){
  if(typeof g.id!=='string'||names.has(g.id)||!Array.isArray(g.articleIds)||!g.articleIds.length||g.grouping!=='schema_assigned')throw new Error('Invalid grouping membership');
  names.add(g.id);
  for(const id of g.articleIds){if(typeof id!=='string'||seen.has(id)||!Object.hasOwn(snapshot.articles,id))throw new Error('Duplicate or unknown grouping membership');seen.add(id);}
 }
 if(seen.size!==Object.keys(snapshot.articles).length)throw new Error('Incomplete snapshot article coverage');
 const group=groups.find((g:any)=>g.id===storyId);if(!group)throw new Error('Unknown story ID');
 return resolveArticles(group.articleIds,new Map(Object.entries(snapshot.articles)) as Map<string,FeedItem>);
}
