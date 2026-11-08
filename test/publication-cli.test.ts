import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/publication-gate.ts',import.meta.url));
test('publication CLI writes only sanitized digest; global failure leaves original file unchanged',()=>{
 const dir=mkdtempSync(join(tmpdir(),'realnews-release-'));
 try {
  mkdirSync(join(dir,'site'));
  const path=join(dir,'site','data.json');
  const data={stories:[{headline:'Retained',articles:[{title:'Source article'}],synthesis_status:'rejected',synthesis:{}}]};
  writeFileSync(path,JSON.stringify(data));
  const result=spawnSync(process.execPath,[script],{cwd:dir,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const published=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(published.stories[0].synthesis,undefined);
  assert.deepEqual(published.stories[0].articles,data.stories[0].articles);
  const invalid=JSON.stringify({grouping:{complete:false},stories:[]});
  writeFileSync(path,invalid);
  const blocked=spawnSync(process.execPath,[script],{cwd:dir,encoding:'utf8'});
  assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/incomplete grouping/);
  assert.equal(readFileSync(path,'utf8'),invalid);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
