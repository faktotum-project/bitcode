#!/usr/bin/env python3
"""Render assets/og-image.png: the link-preview card for index.html.

The card is the site's hero lockup — the pixel B from the #pixel-b symbol and
the Inter SemiBold wordmark — on the canvas tokens shared with src/theme.mjs.

Usage:
    python3 scripts/demos/make-og-image.py [fonts-dir] [out-path]

The fonts are not vendored. Fetch the three faces once into <fonts-dir>
(default /tmp/bitcode-og-fonts) as inter400.ttf, inter600.ttf and
jbmono500.ttf, for example from the static Google Fonts TTF URLs:

    curl -sSL -H 'User-Agent: Mozilla/5.0 (Windows NT 6.1)' \
      'https://fonts.googleapis.com/css2?family=Inter:wght@600' |
      grep -o 'https://fonts.gstatic.com[^)]*\\.ttf'

Requires Pillow.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FONTS = sys.argv[1] if len(sys.argv) > 1 else "/tmp/bitcode-og-fonts"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(REPO, "assets/og-image.png")

# Design tokens shared with index.html and src/theme.mjs.
CANVAS = (247, 247, 244)
SURFACE_STRONG = (230, 229, 224)
ORANGE = (247, 147, 26)
LOGO_INK = (15, 15, 15)
INK = (38, 37, 30)
BODY = (90, 88, 82)
MUTED = (128, 125, 114)

W, H = 1200, 630
SS = 3  # supersample, then downscale, for crisp type

img = Image.new("RGB", (W * SS, H * SS), CANVAS)
d = ImageDraw.Draw(img)

inter600 = ImageFont.truetype(os.path.join(FONTS, "inter600.ttf"), 150 * SS)
inter400 = ImageFont.truetype(os.path.join(FONTS, "inter400.ttf"), 42 * SS)
mono = ImageFont.truetype(os.path.join(FONTS, "jbmono500.ttf"), 21 * SS)


def tracked(xy, text, font, fill, tracking):
    """Draw text with the wordmark's negative letter-spacing."""
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill)
        x += d.textlength(ch, font=font) + tracking
    return x


# The pixel mark, on the same 4x5 grid as the #pixel-b symbol in index.html.
CELL = 52 * SS
LOGO_X, LOGO_Y = 96 * SS, 140 * SS
orange_cells = [(0, 0, 1, 4), (1, 0, 2, 1), (2, 1, 1, 1), (1, 2, 1, 1), (3, 2, 1, 2)]
ink_cells = [(0, 4, 2, 1)]
for cx, cy, cw, ch in orange_cells:
    d.rectangle([LOGO_X + cx * CELL, LOGO_Y + cy * CELL,
                 LOGO_X + (cx + cw) * CELL - 1, LOGO_Y + (cy + ch) * CELL - 1], fill=ORANGE)
for cx, cy, cw, ch in ink_cells:
    d.rectangle([LOGO_X + cx * CELL, LOGO_Y + cy * CELL,
                 LOGO_X + (cx + cw) * CELL - 1, LOGO_Y + (cy + ch) * CELL - 1], fill=LOGO_INK)

# Wordmark, optically centred against the mark.
word_x = LOGO_X + 4 * CELL + 48 * SS
ascent, _descent = inter600.getmetrics()
logo_mid = LOGO_Y + (5 * CELL) / 2
word_y = logo_mid - ascent / 2 - 6 * SS
tracked((word_x, word_y), "bitcode", inter600, INK, -0.06 * 150 * SS)

# The site's payoff line.
d.text((LOGO_X, 444 * SS), "Your code. Your Bitcoin. One agent.", font=inter400, fill=BODY)

# Footer in mono, with the orange eyebrow square.
foot_y = 532 * SS
d.rectangle([LOGO_X, foot_y - 26 * SS, W * SS - LOGO_X, foot_y - 26 * SS + SS], fill=SURFACE_STRONG)
sq = 9 * SS
d.rectangle([LOGO_X, foot_y + 5 * SS, LOGO_X + sq, foot_y + 5 * SS + sq], fill=ORANGE)
d.text((LOGO_X + sq + 14 * SS, foot_y),
       "TERMINAL AGENT  ·  62 TOOLS  ·  45 COMMANDS  ·  YOUR CHOICE OF MODEL",
       font=mono, fill=MUTED)

img.resize((W, H), Image.LANCZOS).save(OUT, "PNG", optimize=True)
print("wrote", OUT)
