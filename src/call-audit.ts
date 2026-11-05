import {closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {LlmOutputError, type LlmClient} from './llm.ts';

/** One atomic JSON snapshot per run. Unsettled requests have unknown cost, never free. */
export function auditedClient(provider:LlmClient, path:string, calls:any[]):LlmClient {
  mkdirSync(dirname(path),{recursive:true});
  const run_id=randomUUID();
  function persist() {
    const tmp=path+'.'+run_id+'.tmp';
    const fd=openSync(tmp,'w',0o600);
    try {writeFileSync(fd,JSON.stringify({version:1,run_id,updated_at:new Date().toISOString(),calls}));fsyncSync(fd);} finally {closeSync(fd);}
    renameSync(tmp,path);
    const dir=openSync(dirname(path),'r');try{fsyncSync(dir);}finally{closeSync(dir);}
  }
  persist();
  return {async generateJson(req) {
    const id=calls.length;
    const entry:any={id,run_id,stage:req.label,status:'started',started_at:new Date().toISOString()};
    calls.push(entry);persist();
    try {
      const response=await provider.generateJson(req);
      entry.status='returned';entry.usage=response.usage;entry.diagnostics=response.diagnostics;entry.completed_at=new Date().toISOString();
      persist();return response;
    } catch(e) {
      entry.status='failed';entry.completed_at=new Date().toISOString();
      // No arbitrary exception message or provider content in the durable snapshot.
      if(e instanceof LlmOutputError){entry.diagnostics=e.diagnostics;entry.usage=e.diagnostics?.usage;}
      persist();throw e;
    }
  }};
}
