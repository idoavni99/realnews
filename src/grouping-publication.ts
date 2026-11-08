import {articleRegistry, resolveArticles} from './article-registry.ts';
import type {FeedItem} from './rss.ts';
import type {GroupingResult} from './grouping.ts';

export function publishableGroups(result: GroupingResult, items: FeedItem[]) {
  const registry=articleRegistry(items);
  const seen=new Set<string>();
  const names=new Set<string>();
  for (const group of result.groups) {
    if (names.has(group.id) || !group.articleIds.length || !['schema_assigned','unvalidated'].includes(group.grouping))
      throw new Error('Invalid grouping partition');
    names.add(group.id);
    const members=resolveArticles(group.articleIds,registry);
    if (JSON.stringify(members)!==JSON.stringify(group.items))
      throw new Error('Grouping provenance mismatch');
    for (const id of group.articleIds) {
      if (seen.has(id)) throw new Error('Duplicate grouping membership');
      seen.add(id);
    }
  }
  if (seen.size!==registry.size) throw new Error('Incomplete grouping article partition');
  const groups=result.groups.filter(g=>g.grouping==='schema_assigned');
  const retained=groups.reduce((n,g)=>n+g.articleIds.length,0);
  const omitted=registry.size-retained;
  if (result.complete && omitted) throw new Error('Inconsistent grouping completion');
  return {groups,manifest:{mode:'model',complete:result.complete,
    unvalidated_articles:result.unvalidated_articles,partial:!result.complete,
    input_articles:registry.size,published_articles:retained,omitted_articles:omitted,
    omitted_groups:result.groups.length-groups.length}};
}
