// Produce editorial replays from real captured events, plus complete transcripts.
// BITCODE_PLAYWRIGHT_MODULE may point to an existing Playwright installation.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const { chromium } = await import(process.env.BITCODE_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const input = path.resolve(process.argv[2] || '/tmp/bitcode-demo-recordings');
const out = path.join(repo, 'assets/demos');
await mkdir(path.join(os.tmpdir(), 'bitcode-demo-frames'), { recursive: true });
const frames = path.join(os.tmpdir(), 'bitcode-demo-frames');
await mkdir(out, { recursive: true });
const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const configs = {
  'code-review': { title: 'Find it. Fix it. Verify it.', short: 'Code, with evidence.', subtitle: 'A real repair in a disposable project.', tag: 'CODE / REAL SESSION', accent: '#c0a8dd' },
  'bitcoin-fees': { title: 'Read the network.', short: 'Bitcoin, in context.', subtitle: 'Public mainnet data. No transaction sent.', tag: 'BITCOIN / REAL SESSION', accent: '#9fbbe0' },
  'mcp-skills': { title: 'Bring your own tools.', short: 'MCP meets local skills.', subtitle: 'A real MCP server. A real review skill.', tag: 'MCP + SKILLS / REAL SESSION', accent: '#9fc9a2' },
};
function scenes(capture) {
  const result = [{ label: 'The request', text: capture.events[0].text, caption: 'A focused task, sent to the local model.', color: '#dfa88f' }];
  for (const e of capture.events) {
    if (e.type !== 'tool_end') continue;
    let body = e.result;
    if (e.name === 'edit_file') {
      const edit = capture.events.find(x => x.type === 'tool_start' && x.name === 'edit_file');
      body = JSON.stringify(edit?.args, null, 2) + '\n\n' + e.result;
    }
    if (e.name === 'bash') body = e.result.split('\n').filter(line => /[✖✔]|test|pass|fail|expected|actual|\+|\-|exit code|156|155/i.test(line)).join('\n');
    const label = e.name;
    result.push({ label, text: body, caption: e.name === 'edit_file' ? 'The agent applies a change to the demo fixture.' : e.name === 'bash' ? 'Actual test output from the recorded run.' : e.name.startsWith('btc_') ? 'Recorded network snapshot; values change over time.' : e.name.startsWith('mcp_') ? 'The MCP tool reads the project’s real release requirements.' : e.name === 'read_skill' ? 'The agent loads a local review skill.' : 'The agent inspects the evidence before answering.', color: e.name === 'edit_file' ? '#c0a8dd' : e.name.startsWith('mcp_') ? '#9fc9a2' : '#9fbbe0' });
  }
  const answer = capture.events.filter(e => e.type === 'assistant').at(-1);
  if (answer) result.push({ label: 'The result', text: answer.text, caption: 'The actual final answer. Full transcript on the site.', color: '#c08532' });
  // Combine adjacent read-file views only through explicit editorial selection.
  return result.length <= 7 ? result : [result[0], ...result.slice(1).filter(s => !s.label.startsWith('read_file')).slice(0, 5), result.at(-1)];
}
function excerpt(text, columns, maxLines) {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = [];
  for (const line of clean.split('\n')) {
    if (!line) { lines.push(''); continue; }
    let remaining = line;
    while (remaining.length > columns) {
      let cut = remaining.lastIndexOf(' ', columns);
      if (cut < columns / 2) cut = columns;
      lines.push(remaining.slice(0, cut)); remaining = remaining.slice(cut).trimStart();
    }
    lines.push(remaining);
  }
  return lines.length > maxLines ? lines.slice(0, maxLines - 2).join('\n') + '\n\n[… excerpt; full transcript on site]' : lines.join('\n');
}
function html(capture, config, scene, index, count, vertical) {
  const width = vertical ? 1080 : 1920, height = vertical ? 1920 : 1080;
  const text = excerpt(scene.text, vertical ? 53 : 102, vertical ? 12 : 10);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"><style>
  *{box-sizing:border-box}body{margin:0;width:${width}px;height:${height}px;background:#f7f7f4;color:#26251e;font-family:Inter,Arial,sans-serif;padding:${vertical ? '235px 72px 300px' : '65px 88px 55px'};display:flex;flex-direction:column}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:${vertical ? 32 : 24}px}.brand{display:flex;gap:17px;align-items:center;font-size:38px;font-weight:600;letter-spacing:-2px}.tag{font-family:'JetBrains Mono',monospace;font-size:${vertical ? 17 : 19}px;color:#5a5852}.label{font-size:17px;letter-spacing:2px;color:#5a5852;margin-bottom:20px}h1{margin:0;font-size:${vertical ? 64 : 66}px;letter-spacing:-3px;font-weight:400;line-height:1.1}h1 span{box-shadow:0 4px #f7931a} .sub{font-size:${vertical ? 25 : 25}px;color:#5a5852;margin:14px 0 22px;line-height:1.5}.terminal{border:1px solid #cfcdc4;background:white;border-radius:16px;overflow:hidden;flex:1;min-height:0}.bar{display:flex;align-items:center;justify-content:space-between;padding:14px 24px;background:#fafaf7;border-bottom:1px solid #e6e5e0;font:19px 'JetBrains Mono',monospace;color:#5a5852}.dots{display:flex;gap:8px}.dots i{width:10px;height:10px;border-radius:50%;background:#dfa88f}.dots i:nth-child(2){background:#9fc9a2}.dots i:nth-child(3){background:#9fbbe0}.body{padding:22px 30px}.pill{display:inline-block;border-radius:5px;padding:8px 12px;background:${scene.color};font:19px 'JetBrains Mono',monospace;margin-bottom:16px}pre{font-family:'JetBrains Mono',monospace;font-size:${vertical ? 26 : 26}px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;letter-spacing:-.6px}.caption{font-size:${vertical ? 27 : 26}px;line-height:1.5;margin:25px 0 22px;min-height:${vertical ? 81 : 39}px;color:#5a5852}.progress{display:flex;gap:7px;margin-bottom:17px}.progress i{height:4px;flex:1;background:#e6e5e0}.progress i.on{background:#f7931a}.footer{display:flex;justify-content:space-between;gap:20px;font:16px/1.5 'JetBrains Mono',monospace;color:#5a5852}.model{font:19px/1.5 'JetBrains Mono',monospace;margin-top:12px;color:#5a5852}
  </style></head><body><header><div class="brand"><svg width="32" height="40" viewBox="0 0 4 5"><path fill="#f7931a" d="M0 0h1v4H0zM1 0h2v1H1zM2 1h1v1H2zM1 2h1v1H1zM3 2h1v2H3z"/><path fill="#0f0f0f" d="M0 4h2v1H0z"/></svg>bitcode</div><span class="tag">RECORDED SESSION</span></header><div class="label">${config.tag}</div><h1><span>${config[vertical ? 'short' : 'title']}</span></h1><div class="model">${escape(capture.model)} · ${capture.model.startsWith('ollama/') ? 'local model tag' : 'configured API model'}</div><p class="sub">${config.subtitle}</p><div class="terminal"><div class="bar"><span class="dots"><i></i><i></i><i></i></span><span>bitcode v${capture.version} / demo-project</span></div><div class="body"><span class="pill">${escape(scene.label)}</span><pre>${escape(text)}</pre></div></div><p class="caption">${escape(scene.caption)}</p><div class="progress">${Array.from({length:count},(_,i)=>`<i class="${i<=index?'on':''}"></i>`).join('')}</div><div class="footer"><span>Edited replay · ${index+1}/${count}</span><span>${capture.recordedAt.slice(0,10)} · bitcode</span></div></body></html>`;
}
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const manifest = { version: 1, generatedAt: new Date().toISOString(), method: 'Editorial replay of real bitcode runAgent events, not a screen recording. Waits shortened, selected excerpts shown; complete transcript included.', requestedModelsPending: ['openai/gpt-6-astra', 'anthropic/claude-fable-5-1', 'Qwen3.8-Flash-Next deployment'], demos: [] };
try {
  for (const [id, config] of Object.entries(configs)) {
    const capture = JSON.parse(await readFile(path.join(input, `${id}.json`), 'utf8'));
    if (capture.status !== 'complete' || capture.events.some(e=>e.type==='error')) throw new Error(`${id}: incomplete capture`);
    const sequence = scenes(capture);
    const transcript = [`bitcode ${capture.version} — ${config.title}`, `Model requested/configured: ${capture.model}`, capture.modelAttestation, `Recorded: ${capture.recordedAt}`, `Original elapsed time: ${capture.elapsedSeconds}s`, `Base commit: ${capture.gitBase}; local modifications present`, capture.fixture, manifest.method, '', ...capture.events.map(e => `[${e.time.toFixed(2)}s] ${e.type}${e.name ? ' '+e.name : ''}\n${e.text || e.result || JSON.stringify(e.args || {})}`)].join('\n\n');
    await writeFile(path.join(out, `${id}-transcript.txt`), transcript);
    const exports = {};
    for (const vertical of [false, true]) {
      const aspect = vertical ? '9x16' : '16x9';
      const seconds = vertical ? 4 : 6;
      const files = [];
      await page.setViewportSize({ width: vertical ? 1080 : 1920, height: vertical ? 1920 : 1080 });
      for (let i=0;i<sequence.length;i++) {
        await page.setContent(html(capture, config, sequence[i], i, sequence.length, vertical));
        await page.evaluate(() => document.fonts.ready);
        const fits = await page.evaluate(() => {
          const pre=document.querySelector('pre'), terminal=document.querySelector('.terminal');
          let lines=pre.textContent.split('\n');
          while(pre.getBoundingClientRect().bottom > terminal.getBoundingClientRect().bottom-16 && lines.length>4) {
            lines=lines.filter(line=>!line.startsWith('[… excerpt;'));
            lines.pop(); while(lines.at(-1)==='') lines.pop();
            pre.textContent=lines.join('\n')+'\n[… excerpt; full transcript on site]';
          }
          return pre.getBoundingClientRect().bottom <= terminal.getBoundingClientRect().bottom-16;
        });
        if (!fits) throw new Error(`${id}/${aspect}/${i}: terminal text overflows`);
        const file = path.join(frames, `${id}-${aspect}-${i}.png`);
        await page.screenshot({ path: file }); files.push(file);
        if (!vertical && i===0) execFileSync('ffmpeg',['-y','-v','error','-i',file,'-frames:v','1','-quality','85',path.join(out,`${id}-poster.webp`)]);
      }
      const list = path.join(frames, `${id}-${aspect}.txt`);
      await writeFile(list, files.map(f=>`file '${f}'\nduration ${seconds}`).join('\n')+`\nfile '${files.at(-1)}'\n`);
      const video = `${id}-${aspect}.mp4`;
      execFileSync('ffmpeg', ['-y','-v','error','-f','concat','-safe','0','-i',list,'-t',String(sequence.length*seconds),'-vf','fps=30','-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart','-an',path.join(out,video)], { timeout: 180000 });
      const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path.join(out,video)]));
      exports[aspect] = { file: video, width: probe.streams[0].width, height: probe.streams[0].height, duration: Number(probe.format.duration), bytes: Number(probe.format.size) };
      console.log('Rendered',video,exports[aspect].duration+'s');
    }
    const stamp = n => `00:${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}.000`;
    await writeFile(path.join(out,`${id}.en.vtt`), 'WEBVTT\n\n'+sequence.map((s,i)=>`${stamp(i*6)} --> ${stamp((i+1)*6)}\n${s.caption}`).join('\n\n')+'\n');
    manifest.demos.push({ id, title: config.title, model: capture.model, modelAttestation: capture.modelAttestation, recordedAt:capture.recordedAt, originalElapsedSeconds:capture.elapsedSeconds, sourceCommit:capture.gitBase, workingTreeModified:true, toolCalls:capture.events.filter(e=>e.type==='tool_end').length, transcript:`${id}-transcript.txt`, poster:`${id}-poster.webp`, captions:`${id}.en.vtt`, exports });
    await writeFile(path.join(out,'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
  }
} finally { await browser.close(); }
