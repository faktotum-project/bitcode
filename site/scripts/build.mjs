// Authoring only. Generated HTML is committed; Vercel has no build step.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateCatalog } from './catalog.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const pub=p=>path.join(root,'site/public',p);
const read=p=>readFile(path.join(root,p),'utf8');
const template=await read('site/src/index.template.html');
const catalogs=await Promise.all(['en','it'].map(async lang=>[lang,JSON.parse(await read(`site/src/i18n/${lang}.json`))]));
const keys=Object.keys(catalogs[0][1]).sort();
for(const [lang,strings] of catalogs) validateCatalog(catalogs[0][1],strings,lang);
const {sessions}=JSON.parse(await read('site/public/assets/site/recordings.json'));
const desktopManifest='site/public/assets/demos/desktop/manifest.json';
const desktopDemos=existsSync(path.join(root,desktopManifest))?JSON.parse(await read(desktopManifest)).demos:{};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=s=>JSON.stringify(s).replaceAll('<','\\u003c');
const ids=['bitcoin','lightning','liquid','rgb','cashu','local','code','extensions'];
// Intro: the pixel b assembles from falling, turning pieces coloured through the transaction states,
// then the outlined wordmark drops in letter by letter behind a pixel mask. Pure SVG + CSS, decorative.
const wordmark=await read('brand/logo/wordmark-on-dark.svg');
const letters=[...wordmark.matchAll(/<path transform="([^"]+)" d="([^"]+)"\/>/g)].map(([,transform,d],i)=>`<g class="intro-letter" style="--i:${i}"><path transform="${transform}" d="${d}"/></g>`).join('');
// Each piece: rect, entry offset in mark units and the quarter turns it makes on the way down.
const pieces=[[0,4,2,1,-1,1],[0,0,1,4,-2,1],[3,2,1,2,2,-1],[1,2,1,1,1,2],[2,1,1,1,-1,-1],[1,0,2,1,1,1]];
const piecesSvg=pieces.map(([x,y,w,h,dx,turns],i)=>`<rect class="intro-piece${i===0?' intro-piece--ink':''}" style="--i:${i};--dx:${dx};--turns:${turns}" x="${x}" y="${y}" width="${w}" height="${h}"/>`).join('');
let seed=21;const random=()=>((seed=Math.imul(seed^seed>>>15,seed|1)+0x6d2b79f5|0)>>>0)/4294967296;
const cells=[];for(let y=100;y<420;y+=40)for(let x=480;x<1448;x+=40)cells.push(`<rect x="${x}" y="${y}" width="40" height="40" style="--d:${Math.round(random()*360)}ms"/>`);
const intro=`<div class="intro" aria-hidden="true"><svg class="intro-lockup" viewBox="0 0 1448 500"><defs><mask id="intro-pixels" maskUnits="userSpaceOnUse" x="0" y="0" width="1448" height="500">${cells.join('')}</mask></defs><g class="intro-mark" transform="scale(100)" shape-rendering="crispEdges">${piecesSvg}</g><g class="intro-word" mask="url(#intro-pixels)">${letters}</g></svg></div>`;
for(const [lang,t] of catalogs){
 const localizedSessions=Object.fromEntries(Object.entries(sessions).map(([id,s])=>{const lines=t[`terminal.${id}.output`].split('\n');if(lines.length!==s.lines.length)throw Error('Recorded line count changed: '+id);return [id,{...s,lines:s.lines.map((line,i)=>({...line,text:lines[i]}))}];}));
 const terminal=(id,mode)=>{
  const s=localizedSessions[id];const hero=mode==='hero';const sticky=mode==='sticky';
  const rows=s.lines.map(l=>`<div class="hero-cli-line ${l.className?'hero-cli-line--'+escape(l.className):''}">${escape(l.text)||'&nbsp;'}</div>`).join('');
  const body=`<div class="hero-cli-body" ${hero?'id="hero-cli-output"':''} data-session="${id}" data-player="${mode}" lang="en" aria-hidden="true">${rows}</div><div class="sr-only" lang="en">${escape(s.lines.map(l=>l.text).join("\n"))}</div>`;
  if(hero)return body;
  return `<figure class="session-panel ${sticky?'session-panel--sticky':'inline-session'}" ${sticky?`data-panel="${id}"`:''}><div class="terminal"><div class="terminal-bar"><span class="terminal-title">bitcode · ${id}</span><span class="demo-label">${escape(t['ui.recorded'])}</span></div>${body}<div class="terminal-bottom"><span>${s.recordedAt.slice(0,10)}</span><a href="${s.source}">${escape(t['ui.source'])} ↗</a></div></div><figcaption><code>${escape(s.command)}</code><span>${escape(t[s.context])}</span></figcaption></figure>`;
 };
 const tabs=['source','ollama','qvac','scriptable'];
 const labels=[t['ui.sourceTab'],'Ollama','QVAC','Scriptable'];
 const installTabs=`<div class="install-tabs" aria-label="${escape(t['ui.installTabs'])}">${tabs.map((id,i)=>`<a id="tab-${id}" href="#install-${id}" data-install-tab="${id}">${escape(labels[i])}</a>`).join('')}<span class="install-indicator" aria-hidden="true"></span></div>`;
 const cmds={ollama:'node bitcode.mjs -m ollama/gpt-oss:20b',qvac:'npm --prefix integrations/qvac start\nnode bitcode.mjs -m qvac/bitcode-local',scriptable:'node bitcode.mjs --read-only --json -p "review this repo"'};
 const panels=tabs.slice(1).map(id=>`<div class="install-box" id="install-${id}" data-install-panel><div class="install-bar"><span>${id==='qvac'?'QVAC':id==='ollama'?'Ollama':'Scriptable'}</span><button class="copy-button" type="button" data-copy="install-${id}-command" aria-label="${escape(t['ui.copy'])}" hidden><svg class="icon" aria-hidden="true"><use href="#i-copy"/></svg></button></div><pre id="install-${id}-command">${escape(cmds[id])}</pre><div class="install-next"><p>${escape(t['ui.'+({ollama:'ollamaNote',qvac:'qvacNote',scriptable:'scriptNote'}[id])])}</p></div></div>`).join('');
 const extras=`<div class="site-preferences container"><button type="button" id="motion-toggle" aria-pressed="false" hidden>${escape(t['ui.motionPause'])}</button><p>${escape(t['ui.privacy'])}</p></div><div class="language-banner" hidden><span>${escape(t['ui.banner'])}</span><a data-language="it" href="/it/">${escape(t['ui.bannerLink'])}</a><button type="button" aria-label="${escape(t['ui.dismiss'])}">×</button></div><div class="brand-menu" role="group" aria-label="${escape(t['ui.brandMenu'])}" hidden><button type="button" data-logo-copy>${escape(t['ui.copySvg'])}</button><a href="/assets/site/bitcode.svg" download="bitcode.svg">${escape(t['ui.downloadSvg'])}</a><a href="https://github.com/faktotum-project/bitcode/tree/main/brand">${escape(t['ui.brand'])} ↗</a></div><dialog id="genesis-dialog" aria-labelledby="genesis-title"><p class="eyebrow" id="genesis-title">${escape(t['ui.genesisLabel'])}</p><blockquote lang="en">The Times 03/Jan/2009 Chancellor on brink of second bailout for banks</blockquote><button class="button button-secondary" type="button" data-genesis-close>${escape(t['ui.genesisClose'])}</button></dialog>`;
 const data={...t,heroSession:terminal('bitcoin','hero'),storySessions:ids.map(id=>terminal(id,'sticky')).join(''),installTabs,installPanels:panels,extras,jsonld:json({'@context':'https://schema.org','@type':'SoftwareApplication',name:'bitcode',applicationCategory:'DeveloperApplication',operatingSystem:'Linux, macOS, Windows',softwareVersion:'0.2.0',description:t['meta.description'],url:'https://bitcode-agent.vercel.app/'+t.path,inLanguage:lang,license:'https://github.com/faktotum-project/bitcode/blob/main/LICENSE',downloadUrl:'https://github.com/faktotum-project/bitcode'}),siteData:json({lang,heroSats:['node','script','hash','merkle'].map(id=>({id,src:`/assets/sats/${id}/ask-384.webp`,line:t[`hero.sat.${id}`]})),ui:Object.fromEntries(Object.entries(t).filter(([k])=>k.startsWith('ui.')).map(([k,v])=>[k.slice(3),v])),sessions:localizedSessions})};
 for(const id of ids)data['session.'+id]=terminal(id,'inline');
 // One Sat greets each visit beside the hero recording; the runtime picks which, so the markup stays static.
 data.heroSat='<div class="hero-sat" data-hero-sat aria-hidden="true" hidden><img alt="" width="384" height="384" decoding="async"><p class="hero-sat-line"></p></div>';
 data.intro=intro;
 data.viewSwitch=`<div class="view-switch" role="group" aria-label="${escape(t['ui.viewSwitch'])}" hidden><button type="button" data-view-tab="desktop" aria-pressed="true">${escape(t['ui.viewDesktop'])}</button><button type="button" data-view-tab="cli" aria-pressed="false">${escape(t['ui.viewCli'])}</button></div>`;
 // Desktop recordings: the same native player as the CLI walkthroughs, bytes requested only on play.
 const clock=s=>`${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;
 for(const [id,d] of Object.entries(desktopDemos)){
  if(d.loop)continue;
  const base='/assets/demos/desktop/',label=`${t[`desk.${id}.title`]} — ${t['ui.desktopWalkthrough']}`;
  data['player.'+id]=`<div class="recording-player" data-tilt><video id="recording-desktop-${id}" controls playsinline preload="none" loading="lazy" poster="${base}${d.files.poster}" width="1920" height="1080" aria-label="${escape(label)}"><source src="${base}${d.files.video}" type="video/mp4"><track kind="captions" src="${base}${id}.en.vtt" srclang="en" label="English" ${lang==='en'?'default':''}><track kind="captions" src="${base}${id}.it.vtt" srclang="it" label="Italiano" ${lang==='it'?'default':''}><p><a href="${base}${d.files.video}">${escape(t['text.149'])}</a>.</p></video><p class="video-message" role="status" aria-live="polite"></p></div><div class="recording-meta"><span>${clock(d.duration)} · ${escape(t['ui.desktopRecording'])}</span><span>${d.recordedAt.slice(0,10)}</span></div>`;
 }
 // A block wrapped in <!--if:KEY-->…<!--endif--> appears only once its data exists (a recording not made yet).
 const html='<!-- Generated by node site/scripts/build.mjs. Edit site/src/index.template.html and site/src/i18n/*.json. -->\n'+template.replace(/<!--if:([\w.-]+)-->([\s\S]*?)<!--endif-->/g,(_,key,block)=>key in data?block:'').replace(/\{\{([\w.-]+)\}\}/g,(_,key)=>{if(!(key in data))throw Error('Unknown template key: '+key);return ['heroSession','storySessions','installTabs','installPanels','extras','jsonld','siteData','viewSwitch','heroSat','intro'].includes(key)||key.startsWith('session.')||key.startsWith('player.')?data[key]:escape(data[key]);});
// Desktop recordings and share images keep their names across re-takes, so each URL carries a content version
// for browser caches and for link-preview caches (Telegram, WhatsApp, Instagram) keyed by image URL.
 const version=file=>createHash('sha1').update(readFileSync(pub(file.slice(1)))).digest('hex').slice(0,10);
 const versioned=html.replace(/\/assets\/(?:demos\/desktop\/[\w.-]+\.(?:mp4|webm|webp|vtt|txt)|og-image[\w-]*\.jpg)/g,file=>`${file}?v=${version(file)}`).replace(/data-loop-video data-src="([^"]+)"/g,(m,base)=>`${m} data-v="${createHash('sha1').update(['webm','mp4'].map(ext=>version(`${base}.${ext}`)).join('')).digest('hex').slice(0,10)}"`);
 if(/\{\{[\w.-]+\}\}/.test(html))throw Error('Unresolved placeholder');
 const out=lang==='en'?'index.html':'it/index.html';await mkdir(path.dirname(pub(out)),{recursive:true});await writeFile(pub(out),versioned);
 console.log(`Generated site/public/${out} (${keys.length} keys)`);
}
const base='https://bitcode-agent.vercel.app';
const alternates=`<xhtml:link rel="alternate" hreflang="en" href="${base}/"/><xhtml:link rel="alternate" hreflang="it" href="${base}/it/"/><xhtml:link rel="alternate" hreflang="x-default" href="${base}/"/>`;
await writeFile(pub('sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"><url><loc>${base}/</loc>${alternates}</url><url><loc>${base}/it/</loc>${alternates}</url></urlset>\n`);
// Vercel serves only site/public; the Sats the page shows are copied from the CLI's assets/sats.
for(const id of ['node','script','hash','merkle']){await mkdir(pub(`assets/sats/${id}`),{recursive:true});await copyFile(path.join(root,`assets/sats/${id}/idle-256.webp`),pub(`assets/sats/${id}/idle-256.webp`));}
await writeFile(pub('robots.txt'),`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
