import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
function context(search='') {
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',classList:{remove(){},add(){}},addEventListener(){}});return nodes.get(id);};
 const location={search,href:'https://example.com/'+search,hash:''};
 const ctx=vm.createContext({URL,URLSearchParams,location,history:{replaceState(_a,_b,url){location.href=url.href;location.search=url.search;}},document:{getElementById:node,createElement(){return {set textContent(v){this.innerHTML=String(v||'').replace(/</g,'&lt;');}};}},window:{addEventListener(){}},fetch:()=>new Promise(()=>{}),console});
 vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],ctx);return {ctx,node,location,run:s=>vm.runInContext(s,ctx)};
}
test('URL query initializes exact affiliations, Unicode search and combined same-article matching',()=>{
 const c=context('?side=center_left&q=%D7%9B%D7%A1%D7%A3');c.run('syncControls()');assert.equal(c.node('search').value,'כסף');assert.equal(c.node('affiliation').value,'center_left');
 c.run(`globalThis.story={articles:[{side:'left',title:'כסף',summary:'בדיקה',source:'מקור'},{side:'right',title:'אחר',summary:'משהו',source:'source'}]}`);
 assert.equal(c.run(`matchesStory(story,{q:'כסף בדיקה',side:'left'})`),true);
 assert.equal(c.run(`matchesStory(story,{q:'כסף',side:'right'})`),false);
 assert.equal(c.run(`matchesStory(story,{q:'SOURCE',side:'right'})`),true);
 assert.equal(c.run(`matchesStory(story,{q:'לא נמצא',side:''})`),false);
});
test('filter query encoding preserves hash and unrelated params; clear removes only q and side',()=>{
 const c=context('?keep=1');c.location.href+='&q=old#/story/3';c.node('search').value='צה"ל & test';c.node('affiliation').value='center_right';c.run('updateFilters()');
 const url=new URL(c.location.href);assert.equal(url.searchParams.get('q'),'צה"ל & test');assert.equal(url.searchParams.get('side'),'center_right');assert.equal(url.searchParams.get('keep'),'1');assert.equal(url.hash,'#/story/3');
 c.node('search').value='';c.node('affiliation').value='';c.run('updateFilters()');assert.equal(new URL(c.location.href).searchParams.has('q'),false);assert.equal(new URL(c.location.href).searchParams.get('keep'),'1');
});
test('unified feed renders each matching story once and retains original detail index',()=>{
 const c=context('?side=left');c.run(`DATA={generated_at:new Date().toISOString(),window_hours:24,monitored_sides:['left','right'],source_health:{},stories:[{headline:'One',summary:'lead',total:2,counts:{left:1,right:1},articles:[{side:'left',title:'left'},{side:'right',title:'right'}]},{headline:'Two',summary:'other',total:1,counts:{right:1},articles:[{side:'right',title:'right'}]}]};renderFeed();`);
 const feed=c.node('feed').innerHTML;assert.equal((feed.match(/class="card"/g)||[]).length,1);assert.ok(feed.includes('#/story/0'));assert.ok(feed.includes('1 מתוך 2'));assert.ok(!feed.includes('class="grp'));
});
