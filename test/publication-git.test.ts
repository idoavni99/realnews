import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';

function fixture() {
 const root=mkdtempSync(join(tmpdir(),'realnews-publication-'));
 const remote=join(root,'remote.git'), runner=join(root,'runner'), editor=join(root,'editor');
 function cmd(cwd:string, command:string,args:string[]) {
  const r=spawnSync(command,args,{cwd,encoding:'utf8',timeout:20000,env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
  assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout.trim();
 }
 const git=(cwd:string,...args:string[])=>cmd(cwd,'git',args);
 const put=(cwd:string,path:string,text:string)=>{mkdirSync(dirname(join(cwd,path)),{recursive:true});writeFileSync(join(cwd,path),text);};
 git(root,'init','--bare',remote);git(root,'clone',remote,runner);
 git(runner,'checkout','-b','main');
 for (const cwd of [runner]) {git(cwd,'config','user.name','Test');git(cwd,'config','user.email','test@example.invalid');}
 for(const name of ['publish-digest.sh','push-with-retry.sh']) {
  mkdirSync(join(runner,'scripts'),{recursive:true});copyFileSync(new URL('../scripts/'+name,import.meta.url),join(runner,'scripts',name));
 }
 put(runner,'site/data.json','{"edition":"old"}\n');put(runner,'src/pipeline.ts','// old\n');
 put(runner,'.github/workflows/daily.yml',"on:\n  schedule:\n    - cron: '0 9,21 * * *'\n      timezone: 'Asia/Jerusalem'\njobs:\n  build: old\n");
 git(runner,'add','.');git(runner,'commit','-m','base');git(runner,'push','-u','origin','main');
 git(root,'clone','--branch','main',remote,editor);git(editor,'config','user.name','Editor');git(editor,'config','user.email','editor@example.invalid');
 const advance=(path:string,text:string)=>{put(editor,path,text);git(editor,'add','.');git(editor,'commit','-m','concurrent edit');git(editor,'push');};
 const publish=(extra:Record<string,string>={})=>spawnSync('bash',['scripts/publish-digest.sh'],{cwd:runner,encoding:'utf8',timeout:20000,env:{...process.env,RETRY_DELAYS:'0 0',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',...extra}});
 const remoteFile=(path:string)=>git(root,'--git-dir='+remote,'show','main:'+path);
 return {root,runner,editor,git,put,advance,publish,remoteFile,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
for (const kind of ['no race','UI edit','cron edit','source edit','data edit','workflow behavior edit','no change']) {
 test('digest publication handles '+kind,()=>{
  const f=fixture();try {
   if(kind!=='no change') f.put(f.runner,'site/data.json','{"edition":"new"}\n');
   if(kind==='UI edit') f.advance('site/index.html','new UI');
   if(kind==='cron edit') f.advance('.github/workflows/daily.yml',readFileSync(join(f.editor,'.github/workflows/daily.yml'),'utf8').replace('0 9,21 * * *','0 9/12 * * *'));
   if(kind==='source edit') f.advance('src/pipeline.ts','// new generation\n');
   if(kind==='data edit') f.advance('site/data.json','{"edition":"other"}\n');
   if(kind==='workflow behavior edit') f.advance('.github/workflows/daily.yml',readFileSync(join(f.editor,'.github/workflows/daily.yml'),'utf8').replace('build: old','build: new'));
   const r=f.publish(), blocked=['source edit','data edit','workflow behavior edit'].includes(kind);
   assert.equal(r.status,blocked?1:0,r.stdout+r.stderr);
   if(blocked) assert.match(r.stderr,/Publication blocked:/);
   assert.equal(f.remoteFile('site/data.json'),kind==='data edit'?'{"edition":"other"}':blocked||kind==='no change'?'{"edition":"old"}':'{"edition":"new"}');
   if(kind==='UI edit') assert.equal(f.remoteFile('site/index.html'),'new UI');
   if(kind==='source edit') assert.equal(f.remoteFile('src/pipeline.ts'),'// new generation');
   if(kind==='cron edit') assert.match(f.remoteFile('.github/workflows/daily.yml'),/0 9\/12/);
  } finally {f.cleanup();}
 });
}

test('main advancing between fetch and push is retried without losing edits',()=>{
 const f=fixture();try {
  f.put(f.runner,'site/data.json','{"edition":"new"}\n');
  const realGit=spawnSync('which',['git'],{encoding:'utf8'}).stdout.trim();
  const bin=join(f.root,'bin');mkdirSync(bin);
  const wrapper=join(bin,'git'), marker=join(f.root,'injected');
  writeFileSync(wrapper,`#!/usr/bin/env bash
set -e
if [ "$1" = push ] && [ ! -f "${marker}" ]; then
 touch "${marker}"
 echo concurrent > "${f.editor}/README.md"
 "${realGit}" -C "${f.editor}" add README.md
 "${realGit}" -C "${f.editor}" commit -m concurrent
 "${realGit}" -C "${f.editor}" push
fi
exec "${realGit}" "$@"
`);chmodSync(wrapper,0o755);
  const r=f.publish({PATH:bin+':'+process.env.PATH});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout+r.stderr,/main advanced again/);
  assert.equal(f.remoteFile('README.md'),'concurrent');
  assert.equal(f.remoteFile('site/data.json'),'{"edition":"new"}');
 } finally {f.cleanup();}
});
