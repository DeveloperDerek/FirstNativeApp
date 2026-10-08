#!/usr/bin/env python3
"""
Generates the placeholder character sprites in assets/avatar/.

Original art drawn in code, following the spec in step-tracker-stage3.txt:
every layer is a 32 x 48 PNG with a transparent background, feet on row
46, a 1-pixel dark outline, no anti-aliasing (every pixel fully opaque or
fully transparent), light from the top-left with one shadow tone per
color. Body and hair are grayscale so the app can tint them.

Replace these files with hand-drawn art whenever you like; keep the same
file names and canvas size.

Usage: python3 scripts/generate-avatar-sprites.py
"""
import os
import struct
import zlib

W, H = 32, 48
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'avatar')

OUTLINE = (0x3A, 0x2A, 0x2A)
LAYERS = {}  # name -> pixels, for previews
# Tintable layers: white becomes the chosen color, gray its shadow,
# and the dark outline stays dark after tinting.
GRAY_BASE, GRAY_SHADOW, GRAY_OUTLINE = (255, 255, 255), (196, 196, 196), (58, 58, 58)


# ---------------------------------------------------------------- shapes
def rect(x0, y0, x1, y1):
    return {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}


def ellipse(cx, cy, rx, ry):
    """Pixels whose centers fall inside the ellipse (cx, cy in pixel-edge coordinates)."""
    return {
        (x, y)
        for x in range(W)
        for y in range(H)
        if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1
    }


def mirror(points):
    """Points plus their left-right mirror around the canvas center."""
    return set(points) | {(W - 1 - x, y) for x, y in points}


# ---------------------------------------------------------------- painting
def shade(mask, base, shadow, outline):
    """Outline the edge of a shape and shade its bottom/right inner band."""
    px = {}
    for x, y in mask:
        if not (0 <= x < W and 0 <= y < H):
            continue
        if any((x + dx, y + dy) not in mask for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            px[(x, y)] = outline
        elif (x + 2, y) not in mask or (x, y + 2) not in mask:
            px[(x, y)] = shadow  # light comes from the top-left
        else:
            px[(x, y)] = base
    return px


class Layer:
    def __init__(self):
        self.px = {}

    def part(self, mask, base, shadow, outline=OUTLINE):
        self.px.update(shade(mask, base, shadow, outline))
        return self

    def dots(self, color, points):
        for p in points:
            self.px[p] = color
        return self

    def save(self, name):
        LAYERS[name] = dict(self.px)
        rows = []
        for y in range(H):
            row = bytearray([0])  # filter type: none
            for x in range(W):
                c = self.px.get((x, y))
                row += bytes((*c, 255)) if c else bytes(4)
            rows.append(bytes(row))
        raw = b''.join(rows)

        def chunk(kind, data):
            body = kind + data
            return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))

        png = (
            b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b'')
        )
        with open(os.path.join(OUT, f'{name}.png'), 'wb') as f:
            f.write(png)


def hexc(s):
    return tuple(int(s[i : i + 2], 16) for i in (1, 3, 5))


def darker(c, f=0.72):
    return tuple(int(v * f) for v in c)


# ---------------------------------------------------------------- body
HEAD = ellipse(16, 14, 11.5, 11.5)  # rows 2-25: big chibi head
EARS = mirror(rect(3, 13, 4, 16))
NECK = rect(14, 24, 17, 27)
TORSO = rect(11, 26, 20, 37)
ARMS = mirror(rect(8, 27, 10, 37) | rect(10, 26, 11, 28))
LEGS = mirror(rect(11, 37, 15, 45))
FEET = mirror(rect(10, 44, 15, 46))


def body():
    gray = (GRAY_BASE, GRAY_SHADOW, GRAY_OUTLINE)
    layer = Layer()
    layer.part(NECK | TORSO | ARMS | LEGS | FEET, *gray)
    # Leg gap so the legs read as two
    for y in range(39, 47):
        layer.px.pop((15, y), None)
        layer.px.pop((16, y), None)
    for y in range(39, 47):
        layer.px[(14, y)] = GRAY_OUTLINE
        layer.px[(17, y)] = GRAY_OUTLINE
    layer.part(HEAD | EARS, *gray)  # head last so the chin outline shows
    layer.save('body_base')


# ---------------------------------------------------------------- faces
EYE_DARK = (0x2B, 0x1E, 0x24)
WHITE = (255, 255, 255)
BLUSH = (0xF2, 0x9C, 0x9C)
MOUTH = (0x8A, 0x3B, 0x3B)


def eye(x, y):
    """2x3 eye with a highlight pixel; (x, y) is its top-left."""
    pts = {(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1), (x, y + 2), (x + 1, y + 2)}
    return pts, (x, y)


