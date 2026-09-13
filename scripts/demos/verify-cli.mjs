// Browser and media acceptance checks for the three local CLI walkthroughs.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tooling = process.env.BITCODE_VIDEO_TOOLS || '/tmp/bitcode-video-tools';
const { chromium } = await import(path.join(tooling, 'node_modules/playwright/index.mjs'));
const manifest = JSON.parse(await readFile(path.join(repo, 'assets/demos/manifest.json')));
assert.deepEqual(manifest.demos.map(d=>d.id), ['installation','configuration','features']);
const results = { media: [], browser: [] };
for(const demo of manifest.demos) {
  for(const file of [demo.poster,demo.transcript,demo.captions]) await stat(path.join(repo,'assets/demos',file));
  const transcript=await readFile(path.join(repo,'assets/demos',demo.transcript),'utf8');
  assert.ok(!transcript.includes('example-key-not-a-credential'), 'Example key must also remain masked');
  for(const [aspect, data] of Object.entries(demo.exports)) {
    const file=path.join(repo,'assets/demos',data.file);
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
    const stream=probe.streams.find(s=>s.codec_type==='video');
    assert.equal(stream.codec_name,'h264'); assert.equal(stream.pix_fmt,'yuv420p'); assert.equal(stream.avg_frame_rate,'30/1');
    assert.equal(stream.width,aspect==='16x9'?1920:1080); assert.equal(stream.height,aspect==='16x9'?1080:1920);
    assert.equal(Number(probe.format.size),data.bytes);
    execFileSync('ffmpeg',['-v','error','-i',file,'-f','null','-'],{stdio:'pipe'});
    results.media.push({file:data.file,duration:data.duration,decoded:true});
  }
}
const server=createServer(async (req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.resolve(repo, '.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(repo+path.sep)) {res.writeHead(403).end();return;}
    const content=await readFile(file);
    const type={'.html':'text/html','.mp4':'video/mp4','.webp':'image/webp','.vtt':'text/vtt','.txt':'text/plain'}[path.extname(file)]||'application/octet-stream';
    const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if(range){const start=Number(range[1]),end=Math.min(Number(range[2]||content.length-1),content.length-1);res.writeHead(206,{'content-type':type,'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${content.length}`,'content-length':end-start+1});res.end(content.subarray(start,end+1));}
    else res.writeHead(200,{'content-type':type,'content-length':content.length,'accept-ranges':'bytes'}).end(content);
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const cache=path.join(os.homedir(),'.cache/ms-playwright');
const executablePath=process.env.BITCODE_CHROMIUM || (existsSync(chromium.executablePath()) ? chromium.executablePath() : readdirSync(cache).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse().flatMap(n=>['chrome-linux64/chrome','chrome-linux/chrome'].map(p=>path.join(cache,n,p))).find(existsSync));
const browser=await chromium.launch({headless:true,executablePath});
const qa=path.join(os.tmpdir(),'bitcode-cli-qa');await mkdir(qa,{recursive:true});
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let mp4Requests=0;page.on('request',r=>{if(r.url().endsWith('.mp4'))mp4Requests++;});
  for(const width of [360,390,768,1280,1440]) {
    await page.setViewportSize({width,height:1000});await page.goto(url);await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.locator('.demo-story').count(),3);
    assert.equal(await page.locator('a[download]').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Overflow at ${width}px`);
    results.browser.push({width,overflow:false});
    if(width===390||width===1440)await page.screenshot({path:path.join(qa,`page-${width}.png`),fullPage:true});
  }
  assert.equal(mp4Requests,0,'No initial MP4 downloads');
  assert.deepEqual(errors,[]);
  for(const demo of manifest.demos) {
    const selector=`#recording-${demo.id}`;
    await page.locator(selector).locator('..').locator('.video-start').click();
    await page.waitForFunction(s=>document.querySelector(s).currentTime>.3,selector);
    assert.equal(await page.locator(selector).evaluate(v=>v.textTracks.length),1);
    assert.equal(await page.evaluate(()=>[...document.querySelectorAll('video')].filter(v=>!v.paused).length),1);
    await page.locator(selector).evaluate(v=>v.pause());
  }
  await page.waitForFunction(()=>document.querySelector('#hero-cli-output').textContent.includes('/btc:fees'));
  await page.setViewportSize({width:390,height:844});await page.goto(url);
  await page.locator('.menu-toggle').click();assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'true');
  await page.keyboard.press('Escape');assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'false');
  await page.emulateMedia({reducedMotion:'reduce'});await page.reload();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const noJS=await browser.newPage({javaScriptEnabled:false,viewport:{width:390,height:844}});await noJS.goto(url);
  assert.equal(await noJS.locator('video[controls]').count(),3);
  await noJS.close();
  await page.route('**/features-16x9.mp4',route=>route.fulfill({status:404,body:'missing'}));await page.goto(url);
  await page.locator('#recording-features').locator('..').locator('.video-start').click();
  await page.waitForFunction(()=>document.querySelector('#recording-features').parentElement.querySelector('.video-message').textContent.includes('unavailable'));
  results.browser.push({playback:true,onePlayerAtATime:true,captions:true,menuEscape:true,reducedMotion:true,zoom200:true,noJavaScript:true,video404:true,initialMP4Requests:0,consoleErrors:errors});
  await writeFile(path.join(qa,'report.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));console.log('QA screenshots:',qa);
} finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
