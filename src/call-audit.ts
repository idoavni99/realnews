import {closeSync,fsyncSync,mkdirSync,openSync,renameSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {DecisionClient} from './decisions.ts';
import {LlmOutputError,type LlmClient,type LlmDiagnostics} from './llm.ts';

function auditRecorder(path:string,calls:any[]){
  mkdirSync(dirname(path),{recursive:true});
  const run_id=randomUUID();
  function persist(){
    const temporary=path+'.'+run_id+'.tmp';
    const fd=openSync(temporary,'w',0o600);
    try{writeFileSync(fd,JSON.stringify({version:1,run_id,updated_at:new Date().toISOString(),calls}));fsyncSync(fd);}finally{closeSync(fd);}
    renameSync(temporary,path);
    const dir=openSync(dirname(path),'r');try{fsyncSync(dir);}finally{closeSync(dir);}
  }
  persist();
  return async function record<T extends {usage?:Record<string,unknown>;diagnostics?:LlmDiagnostics}>(stage:string,operation:()=>Promise<T>):Promise<T>{
    const entry:any={id:calls.length,run_id,stage,status:'started',started_at:new Date().toISOString()};
    calls.push(entry);persist();
    try{
      const response=await operation();
      entry.status='returned';entry.usage=response.usage;entry.diagnostics=response.diagnostics;entry.completed_at=new Date().toISOString();
      persist();return response;
    }catch(error){
      entry.status='failed';entry.completed_at=new Date().toISOString();
      if(error instanceof LlmOutputError){entry.diagnostics=error.diagnostics;entry.usage=error.diagnostics?.usage;}
      persist();throw error;
    }
  };
}

export function auditedClient(provider:LlmClient,path:string,calls:any[]):LlmClient{
  const record=auditRecorder(path,calls);
  return {generateJson:request=>record(request.label,()=>provider.generateJson(request))};
}

export function auditedDecisionClient(provider:DecisionClient,path:string,calls:any[]):DecisionClient{
  const record=auditRecorder(path,calls);
  return {decide:request=>record(request.label,()=>provider.decide(request))};
}
