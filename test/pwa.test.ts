import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const site=new URL('../site/',import.meta.url);
const html=readFileSync(new URL('index.html',site),'utf8');
const manifest=JSON.parse(readFileSync(new URL('manifest.webmanifest',site),'utf8'));
test('manifest launches standalone within the GitHub Pages project scope',()=>{
 const url=new URL('manifest.webmanifest','https://idoavni99.github.io/realnews/');
 assert.equal(new URL(manifest.start_url,url).pathname,'/realnews/');
 assert.equal(new URL(manifest.scope,url).pathname,'/realnews/');
 assert.equal(new URL(manifest.id,url).pathname,'/realnews/');
 assert.equal(manifest.display,'standalone');assert.equal(manifest.lang,'he');assert.equal(manifest.dir,'rtl');
 assert.ok(manifest.name && manifest.short_name);
 assert.match(html,/rel="manifest" href="\.\/manifest.webmanifest"/);
 assert.match(html,/rel="apple-touch-icon" href="\.\/icons\/apple-touch-icon.png"/);
});
test('install icons have the advertised PNG dimensions and no offline or push hooks were added',()=>{
 for(const size of [192,512]) {
  const entry=manifest.icons.find((i: any)=>i.sizes===`${size}x${size}`);
  assert.ok(entry);assert.equal(entry.type,'image/png');
  const bytes=readFileSync(new URL(entry.src,site));
  assert.equal(bytes.subarray(1,4).toString(),'PNG');
  assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);
 }
 const apple=readFileSync(new URL('icons/apple-touch-icon.png',site));
 assert.equal(apple.readUInt32BE(16),180);assert.equal(apple.readUInt32BE(20),180);
 assert.ok(!html.includes('serviceWorker'));assert.ok(!html.includes('PushManager'));
 assert.ok(html.includes("fetch('data.json')"));
});
