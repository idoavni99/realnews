/** Isolated evaluation only. Never fetches feeds, groups stories or publishes data. */
import {synthesizeStory, synthesisInput, type StorySynthesis} from './synthesis.ts';
import {verifyCandidates} from './verification.ts';
import {LlmOutputError, type LlmClient} from './llm.ts';
import type {FeedItem} from './rss.ts';
import {createHash} from 'node:crypto';

export async function evaluateSummary(items:FeedItem[],provider:LlmClient) {
 const input=synthesisInput(items);
 const calls:any[]=[];
 const llm:LlmClient={async generateJson(req){
  const start=performance.now();const row:any={stage:req.label,status:'started',output_limit:req.maxOutputTokens};calls.push(row);
  try {const response=await provider.generateJson(req);row.status='returned';row.usage=response.usage;row.diagnostics=response.diagnostics;return response;}
  catch(e){row.status='failed';if(e instanceof LlmOutputError){row.diagnostics=e.diagnostics;row.usage=e.diagnostics?.usage;}throw e;}
  finally{row.duration_ms=performance.now()-start;}
 }};
 let phase='synthesis';let draft:StorySynthesis|undefined;let verdicts:unknown;let status='error';let error:string|undefined;
 try {
  draft=await synthesizeStory(items,llm);phase='verification';
  const result=await verifyCandidates(items,[{id:'summary',summary:draft}],llm);verdicts=result;
  status=result[0].supported?'supported':'rejected';
 }catch(e){error=(e as Error).message.slice(0,250);}
 return {input_sha256:createHash('sha256').update(JSON.stringify(input)).digest('hex'),article_count:items.length,status,phase,error,draft,verdicts,calls,
  accounting:{attempts:calls.length,reported_cost_usd:calls.reduce((n,r)=>n+(typeof r.usage?.cost==='number'?r.usage.cost:0),0),missing_cost_records:calls.filter(r=>typeof r.usage?.cost!=='number').length},
  caveat:'A verifier acceptance is not independent proof of fidelity. Mock tests measure control flow, not model quality.'};
}
