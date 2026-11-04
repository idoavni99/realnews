/** Validate flags before I/O. Model grouping and summaries are separate opt-ins. */
export function runPolicy(env:Record<string,string|undefined>) {
  for(const flag of ['REALNEWS_SYNTHESIS_ENABLED']) if(env[flag]!==undefined&&!['true','false'].includes(env[flag]!))throw new Error('Invalid '+flag);
  if(env.REALNEWS_GROUPING!==undefined&&!['model','lexical'].includes(env.REALNEWS_GROUPING))throw new Error('Invalid REALNEWS_GROUPING');
  const grouping=env.REALNEWS_GROUPING==='model', synthesis=env.REALNEWS_SYNTHESIS_ENABLED==='true';
  if((grouping||synthesis)&&!env.OPENROUTER_API_KEY)throw new Error('Requested model stage has no configured provider');
  const maxCalls=Number(env.REALNEWS_MAX_CALLS??60);
  if(!Number.isSafeInteger(maxCalls)||maxCalls<0)throw new Error('Invalid REALNEWS_MAX_CALLS');
  return {grouping,synthesis,maxCalls};
}
