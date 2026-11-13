import {LlmOutputError, type LlmDiagnostics} from './llm.ts';

export interface DecisionQuestion {type:'noul'; instructions:string; criteria?:{true:string;false:string}}
export interface DecisionRequest {label:'Grouping'|'Verification'; state:unknown; questions:Record<string,DecisionQuestion>}
export interface DecisionResponse {answers:Record<string,number>; usage?:Record<string,unknown>; diagnostics:LlmDiagnostics}
export interface DecisionClient {decide(request:DecisionRequest):Promise<DecisionResponse>}
export const DECISION_REQUEST_BYTES=60_000;
const DECISION_TIMEOUT_MS=90_000;
const DECISIONS_URL='https://openrouter.ai/api/alpha/decisions';

export function validateProbability(value:unknown):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)throw new Error('Invalid decision probability');
  return value;
}

export function validateDecisionThreshold(value:number):number {
  if(!Number.isFinite(value)||value<=0.5||value>=1)throw new Error('Decision threshold must be greater than 0.5 and less than 1');
  return value;
}

export function decisionBody(model:string,request:DecisionRequest):string {
  if(!model.trim()||model==='openrouter/auto')throw new Error('An explicit Decisions model is required; openrouter/auto is unsupported');
  if(!Object.keys(request.questions).length)throw new Error('No decision questions');
  const body=JSON.stringify({model,state:request.state,questions:request.questions});
  if(Buffer.byteLength(body)>DECISION_REQUEST_BYTES)throw new Error('Decision request exceeds conservative byte limit; evidence was not truncated');
  return body;
}

export function createDecisionClient(key:string,model:string,transport:typeof fetch=fetch):DecisionClient {
  decisionBody(model,{label:'Grouping',state:{},questions:{check:{type:'noul',instructions:'Validate configuration'}}});
  return {async decide(request){
    const body=decisionBody(model,request);
    const response=await transport(DECISIONS_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body,signal:AbortSignal.timeout(DECISION_TIMEOUT_MS)});
    const diagnostics:LlmDiagnostics={requested_model:model,content_chars:0,http_status:response.status};
    if(!response.ok)throw new LlmOutputError(`${request.label} HTTP ${response.status}`,diagnostics);
    const result=await response.json();
    diagnostics.model=result.model;diagnostics.provider=result.provider;diagnostics.usage=result.usage;
    const answers:Record<string,number>={};
    for(const id of Object.keys(request.questions)){
      const answer=result.answers?.[id];
      if(answer?.type!=='noul')throw new LlmOutputError('Missing or wrong decision answer type',diagnostics);
      try {answers[id]=validateProbability(answer.noul);}catch{throw new LlmOutputError('Invalid decision probability',diagnostics);}
    }
    return {answers,usage:result.usage,diagnostics};
  }};
}
