"""Capture the real CLI's ANSI output in a disposable pseudo-terminal.

The JSON request arrives on stdin; the JSON result goes to stdout. No input
events (including the example login key) are included in the output recording.
"""
import errno
import fcntl
import json
import os
import select
import struct
import subprocess
import sys
import termios
import time

request = json.load(sys.stdin)
master, slave = os.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 92, 0, 0))
env = {**os.environ, **request.get("env", {}), "TERM": "xterm-256color", "COLORTERM": "truecolor"}
env.pop("NO_COLOR", None)
child = subprocess.Popen(request["argv"], cwd=request["cwd"], env=env,
                         stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
start = time.monotonic()
events = []
pending = b""


def drain(seconds):
    global pending
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if not select.select([master], [], [], min(.02, max(0, end-time.monotonic())))[0]:
            continue
        try:
            data = os.read(master, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                return
            raise
        if not data:
            return
        # Decode across chunk boundaries without damaging Unicode glyphs.
        pending += data
        try:
            text = pending.decode("utf-8")
            pending = b""
        except UnicodeDecodeError:
            continue
        events.append({"time": round(time.monotonic()-start, 4), "data": text})
        # The TUI asks for a cursor position when its real dropdown is visible.
        # A stable row is sufficient for this keyboard-only recording.
        if "\x1b[6n" in text:
            os.write(master, b"\x1b[10;1R")


try:
    for step in request.get("steps", []):
        if "waitFor" in step:
            deadline = time.monotonic() + step.get("timeout", 30)
            offset = len(events)
            while step["waitFor"] not in "".join(e["data"] for e in events[offset:]):
                if child.poll() is not None:
                    raise RuntimeError("CLI exited before expected prompt")
                if time.monotonic() > deadline:
                    raise TimeoutError("CLI did not reach expected prompt")
                drain(.05)
        drain(step.get("pause", .35))
        for char in step.get("type", ""):
            os.write(master, char.encode("utf-8"))
            drain(step.get("delay", .035))
        if step.get("enter"):
            os.write(master, b"\r")
            drain(.05)
    deadline = start + request.get("timeout", 600)
    while child.poll() is None:
        if time.monotonic() > deadline:
            raise TimeoutError("CLI capture timed out")
        drain(.05)
    drain(.1)
    json.dump({"events": events, "exitCode": child.returncode,
               "elapsed": round(time.monotonic()-start, 3)}, sys.stdout)
finally:
    if child.poll() is None:
        child.terminate()
        try:
            child.wait(3)
        except subprocess.TimeoutExpired:
            child.kill()
    os.close(master)
