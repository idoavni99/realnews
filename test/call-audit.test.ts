import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditedClient} from '../src/call-audit.ts';
import {LlmOutputError} from '../src/llm.ts';
const req={label:'Grouping',system:'PRIVATE PROMPT',input:{secret:'PRIVATE ARTICLE'},schema:{},temperature:0,maxOutputTokens:10} as const;
test('journal preserves settled costs before normal pipeline completion, including failed output',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'audit-'));const path=join(dir,'calls.jsonl');const calls:any[]=[];
 try {
  const client=auditedClient({async generateJson(){return {json:{private:'PRIVATE OUTPUT'},usage:{cost:0.03}};}},path,calls);
  await client.generateJson(req);
  await assert.rejects(auditedClient({async generateJson(){throw new LlmOutputError('PRIVATE ERROR',{requested_model:'auto',content_chars:0,usage:{cost:0.02}});}},path,calls).generateJson(req));
  const text=readFileSync(path,'utf8');assert.ok(!text.includes('PRIVATE'));
  const rows=text.trim().split('\n').map(x=>JSON.parse(x));
  assert.deepEqual(rows.map(x=>[x.id,x.status]),[[0,'started'],[0,'returned'],[1,'started'],[1,'failed']]);
  assert.equal(rows[1].usage.cost+rows[3].usage.cost,0.05);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('in-flight cancellation retains unknown-cost started record without a fake zero',()=>{
 const dir=mkdtempSync(join(tmpdir(),'audit-'));const path=join(dir,'calls.jsonl');
 try {
  void auditedClient({generateJson(){return new Promise(()=>{});}},path,[]).generateJson(req);
  const rows=readFileSync(path,'utf8').trim().split('\n').map(x=>JSON.parse(x));
  assert.equal(rows.length,1);assert.equal(rows[0].status,'started');assert.equal(rows[0].usage,undefined);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('workflow retains cancellation journal and grouping checkpoint as private evidence',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/daily.yml',import.meta.url),'utf8');
 assert.match(workflow,/Private review evidence\s+if: always\(\)/);
 assert.match(workflow,/\.review\/calls\.jsonl/);assert.match(workflow,/\.review\/grouping\.json/);
 const pipeline=readFileSync(new URL('../src/pipeline.ts',import.meta.url),'utf8');
 assert.ok(pipeline.indexOf("writeFileSync(join(reviewDir,'grouping.json')")<pipeline.indexOf('const clusters='));
});
