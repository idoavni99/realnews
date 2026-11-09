import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const pages=readFileSync(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
const daily=readFileSync(new URL('../.github/workflows/daily.yml',import.meta.url),'utf8');
test('Pages publishes only static site with scoped deployment permissions and no model stage',()=>{
 assert.match(pages,/workflow_call:/);
 assert.match(pages,/pages: write/);assert.match(pages,/id-token: write/);
 assert.match(pages,/path: site/);assert.match(pages,/ref: main/);
 assert.match(pages,/repository.visibility == 'public'/);
 assert.match(pages,/actions\/deploy-pages@v4/);
 assert.ok(!pages.includes('OPENROUTER'));assert.ok(!pages.includes('src/pipeline.ts'));
});
test('digest directly deploys after successful publication and keeps review artifacts private-only',()=>{
 assert.match(daily,/deploy-pages:\n    needs: build/);
 assert.match(daily,/uses: .\/.github\/workflows\/pages.yml/);
 for(const name of ['Preserve staged output','Private review evidence']) {
  const after=daily.slice(daily.indexOf('- name: '+name));
  assert.match(after.split('uses:')[0],/if: always\(\) && github.event.repository.private == true/);
 }
});
