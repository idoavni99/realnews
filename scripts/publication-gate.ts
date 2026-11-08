import {readFileSync, writeFileSync} from 'node:fs';
import {groupOf} from '../src/config.ts';

function validSummary(story: any): boolean {
  const value=story.synthesis;
  if (!value || typeof value!=='object' || Object.keys(value).some(k=>k!=='sides') ||
    !value.sides || typeof value.sides!=='object' || !Array.isArray(story.articles)) return false;
  if (Object.keys(value.sides).some(k=>!['left','center','right'].includes(k))) return false;
  for (const side of ['left','center','right']) {
    const rows=value.sides[side]?.summary;
    if (!Array.isArray(rows) || rows.length>6) return false;
    for (const row of rows) {
      if (!row || typeof row.text!=='string' || !row.text.trim() ||
        row.text.length>(row.evidence_kind==='side_membership'?3900:650) ||
        !Array.isArray(row.article_ids) || !row.article_ids.length ||
        row.article_ids.some((id: any)=>!Number.isInteger(id) || !story.articles[id] || groupOf(story.articles[id].side)!==side) ||
        (row.evidence_kind!==undefined && row.evidence_kind!=='side_membership')) return false;
      if (row.evidence_kind==='side_membership') {
        const expected=story.articles.flatMap((a: any,i: number)=>groupOf(a.side)===side?[i]:[]);
        if (JSON.stringify(row.article_ids)!==JSON.stringify(expected)) return false;
      }
    }
  }
  return true;
}

export function publicationGate(data: any, allowModelGrouping=false) {
  if (!data || typeof data!=='object' || !Array.isArray(data.stories) ||
    data.stories.some((s: any)=>!s || typeof s!=='object' || Array.isArray(s)))
    throw new Error('Publication blocked: malformed digest');
  if (data.grouping && data.grouping.complete!==true) throw new Error('Publication blocked: incomplete grouping');
  if (data.stories.some((s: any)=>s.grouping_status==='unvalidated' || s.synthesis_status==='grouping_unvalidated'))
    throw new Error('Publication blocked: unvalidated membership');
  if (data.grouping && !allowModelGrouping) throw new Error('Publication blocked: model grouping not enabled for publication');
  return {...data,stories:data.stories.map((story: any)=>{
    if (story.synthesis_status==='ready' && validSummary(story)) return story;
    if (!story.synthesis && story.synthesis_status!=='ready') return story;
    const {synthesis,...sourceOnly}=story;
    return {...sourceOnly,synthesis_status:story.synthesis_status==='ready'?'invalid_summary':story.synthesis_status};
  })};
}

if (process.argv[1]?.endsWith('/publication-gate.ts')) {
  const path='site/data.json';
  const data=JSON.parse(readFileSync(path,'utf8'));
  const publishable=publicationGate(data,process.env.REALNEWS_AUTOPUBLISH_GROUPING==='true');
  writeFileSync(path,JSON.stringify(publishable,null,1));
}
