#!/usr/bin/env python3
"""Assemble design/video/stage/: the real built renderer + the demo backend."""
import json, pathlib, re, shutil
here = pathlib.Path(__file__).resolve().parent
ui = here.parent.parent / 'desktop' / 'dist' / 'ui'
out = here / 'stage'
if out.exists(): shutil.rmtree(out)
shutil.copytree(ui, out / 'app')
html = (out / 'app' / 'index.html').read_text()
html = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', '', html)  # stage-only: the demo backend is a local script
html = html.replace('<link rel="stylesheet" href="xterm.css">', '<script src="sats.js"></script>\n<script src="mock.js"></script>\n<link rel="stylesheet" href="xterm.css">')
(out / 'app' / 'index.html').write_text(html)
(out / 'app' / 'sats.js').write_text('window.__SATS = ' + (here / 'sats.fixture.json').read_text() + ';')
shutil.copy(here / 'mock.js', out / 'app' / 'mock.js')
for f in ('stage.html', 'engine.js', 'timeline.js'): shutil.copy(here / f, out / f)
print('stage ready:', out)
