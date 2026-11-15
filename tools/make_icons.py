#!/usr/bin/env python3
"""Make the Android launcher icons from one logo picture (a PNG/WebP with a transparent background).

    python3 tools/make_icons.py                 # uses tools/icon/logo.png
    python3 tools/make_icons.py path/to/logo.png

Writes (in app/res/):
  drawable-xxxhdpi/ic_launcher_background.png   432x432 sky gradient   (adaptive icon, Android 8+)
  drawable-xxxhdpi/ic_launcher_foreground.png   432x432 logo in the visible area
  drawable-xxxhdpi/ic_launcher_monochrome.png   432x432 logo silhouette (Android 13 themed icons)
  mipmap-*/ic_launcher.png, ic_launcher_round.png   48..192 px legacy icons (Android 7)
and build/icon-preview.png with the icon under the common launcher masks.
Needs Pillow (pip install pillow).
"""
import os, sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RES = os.path.join(ROOT, "app", "res")
SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
SKY = ((0x9F, 0xD6, 0xFF), (0xE6, 0xF4, 0xFF))   # top, bottom: the game's day sky
ADAPTIVE = 432          # 108 dp at xxxhdpi
VISIBLE = 288           # 72 dp: what launcher masks show
FIT = 0.84              # the logo's longest side, as a share of the visible area


def gradient(size):
    w, h = size
    top, bottom = SKY
    g = Image.new("RGBA", size)
    px = g.load()
    for y in range(h):
        k = y / max(1, h - 1)
        c = tuple(round(top[i] + (bottom[i] - top[i]) * k) for i in range(3)) + (255,)
        for x in range(w):
            px[x, y] = c
    # a soft light spot behind the character
    glow = Image.new("L", size, 0)
    ImageDraw.Draw(glow).ellipse((w * .18, h * .12, w * .82, h * .76), fill=110)
    glow = glow.filter(ImageFilter.GaussianBlur(w * .12))
    g.paste(Image.new("RGBA", size, (255, 255, 255, 255)), (0, 0), glow)
    return g


def trimmed(logo):
    bbox = logo.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    return logo.crop(bbox) if bbox else logo


def place(logo, canvas_size, box, shadow=True):
    """The logo scaled to fit a box (side px), centred on a transparent canvas (shadow under it)."""
    lw, lh = logo.size
    s = box / max(lw, lh)
    lg = logo.resize((max(1, round(lw * s)), max(1, round(lh * s))), Image.LANCZOS)
    out = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    x, y = (canvas_size - lg.width) // 2, (canvas_size - lg.height) // 2
    if shadow:
        sh = Image.new("RGBA", lg.size, (40, 20, 70, 0))
        sh.putalpha(lg.getchannel("A").point(lambda a: a * 0.28))
        sh = sh.filter(ImageFilter.GaussianBlur(max(1, canvas_size // 120)))
        out.alpha_composite(sh, (x, y + max(1, canvas_size // 90)))
    out.alpha_composite(lg, (x, y))
    return out


def mask(size, shape):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    if shape == "circle":
        d.ellipse((0, 0, size - 1, size - 1), fill=255)
    elif shape == "squircle":
        d.rounded_rectangle((0, 0, size - 1, size - 1), radius=size * .32, fill=255)
    else:
        d.rounded_rectangle((0, 0, size - 1, size - 1), radius=size * .18, fill=255)
    return m


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "tools", "icon", "logo.png")
    logo = trimmed(Image.open(src).convert("RGBA"))
    xxx = os.path.join(RES, "drawable-xxxhdpi")
    os.makedirs(xxx, exist_ok=True)

    # adaptive icon layers
    bg = gradient((ADAPTIVE, ADAPTIVE))
    bg.save(os.path.join(xxx, "ic_launcher_background.png"))
    fg = place(logo, ADAPTIVE, VISIBLE * FIT)
    fg.save(os.path.join(xxx, "ic_launcher_foreground.png"))
    mono = Image.new("RGBA", fg.size, (255, 255, 255, 0))
    mono.putalpha(place(logo, ADAPTIVE, VISIBLE * FIT * .9, shadow=False).getchannel("A"))
    mono.save(os.path.join(xxx, "ic_launcher_monochrome.png"))

    # legacy icons: the visible 72 dp part of the adaptive icon, square-ish and round
    full = bg.copy()
    full.alpha_composite(fg)
    cut = (ADAPTIVE - VISIBLE) // 2
    visible = full.crop((cut, cut, cut + VISIBLE, cut + VISIBLE))
    for dens, px in SIZES.items():
        d = os.path.join(RES, f"mipmap-{dens}")
        os.makedirs(d, exist_ok=True)
        icon = visible.resize((px, px), Image.LANCZOS)
        for name, shape in (("ic_launcher.png", "rounded"), ("ic_launcher_round.png", "circle")):
            out = Image.new("RGBA", (px, px), (0, 0, 0, 0))
            out.paste(icon, (0, 0), mask(px, shape))
            out.save(os.path.join(d, name))

    # preview: the three common launcher masks, plus the monochrome version
    os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
    sheet = Image.new("RGBA", (4 * 220 + 50, 260), (245, 245, 250, 255))
    for i, shape in enumerate(("circle", "squircle", "rounded")):
        tile = visible.resize((200, 200), Image.LANCZOS)
        sheet.paste(tile, (10 + i * 220, 30), mask(200, shape))
    m = mono.crop((cut, cut, cut + VISIBLE, cut + VISIBLE)).resize((200, 200), Image.LANCZOS)
    dark = Image.new("RGBA", (200, 200), (60, 70, 110, 255))
    dark.alpha_composite(m)
    sheet.paste(dark, (10 + 3 * 220, 30), mask(200, "circle"))
    sheet.save(os.path.join(ROOT, "build", "icon-preview.png"))
    print("icons written to app/res; preview: build/icon-preview.png")


if __name__ == "__main__":
    main()
