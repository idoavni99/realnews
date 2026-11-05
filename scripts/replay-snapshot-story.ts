/** Offline only: node scripts/replay-snapshot-story.ts articles.json grouping.json story_id responses.json result.json */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {snapshotStory} from '../src/article-snapshot.ts';
import {evaluateSummary} from '../src/summary-evaluation.ts';
const [articlesPath,groupsPath,storyId,responsesPath,outputPath]=process.argv.slice(2);
if(!articlesPath||!groupsPath||!storyId||!responsesPath||!outputPath)throw new Error('Require article snapshot, grouping snapshot, story ID, replay responses, private result path');
const output=resolve(outputPath),site=fileURLToPath(new URL('../site/',import.meta.url));
if(output===site.slice(0,-1)||output.startsWith(site))throw new Error('Evaluation cannot write published site files');
if([articlesPath,groupsPath,responsesPath].some(p=>resolve(p)===output))throw new Error('Do not overwrite replay inputs');
const snapshot=JSON.parse(readFileSync(articlesPath,'utf8'));const groups=JSON.parse(readFileSync(groupsPath,'utf8'));
const items=snapshotStory(snapshot,groups,storyId);const responses=JSON.parse(readFileSync(responsesPath,'utf8'));
if(!Array.isArray(responses))throw new Error('Invalid replay responses');let index=0;
const result=await evaluateSummary(items,{async generateJson(){if(index>=responses.length)throw new Error('Missing replay response');return responses[index++];}});
writeFileSync(output,JSON.stringify({...result,mode:'OFFLINE_REPLAY',snapshot_run_id:snapshot.run_id,snapshot_sha256:snapshot.content_sha256,story_id:storyId},null,2),{mode:0o600});
console.log(JSON.stringify({mode:'OFFLINE_REPLAY',status:result.status,phase:result.phase,attempts:result.calls.length,output}));
