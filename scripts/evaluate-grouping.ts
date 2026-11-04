/** Bounded labelled grouping evaluation, no summaries/feed/publication. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createOpenRouterClient} from '../src/llm.ts';
import {groupArticles,articleId} from '../src/grouping.ts';
const positivesAndNegatives=JSON.parse(readFileSync(new URL('../test/fixtures/grouping-evaluation.json',import.meta.url),'utf8'));
const captured=JSON.parse(readFileSync(new URL('../test/fixtures/free-router-false-merges.json',import.meta.url),'utf8')).cases;
const pairs=[...positivesAndNegatives.map((x:any)=>({id:x.id,expected:x.expected_same,articles:[x.a,x.b]})),...captured.map((x:any)=>({id:x.case_id,expected:false,articles:x.articles}))];
const unique=new Map<string,any>();
const sourceId=(s:string)=>({Ynet:'ynet',Maariv:'maariv',i24NEWS:'i24','הארץ':'haaretz','סרוגים':'srugim'}[s]||s);
// First members before second members so repeated events exercise checkpoint carryover.
for(const turn of [0,1])for(const p of pairs){const a=p.articles[turn];if(!unique.has(a.url))unique.set(a.url,{...a,source:sourceId(a.source),sourceName:a.source,published:new Date(Date.UTC(2026,10,4,0,unique.size)).toISOString()});}
const key=process.env.OPENROUTER_API_KEY;if(!key)throw new Error('Secure key required');
const model=process.env.EVALUATION_MODEL||'openrouter/free';
if(!['openrouter/free','openrouter/auto'].includes(model))throw new Error('Unsupported evaluation route');
if(model==='openrouter/auto'){
 const response=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:`Bearer ${key}`}});
 if(!response.ok)throw new Error('Cannot verify auto key spending cap');
 const {data}=await response.json();
 if(!(typeof data.limit==='number'&&data.limit<=2&&data.limit_reset===null&&data.limit_remaining>0))throw new Error('Auto test requires a non-resetting key limit <=2.00USD');
}
const result=await groupArticles([...unique.values()],createOpenRouterClient(key,model),{batchTokens:6000,maxOutputTokens:4000,maxArticlesPerBatch:6,maxCalls:4,delayMs:5000});
const judgments=pairs.map((p:any)=>{const gs=p.articles.map((a:any)=>result.groups.find(g=>g.articleIds.includes(articleId(a.url)))!);const scored=gs.every((g:any)=>g.grouping==='schema_assigned');const same=gs[0].id===gs[1].id;return {id:p.id,expected_same:p.expected,observed_same:same,scored,correct:scored?same===p.expected:null};});
const out={route:model,bound:{articles:unique.size,max_calls:4,max_output_tokens:4000,summaries:0},result,judgments,passed:result.complete&&judgments.every((j:any)=>j.correct===true)};
writeFileSync(process.env.EVALUATION_OUTPUT||'/tmp/realnews-broader-evaluation.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({bound:out.bound,calls:result.calls,complete:result.complete,unvalidated:result.unvalidated_articles,passed:out.passed,batches:result.batches.map(b=>({index:b.index,status:b.status,error:b.error,diagnostics:b.diagnostics})),judgments},null,2));
