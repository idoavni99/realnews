import {test} from 'node:test';
import assert from 'node:assert/strict';
import {articleRegistry,articleId,resolveArticles} from '../src/article-registry.ts';
import {synthesisInput} from '../src/synthesis.ts';
import {extractArticlePage} from '../src/extract.ts';
import {groupArticles} from '../src/grouping.ts';
const item={source:'test',sourceName:'test',side:'center',url:'https://test.example/1',title:'ראש הממשלה נפגש עם השר',published:'2026-11-05T06:00:00Z',summary:'פתיח',fulltext:'גוף פרטי '.repeat(1500),extraction:'full'} as const;
test('stable IDs resolve original body; exact aliases dedup, collision and provenance conflicts fail',()=>{
 const registry=articleRegistry([item,{...item,url:item.url+'?utm_source=x#top'}]);
 assert.equal(registry.size,1);assert.equal(resolveArticles([articleId(item.url)],registry)[0],item);
 assert.throws(()=>articleRegistry([item,{...item,url:'https://test.example/2'}],()=> 'collision'),/collision/);
 assert.throws(()=>articleRegistry([item,{...item,side:'right'}]),/provenance/);
 assert.throws(()=>resolveArticles(['missing'],registry),/Unknown/);
 assert.throws(()=>resolveArticles([articleId(item.url),articleId(item.url)],registry),/Duplicate/);
});
test('grouping only sees short lead; resolved summary has stable ID and bounded evidence without body loss',async()=>{
 let input:any;
 const result=await groupArticles([item],{async generateJson(req){input=req.input;return {json:{assignments:[{article_id:articleId(item.url),target:'new:1'}]}};}},{batchTokens:10000});
 assert.ok(input.new_articles[0].lead.length<=280);assert.ok(!JSON.stringify(input).includes(item.fulltext));
 assert.equal(result.groups[0].items[0].fulltext,item.fulltext);
 const synthesis=synthesisInput(result.groups[0].items)[0];assert.equal(synthesis.article_id,articleId(item.url));assert.equal(synthesis.id,0);assert.equal(synthesis.evidence.length,4000);
});
test('retains complete available articleBody above4000 privately, not just its model-input prefix',()=>{
 const body=item.title+' '+item.fulltext;
 const result=extractArticlePage(JSON.stringify({articleBody:body}),item.title);
 assert.equal(result.status,'full');assert.equal(result.text,body.trim());assert.ok(result.text.length>4000);
});
