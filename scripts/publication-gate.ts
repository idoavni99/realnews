/** A green build/valid schema is not a semantic release approval. No auto override. */
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
export function publicationGate(data:any,approval?:any) {
  if(data.grouping&&!data.grouping.complete)throw new Error('Publication blocked: incomplete grouping');
  if(data.stories?.some((s:any)=>s.grouping_status==='unvalidated'))throw new Error('Publication blocked: unvalidated membership');
  if(data.stories?.some((s:any)=>['rejected','unavailable','grouping_unvalidated'].includes(s.synthesis_status)))throw new Error('Publication blocked: failed summary stage');
  const experimental=!!data.grouping||data.stories?.some((s:any)=>s.synthesis_status==='ready');
  if(experimental) {
    const hash=createHash('sha256').update(JSON.stringify(data)).digest('hex');
    if(approval?.data_sha256!==hash||approval?.grouping_quality_approved!==true||approval?.summary_quality_approved!==true)
      throw new Error('Publication blocked: missing exact-data human quality approval (grouping and summaries)');
  }
}
if(process.argv[1]?.endsWith('/publication-gate.ts')) {
  const data=JSON.parse(readFileSync('site/data.json','utf8'));
  const path='.review/release-approval.json';
  publicationGate(data,existsSync(path)?JSON.parse(readFileSync(path,'utf8')):undefined);
}
