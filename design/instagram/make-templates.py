#!/usr/bin/env python3
"""Render the empty Bitcode Instagram templates into ./templates.

Each template carries only the brand chrome (card, header lockup, footer
signature, carousel progress); the content area is left empty to fill per post.

    templates/<light|dark>/   post, carousel cover/slide/end, story, reel cover, highlights
    templates/shared/         profile picture
    templates/guides/         the light templates with safe areas and margins drawn on
    templates/overview.png    every template at a glance

Usage: python3 make-templates.py
"""
import os

from PIL import Image, ImageDraw

from bitcode_ig import (SAT_IDS, SS, T, Canvas, lockup, mark, rgb, sat_dots, sat_image,
                        theme, with_shadow)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")
INSET, PADDING = T["space"]["cardInset"], T["space"]["cardPadding"]
HEADER_CELL = T["lockup"]["cell"]["header"]


def header(cv, th, x, y, cell=HEADER_CELL, counter=None, right_edge=None):
    """Lockup at the top-left of the content box; optional carousel counter on the right."""
    lk, pad = with_shadow(lockup(cell, th), th) if cell > HEADER_CELL else (lockup(cell, th), 0)
    cv.paste(lk, x - pad, y - pad)
    if counter:
        cv.text(right_edge, y + 5 * cell / 2, counter, "label", T["typeScale"]["label"], th["muted"], anchor="rm")
    return y + 5 * cell


def progress(cv, th, x, y_mid, index, total, seg=56, h=6, gap=8):
    for i in range(total):
        x0 = x + i * (seg + gap)
        cv.d.rounded_rectangle(cv.box(x0, y_mid - h / 2, x0 + seg, y_mid + h / 2), radius=h * SS / 2,
                               fill=rgb(T["accent"]) if i == index else th["hairline"])


def framed(th, size, box):
    """Canvas with the card; returns the canvas and the content box inside the padding."""
    cv = Canvas(*size, th["canvas"])
    cv.card(*box, th)
    x0, y0, x1, y1 = box
    return cv, (x0 + PADDING, y0 + PADDING, x1 - PADDING, y1 - PADDING)


def post(th):
    w, h = T["format"]["post"]["size"]
    cv, (cx0, cy0, cx1, cy1) = framed(th, (w, h), (INSET, INSET, w - INSET, h - INSET))
    header(cv, th, cx0, cy0)
    sat_dots(cv, cx1, cy1 - 7)
    return cv


def carousel(th, kind, index=1, total=5):
    w, h = T["format"]["post"]["size"]
    cv, (cx0, cy0, cx1, cy1) = framed(th, (w, h), (INSET, INSET, w - INSET, h - INSET))
    counter = f"{index + 1:02d} / {total:02d}"
    if kind == "cover":
        header(cv, th, cx0, cy0, cell=T["lockup"]["cell"]["cover"])
        cv.text(cx1, cy1 - 7, "scorri", "label", T["typeScale"]["label"], th["muted"], anchor="rm")
        progress(cv, th, cx0, cy1 - 7, 0, total)
        return cv
    if kind == "end":
        cell = T["lockup"]["cell"]["hero"] - 6
        lk, pad = with_shadow(lockup(cell, th), th)
        lw = lk.width / SS - 2 * pad
        top = (cy0 + cy1) / 2 - 5 * cell - 40
        cv.paste(lk, (w - lw) / 2 - pad, top - pad)
        size, gap = 150, 26
        x = (w - 4 * size - 3 * gap) / 2
        for sat in SAT_IDS:
            cv.paste(sat_image(sat, "happy", size), x, top + 5 * cell + 90)
            x += size + gap
        progress(cv, th, cx0, cy1 - 7, total - 1, total)
        sat_dots(cv, cx1, cy1 - 7)
        return cv
    header(cv, th, cx0, cy0, counter=counter, right_edge=cx1)
    progress(cv, th, cx0, cy1 - 7, index, total)
    sat_dots(cv, cx1, cy1 - 7)
    return cv


def story(th):
    f = T["format"]["story"]
    w, h = f["size"]
    cv, (cx0, _, cx1, _) = framed(th, (w, h), (48, 48, w - 48, h - 48))
    header(cv, th, cx0, f["safeTop"])
    sat_dots(cv, cx1, h - f["safeBottom"] - 7)
    return cv


def reel_cover(th):
    f = T["format"]["reel"]
    w, h = f["size"]
    gw, gh = f["gridCrop"]
    top = (h - gh) / 2
    cv, (cx0, cy0, cx1, cy1) = framed(th, (w, h), (INSET, top + 48, w - INSET, top + gh - 48))
    header(cv, th, cx0, cy0)
    sat_dots(cv, cx1, cy1 - 7)
    return cv


def highlight(th, sat=None):
    w = h = T["format"]["square"]["size"][0]
    cv = Canvas(w, h, th["canvas"])
    r = 470
    if sat is None:
        cv.d.ellipse(cv.box(w / 2 - r, h / 2 - r, w / 2 + r, h / 2 + r), fill=th["card"],
                     outline=th["hairline"], width=T["stroke"]["hairline"] * SS)
        m = mark(70, th)
        cv.paste(m, (w - 280) / 2, (h - 350) / 2)
    else:
        col = rgb(T["sats"][sat]["color"])
        tint = tuple(round(c * 0.22 + b * 0.78) for c, b in zip(col, th["card"]))
        cv.d.ellipse(cv.box(w / 2 - r, h / 2 - r, w / 2 + r, h / 2 + r), fill=tint)
        cv.paste(sat_image(sat, "idle", 760), (w - 760) / 2, (h - 760) / 2 + 30)
    return cv


