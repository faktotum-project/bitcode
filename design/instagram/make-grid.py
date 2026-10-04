#!/usr/bin/env python3
"""Render the three pinned Instagram posts that together spell the Bitcode lockup.

Each post is 1080x1350 (4:5). The profile grid shows the central 1012x1350 (3:4)
of every post, so the design is laid out on a virtual strip made of the three
visible areas, and each post adds the 34px of strip beyond its edges. A white
card with a hairline and a soft shadow frames the whole strip; the lockup sits on
it with its own soft shadow. Size and position are chosen so both cuts fall in
empty space. Colours and effects come from tokens.json.

Usage: python3 make-grid.py [light|dark]   (writes templates/<theme>/grid/)
"""
import json
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
THEME = sys.argv[1] if len(sys.argv) > 1 else "light"
FONT = os.path.join(HERE, "fonts", "Inter-SemiBold.ttf")
OUT = os.path.join(HERE, "templates", THEME, "grid")
os.makedirs(OUT, exist_ok=True)
T = json.load(open(os.path.join(HERE, "tokens.json")))


def rgb(hex_):
    return tuple(int(hex_[i:i + 2], 16) for i in (1, 3, 5))


TH = T["theme"][THEME]
C = {k: rgb(v) for k, v in TH.items() if isinstance(v, str)}
C["accent"], C["logoInk"] = rgb(T["accent"]), C["logoBase"]
POST_W, POST_H = T["format"]["post"]["size"]
VIS_W = T["format"]["post"]["gridCrop"][0]
FRAME = {"inset": 48, "radius": T["radius"]["card"], "stroke": T["stroke"]["hairline"]}
SHADOW = {"frame": dict(T["shadow"]["card"], opacity=TH["shadowOpacity"]),
          "logo": dict(T["shadow"]["logo"], opacity=min(1, TH["shadowOpacity"] * T["shadow"]["logo"]["opacityScale"]))}
PAD = (POST_W - VIS_W) // 2
STRIP_W = 3 * VIS_W + 2 * PAD
SS = 2

B_BODY = [(0, 0, 1, 4), (1, 0, 2, 1), (2, 1, 1, 1), (1, 2, 1, 1), (3, 2, 1, 2)]
B_BASE = (0, 4, 2, 1)


