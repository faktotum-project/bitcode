#!/usr/bin/env python3
"""Render the Bitcode Desktop video frame by frame.

  render.py preview 3,6,12.5        -> PNG stills (1080p) of the given seconds
  render.py chunk <i> <n>           -> render chunk i of n as 4K60 mp4 segment
"""
import argparse, functools, http.server, pathlib, socketserver, subprocess, sys, threading, time
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
STAGE = HERE / 'stage'
FPS, DURATION = 60, 59.0
TOTAL = int(FPS * DURATION)

def serve(port):
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=str(STAGE)))
    srv.allow_reuse_address = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]

def open_page(p, port, scale):
    b = p.chromium.launch(args=['--disable-lcd-text', '--font-render-hinting=none', '--disable-gpu-vsync'])
    ctx = b.new_context(viewport={'width': 1920, 'height': 1080}, device_scale_factor=scale)
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    pg.goto(f'http://127.0.0.1:{port}/stage.html')
    pg.evaluate('engine.ready()')
    return b, pg, errs

def frame_step(pg, t, shot=False):
    r = pg.evaluate('t => engine.step(t)', t)
    if r['cursor'] > 0.01: pg.mouse.move(r['mx'], r['my'])
    pg.evaluate('([t, s]) => engine.scan(t, { settle: s })', [t, shot])

def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest='cmd', required=True)
    pv = sub.add_parser('preview'); pv.add_argument('times'); pv.add_argument('--scale', type=float, default=1); pv.add_argument('--out', default=str(HERE / 'preview')); pv.add_argument('--css', default='')
    ck = sub.add_parser('chunk'); ck.add_argument('index', type=int); ck.add_argument('count', type=int); ck.add_argument('--out', default=str(HERE / 'out' / 'chunks')); ck.add_argument('--scale', type=float, default=2); ck.add_argument('--port', type=int, default=0); ck.add_argument('--lo', type=int, default=-1); ck.add_argument('--hi', type=int, default=-1)
    a = ap.parse_args()
    if a.cmd == 'preview':
        port = serve(0)
        wanted = sorted({round(float(x) * FPS) for x in a.times.split(',')})
        out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
        with sync_playwright() as p:
            b, pg, errs = open_page(p, port, a.scale)
            if a.css: pg.add_style_tag(content=a.css)
            for i in range(max(wanted) + 1):
                shot = i in wanted
                frame_step(pg, i / FPS, shot)
                if shot:
                    pg.screenshot(path=str(out / f't{i / FPS:06.2f}.png'), caret='initial')
                    print(f't={i / FPS:.2f}', pg.evaluate('engine.state()'))
            print('page errors:', errs)
            b.close()
    else:
        port = serve(0)
        per = -(-TOTAL // a.count); lo, hi = a.index * per, min(TOTAL, (a.index + 1) * per)
        if a.lo >= 0: lo, hi = a.lo, a.hi
        out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
        dest = out / f'chunk{a.index:02d}.mp4'
        ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', str(FPS), '-c:v', 'mjpeg', '-i', '-',
                               '-vf', 'scale=3840:2160:flags=lanczos', '-c:v', 'libx264', '-preset', 'medium', '-crf', '13', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', str(FPS), str(dest)], stdin=subprocess.PIPE)
        with sync_playwright() as p:
            b, pg, errs = open_page(p, port, a.scale)
            t0 = time.time()
            for i in range(hi):
                shot = i >= lo
                frame_step(pg, i / FPS, shot)
                if shot:
                    ff.stdin.write(pg.screenshot(type='jpeg', quality=96, caret='initial'))
                    if (i - lo) % 60 == 0: print(f'chunk {a.index}: frame {i - lo}/{hi - lo}  {time.time() - t0:.0f}s', flush=True)
            ff.stdin.close(); ff.wait(); print('page errors:', errs); b.close()

if __name__ == '__main__':
    main()
