/** One-call continuation of a saved local sample. No feed/synthesis/publication. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createOpenRouterClient,LlmOutputError} from '../src/llm.ts';
import {articleId,validateAssignments,GROUPING_INSTRUCTIONS,groupingSchema} from '../src/grouping.ts';
const saved=JSON.parse(readFileSync(process.env.SAMPLE_PREVIOUS||'/tmp/realnews-sample-second.json','utf8'));
const accepted=saved.result.groups.filter((g:any)=>g.grouping==='schema_assigned');
if(accepted.length!==5||accepted.some((g:any)=>g.items.length!==1))throw new Error('Expected saved five accepted singleton groups');
const prior=accepted.sort((a:any,b:any)=>Date.parse(a.items[0].published)-Date.parse(b.items[0].published));
const checkpoint={stories:prior.map((g:any,i:number)=>({id:'s'+(i+1),title:g.items[0].title,brief:g.items[0].summary.slice(0,160),count:1}))};
const remaining=saved.result.groups.filter((g:any)=>g.grouping==='unvalidated').flatMap((g:any)=>g.items).sort((a:any,b:any)=>Date.parse(a.published)-Date.parse(b.published));
if(remaining.length!==5)throw new Error('Expected five remaining articles');
const input={checkpoint,new_articles:remaining.map((a:any)=>({id:articleId(a.url),source:a.sourceName,title:a.title,lead:a.summary.slice(0,280)}))};
const key=process.env.OPENROUTER_API_KEY;if(!key)throw new Error('Secure key required');
let out:any={input,route:'openrouter/free',call_bound:1};
try{
 const r=await createOpenRouterClient(key,'openrouter/free').generateJson({label:'Grouping',system:GROUPING_INSTRUCTIONS,input,schema:groupingSchema(checkpoint.stories.map(s=>s.id),input.new_articles.map(a=>a.id)),temperature:0,maxOutputTokens:2000});
 const plan=validateAssignments(r.json,input.new_articles.map(a=>a.id),new Set(checkpoint.stories.map(a=>a.id)));
 const label=new Map<string,string>();prior.forEach((g:any,i:number)=>label.set(g.articleIds[0],'s'+(i+1)));
 for(const [id,a] of plan)label.set(id,a.story_id||'new:'+a.new_key);
 out={...out,status:'schema_assigned',response:r,judgments:saved.judgments.map((j:any,i:number)=>{const a=prior[i].articleIds[0];const b=articleId(remaining[i].url);const same=label.get(a)===label.get(b);return {...j,observed_same:same,schema_assigned:true,correct:same===j.expected_same};})};
}catch(e){out={...out,status:'unavailable',error:(e as Error).message,diagnostics:e instanceof LlmOutputError?e.diagnostics:undefined};}
writeFileSync('/tmp/realnews-sample-continuation.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({status:out.status,error:out.error,diagnostics:out.response?.diagnostics||out.diagnostics,judgments:out.judgments},null,2));
