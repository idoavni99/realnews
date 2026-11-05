import {createHash} from 'node:crypto';
import type {FeedItem} from './rss.ts';
export function canonicalUrl(raw:string):string {
 const u=new URL(raw);u.hash='';
 for(const key of [...u.searchParams.keys()])if(key.startsWith('utm_')||['fbclid','gclid'].includes(key))u.searchParams.delete(key);
 return u.href;
}
/** Preserve existing IDs; detect rather than silently overwrite a shortened-hash collision. */
export const articleId=(url:string):string=>'a_'+createHash('sha256').update(canonicalUrl(url)).digest('hex').slice(0,12);
export function articleRegistry(items:FeedItem[],idFor:(url:string)=>string=articleId):Map<string,FeedItem> {
 const map=new Map<string,FeedItem>();
 for(const item of items){
  const id=idFor(item.url);const previous=map.get(id);
  if(previous){
   if(canonicalUrl(previous.url)!==canonicalUrl(item.url))throw new Error('Article ID collision: '+id);
   if(previous.source!==item.source||previous.side!==item.side)throw new Error('Conflicting duplicate article provenance: '+id);
   // Same canonical URL is one article. Preserve the first observation, never silently merge bodies.
  }else map.set(id,item);
 }
 return map;
}
export function resolveArticles(ids:string[],registry:Map<string,FeedItem>):FeedItem[]{
 if(new Set(ids).size!==ids.length)throw new Error('Duplicate article membership');
 return ids.map(id=>{const item=registry.get(id);if(!item)throw new Error('Unknown article membership: '+id);return item;});
}