def profile():
    th = theme("light")
    w = T["format"]["square"]["size"][0]
    cv = Canvas(w, w, th["canvas"])
    cell = 96
    cv.paste(mark(cell, th), (w - 4 * cell) / 2, (w - 5 * cell) / 2)
    return cv


# ---------- guides ----------

def guide_layer(size):
    layer = Image.new("RGBA", (size[0] * SS, size[1] * SS), (0, 0, 0, 0))
    return layer, ImageDraw.Draw(layer)


def dashed(d, x0, y0, x1, y1, color, dash=14):
    x0, y0, x1, y1 = (v * SS for v in (x0, y0, x1, y1))
    for (ax, ay, bx, by) in ((x0, y0, x1, y0), (x0, y1, x1, y1), (x0, y0, x0, y1), (x1, y0, x1, y1)):
        length = max(abs(bx - ax), abs(by - ay))
        steps = int(length // (dash * SS * 2)) + 1
        for i in range(steps):
            t0, t1 = i * 2 * dash * SS / length, min(1, (i * 2 + 1) * dash * SS / length)
            if t0 > 1:
                break
            d.line([ax + (bx - ax) * t0, ay + (by - ay) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1],
                   fill=color, width=2 * SS)


def label(cv, x, y, s, color):
    cv.text(x, y, s, "label", 20, color)


def guides(cv, kind):
    blue, red = rgb(T["guide"]["color"]), rgb(T["guide"]["danger"])
    layer, d = guide_layer((cv.w, cv.h))
    if kind == "post":
        gw = T["format"]["post"]["gridCrop"][0]
        side = (cv.w - gw) / 2
        for x0, x1 in ((0, side), (cv.w - side, cv.w)):
            d.rectangle([x0 * SS, 0, x1 * SS, cv.h * SS], fill=red + (60,))
        box = (INSET + PADDING, INSET + PADDING, cv.w - INSET - PADDING, cv.h - INSET - PADDING)
    elif kind == "story":
        f = T["format"]["story"]
        d.rectangle([0, 0, cv.w * SS, f["safeTop"] * SS], fill=red + (50,))
        d.rectangle([0, (cv.h - f["safeBottom"]) * SS, cv.w * SS, cv.h * SS], fill=red + (50,))
        box = (48 + PADDING, f["safeTop"], cv.w - 48 - PADDING, cv.h - f["safeBottom"])
    else:
        f = T["format"]["reel"]
        top = (cv.h - f["gridCrop"][1]) / 2
        d.rectangle([0, 0, cv.w * SS, top * SS], fill=red + (50,))
        d.rectangle([0, (cv.h - top) * SS, cv.w * SS, cv.h * SS], fill=red + (50,))
        box = (INSET + PADDING, top + 48 + PADDING, cv.w - INSET - PADDING, top + f["gridCrop"][1] - 48 - PADDING)
    dashed(d, *box, blue + (255,))
    cv.im.alpha_composite(layer)
    if kind == "post":
        label(cv, 4, 30, "griglia", red)
    elif kind == "story":
        label(cv, 64, T["format"]["story"]["safeTop"] - 24, "zona ui instagram", red)
    else:
        label(cv, 64, (cv.h - T["format"]["reel"]["gridCrop"][1]) / 2 - 24, "fuori dalla griglia 3:4", red)
    label(cv, box[0] + 8, box[1] + 120, "area contenuto", blue)
    return cv


def overview(paths, out):
    """Contact sheet: every template scaled to the same height."""
    H, G = 420, 24
    thumbs = []
    for p in paths:
        im = Image.open(p)
        thumbs.append(im.resize((round(im.width * H / im.height), H), Image.LANCZOS))
    rows, row, width = [], [], 0
    for t in thumbs:
        if row and width + t.width > 2400:
            rows.append(row)
            row, width = [], 0
        row.append(t)
        width += t.width + G
    rows.append(row)
    W = max(sum(t.width for t in r) + G * (len(r) + 1) for r in rows)
    sheet = Image.new("RGB", (W, len(rows) * (H + G) + G), (128, 128, 124))
    y = G
    for r in rows:
        x = G
        for t in r:
            sheet.paste(t, (x, y))
            x += t.width + G
        y += H + G
    sheet.save(out)


def main():
    written = []

    def save(cv, *parts):
        path = os.path.join(OUT, *parts)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        cv.save(path)
        written.append(path)

    for name in ("light", "dark"):
        th = theme(name)
        save(post(th), name, "post.png")
        save(carousel(th, "cover"), name, "carousel-1-cover.png")
        save(carousel(th, "slide"), name, "carousel-2-slide.png")
        save(carousel(th, "end"), name, "carousel-3-end.png")
        save(story(th), name, "story.png")
        save(reel_cover(th), name, "reel-cover.png")
        save(highlight(th), name, "highlight-bitcode.png")
        for sat in SAT_IDS:
            save(highlight(th, sat), name, f"highlight-{sat}.png")
    save(profile(), "shared", "profile.png")
    light = theme("light")
    save(guides(post(light), "post"), "guides", "post.png")
    save(guides(story(light), "story"), "guides", "story.png")
    save(guides(reel_cover(light), "reel"), "guides", "reel-cover.png")
    overview(written, os.path.join(OUT, "overview.png"))
    print("\n".join(os.path.relpath(p, OUT) for p in written))


if __name__ == "__main__":
    main()
