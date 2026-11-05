import {appendFileSync, closeSync, fsyncSync, mkdirSync, openSync} from 'node:fs';
import {dirname} from 'node:path';
import {LlmOutputError, type LlmClient} from './llm.ts';

/** Private append-only accounting. A started call without a result is unknown cost, never free. */
export function auditedClient(provider:LlmClient, path:string, calls:any[]):LlmClient {
  mkdirSync(dirname(path),{recursive:true});
  function persist(record:unknown) {
    const fd=openSync(path,'a',0o600);
    try {appendFileSync(fd,JSON.stringify(record)+'\n');fsyncSync(fd);} finally {closeSync(fd);}
  }
  return {async generateJson(req) {
    const id=calls.length;
    const entry:any={stage:req.label,status:'started'};
    calls.push(entry);
    persist({id,at:new Date().toISOString(),...entry});
    try {
      const response=await provider.generateJson(req);
      entry.status='returned';entry.usage=response.usage;entry.diagnostics=response.diagnostics;
      persist({id,at:new Date().toISOString(),...entry});
      return response;
    } catch(e) {
      entry.status='failed';
      // No arbitrary exception message or provider content in the durable journal.
      if(e instanceof LlmOutputError){entry.diagnostics=e.diagnostics;entry.usage=e.diagnostics?.usage;}
      persist({id,at:new Date().toISOString(),...entry});
      throw e;
    }
  }};
}