def lockup(cell):
    """Draw mark + wordmark on a tight transparent layer; return it."""
    size = round(cell * T["lockup"]["wordSizePerCell"])  # mark-to-word ratio of assets/og-image.png
    font = ImageFont.truetype(FONT, size)
    track = T["font"]["wordmark"]["trackingEm"] * size
    mark_w, mark_h = 4 * cell, 5 * cell
    gap = round(cell * T["lockup"]["gapPerCell"])
    word_w = sum(font.getlength(c) for c in "bitcode") + 6 * track
    layer = Image.new("RGBA", (int(mark_w + gap + word_w + 4), mark_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for x, y, cw, ch in B_BODY:
        d.rectangle([x * cell, y * cell, (x + cw) * cell - 1, (y + ch) * cell - 1], fill=C["accent"])
    x, y, cw, ch = B_BASE
    d.rectangle([x * cell, y * cell, (x + cw) * cell - 1, (y + ch) * cell - 1], fill=C["logoInk"])
    # Centre the ascender-to-baseline box of the word on the mark.
    top, bottom = font.getbbox("b")[1], font.getbbox("b")[3]
    ty = mark_h / 2 - (top + bottom) / 2
    tx = mark_w + gap
    for c in "bitcode":
        d.text((tx, ty), c, font=font, fill=C["ink"])
        tx += font.getlength(c) + track
    return layer


def empty_columns(layer):
    px = layer.getchannel("A").load()
    w, h = layer.size
    return [all(px[x, y] == 0 for y in range(0, h, 2)) for x in range(w)]


def clearance(empty, col, cell):
    if col < 0 or col >= len(empty):
        return 10 ** 6
    # A cut along a cell edge of the pixel mark keeps the grid intact.
    if col < 4 * cell and abs(col - round(col / cell) * cell) <= SS:
        return 10 ** 5
    if not empty[col]:
        return -1
    l = r = col
    while l > 0 and empty[l - 1]:
        l -= 1
    while r < len(empty) - 1 and empty[r + 1]:
        r += 1
    return min(col - l, r - col)


def shadow(alpha, spec, fill):
    """A soft shadow layer for the given alpha mask."""
    a = alpha.point(lambda v: round(v * spec["opacity"]))
    a = ImageChops.offset(a, 0, spec["offsetY"] * SS).filter(ImageFilter.GaussianBlur(spec["blur"] * SS / 2))
    layer = Image.new("RGBA", alpha.size, fill + (0,))
    layer.putalpha(a)
    return layer


# Largest lockup, closest to centre, whose cuts land in empty space.
best = None
for cell in range(160 * SS, 172 * SS, SS):
    layer = lockup(cell)
    empty = empty_columns(layer)
    centre = (STRIP_W * SS - layer.width) // 2
    for shift in range(-40 * SS, 41 * SS, SS):
        x0 = centre + shift
        cuts = [(PAD + VIS_W) * SS - x0, (PAD + 2 * VIS_W) * SS - x0]
        if min(clearance(empty, c, cell) for c in cuts) < 3 * SS:
            continue
        rank = (cell, -abs(shift))
        if best is None or rank > best[0]:
            best = (rank, cell, x0)
_, cell, x0 = best

size = (STRIP_W * SS, POST_H * SS)

# Background: canvas + framed card spanning the three visible areas.
bg = Image.new("RGBA", size, C["canvas"] + (255,))
f = FRAME
box = [(PAD + f["inset"]) * SS, f["inset"] * SS,
       (STRIP_W - PAD - f["inset"]) * SS - 1, (POST_H - f["inset"]) * SS - 1]
mask = Image.new("L", size, 0)
ImageDraw.Draw(mask).rounded_rectangle(box, radius=f["radius"] * SS, fill=255)
bg.alpha_composite(shadow(mask, SHADOW["frame"], C["shadow"]))
ImageDraw.Draw(bg).rounded_rectangle(box, radius=f["radius"] * SS, fill=C["card"] + (255,),
                                     outline=C["hairline"] + (255,), width=f["stroke"] * SS)

# Foreground: the lockup and its shadow.
layer = lockup(cell)
fg = Image.new("RGBA", size, (0, 0, 0, 0))
fg.paste(layer, (x0, (POST_H * SS - layer.height) // 2), layer)
logo = Image.new("RGBA", size, (0, 0, 0, 0))
logo.alpha_composite(shadow(fg.getchannel("A"), SHADOW["logo"], C["shadow"]))
logo.alpha_composite(fg)

bg = bg.resize((STRIP_W, POST_H), Image.LANCZOS)
logo = logo.resize((STRIP_W, POST_H), Image.LANCZOS)
print(f"cell={cell / SS}px  lockup={layer.width // SS}x{layer.height // SS}px")

names = ["3-sinistra.png", "2-centro.png", "1-destra.png"]
for i, name in enumerate(names):
    crop = (i * VIS_W, 0, i * VIS_W + POST_W, POST_H)
    post, mark = bg.crop(crop), logo.crop(crop)
    # The lockup beyond the grid crop belongs to the neighbour; drop it so a
    # post opened on its own shows no slivers of the next letter. The frame
    # stays, so its lines run on to the post edges.
    clear = Image.new("RGBA", (PAD, POST_H), (0, 0, 0, 0))
    mark.paste(clear, (0, 0))
    mark.paste(clear, (POST_W - PAD, 0))
    post.alpha_composite(mark)
    post.convert("RGB").save(os.path.join(OUT, name))

# Preview of the profile grid: 3:4 crops with Instagram's thin gutter.
G, S = 3, 1 / 2.5
tw, th = round(VIS_W * S), round(POST_H * S)
prev = Image.new("RGB", (3 * tw + 2 * G, th), C["canvas"])
for i, name in enumerate(names):
    t = Image.open(os.path.join(OUT, name)).crop((PAD, 0, PAD + VIS_W, POST_H)).resize((tw, th), Image.LANCZOS)
    prev.paste(t, (i * (tw + G), 0))
prev.save(os.path.join(OUT, "anteprima-griglia.png"))
