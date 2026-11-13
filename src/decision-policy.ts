import {validateDecisionThreshold} from './decisions.ts';

export const SELECTED_DECISION_MODEL='perplexity/pplx-decider-v1.3:free';
export const DISABLED_FALLBACK_CANDIDATES=['liquid/d1.1','typesafe/jev-1.14'] as const;

export function decisionPolicy(env:Record<string,string|undefined>) {
  const grouping=env.REALNEWS_GROUPING==='decisions';
  const verification=env.REALNEWS_VERIFICATION==='decisions';
  if(env.REALNEWS_VERIFICATION!==undefined&&!['llm','decisions'].includes(env.REALNEWS_VERIFICATION))throw new Error('Invalid REALNEWS_VERIFICATION');
  if(!grouping&&!verification)return undefined;
  const model=(env.REALNEWS_DECISION_MODEL??SELECTED_DECISION_MODEL).trim();
  if(!model||model==='openrouter/auto')throw new Error('Configure an explicit REALNEWS_DECISION_MODEL, not openrouter/auto');
  if(!env.OPENROUTER_API_KEY)throw new Error('Requested decision stage has no configured provider');
  const threshold=validateDecisionThreshold(Number(env.REALNEWS_DECISION_THRESHOLD));
  return {grouping,verification,model,threshold,cacheIdentity:`decisions-v1:${model}:${threshold}`};
}
