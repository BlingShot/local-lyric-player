import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { taggedWav } from './library-fixtures.mjs';
import { selectMenu } from './select-menu.mjs';

const root=resolve('test-results/studio-refinements'); await mkdir(root,{recursive:true});
const origin='http://127.0.0.1:4206', server=await createServer({server:{host:'127.0.0.1',port:4206,strictPort:true,watch:{ignored:['**/release/**','**/.cache/**','**/test-results/**']}}}); await server.listen();
let browser,page,phase='setup';const errors=[],external=[],checks=[];
try {
 browser=await chromium.launch({channel:'msedge',headless:true});const ctx=await browser.newContext({locale:'en-US',viewport:{width:1600,height:1100},acceptDownloads:true});
 await ctx.route('**/*',r=>{if(new URL(r.request().url()).origin!==origin){external.push(r.request().url());return r.abort();}return r.continue();});
 page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 const file=resolve(root,'Refinements.wav'), audio=taggedWav({TIT2:'Refinements',TPE1:'Local singer'},[],undefined,60);await writeFile(file,audio);
 const digest=data=>createHash('sha256').update(data).digest('hex'), originalHash=digest(audio);
 await page.goto(origin+'/studio');await page.getByLabel('Choose studio audio',{exact:true}).setInputFiles(file);await page.waitForFunction(()=>document.querySelector('audio')?.duration===60);
 const fixture=await page.evaluate(async()=>{
  const m=await import('/src/studio/project.ts'),{store}=await import('/src/store/store.ts'); const p=m.newProject(store.getState().player.currentId,'Refinements.wav');
  p.performers=[{id:'voice',name:'Local singer',type:'person',color:'#1ed760',align:'auto'}];
  p.lines=Array.from({length:8},(_,i)=>{const l=m.vocalLine(i===2?'One final word':'A melody returns');l.id=`lead-${i}`;l.startMs=1000+i*5000;l.endMs=l.startMs+4000;l.performerId='voice';l.units.filter(w=>w.kind==='word').forEach((w,j)=>{w.startMs=l.startMs+j*1200;w.endMs=w.startMs+1000;});return l;});
  const bg=m.vocalLine('Echo & light','background','lead-2');bg.id='backing';bg.startMs=12500;bg.endMs=14500;bg.performerId='voice';bg.units.filter(w=>w.kind==='word').forEach((w,j)=>{w.startMs=12500+j*650;w.endMs=w.startMs+600;});p.lines.splice(3,0,bg);p.selectedId='lead-2';p.settings.mode='word';p.settings.preRollMs=0;return p;
 });
 const restore=async p=>{await page.getByLabel('Choose studio project',{exact:true}).setInputFiles({name:'test.lyric-studio.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await page.getByRole('button',{name:'Use imported project',exact:true}).click();await page.getByRole('dialog',{name:'Import into Lyric Studio',exact:true}).waitFor({state:'hidden'});};
 const seek=async t=>{await page.evaluate(t=>{document.activeElement?.blur();const a=document.querySelector('audio');a.pause();a.currentTime=t;},t);await page.waitForTimeout(120);};
 const saved=async()=>{await page.locator('.studio-save-status').filter({hasText:'Draft saved'}).waitFor();return page.evaluate(async()=>{const {readStudioDraft}=await import('/src/studio/repository.ts'),{store}=await import('/src/store/store.ts');return readStudioDraft(store.getState().player.currentId);});};
 await restore(fixture);
 phase='child translation and deletion';
 await page.getByRole('button',{name:'LRC',exact:true}).click();
 await page.getByText('Background vocals (1)',{exact:true}).click();
 const bg=page.locator('.studio-row[data-line-id="backing"]');await bg.getByRole('button',{name:'Translation / romanization line 4',exact:true}).click();
 await page.getByLabel('translation line 4',{exact:true}).fill('回声与光');await page.getByLabel('translation language line 4',{exact:true}).fill('zh-Hans');
 await page.getByLabel('romanization line 4',{exact:true}).fill('Echo and light');
 let p=await saved();assert.equal(p.lines[3].annotations[0].targetId,'backing');assert.equal(p.lines[3].annotations[0].text,'回声与光');
 await page.getByRole('button',{name:'Remove background line 4',exact:true}).click();assert.equal(await page.locator('.studio-row[data-line-id="backing"]').count(),0);
 await page.getByRole('button',{name:'Undo',exact:true}).click();p=await saved();assert.equal(p.lines[3].id,'backing');assert.equal(p.lines[3].annotations[0].text,'回声与光');checks.push('Child translation/romanization edit, stable references, actual delete and undo');
 phase='background insertion cursor';
 await page.getByRole('button',{name:'TTML Studio',exact:true}).click();
 await page.getByLabel('Lyrics line 3',{exact:true}).focus();
 await page.locator('.studio-row[data-line-id="lead-2"]').getByRole('button',{name:'＋ Background vocal',exact:true}).click();
 p=await saved();const added=p.lines.find(l=>l.id===p.selectedId);assert.equal(added.role,'background');assert.equal(added.parentId,'lead-2');
 await page.getByText('Background vocals (2)',{exact:true}).click();await page.locator('.studio-row[data-line-id="backing"]').waitFor({state:'hidden'});assert.equal(await page.locator('.studio-row[data-line-id="backing"]').isVisible(),false);
 await page.getByRole('button',{name:'Undo',exact:true}).click();checks.push('Adding a background keeps its edit cursor; selected background disclosure can collapse');
 phase='last word and next line';
 await page.getByRole('button',{name:'TTML Studio',exact:true}).click();
 await page.getByLabel('Lyrics line 3',{exact:true}).focus();await page.locator('.studio-fragment').filter({hasText:'word'}).click();await seek(13.4);
 await page.evaluate(()=>document.querySelector('audio').play());await page.keyboard.down('KeyT');await page.waitForTimeout(150);assert.equal(await page.locator('[data-preview-word][data-recording]').count(),1);await page.waitForTimeout(200);await page.keyboard.up('KeyT');await page.evaluate(()=>document.querySelector('audio').pause());
 p=await saved();assert.equal(p.selectedId,'lead-3');assert.equal(p.selectedUnitId,p.lines.find(l=>l.id==='lead-3').units.find(w=>w.kind==='word').id);
 const last=p.lines[2].units.filter(w=>w.kind==='word').at(-1);assert.ok(last.endMs>last.startMs);assert.equal(p.lines[2].endMs,last.endMs);
 await seek((last.startMs+last.endMs)/2000);await page.waitForFunction(id=>Math.abs(Number(document.querySelector(`[data-preview-word="${id}"]`).dataset.progress)-50)<1,last.id);
 await seek(17);assert.equal(await page.locator(`[data-preview-word="${last.id}"]`).getAttribute('data-progress'),'100.00');await seek(12);assert.equal(await page.locator(`[data-preview-word="${last.id}"]`).getAttribute('data-progress'),'0.00');
 checks.push('Hold/release final word enters next lead; final word fills at midpoint, completes after line and resets on seek backwards');
 phase='Studio child entrance';
 await seek(12);await page.waitForTimeout(700);assert.equal(await page.locator('[data-preview-line="backing"]').evaluate(n=>n.offsetHeight),0);
 const heights=await page.evaluate(async()=>{document.querySelector('audio').currentTime=13;const node=document.querySelector('[data-preview-line="backing"]'),a=[],start=performance.now();await new Promise(r=>{const step=()=>{a.push(node.offsetHeight);performance.now()-start<700?requestAnimationFrame(step):r();};requestAnimationFrame(step);});return a;});assert.ok(new Set(heights).size>5);assert.ok(heights.at(-1)>35);checks.push('Studio background plus annotations expands through intermediate layout frames');
 phase='write TTML and LRC to saved WAV';
 for(const [label,format] of [['Write word TTML to song copy','ttml'],['Write LRC to song copy','lrc']]){
  await page.getByRole('button',{name:'Write to song ▾',exact:true}).click();await page.getByRole('menuitem',{name:label,exact:true}).click();await page.getByRole('button',{name:'Write lyrics',exact:true}).click();
  await page.getByRole('dialog',{name:'Audio copy ready',exact:true}).waitFor();
  const data=await page.evaluate(async()=>{const {store}=await import('/src/store/store.ts'),r=await import('/src/lyrics/repository.ts');return r.readLyrics(store.getState().player.currentId);});assert.equal(data.document.format,format);assert.ok(data.fileName.endsWith(`.${format}`));if(format==='ttml')assert.ok(data.document.lines.some(l=>l.role==='background'&&l.annotations.some(a=>a.text==='回声与光')));
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'Download Refinements.wav',exact:true}).click();const d=await download;await d.saveAs(resolve(root,`written-${format}.wav`));await page.getByRole('dialog',{name:'Audio copy ready',exact:true}).getByRole('button',{name:'Close',exact:true}).click();
 }
 assert.equal(digest(await readFile(file)),originalHash);checks.push('Actual TTML/LRC tag writes and reader verification, downloadable saved audio, original WAV unchanged');
 // Restore TTML for player checks through the same write UI.
 await page.getByRole('button',{name:'Write to song ▾',exact:true}).click();await page.getByRole('menuitem',{name:'Write word TTML to song copy',exact:true}).click();await page.getByRole('button',{name:'Write lyrics',exact:true}).click();await page.getByRole('dialog',{name:'Audio copy ready',exact:true}).waitFor();await page.getByRole('dialog',{name:'Audio copy ready',exact:true}).getByRole('button',{name:'Close',exact:true}).click();
 phase='liquid glass contrast and alignment';
 await page.evaluate(async()=>{await (await import('/src/theme/surface.ts')).setGlassSurface(true);});
 for(const theme of ['dark','light']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.waitForTimeout(250);
  const styles=await page.locator('.studio-format-tabs button[aria-pressed=true]').evaluate(n=>{const s=getComputedStyle(n);return {color:s.color,background:s.backgroundColor};});assert.notEqual(styles.color,styles.background);assert.ok(styles.color.includes(theme==='dark'?'18, 32, 44':'255, 255, 255'));
  const centers=await page.locator('.studio-row[data-line-id="lead-2"]').evaluate(n=>[...n.querySelectorAll(':scope > .studio-sync-clear,:scope > .studio-sync-time,:scope > .studio-sync-listen')].map(el=>{const r=el.getBoundingClientRect();return r.top+r.height/2;}));assert.ok(Math.max(...centers)-Math.min(...centers)<1);
  const rowStyle=await page.locator('.studio-row[data-selected]').evaluate(n=>({shadow:getComputedStyle(n).boxShadow,border:getComputedStyle(n).borderTopColor,playing:n.hasAttribute('data-playing')}));if(rowStyle.playing)assert.match(rowStyle.shadow,/inset/);else assert.equal(rowStyle.shadow,'none');assert.equal(rowStyle.border,'rgba(0, 0, 0, 0)');
  await page.screenshot({path:resolve(root,`studio-${theme}.png`)});
 }
 const flow=await page.locator('.offline-app').evaluate(async n=>{const first=getComputedStyle(n,'::before').transform;await new Promise(r=>setTimeout(r,350));return [first,getComputedStyle(n,'::before').transform];});assert.deepEqual(flow,['none','none']);
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.offline-app').evaluate(n=>getComputedStyle(n,'::before').animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});checks.push('Static glass without moving light fields; day/night active-tab contrast, control alignment, media-time row outline, reduced motion');
 phase='player child entrance';
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.getByRole('link',{name:'Back to player',exact:true}).click();await page.getByRole('button',{name:'Lyrics',exact:true}).click();await seek(12);await page.waitForTimeout(800);
 const child=page.locator('.lyric-background').first();assert.equal(await child.evaluate(n=>n.offsetHeight),0);
 const movement=await page.evaluate(async()=>{const bg=document.querySelector('.lyric-background'),lead=bg.previousElementSibling,next=bg.nextElementSibling;const pos=()=>[bg.offsetHeight,lead.getBoundingClientRect().top,next.getBoundingClientRect().top];const samples=[pos()];document.querySelector('audio').currentTime=13;const start=performance.now();await new Promise(r=>{const step=()=>{samples.push(pos());performance.now()-start<1400?requestAnimationFrame(step):r();};requestAnimationFrame(step);});return samples;});
 assert.ok(new Set(movement.map(a=>a[0])).size>5);assert.ok(movement.at(-1)[0]>35);assert.ok(movement.at(-1)[1]<movement[0][1]-5);assert.ok(movement.at(-1)[2]>movement[0][2]+5);await page.screenshot({path:resolve(root,'player-popout.png')});checks.push('Player popout expands real space, lifts the parent and pushes the next line down');

 phase='full screen and mini lyrics';
 await page.getByRole('button',{name:'Full screen lyrics',exact:true}).click();await seek(12);await page.waitForTimeout(800);assert.equal(await page.locator('.lyric-background').first().evaluate(n=>n.offsetHeight),0);await seek(13);await page.waitForTimeout(800);assert.ok(await page.locator('.lyric-background').first().evaluate(n=>n.offsetHeight)>35);await page.screenshot({path:resolve(root,'fullscreen-popout.png')});await page.getByRole('button',{name:'Exit full screen',exact:true}).click();
 await page.getByRole('button',{name:'File details',exact:true}).click();await selectMenu(page,'Right sidebar view','lyrics');await page.locator('.mini-lyrics .lyric-background').waitFor({state:'attached'});await seek(12);await page.waitForTimeout(700);assert.equal(await page.locator('.mini-lyrics .lyric-background').first().evaluate(n=>n.offsetHeight),0);await seek(13);await page.waitForTimeout(700);assert.ok(await page.locator('.mini-lyrics .lyric-background').first().evaluate(n=>n.offsetHeight)>20);checks.push('Full screen and sidebar share the timed popout behavior');
 phase='analysis glass and clipping';
 await page.getByRole('link',{name:'Analyze',exact:true}).click();await page.locator('.analysis-page').waitFor();
 for(const theme of ['dark','light']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.waitForTimeout(300);
  for(const selector of ['.analysis-card','.analysis-audio-card','.analysis-metrics > div']){const style=await page.locator(selector).first().evaluate(n=>({shadow:getComputedStyle(n).boxShadow,animation:getComputedStyle(n,'::after').animationName}));assert.notEqual(style.shadow,'none');assert.equal(style.animation,'none');}
  await page.screenshot({path:resolve(root,`analysis-${theme}.png`)});
 }
 const clip=await page.locator('.Main-section').evaluate(n=>{n.scrollTop=200;const box=n.getBoundingClientRect();const above=document.elementFromPoint(box.left+100,box.top-3);return {clip:getComputedStyle(n).clipPath,inside:above?.closest('.analysis-page')!==null};});assert.notEqual(clip.clip,'none');assert.equal(clip.inside,false);await page.screenshot({path:resolve(root,'analysis-scrolled.png')});checks.push('Analysis cards and loudness tiles retain consistent static glass; panel clips scrolled content below the header');
 phase='auto language prompt without external calls';
 await selectMenu(page,'Analysis language','en');await selectMenu(page,'Analysis language','auto');assert.equal(await page.evaluate(async()=>(await import('/src/analysis/deepseek/config.ts')).getDeepSeekConfig().language),'auto');
 const prompt=await page.evaluate(async()=>{
  const {createDeepSeekAdapter}=await import('/src/analysis/deepseek/client.ts'),{ADVISORY_CATEGORIES}=await import('/src/analysis/advisory.ts');const native=window.fetch;let request;
  window.fetch=async(_url,init)=>{request=JSON.parse(init.body);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({interpretation:'关于回声与光的解读',themes:[],moods:[],advisoryAssessment:{summary:'文本未涉及所审查的内容类别。',review:Object.keys(ADVISORY_CATEGORIES).map(category=>({category,status:'clear',reason:'原文没有相关内容。',evidence:[]}))}})}}]}),{status:200,headers:{'Content-Type':'application/json'}});};
  try{await createDeepSeekAdapter({apiKey:'fixture-key',model:'deepseek-flash',language:'auto'}).run({lyrics:{kind:'studio',label:'text',fingerprint:'fixture',lines:[{id:'line',text:'回声与光'}]}},{signal:new AbortController().signal,progress:()=>{},settings:{}});return request;}finally{window.fetch=native;}
 });assert.match(prompt.messages[0].content,/Detect the dominant language/);assert.deepEqual(JSON.parse(prompt.messages[1].content),{lines:[{id:'L1',text:'回声与光'}]});checks.push('Auto output-language prompt uses actual lyrics only; response schema checked with local mock, no cloud call');
 assert.equal(await page.locator('audio').count(),1);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await writeFile(resolve(root,'report.json'),JSON.stringify({result:'passed',checks},null,2));console.log(JSON.stringify({result:'passed',checks}));
}catch(e){console.error('PHASE',phase,e);if(page)await page.screenshot({path:resolve(root,'failure.png')}).catch(()=>{});process.exitCode=1;}finally{await browser?.close();await server.close();}