def face(name, left='open', mouth='smile', brows=False, blush=True):
    layer = Layer()
    for side, ex in (('left', 10), ('right', 20)):
        state = left if side == 'left' else 'open'
        if state == 'open':
            pts, hl = eye(ex, 14)
            layer.dots(EYE_DARK, pts).dots(WHITE, [hl])
        else:  # closed: a little curve
            layer.dots(EYE_DARK, [(ex - 1, 15), (ex, 16), (ex + 1, 16), (ex + 2, 15)])
    if brows:
        layer.dots(OUTLINE, [(9, 11), (10, 11), (11, 12), (12, 12)])
        layer.dots(OUTLINE, [(19, 12), (20, 12), (21, 11), (22, 11)])
    if blush:
        layer.dots(BLUSH, [(8, 18), (9, 18), (22, 18), (23, 18)])
    if mouth == 'smile':
        layer.dots(MOUTH, [(13, 19), (14, 20), (15, 20), (16, 20), (17, 20), (18, 19)])
    elif mouth == 'flat':
        layer.dots(MOUTH, [(14, 20), (15, 20), (16, 20), (17, 20)])
    elif mouth == 'grit':
        layer.dots(MOUTH, [(13, 20), (14, 20), (15, 20), (16, 20), (17, 20), (18, 20)])
        layer.dots(WHITE, [(14, 19), (15, 19), (16, 19), (17, 19)])
        layer.dots(MOUTH, [(13, 19), (18, 19)])
    layer.save(name)


# ---------------------------------------------------------------- hair (grayscale)
GRAY = (GRAY_BASE, GRAY_SHADOW, GRAY_OUTLINE)
CAP = ellipse(16, 13, 12.5, 12) & rect(0, 0, W - 1, 9)  # top of the head, a little bigger


def hair_spiky():
    spikes = set()
    for i, cx in enumerate((7, 12, 16, 20, 25)):
        apex = 0 if i % 2 == 0 else 2  # alternate tall and short spikes
        for y in range(apex, 7):
            half = (y - apex) // 2
            spikes |= rect(cx - half, y, cx + half, y)
    fringe = {(x, 10) for x in range(6, 26) if x % 4 != 1} | {(x, 11) for x in range(7, 25) if x % 4 == 3}
    sides = mirror(rect(4, 8, 6, 14))
    Layer().part(CAP | spikes | fringe | sides, *GRAY).save('hair_spiky')


def hair_short():
    fringe = rect(6, 9, 25, 10) | {(x, 11) for x in range(6, 18)}
    sides = mirror(rect(3, 8, 6, 18))
    Layer().part(CAP | fringe | sides, *GRAY).save('hair_short')


def hair_buzz():
    buzz = ellipse(16, 13, 12, 11.5) & rect(0, 0, W - 1, 7)
    Layer().part(buzz | mirror(rect(4, 7, 5, 10)), *GRAY).save('hair_buzz')


def hair_long():
    fringe = rect(6, 9, 25, 10) | mirror({(x, 11) for x in range(6, 12)})
    sides = mirror(rect(2, 8, 6, 24))
    Layer().part(CAP | fringe | sides, *GRAY).save('hair_long')
    back = ellipse(16, 13, 13.5, 12.5) | rect(3, 13, 28, 33) | ellipse(16, 33, 12.5, 3)
    Layer().part(back, *GRAY).save('hair_long_back')


def hair_ponytail():
    fringe = rect(7, 9, 24, 10) | {(x, 11) for x in range(14, 25)}
    sides = mirror(rect(4, 8, 6, 15))
    Layer().part(CAP | fringe | sides, *GRAY).save('hair_ponytail')
    tail = ellipse(16, 12, 13, 11.5) | ellipse(26, 16, 4, 5) | ellipse(27.5, 25, 3.5, 8)
    Layer().part(tail, *GRAY).save('hair_ponytail_back')


# ---------------------------------------------------------------- clothes
TOP_BODY = rect(10, 26, 21, 37)
TOP_ARMS = mirror(rect(7, 27, 10, 35) | rect(9, 26, 11, 27))


def top(name, color, detail=None):
    c = hexc(color)
    layer = Layer().part(TOP_BODY | TOP_ARMS, c, darker(c))
    if detail:
        detail(layer, c)
    layer.save(name)


def hoodie(layer, c):
    hood = mirror(rect(10, 25, 12, 27))
    layer.part(hood | rect(12, 26, 19, 26), c, darker(c))
    layer.dots(WHITE, [(14, 28), (14, 29), (14, 30), (17, 28), (17, 29), (17, 30)])
    layer.part(rect(12, 32, 19, 36), darker(c, 0.88), darker(c))  # front pocket


def tee(layer, c):
    stripe = hexc('#5b8def')
    layer.dots(stripe, [(x, y) for x in range(11, 21) for y in (30, 31)])
    layer.dots(darker(c), [(x, 26) for x in range(13, 19)])  # collar


def jacket(layer, c):
    layer.dots(OUTLINE, [(15, y) for y in range(27, 37)])  # zipper
    layer.dots(hexc('#e8e8e8'), [(15, 27), (16, 27)])
    layer.dots(darker(c), [(13, 27), (14, 28), (17, 28), (18, 27)])  # lapels


