/** Usage: node scripts/evaluate-summary-replay.ts input.json responses.json private-result.json
 * Input: {articles:[FeedItem,...]}; responses: array of LlmResponse objects in call order.
 * Offline only: no credentials, network, regrouping, or publication path.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evaluateSummary} from '../src/summary-evaluation.ts';
const [inputPath,responsesPath,outputPath]=process.argv.slice(2);
if(!inputPath||!responsesPath||!outputPath)throw new Error('Require input fixture, response replay, private result path');
if(resolve(outputPath).includes('/site/'))throw new Error('Evaluation must not write published site files');
const input=JSON.parse(readFileSync(inputPath,'utf8'));const responses=JSON.parse(readFileSync(responsesPath,'utf8'));
if(!Array.isArray(input.articles)||!Array.isArray(responses))throw new Error('Invalid replay fixtures');
let index=0;
const result=await evaluateSummary(input.articles,{async generateJson(){if(index>=responses.length)throw new Error('Missing replay response');return responses[index++];}});
writeFileSync(outputPath,JSON.stringify({...result,mode:'OFFLINE_REPLAY',expected_same_event:input.expected_same_event},null,2),{mode:0o600});
console.log(JSON.stringify({mode:'OFFLINE_REPLAY',status:result.status,phase:result.phase,attempts:result.calls.length,output:outputPath}));
