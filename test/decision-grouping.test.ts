import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupWithDecisions} from '../src/decision-grouping.ts';
import type {DecisionClient,DecisionRequest} from '../src/decisions.ts';
import type {FeedItem} from '../src/rss.ts';

const item=(id:string):FeedItem=>({source:'outlet',sourceName:'Outlet',side:'center',title:id,url:`https://example.com/${id}`,summary:`ראיה ${id}`,published:''});
const config={threshold:0.9,maxCalls:30};
function client(judge:(request:DecisionRequest,key:string)=>number):DecisionClient{
  return {async decide(request){return {answers:Object.fromEntries(Object.keys(request.questions).map(key=>[key,judge(request,key)])),diagnostics:{requested_model:'mock',content_chars:0}};}};
}
const titles=(result:Awaited<ReturnType<typeof groupWithDecisions>>)=>result.groups.map(group=>group.items.map(item=>item.title));

test('empty and first-singleton grouping need no inference or fabricated assignment',async()=>{
  const never=client(()=>{throw new Error('Must not call');});
  assert.equal((await groupWithDecisions([],never,config)).calls,0);
  const result=await groupWithDecisions([item('a')],never,config);
  assert.equal(result.complete,true);assert.deepEqual(titles(result),[['a']]);
});

test('only one complete accepted group merges, equality at threshold is explicit',async()=>{
  const result=await groupWithDecisions([item('a'),item('b')],client(()=>0.9),config);
  assert.deepEqual(titles(result),[['a','b']]);assert.equal(result.calls,1);
});

test('A-B and B-C must not transitively merge A-C when A-C is rejected',async()=>{
  const result=await groupWithDecisions(['a','b','c'].map(item),client((request,key)=>{
    const state=request.state as any;
    return state.article.title==='c'&&state.members[key].title==='a'?0.1:0.99;
  }),config);
  assert.deepEqual(titles(result),[['a','b'],['c']]);
});

test('two accepted groups remain ambiguous; neither first-match routing nor group fusion is allowed',async()=>{
  const result=await groupWithDecisions(['a','b','c'].map(item),client(request=>(request.state as any).article.title==='b'?0.1:0.99),config);
  assert.deepEqual(titles(result),[['a'],['b'],['c']]);
});

test('low certainty leaves valid separate stories, missing answer does not masquerade as no-match',async()=>{
  const separate=await groupWithDecisions(['a','b'].map(item),client(()=>0.89),config);
  assert.equal(separate.complete,true);assert.equal(separate.groups.length,2);
  const missing=await groupWithDecisions(['a','b'].map(item),client(()=>undefined as any),config);
  assert.equal(missing.complete,false);assert.equal(missing.unvalidated_articles,1);
});

test('transport failure and call cap hold remaining articles back, never fall back to lexical merging',async()=>{
  let calls=0;
  const broken:DecisionClient={async decide(){calls++;throw new Error('HTTP 503');}};
  const result=await groupWithDecisions(['a','b','c'].map(item),broken,config);
  assert.equal(calls,1);assert.equal(result.unvalidated_articles,2);assert.equal(result.groups.length,3);
  const capped=await groupWithDecisions(['a','b','c'].map(item),client(()=>0.99),{...config,maxCalls:0});
  assert.equal(capped.calls,0);assert.equal(capped.unvalidated_articles,2);
});

test('canonical duplicate articles do not increase decision work or outlet coverage',async()=>{
  const result=await groupWithDecisions([item('a'),item('a')],client(()=>{throw new Error('No call');}),config);
  assert.equal(result.groups[0].items.length,1);assert.equal(result.calls,0);
});
