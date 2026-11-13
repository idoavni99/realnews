import {validateDecisionThreshold} from './decisions.ts';

export const SELECTED_DECISION_THRESHOLD=0.8;
export const SELECTED_DECISION_MODEL='perplexity/pplx-decider-v1.3:free';
export const SELECTED_FALLBACK_MODELS=['liquid/d1.1','typesafe/jev-1.14'] as const;

export function decisionPolicy(env:Record<string,string|undefined>) {
  const grouping=true,verification=true;
  const model=(env.REALNEWS_DECISION_MODEL??SELECTED_DECISION_MODEL).trim();
  if(!model||model==='openrouter/auto')throw new Error('Configure an explicit REALNEWS_DECISION_MODEL, not openrouter/auto');
  if(!env.OPENROUTER_API_KEY)throw new Error('Requested decision stage has no configured provider');
  const threshold=validateDecisionThreshold(Number(env.REALNEWS_DECISION_THRESHOLD||SELECTED_DECISION_THRESHOLD));
  return {grouping,verification,model,threshold,cacheIdentity:`decisions-v2:${model}:${SELECTED_FALLBACK_MODELS.join(',')}:${threshold}`};
}
