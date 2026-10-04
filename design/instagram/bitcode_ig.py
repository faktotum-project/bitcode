"""Drawing primitives for the Bitcode Instagram design system.

Every value comes from tokens.json; fonts live in ./fonts and the Sats renders
in assets/sats. Canvases are drawn at SS x supersampling and downscaled on save.
"""
import json
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
T = json.load(open(os.path.join(HERE, "tokens.json")))
SS = 2

B_BODY = [(0, 0, 1, 4), (1, 0, 2, 1), (2, 1, 1, 1), (1, 2, 1, 1), (3, 2, 1, 2)]
B_BASE = (0, 4, 2, 1)
SAT_IDS = ["node", "script", "hash", "merkle"]


def rgb(hex_):
    return tuple(int(hex_[i:i + 2], 16) for i in (1, 3, 5))


def theme(name):
    t = T["theme"][name]
    return {k: (rgb(v) if isinstance(v, str) else v) for k, v in t.items()}


ACCENT = rgb(T["accent"])
_fonts = {}


def font(role, px):
    key = (role, px)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(os.path.join(HERE, "fonts", T["font"][role]["file"]), round(px * SS))
    return _fonts[key]


class Canvas:
    """A supersampled RGBA canvas addressed in final-size pixels."""

    def __init__(self, w, h, fill):
        self.w, self.h = w, h
        self.im = Image.new("RGBA", (w * SS, h * SS), fill + (255,))
        self.d = ImageDraw.Draw(self.im)

    def box(self, x0, y0, x1, y1):
        return [round(x0 * SS), round(y0 * SS), round(x1 * SS) - 1, round(y1 * SS) - 1]

    def rect(self, x0, y0, x1, y1, fill):
        self.d.rectangle(self.box(x0, y0, x1, y1), fill=fill)

    def card(self, x0, y0, x1, y1, th, radius=None, shadow=True):
        """White (or dark) card with a hairline and a soft shadow."""
        r = (T["radius"]["card"] if radius is None else radius) * SS
        b = self.box(x0, y0, x1, y1)
        if shadow:
            mask = Image.new("L", self.im.size, 0)
            ImageDraw.Draw(mask).rounded_rectangle(b, radius=r, fill=255)
            self.im.alpha_composite(soft_shadow(mask, T["shadow"]["card"], th["shadow"], th["shadowOpacity"]))
        self.d.rounded_rectangle(b, radius=r, fill=th["card"] + (255,),
                                 outline=th["hairline"] + (255,), width=T["stroke"]["hairline"] * SS)

    def text(self, x, y, s, role, px, fill, anchor="ls"):
        """Text with the role's tracking; (x, y) is the baseline start by default."""
        spec = T["font"][role]
        if spec.get("uppercase"):
            s = s.upper()
        f = font(role, px)
        track = spec.get("trackingEm", 0) * px * SS
        width = sum(f.getlength(c) for c in s) + track * (len(s) - 1)
        cx = x * SS
        if anchor[0] == "r":
            cx -= width
        elif anchor[0] == "m":
            cx -= width / 2
        for c in s:
            self.d.text((cx, y * SS), c, font=f, fill=fill, anchor="l" + anchor[1])
            cx += f.getlength(c) + track
        return width / SS

    def paste(self, layer, x, y):
        self.im.alpha_composite(layer, (round(x * SS), round(y * SS)))

    def save(self, path):
        self.im.resize((self.w, self.h), Image.LANCZOS).convert("RGB").save(path)


def soft_shadow(alpha, spec, color, opacity):
    a = alpha.point(lambda v: round(v * opacity))
    a = ImageChops.offset(a, 0, spec["offsetY"] * SS).filter(ImageFilter.GaussianBlur(spec["blur"] * SS / 2))
    layer = Image.new("RGBA", alpha.size, color + (0,))
    layer.putalpha(a)
    return layer


def mark(cell, th):
    """The 4x5 pixel b at `cell` final pixels per cell, as an RGBA layer."""
    c = cell * SS
    layer = Image.new("RGBA", (round(4 * c), round(5 * c)), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for x, y, w, h in B_BODY:
        d.rectangle([round(x * c), round(y * c), round((x + w) * c) - 1, round((y + h) * c) - 1], fill=ACCENT)
    x, y, w, h = B_BASE
    d.rectangle([round(x * c), round(y * c), round((x + w) * c) - 1, round((y + h) * c) - 1], fill=th["logoBase"])
    return layer


def lockup(cell, th, gap_per_cell=None):
    """Mark + wordmark, word centred on the mark, as a tight RGBA layer."""
    spec = T["lockup"]
    size = cell * spec["wordSizePerCell"]
    f = font("wordmark", size)
    track = T["font"]["wordmark"]["trackingEm"] * size * SS
    m = mark(cell, th)
    gap = cell * (gap_per_cell or spec["gapPerCell"]) * SS
    word_w = sum(f.getlength(c) for c in "bitcode") + 6 * track
    layer = Image.new("RGBA", (round(m.width + gap + word_w + 4 * SS), m.height), (0, 0, 0, 0))
    layer.alpha_composite(m)
    d = ImageDraw.Draw(layer)
    top, bottom = f.getbbox("b")[1], f.getbbox("b")[3]
    ty = m.height / 2 - (top + bottom) / 2
    tx = m.width + gap
    for c in "bitcode":
        d.text((tx, ty), c, font=f, fill=th["ink"])
        tx += f.getlength(c) + track
    return layer


def with_shadow(layer, th):
    """The layer over its own soft shadow, padded so the blur is not clipped."""
    spec = T["shadow"]["logo"]
    pad = (spec["blur"] + spec["offsetY"]) * SS
    out = Image.new("RGBA", (layer.width + 2 * pad, layer.height + 2 * pad), (0, 0, 0, 0))
    alpha = Image.new("L", out.size, 0)
    alpha.paste(layer.getchannel("A"), (pad, pad))
    out.alpha_composite(soft_shadow(alpha, spec, th["shadow"], min(1, th["shadowOpacity"] * spec["opacityScale"])))
    out.alpha_composite(layer, (pad, pad))
    return out, pad / SS


def sat_image(sat, pose="idle", px=256):
    src = os.path.join(REPO, "assets", "sats", sat, "masters", f"{pose}-1024.png")
    im = Image.open(src).convert("RGBA")
    return im.resize((round(px * SS), round(px * SS)), Image.LANCZOS)


def sat_dots(cv, x_right, y_mid, size=14, gap=8):
    """Four squares in the Sats colours, right-aligned: the family signature."""
    x = x_right - 4 * size - 3 * gap
    for sat in SAT_IDS:
        cv.rect(x, y_mid - size / 2, x + size, y_mid + size / 2, rgb(T["sats"][sat]["color"]))
        x += size + gap
