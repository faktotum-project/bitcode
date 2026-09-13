// Render genuine ANSI captures through xterm, including the real bitcode TUI.
// Shell commands are animated; output is replayed without invented CLI messages.
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const input = path.resolve(process.argv[2] || '/tmp/bitcode-cli-recordings');
const tooling = process.env.BITCODE_VIDEO_TOOLS || '/tmp/bitcode-video-tools';
const { chromium } = await import(path.join(tooling, 'node_modules/playwright/index.mjs'));
const { Terminal: Headless } = (await import(path.join(tooling, 'node_modules/@xterm/headless/lib-headless/xterm-headless.js'))).default;
const out = path.join(repo, 'assets/demos');
const frames = await mkdtemp(path.join(os.tmpdir(), 'bitcode-cli-frames-'));
await mkdir(out, { recursive: true });
const font = (await readFile(path.join(tooling, 'JetBrainsMono.ttf'))).toString('base64');
const boldFont = (await readFile(path.join(tooling, 'JetBrainsMono-SemiBold.ttf'))).toString('base64');
const xtermScript = await readFile(path.join(tooling, 'node_modules/@xterm/xterm/lib/xterm.js'), 'utf8');
const xtermCSS = await readFile(path.join(tooling, 'node_modules/@xterm/xterm/css/xterm.css'), 'utf8');
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ids = ['installation', 'configuration', 'features'];
const only = process.argv[3];
function timeline(capture) {
  let time = 0;
  const events = [], cues = [];
  function emit(data, delay = 0) { time += delay; events.push({ time, data }); }
  for (const [index, segment] of capture.segments.entries()) {
    const start = time;
    emit(index === 0 ? '$ ' : '\r\n$ ', .6);
    for (const char of segment.command) emit(char, .045);
    emit('\r\n', .55);
    let previous = 0;
    const captured = segment.capture?.events || [];
    const exitIndex = segment.interactive ? captured.findIndex(e=>e.data.includes('\x1b[J') && /^\r› \/e(?:x(?:i(?:t)?)?)?[\r\n]/.test(e.data.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,''))) : -1;
    // Exclude the initial slash that would open /exit's dropdown, too.
    for (const event of exitIndex < 0 ? captured : captured.slice(0, Math.max(0,exitIndex-1))) {
      const delay = Math.min(Math.max(event.time - previous, 0), .8);
      previous = event.time;
      // Preserve escape sequences; they implement the actual dropdown and masking.
      // TUI redraws stay atomic. Ordinary output is revealed in readable chunks.
      if (event.data.includes('\x1b[J') || event.data.includes('\x1b[K')) emit(event.data, delay);
      else {
        const tokens = event.data.match(/\x1b\[[0-?]*[ -/]*[@-~]|\r\n|[^\x1b\r\n]{1,5}|[\s\S]/g) || [];
        let data = '';
        for (const token of tokens) {
          data += token;
          if (token === '\r\n' || (!token.startsWith('\x1b') && data.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').length >= 5)) {
            emit(data, data === '\r\n' ? .07 : .025); data = '';
          }
        }
        if (data) emit(data);
        time += delay;
      }
    }
    time += segment.hold || 1.5;
    cues.push({ start, end: time, text: segment.caption });
  }
  time += 2;
  cues.at(-1).end = time;
  return { events, cues, duration: time };
}
function markup(capture, vertical) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:JB;src:url(data:font/ttf;base64,${font})} @font-face{font-family:JB;src:url(data:font/ttf;base64,${boldFont});font-weight:600}
  ${xtermCSS}
  *{box-sizing:border-box}body{margin:0;width:${vertical ? 1080 : 1920}px;height:${vertical ? 1920 : 1080}px;background:#f7f7f4;color:#26251e;font-family:JB,monospace;padding:${vertical ? '220px 60px 310px' : '38px 64px 32px'};display:flex;flex-direction:column}
  header{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;gap:30px}.brand{font-size:${vertical ? 34 : 30}px;font-weight:600}.brand span{color:#f7931a}.eyebrow{font-size:18px;color:#5a5852;letter-spacing:2px}h1{font:400 ${vertical ? 42 : 36}px/1.25 JB;letter-spacing:-1.7px;margin:0 0 12px}.subtitle{font-size:20px;color:#5a5852;margin-bottom:22px}
  .window{background:white;border:1px solid #cfcdc4;border-radius:12px;overflow:hidden;box-shadow:0 18px 50px -30px #26251e35}.bar{height:48px;background:#fafaf7;border-bottom:1px solid #e6e5e0;display:flex;align-items:center;justify-content:space-between;padding:0 24px;font-size:17px;color:#5a5852}.dots{display:flex;gap:8px}.dots i{width:10px;height:10px;border-radius:50%;background:#dfa88f}.dots i:nth-child(2){background:#9fc9a2}.dots i:nth-child(3){background:#9fbbe0}
  #terminal{padding:${vertical ? '20px 22px' : '16px 24px'};height:${vertical ? 1010 : 730}px}.xterm-viewport::-webkit-scrollbar{width:0}.xterm .xterm-scrollable-element>.scrollbar{display:none!important}.xterm{font-variant-ligatures:none}
  .caption{font-size:${vertical ? 25 : 23}px;line-height:1.45;min-height:${vertical ? 110 : 54}px;margin-top:23px;color:#5a5852}.footer{display:flex;justify-content:space-between;gap:24px;margin-top:auto;font-size:${vertical ? 16 : 16}px;color:#5a5852}.progress{height:3px;background:#e6e5e0;margin:10px 0 15px}.progress div{height:100%;background:#f7931a;width:0}
  </style></head><body><header><div class="brand"><span>⚡</span> bitcode</div><div class="eyebrow">${String(ids.indexOf(capture.id)+1).padStart(2,'0')} / ${capture.id.toUpperCase()}</div></header>
  ${vertical ? `<h1>${esc(capture.title)}</h1><div class="subtitle">${esc(capture.subtitle)}</div>` : ''}
  <div class="window"><div class="bar"><span class="dots"><i></i><i></i><i></i></span><span>bitcode · terminal walkthrough</span><span>v${esc(capture.version)}</span></div><div id="terminal"></div></div>
  <div class="caption" id="caption"></div><div class="progress"><div id="progress"></div></div><div class="footer"><span>${esc(capture.note)}</span><span>${capture.recordedAt.slice(0,10)}</span></div>
  </body></html>`;
}
const stamp = seconds => { const ms = Math.round(seconds*1000); return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`; };
// Decode all cursor movement at the capture's native width first. Recompose
// cells into the export width afterwards; raw wide-terminal cursor sequences
// would otherwise leave ghost menu rows in portrait output.
function snapshot(source, cols, rows) {
  const buffer = source.buffer.active;
  const cursorRow = buffer.baseY + buffer.cursorY;
  const lines = [[]]; let x = 0, cursor = { row: 0, col: 0 };
  for (let row=0; row<buffer.length; row++) {
    const line = buffer.getLine(row);
    const continuation = buffer.getLine(row+1)?.isWrapped;
    let end = continuation ? source.cols : 0;
    if (!continuation) for(let col=0;col<source.cols;col++) if(line.getCell(col)?.getChars().trim()) end=col+1;
    if(row===cursorRow) end=Math.max(end,buffer.cursorX);
    for(let col=0;col<=end;col++) {
      if(x>=cols) { lines.push([]); x=0; }
      if(row===cursorRow && col===buffer.cursorX) cursor={row:lines.length-1,col:x};
      if(col===end) break;
      const cell=line.getCell(col); if(!cell || cell.getWidth()===0) continue;
      if(x+cell.getWidth()>cols){lines.push([]);x=0;}
      let style='\x1b[0m';
      if(cell.isBold()) style+='\x1b[1m';
      if(cell.isFgRGB()){const n=cell.getFgColor();style+=`\x1b[38;2;${n>>>16&255};${n>>>8&255};${n&255}m`;}
      else if(cell.isFgPalette())style+=`\x1b[38;5;${cell.getFgColor()}m`;
      if(cell.isBgRGB()){const n=cell.getBgColor();style+=`\x1b[48;2;${n>>>16&255};${n>>>8&255};${n&255}m`;}
      else if(cell.isBgPalette())style+=`\x1b[48;5;${cell.getBgColor()}m`;
      lines.at(-1).push({ text:cell.getChars()||' ', style }); x+=cell.getWidth();
    }
    if(!continuation && row<buffer.length-1){lines.push([]);x=0;}
  }
  while(lines.length>cursor.row+1 && !lines.at(-1).some(c=>c.text.trim())) lines.pop();
  const top=Math.max(0,lines.length-rows);
  const output=lines.slice(top).map(line=>{let style='';return line.map(c=>{const prefix=c.style===style?'':c.style;style=c.style;return prefix+c.text;}).join('')+'\x1b[0m';}).join('\r\n');
  return '\x1b[?25l\x1b[0m\x1b[2J\x1b[H'+output+`\x1b[${Math.max(0,cursor.row-top)+1};${Math.min(cursor.col,cols-1)+1}H\x1b[?25h`;
}
async function transcript(capture) {
  const parts = [capture.title, `bitcode ${capture.version} · ${capture.recordedAt}`, capture.provenance, 'Presentation: animated command entry, original ANSI CLI output, shortened waits. Example login key is fake. Paths normalized.', ''];
  for (const segment of capture.segments) {
    const terminal = new Headless({ cols: 92, rows: 32, scrollback: 10000, allowProposedApi: true });
    await new Promise(resolve => terminal.write((segment.capture?.events || []).map(e=>e.data).join(''), resolve));
    const buffer = terminal.buffer.active;
    const lines = [];
    for (let row = 0; row < buffer.length; row++) lines.push(buffer.getLine(row).translateToString(true));
    parts.push(`$ ${segment.command}${segment.instructional ? '\n[Instructional command animation; not a captured remote clone.]' : ''}`, lines.join('\n').trimEnd());
    terminal.dispose();
  }
  return parts.join('\n\n') + '\n';
}
let executablePath = process.env.BITCODE_CHROMIUM;
if (!executablePath && !existsSync(chromium.executablePath())) {
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  if (existsSync(cache)) executablePath = readdirSync(cache).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse().flatMap(n=>['chrome-linux64/chrome','chrome-linux/chrome'].map(p=>path.join(cache,n,p))).find(existsSync);
}
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage();
let manifest = { version: 2, generatedAt: new Date().toISOString(), method: 'Three CLI walkthroughs with animated typing and captured ANSI output. Installation includes instructional clone/cd commands. Configuration uses a fake example key. The feature demo runs a real local model against public mainnet data. Waits shortened; paths normalized.', demos: [] };
if (only) { try { const old=JSON.parse(await readFile(path.join(out,'manifest.json'))); if(old.version===2) manifest=old; } catch { /* first render */ } }
try {
  for (const id of ids.filter(id => !only || id === only)) {
    const capture = JSON.parse(await readFile(path.join(input, `${id}.json`)));
    const seq = timeline(capture);
    console.log(id, 'timeline', seq.duration.toFixed(1), 'seconds;', seq.events.length, 'events');
    const exports = {};
    for (const vertical of [false, true]) {
      const aspect = vertical ? '9x16' : '16x9';
      const rate = vertical ? 1.12 : 1;
      const duration = Math.ceil(seq.duration / rate);
      const width = vertical ? 1080 : 1920, height = vertical ? 1920 : 1080;
      await page.setViewportSize({ width, height });
      await page.setContent(markup(capture, vertical));
      await page.addScriptTag({ content: xtermScript });
      const size = await page.evaluate(async vertical => {
        const fontSize = vertical ? 34 : 40;
        await document.fonts.load(`${fontSize}px JB`); await document.fonts.load(`600 ${fontSize}px JB`);
        const terminal = new Terminal({ cols: vertical ? 44 : 68, rows: vertical ? 23 : 14, fontFamily: 'JB, monospace', fontSize, fontWeightBold: '600', lineHeight: 1.16, cursorBlink: false, cursorStyle: 'block', scrollback: 10000, allowProposedApi: true,
          theme: { background: '#ffffff', foreground: '#26251e', cursor: '#f7931a', cursorAccent: '#ffffff', black:'#26251e', white:'#5a5852', brightBlack:'#807d72', brightWhite:'#26251e' } });
        terminal.open(document.getElementById('terminal')); terminal.focus();
        window.terminal = terminal;
        await new Promise(requestAnimationFrame);
        const screen=document.querySelector('.xterm-screen').getBoundingClientRect();
        const host=document.getElementById('terminal');
        const css=getComputedStyle(host);
        const width=host.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight);
        const height=host.clientHeight-parseFloat(css.paddingTop)-parseFloat(css.paddingBottom);
        const cols=Math.floor(width/(screen.width/terminal.cols));
        const rows=Math.floor(height/(screen.height/terminal.rows));
        terminal.resize(cols,rows);
        return {cols,rows};
      }, vertical);
      const source = new Headless({cols:92,rows:32,scrollback:10000,allowProposedApi:true});
      const video = `${id}-${aspect}.mp4`;
      const encoder = spawn('ffmpeg', ['-y','-v','error','-f','image2pipe','-framerate','15','-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-r','30','-movflags','+faststart',path.join(out,video)], { stdio:['pipe','ignore','pipe'] });
      let errorLog = ''; encoder.stderr.on('data', data => { errorLog += data; });
      const exited = once(encoder, 'close');
      encoder.stdin.on('error', () => {});
      let next = 0;
      const frameCount = duration * 15;
      for (let frame=0; frame<frameCount; frame++) {
        const time = frame / 15 * rate;
        let data = '';
        while (next < seq.events.length && seq.events[next].time <= time) data += seq.events[next++].data;
        if(data) { await new Promise(resolve=>source.write(data,resolve)); data=snapshot(source,size.cols,size.rows); }
        const caption = (seq.cues.find(cue=>time>=cue.start && time<cue.end) || seq.cues.at(-1)).text;
        await page.evaluate(async ({ data, caption, fraction, cursor }) => {
          if (data) await new Promise(resolve => window.terminal.write(data, resolve));
          document.getElementById('caption').textContent = caption;
          document.getElementById('progress').style.width = `${fraction*100}%`;
          window.terminal.options.cursorStyle = cursor ? 'block' : 'bar';
          await new Promise(requestAnimationFrame);
        }, { data, caption, fraction: frame/(frameCount-1), cursor: Math.floor(time*2)%2 === 0 });
        const png = await page.screenshot({ type:'png' });
        if (!encoder.stdin.write(png)) await once(encoder.stdin, 'drain');
        if ([0, Math.floor(frameCount*.25), Math.floor(frameCount*.5), Math.floor(frameCount*.8), frameCount-1].includes(frame)) await writeFile(path.join(frames,`${id}-${aspect}-${frame}.png`), png);
        if (!vertical && frame===Math.floor(frameCount*.8)) await writeFile(path.join(frames,`${id}-poster.png`), png);
        if (frame % 150 === 0) console.log(id, aspect, Math.round(frame/frameCount*100)+'%');
      }
      encoder.stdin.end();
      const [code] = await exited;
      source.dispose();
      if (code !== 0) throw new Error(`FFmpeg failed: ${errorLog}`);
      const probe = JSON.parse(execFileSync('ffprobe', ['-v','error','-show_streams','-show_format','-of','json',path.join(out,video)], { encoding:'utf8' }));
      exports[aspect] = { file: video, width, height, duration: Number(probe.format.duration), bytes: Number(probe.format.size) };
      console.log('Rendered', video, exports[aspect].duration+'s');
    }
    execFileSync('ffmpeg', ['-y','-v','error','-i',path.join(frames,`${id}-poster.png`),'-frames:v','1','-quality','85',path.join(out,`${id}-poster.webp`)]);
    await writeFile(path.join(out,`${id}-transcript.txt`), await transcript(capture));
    await writeFile(path.join(out,`${id}.en.vtt`), 'WEBVTT\n\n'+seq.cues.map(c=>`${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`).join('\n\n')+'\n');
    const entry = { id, title:capture.title, subtitle:capture.subtitle, model:capture.model || null, recordedAt:capture.recordedAt, sourceCommit:capture.sourceCommit, workingTreeModified:true, provenance:capture.provenance, transcript:`${id}-transcript.txt`, poster:`${id}-poster.webp`, captions:`${id}.en.vtt`, exports };
    manifest.demos = [...manifest.demos.filter(d=>d.id!==id), entry].sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));
    manifest.generatedAt = new Date().toISOString();
    await writeFile(path.join(out,'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
  }
} finally { await browser.close(); }
console.log('Review frames:',frames);
