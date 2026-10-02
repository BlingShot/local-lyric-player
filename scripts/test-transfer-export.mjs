import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const output = process.argv[2];
if (!output) throw new Error('Pass a temporary output folder');
const server = await createServer({ configFile:false, root:process.cwd(), server:{host:'127.0.0.1',port:0},
  plugins:[{name:'transfer-test',configureServer(s){s.middlewares.use('/__transfer', (_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Transfer regression</title>');});}}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({channel:'chrome',headless:true});
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/__transfer');
  const result = await page.evaluate(async()=>{
    const {openLibraryDatabase}=await import('/src/library/database.ts');
    const {exportTransfer}=await import('/src/transfer/export.ts');
    const db=await openLibraryDatabase(), id='["legacy/path.mp3",64,123]';
    // Real RIFF PCM container, entirely synthetic.
    const pcm=new Uint8Array(88244), view=new DataView(pcm.buffer);
    const text=(offset,s)=>[...s].forEach((c,i)=>pcm[offset+i]=c.charCodeAt(0));
    text(0,'RIFF');view.setUint32(4,88236,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);
    view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,44100,true);view.setUint32(28,88200,true);
    view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,88200,true);
    await new Promise((ok,no)=>{
      const tx=db.transaction(['tracks','audio','lyrics','playlists'],'readwrite');
      tx.objectStore('tracks').put({id,name:'Transfer fixture',artist:'Test',album:'Test album',fileName:'tone.wav',size:pcm.length,lastModified:0,duration:1},id);
      tx.objectStore('audio').put(new Blob([pcm]),id);
      tx.objectStore('lyrics').put({source:'[00:00]Hello\n[00:00.50]World',fileName:'test.lrc',offsetMs:120},id);
      tx.objectStore('playlists').put({id:'list',name:'From Electron',trackIds:[id]},'list');
      tx.oncomplete=ok;tx.onabort=()=>no(tx.error);
    });
    const files={};
    function directory(prefix='') {
      return {getDirectoryHandle:async name=>directory(prefix+name+'/'),
        getFileHandle:async name=>({createWritable:async()=>{const chunks=[];return {
          write:async bytes=>chunks.push(typeof bytes==='string'?new TextEncoder().encode(bytes):bytes),
          close:async()=>{const blob=new Blob(chunks); files[prefix+name]=Array.from(new Uint8Array(await blob.arrayBuffer()));},abort:async()=>{}
        };}}),removeEntry:async name=>{for(const path of Object.keys(files))if(path.startsWith(prefix+name+'/'))delete files[path];}};
    }
    await exportTransfer(directory(),new AbortController().signal,()=>{});
    return files;
  });
  const manifestPath=Object.keys(result).find(path=>path.endsWith('/manifest.json'));
  assert.ok(manifestPath);
  const prefix=manifestPath.slice(0,-'manifest.json'.length), manifest=JSON.parse(Buffer.from(result[manifestPath]));
  assert.equal(manifest.tracks.length,1);
  assert.equal(manifest.playlists[0].trackIDs[0],manifest.tracks[0].id);
  for(const [path,bytes] of Object.entries(result)) {
    const relative=path.slice(prefix.length), target=resolve(output,relative);
    await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,Buffer.from(bytes));
  }
  console.log('PASS: real IndexedDB export snapshot -> '+output);
} finally {await browser?.close();await server.close();}
