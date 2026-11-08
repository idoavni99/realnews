/** A valid schema is not semantic proof. Owner can opt into unattended grouping-only publication. */
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
export function publicationGate(data:any,approval?:any,allowGroupingOnly=false) {
  if(data.grouping&&!data.grouping.complete)throw new Error('Publication blocked: incomplete grouping');
  if(data.stories?.some((s:any)=>s.grouping_status==='unvalidated'))throw new Error('Publication blocked: unvalidated membership');
  if(data.stories?.some((s:any)=>s.synthesis && s.synthesis_status!=='ready'))throw new Error('Publication blocked: unverified summary');
  const hasSummaries=data.stories?.some((s:any)=>s.synthesis_status==='ready');
  const experimental=(!!data.grouping&&!allowGroupingOnly)||hasSummaries;
  if(experimental) {
    const hash=createHash('sha256').update(JSON.stringify(data)).digest('hex');
    if(approval?.data_sha256!==hash||approval?.grouping_quality_approved!==true||approval?.summary_quality_approved!==true)
      throw new Error('Publication blocked: missing exact-data human quality approval (grouping and summaries)');
  }
}
if(process.argv[1]?.endsWith('/publication-gate.ts')) {
  const data=JSON.parse(readFileSync('site/data.json','utf8'));
  const path='.review/release-approval.json';
  publicationGate(data,existsSync(path)?JSON.parse(readFileSync(path,'utf8')):undefined,process.env.REALNEWS_AUTOPUBLISH_GROUPING==='true');
}
