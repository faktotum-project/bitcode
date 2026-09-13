// Integrate the three CLI walkthroughs into the local static page; no deployment.
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(await readFile(path.join(repo, 'assets/demos/manifest.json')));
const ids = ['installation', 'configuration', 'features'];
if (manifest.version !== 2 || manifest.demos.length !== 3 || manifest.demos.some((d,i)=>d.id!==ids[i])) throw new Error('Render installation, configuration and features before integrating.');
for (const d of manifest.demos) for (const f of [d.poster,d.transcript,d.captions,d.exports['16x9'].file,d.exports['9x16'].file]) await access(path.join(repo,'assets/demos',f));
const esc = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const duration = d => `${Math.floor(d/60)}:${String(Math.round(d%60)).padStart(2,'0')}`;
const descriptions = {
  installation: { name:'From source to your terminal.', eyebrow:'01 / INSTALL', body:'Follow the source installation, install the core dependencies and run doctor. Check the version before moving on to model setup.', detail:'Clone → install → doctor → version', context:'Node.js 22+ · Git · Bash' },
  configuration: { name:'Choose your provider.', eyebrow:'02 / CONFIGURE', body:'Use login to enter a masked API key, select a model at startup and inspect /setting. This walkthrough uses an example key and makes no provider request.', detail:'Login → masked key → model → settings', context:'API key setup · example key' },
  features: { name:'Type a command. Read the answer.', eyebrow:'03 / USE', body:'Type /btc:fees in the real CLI. Watch its command menu, tool output and streamed answer explain a recorded Bitcoin fee snapshot. Fee estimates do not guarantee confirmation times.', detail:'Command → tool → response', context:'ollama/qwen3.8:27b · local tag · read-only' },
};
function video(d,id,hero=false) {
  return `<div class="recording-player${hero?' hero-player':''}"><video id="${id}" controls playsinline preload="none" poster="assets/demos/${d.poster}" width="1920" height="1080" aria-label="${esc(descriptions[d.id].name)} — bitcode CLI walkthrough"><source src="assets/demos/${d.exports['16x9'].file}" type="video/mp4"><track kind="captions" src="assets/demos/${d.captions}" srclang="en" label="English" default><p><a href="assets/demos/${d.exports['16x9'].file}">Download this walkthrough</a>.</p></video><p class="video-message" role="status" aria-live="polite"></p></div>`;
}
const feature = manifest.demos.find(d=>d.id==='features');
const hero = `        <div class="terminal-wrap" id="terminal">
          <div class="terminal">
            ${video(feature,'hero-recording',true)}
            <div class="hero-recording-copy"><span class="recording-kicker"><span class="status-dot" aria-hidden="true"></span>The real CLI · animated walkthrough</span><h2>One command. A useful answer.</h2><p>Type /btc:fees. Follow the tool call. Read the result.</p><div class="recording-model">${esc(feature.model)} <span>· local tag · ${duration(feature.exports['16x9'].duration)}</span></div></div>
            <div class="terminal-bottom"><a class="text-link" href="#demos">Install. Configure. Use. <span aria-hidden="true">↓</span></a><a class="text-link" href="assets/demos/${feature.transcript}">Transcript <span aria-hidden="true">↗</span></a></div>
          </div>
          <p class="demo-caption">Recorded CLI output. Typing animated; waits shortened.</p>
        </div>`;
const gallery = `<!-- RECORDED DEMOS START -->
    <section class="section recorded-demos" id="demos" aria-labelledby="demos-title">
      <div class="container">
        <div class="section-heading"><div><p class="eyebrow">See the work happen</p><h2 class="section-title" id="demos-title">Install. Configure.<br>Put it to work.</h2></div><p class="section-description">Three terminal walkthroughs, from setup to your first useful answer. Watch the commands, read the transcript, or download a vertical cut for Stories.</p></div>
        ${manifest.demos.map(d=>{const c=descriptions[d.id];return `<article class="demo-story" aria-labelledby="heading-${d.id}"><div class="demo-story-media">${video(d,`recording-${d.id}`)}<div class="recording-meta"><span>${duration(d.exports['16x9'].duration)} · CLI walkthrough</span><span>${d.recordedAt.slice(0,10)}</span></div></div><div class="demo-story-copy"><p class="eyebrow">${c.eyebrow}</p><h3 id="heading-${d.id}">${c.name}</h3><p>${c.body}</p><div class="recording-model">${c.context}</div><p class="recording-flow">${c.detail}</p><div class="recording-downloads"><a class="text-link" href="assets/demos/${d.transcript}">Read transcript <span aria-hidden="true">↗</span></a><a class="button button-secondary" href="assets/demos/${d.exports['9x16'].file}" download>Download 9:16 <svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg></a></div><p class="recording-format">Stories · 1080 × 1920 · MP4 · ${duration(d.exports['9x16'].duration)}</p></div></article>`;}).join('\n')}
        <p class="recording-disclosure">Animated command entry with captured CLI output and shorter waits. Clone commands are instructional; login uses an example key. The Bitcoin response comes from the recorded local-model session. Transcripts include the source and context of each walkthrough.</p>
      </div>
    </section>
    <!-- RECORDED DEMOS END -->`;
let html = await readFile(path.join(repo,'index.html'),'utf8');
const start = html.indexOf('        <div class="terminal-wrap" id="terminal">');
const end = html.indexOf('\n      </div>\n    </section>',start);
if(start<0 || end<0 || !html.includes('<!-- RECORDED DEMOS START -->')) throw new Error('Missing page integration anchors.');
html = html.slice(0,start)+hero+html.slice(end);
html = html.replace(/<!-- RECORDED DEMOS START -->[\s\S]*?<!-- RECORDED DEMOS END -->/,gallery);
await writeFile(path.join(repo,'index.html'),html);
console.log('Integrated exactly three walkthroughs; the hero reuses features. No deployment performed.');
