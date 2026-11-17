import { readFileSync, writeFileSync } from 'node:fs';
import { groupOf } from '../src/config.ts';

function validSummary(story: any): boolean {
  const value = story.synthesis;
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).some((k) => k !== 'sides') ||
    !value.sides ||
    typeof value.sides !== 'object' ||
    !Array.isArray(story.articles)
  )
    return false;
  if (Object.keys(value.sides).some((k) => !['left', 'center', 'right'].includes(k))) return false;
  for (const side of ['left', 'center', 'right']) {
    const rows = value.sides[side]?.summary;
    if (!Array.isArray(rows) || rows.length > 6) return false;
    for (const row of rows) {
      if (
        !row ||
        typeof row.text !== 'string' ||
        !row.text.trim() ||
        row.text.length > (row.evidence_kind === 'side_membership' ? 3900 : 650) ||
        !Array.isArray(row.article_ids) ||
        !row.article_ids.length ||
        row.article_ids.some(
          (id: any) =>
            !Number.isInteger(id) ||
            !story.articles[id] ||
            groupOf(story.articles[id].side) !== side,
        ) ||
        (row.evidence_kind !== undefined && row.evidence_kind !== 'side_membership')
      )
        return false;
      if (row.evidence_kind === 'side_membership') {
        const expected = story.articles.flatMap((a: any, i: number) =>
          groupOf(a.side) === side ? [i] : [],
        );
        if (JSON.stringify(row.article_ids) !== JSON.stringify(expected)) return false;
      }
    }
  }
  return true;
}

function validComparison(story: any): boolean {
  const c = story.comparison;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  if (c.status !== 'ready' && c.status !== 'no_difference') return false;
  if (!Array.isArray(c.bullets) || c.bullets.length > 3) return false;
  if ((c.status === 'ready') !== c.bullets.length > 0) return false;
  for (const b of c.bullets) {
    if (!b || typeof b !== 'object' || Object.keys(b).some((k) => !['right', 'left'].includes(k)))
      return false;
    let any = false;
    for (const side of ['right', 'left']) {
      const s = b[side];
      if (s === undefined) continue;
      any = true;
      if (
        !s ||
        typeof s.text !== 'string' ||
        !s.text.trim() ||
        s.text.length > 250 ||
        !Array.isArray(s.article_ids) ||
        !s.article_ids.length ||
        s.article_ids.length > 4 ||
        s.article_ids.some(
          (id: any) =>
            !Number.isInteger(id) ||
            !story.articles[id] ||
            groupOf(story.articles[id].side) !== side,
        )
      )
        return false;
    }
    if (!any) return false;
  }
  return true;
}

export function publicationGate(data: any, allowModelGrouping = false) {
  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray(data.stories) ||
    data.stories.some((s: any) => !s || typeof s !== 'object' || Array.isArray(s))
  )
    throw new Error('Publication blocked: malformed digest');
  if (data.grouping && data.grouping.complete !== true) {
    const g = data.grouping;
    const counts = [g.input_articles, g.published_articles, g.omitted_articles, g.omitted_groups];
    const articles = data.stories.flatMap((s: any) =>
      Array.isArray(s.articles) ? s.articles : [],
    );
    const ids = articles.map((a: any) => a.article_id);
    if (
      g.complete !== false ||
      g.partial !== true ||
      counts.some((n) => !Number.isSafeInteger(n) || n < 0) ||
      g.input_articles !== g.published_articles + g.omitted_articles ||
      articles.length !== g.published_articles ||
      ids.some((id: any) => typeof id !== 'string' || !id) ||
      new Set(ids).size !== ids.length ||
      data.stories.some((s: any) => s.grouping_status !== 'schema_assigned')
    )
      throw new Error('Publication blocked: incomplete grouping without valid partial manifest');
  }
  if (
    data.stories.some(
      (s: any) =>
        s.grouping_status === 'unvalidated' || s.synthesis_status === 'grouping_unvalidated',
    )
  )
    throw new Error('Publication blocked: unvalidated membership');
  if (data.grouping && !allowModelGrouping)
    throw new Error('Publication blocked: model grouping not enabled for publication');
  return {
    ...data,
    stories: data.stories.map((story: any) => {
      // An invalid comparison is dropped on its own; it never affects the story or its summary.
      if (story.comparison && !validComparison(story)) {
        const { comparison, ...withoutComparison } = story;
        story = withoutComparison;
      }
      if (story.synthesis_status === 'ready' && validSummary(story)) return story;
      if (!story.synthesis && story.synthesis_status !== 'ready') return story;
      const { synthesis, ...sourceOnly } = story;
      return {
        ...sourceOnly,
        synthesis_status:
          story.synthesis_status === 'ready' ? 'invalid_summary' : story.synthesis_status,
      };
    }),
  };
}

if (process.argv[1]?.endsWith('/publication-gate.ts')) {
  const path = 'site/data.json';
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const publishable = publicationGate(data, true);
  const before = data.stories.filter((story: any) => !!story.comparison).length;
  const after = publishable.stories.filter((story: any) => !!story.comparison).length;
  console.error(
    `comparison publication gate: ${JSON.stringify({ before, after, stripped: before - after })}`,
  );
  writeFileSync(path, JSON.stringify(publishable, null, 1));
}