def sweater(layer, c):
    band = hexc('#ffffff')
    for y in (29, 33):
        layer.dots(band, [(x, y) for x in range(11, 21) if (x + y) % 2])
    layer.dots(darker(c), [(x, 36) for x in range(11, 21)])


def jersey(layer, c):
    num = hexc('#ffffff')
    seven = [(14, 29), (15, 29), (16, 29), (17, 29), (17, 30), (16, 31), (16, 32), (15, 33), (15, 34)]
    layer.dots(num, seven)
    layer.dots(darker(c), [(8, 33), (9, 33), (22, 33), (23, 33)])  # sleeve bands


def bottom(name, color, rows_end, skirt=False):
    c = hexc(color)
    if skirt:
        mask = rect(10, 36, 21, 37) | rect(9, 38, 22, 40) | rect(8, 41, 23, 42)
    else:
        mask = rect(10, 36, 21, 38) | mirror(rect(10, 38, 15, rows_end))
    layer = Layer().part(mask, c, darker(c))
    if not skirt:
        for y in range(39, rows_end + 1):  # gap between the legs
            layer.px.pop((15, y), None)
            layer.px.pop((16, y), None)
            layer.px[(14, y)] = OUTLINE
            layer.px[(17, y)] = OUTLINE
    layer.save(name)


def shoes(name, color, boots=False, sole='#e8e8e8'):
    c = hexc(color)
    top_row = 42 if boots else 44
    left = rect(9, top_row, 14, 46)  # two separate shoes, outlined on their own
    layer = Layer().part(left, c, darker(c)).part(mirror(left) - left, c, darker(c))
    layer.dots(hexc(sole), [(x, 45) for x in list(range(10, 14)) + list(range(18, 22))])
    layer.save(name)


# ---------------------------------------------------------------- hats
def hat_beanie(name, color):
    c = hexc(color)
    dome = ellipse(16, 11, 13, 10.5) & rect(0, 0, W - 1, 9)
    cuff = rect(3, 8, 28, 11)
    pom = ellipse(16, 1.5, 2.5, 2)
    layer = Layer().part(dome | pom, c, darker(c)).part(cuff, darker(c, 0.85), darker(c))
    layer.dots(darker(c), [(x, 5) for x in range(8, 24, 3)])
    layer.save(name)


def hat_cap(name, color):
    c = hexc(color)
    crown = ellipse(16, 11, 13, 10) & rect(0, 0, W - 1, 9)
    brim = rect(4, 9, 27, 10)
    layer = Layer().part(crown, c, darker(c)).part(brim, darker(c, 0.8), darker(c, 0.6))
    layer.part(rect(14, 3, 17, 6), (255, 255, 255), (220, 220, 220))  # front badge
    layer.save(name)


def hat_crown(name, color):
    c = hexc(color)
    band = rect(6, 5, 25, 9)
    points = set()
    for x0 in (6, 13, 20):
        points |= rect(x0 + 1, 3, x0 + 4, 4) | rect(x0 + 2, 1, x0 + 3, 2)
    layer = Layer().part(band | points, c, darker(c))
    layer.dots(hexc('#d9534f'), [(9, 7), (10, 7)]).dots(hexc('#5b8def'), [(15, 7), (16, 7)])
    layer.dots(hexc('#4caf50'), [(21, 7), (22, 7)])
    layer.save(name)


# ---------------------------------------------------------------- build
if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    body()

    face('face_smile')
    face('face_neutral', mouth='flat', blush=False)
    face('face_wink', left='closed')
    face('face_determined', mouth='grit', brows=True, blush=False)

    hair_spiky()
    hair_short()
    hair_buzz()
    hair_long()
    hair_ponytail()

    top('top_hoodie_red', '#d9534f', hoodie)
    top('top_tee_white', '#f2f2f2', tee)
    top('top_jacket_green', '#4c9a5b', jacket)
    top('top_sweater_yellow', '#e8b83c', sweater)
    top('top_jersey_blue', '#3f6fd8', jersey)

    bottom('bottom_shorts_blue', '#3f6fd8', 40)
    bottom('bottom_jeans_blue', '#35548f', 44)
    bottom('bottom_pants_black', '#3b3b45', 44)
    bottom('bottom_skirt_pink', '#e87fa6', 0, skirt=True)

    shoes('shoes_white', '#f2f2f2', sole='#b8b8b8')
    shoes('shoes_red', '#d9534f')
    shoes('shoes_boots_brown', '#7a4a2a', boots=True, sole='#3b2a20')

    hat_beanie('hat_beanie_teal', '#2a9d8f')
    hat_cap('hat_cap_red', '#d9534f')
    hat_crown('hat_crown_gold', '#f2c94c')

    print(f'Wrote {len(os.listdir(OUT))} sprites to {os.path.normpath(OUT)}')
