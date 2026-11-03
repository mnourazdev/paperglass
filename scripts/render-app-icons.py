"""Render Paperglass app-icon.png variants from the supplied-look icon artwork.

Requires Pillow when regenerating the checked-in PNG assets.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SCALE = 3
SIZE = 512 * SCALE


def mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def gradient(size, start, end, diagonal=True):
    w, h = size
    image = Image.new("RGB", size)
    pixels = image.load()
    for y in range(h):
        for x in range(w):
            t = (x / max(1, w - 1) + y / max(1, h - 1)) / 2 if diagonal else x / max(1, w - 1)
            pixels[x, y] = mix(start, end, t)
    return image


def make_icon():
    s = SCALE
    icon = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 0))
    bg = gradient((SIZE, SIZE), (0, 109, 244), (0, 207, 156))
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle((8*s, 8*s, 504*s, 504*s), radius=94*s, fill=255)
    icon.paste(bg, (0, 0), mask)
    draw = ImageDraw.Draw(icon)

    # Four white scanning brackets.
    brackets = [
        [(103, 146), (103, 114), (111, 94), (127, 90), (182, 90)],
        [(330, 90), (385, 90), (402, 98), (409, 114), (409, 146)],
        [(103, 366), (103, 398), (111, 414), (127, 422), (182, 422)],
        [(330, 422), (385, 422), (401, 414), (409, 398), (409, 366)],
    ]
    for points in brackets:
        draw.line([(x*s, y*s) for x, y in points], fill=(255, 255, 255, 255), width=20*s, joint="curve")
        for x, y in (points[0], points[-1]):
            r = 10*s
            draw.ellipse((x*s-r, y*s-r, x*s+r, y*s+r), fill=(255, 255, 255, 255))

    # Soft drop shadow behind the glass-paper sheet.
    shadow = Image.new("RGBA", icon.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((147*s, 137*s, 359*s, 382*s), radius=22*s,
                                              fill=(4, 48, 104, 65))
    shadow = shadow.filter(ImageFilter.GaussianBlur(12*s))
    icon.alpha_composite(shadow)

    paper = Image.new("RGBA", icon.size, (0, 0, 0, 0))
    pd = ImageDraw.Draw(paper)
    pd.rounded_rectangle((151*s, 127*s, 359*s, 381*s), radius=20*s,
                         fill=(222, 245, 255, 255), outline=(173, 228, 249, 255), width=4*s)
    # Folded page corner.
    pd.polygon([(295*s, 128*s), (357*s, 190*s), (308*s, 190*s), (295*s, 177*s)],
               fill=(0, 177, 227, 255))
    pd.polygon([(295*s, 128*s), (357*s, 190*s), (308*s, 190*s), (295*s, 177*s)],
               fill=(35, 160, 233, 230))
    icon.alpha_composite(paper)
    # A subtle glossy diagonal reflection across the sheet.
    ImageDraw.Draw(icon).polygon([(171*s, 147*s), (292*s, 129*s), (292*s, 373*s), (171*s, 373*s)],
                                 fill=(255, 255, 255, 42))

    # Scan light bloom and its crisp white-cyan center line.
    glow = Image.new("RGBA", icon.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).line((70*s, 278*s, 442*s, 278*s), fill=(0, 243, 255, 205), width=12*s)
    glow = glow.filter(ImageFilter.GaussianBlur(7*s))
    icon.alpha_composite(glow)
    draw = ImageDraw.Draw(icon)
    draw.line((70*s, 278*s, 442*s, 278*s), fill=(80, 255, 255, 255), width=3*s)
    draw.line((108*s, 278*s, 404*s, 278*s), fill=(255, 255, 255, 255), width=2*s)

    # Short, softly colored lines on the scanned sheet.
    for box, color in [
        ((194, 220, 266, 239), (65, 140, 195, 205)),
        ((194, 257, 312, 276), (65, 140, 195, 195)),
        ((194, 304, 312, 323), (0, 166, 195, 225)),
        ((194, 341, 274, 360), (0, 166, 195, 225)),
    ]:
        x1, y1, x2, y2 = box
        draw.rounded_rectangle((x1*s, y1*s, x2*s, y2*s), radius=10*s, fill=color)

    return icon.resize((512, 512), Image.Resampling.LANCZOS)


base = make_icon()
outputs = {
    "icon-512.png": 512,
    "icon-192.png": 192,
    "maskable-512.png": 512,
    "maskable-192.png": 192,
    "apple-touch-icon.png": 180,
}
for name, size in outputs.items():
    base.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / "icons" / name, optimize=True)
