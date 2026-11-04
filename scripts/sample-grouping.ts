/** Local fixed-sample experiment. Never fetches feeds, writes site data, or uses a paid model. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createOpenRouterClient} from '../src/llm.ts';
import {groupArticles,articleId} from '../src/grouping.ts';
const positives=JSON.parse(readFileSync(new URL('../test/fixtures/grouping-evaluation.json',import.meta.url),'utf8')).filter((x:any)=>x.expected_same).slice(0,2);
const negatives=JSON.parse(readFileSync(new URL('../test/fixtures/free-router-false-merges.json',import.meta.url),'utf8')).cases.slice(0,3);
const pairs=[...positives.map((x:any)=>({id:x.id,expected:true,articles:[x.a,x.b]})),...negatives.map((x:any)=>({id:x.case_id,expected:false,articles:x.articles}))];
const key=process.env.OPENROUTER_API_KEY;if(!key)throw new Error('OPENROUTER_API_KEY required. Never put the key in command arguments.');
// Two batches, with one member of each pair per batch. Stable ordering makes cross-batch evaluation reproducible.
const items=[0,1].flatMap(turn=>pairs.map((p:any,i:number)=>({...p.articles[turn],sourceName:p.articles[turn].source,published:new Date(Date.UTC(2026,10,4,turn,i)).toISOString()})));
const r=await groupArticles(items,createOpenRouterClient(key,'openrouter/free'),{batchTokens:6000,maxOutputTokens:400,maxCalls:2,delayMs:5000});
const judgments=pairs.map((p:any)=>{
 const ids=p.articles.map((a:any)=>articleId(a.url));const gs=ids.map((id:string)=>r.groups.find(g=>g.articleIds.includes(id))!);
 const eligible=gs.every((g:any)=>g.grouping==='schema_assigned');
 return {id:p.id,expected_same:p.expected,observed_same:gs[0].id===gs[1].id,schema_assigned:eligible,correct:eligible?(gs[0].id===gs[1].id)===p.expected:null};
});
const out={route:'openrouter/free',bound:{articles:items.length,max_calls:2,summary_calls:0},result:r,judgments};
writeFileSync(process.env.SAMPLE_OUTPUT||'/tmp/realnews-sample.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({calls:r.calls,complete:r.complete,unvalidated:r.unvalidated_articles,batches:r.batches.map(b=>({status:b.status,error:b.error,diagnostics:b.diagnostics})),judgments},null,2));
