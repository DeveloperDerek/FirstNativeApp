#!/usr/bin/env python3
"""
Generates the placeholder sprites in assets/avatar/, assets/track/ and
assets/maps/ (one folder per map theme).

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
def shade(mask, base, shadow, outline, size=(W, H)):
    """Outline the edge of a shape and shade its bottom/right inner band."""
    px = {}
    for x, y in mask:
        if not (0 <= x < size[0] and 0 <= y < size[1]):
            continue
        if any((x + dx, y + dy) not in mask for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            px[(x, y)] = outline
        elif (x + 2, y) not in mask or (x, y + 2) not in mask:
            px[(x, y)] = shadow  # light comes from the top-left
        else:
            px[(x, y)] = base
    return px


class Layer:
    def __init__(self, size=(W, H)):
        self.px = {}
        self.size = size

    def part(self, mask, base, shadow, outline=OUTLINE):
        self.px.update(shade(mask, base, shadow, outline, self.size))
        return self

    def dots(self, color, points):
        for p in points:
            self.px[p] = color
        return self

    def save(self, name, size=None, folder=None, scale=1, suffix=''):
        LAYERS[name] = dict(self.px)
        w, h = size or self.size
        w, h = w * scale, h * scale
        rows = []
        for y in range(h):
            row = bytearray([0])  # filter type: none
            for x in range(w):
                c = self.px.get((x // scale, y // scale))  # nearest neighbor
                row += bytes((*c, 255)) if c else bytes(4)
            rows.append(bytes(row))
        raw = b''.join(rows)

        def chunk(kind, data):
            body = kind + data
            return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))

        png = (
            b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b'')
        )
        with open(os.path.join(folder or OUT, f'{name}{suffix}.png'), 'wb') as f:
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


# ---------------------------------------------------------------- step track
TRACK_OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'track')
FLAG_W, FLAG_H = 12, 24


def goal_flag():
    """12 x 24 goal flag: a pole with a red pennant. Base of the pole on the bottom row."""
    red = hexc('#e2483d')
    pole = rect(1, 1, 2, 23)
    cloth = {(x, y) for y in range(2, 11) for x in range(3, 11) if x - 3 <= 7 - abs(y - 6)}
    layer = Layer().part(cloth, red, darker(red))
    layer.part(pole, (0xC8, 0xB0, 0x90), (0x9A, 0x82, 0x66))
    layer.dots((0xF7, 0xC9, 0x48), [(1, 0), (2, 0)])  # gold tip
    layer.dots((255, 255, 255), [(5, 5), (6, 5), (5, 6)])  # shine
    layer.save('flag_goal', size=(FLAG_W, FLAG_H), folder=TRACK_OUT)


# ---------------------------------------------------------------- maps
# Backgrounds for the scrolling step road (step-tracker-stage6.txt and
# step-tracker-stage7.txt). One folder per theme in assets/maps/, each
# with tile_a, tile_b (256 x 80) and start, mid, goal, far landmarks
# (up to 64 x 72), exported at 2x, 4x and 6x with nearest neighbor as
# name.png, name@2x.png, name@3x.png.
#
# Rules that keep the map seamless with the app's sky and ground colors:
#   1. Fully transparent above the scenery (the app paints the sky).
#   2. The bottom rows are the theme's exact GROUND color, flat, with
#      no outline along the bottom edge. Texture stays above FLAT_FROM.
#   3. Left and right edges match so tiles repeat without a seam.
# Calmer than the characters: soft outlines (never black), lower
# contrast and saturation.
MAPS_OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'maps')
TILE = (256, 80)
GROUND = 55  # last row of the verge; scenery stands on it
ROAD_TOP = 56  # bottom 24 rows are road
FLAT_FROM = 72  # rows 72-79 are plain ground color
SOFT = hexc('#6b5a50')  # outline for the theme being drawn


def set_outline(color):
    global SOFT
    SOFT = hexc(color)

V = {
    'grass': hexc('#9cc07a'), 'grass_dark': hexc('#86aa66'),
    'road': hexc('#c9a26b'), 'road_dark': hexc('#b8915c'), 'curb': hexc('#a8844f'),
    'wall': hexc('#efe2c6'), 'wall_dark': hexc('#dccdae'),
    'warm': hexc('#f0d9b5'), 'warm_dark': hexc('#dcc39c'),
    'timber': hexc('#9a7b5c'),
    'red': hexc('#c97a6a'), 'blue': hexc('#7f9cc0'), 'green': hexc('#86a87a'),
    'brown': hexc('#a9805e'), 'slate': hexc('#8c94a0'),
    'window': hexc('#a9c7d8'), 'door': hexc('#8a6a4a'),
    'leaf': hexc('#7fae6a'), 'trunk': hexc('#8a6a4a'),
    'stone': hexc('#bdb6aa'), 'white': hexc('#f3ebe0'),
    'light': hexc('#f3d98a'), 'gold': hexc('#e2c070'),
}


def ell(cx, cy, rx, ry):
    """Ellipse for any canvas size (pixel centers inside)."""
    return {
        (x, y)
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2)
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2)
        if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1
    }


def tri(x0, x1, y_base, height):
    """Gable roof: a triangle from x0..x1 on row y_base rising `height` rows."""
    pts = set()
    half = (x1 - x0) / 2
    cx = (x0 + x1) / 2
    for r in range(height):
        w = half * (1 - r / height)
        pts |= {(x, y_base - r) for x in range(round(cx - w), round(cx + w) + 1)}
    return pts


def vpart(layer, mask, color, f=0.88):
    return layer.part(mask, color, darker(color, f), SOFT)


def house(layer, x0, w, wall_h, roof, warm=False, chimney=False, shop=None):
    top = GROUND - wall_h + 1
    wall = V['warm'] if warm else V['wall']
    if chimney:
        vpart(layer, rect(x0 + w - 7, top - 9, x0 + w - 5, top - 2), V['stone'])
    vpart(layer, tri(x0 - 2, x0 + w + 1, top - 1, max(6, w // 2 - 1)), roof)
    vpart(layer, rect(x0, top, x0 + w - 1, GROUND), wall)
    # Timber framing
    mid = top + wall_h // 2
    layer.dots(V['timber'], [(x, mid) for x in range(x0 + 1, x0 + w - 1)])
    for x in range(x0 + 5, x0 + w - 3, 7):
        layer.dots(V['timber'], [(x, y) for y in range(top + 1, mid)])
    # Door and windows
    door_x = x0 + w // 2 - 2
    vpart(layer, rect(door_x, GROUND - 7, door_x + 3, GROUND), V['door'])
    for wx in (x0 + 2, x0 + w - 6):
        if abs(wx - door_x) > 4:
            vpart(layer, rect(wx, mid + 2, wx + 3, mid + 5), V['window'])
            vpart(layer, rect(wx, top + 2, wx + 3, top + 5), V['window'])
    if shop:  # striped awning over the front
        for x in range(x0 - 1, x0 + w + 1):
            layer.dots(shop if (x // 2) % 2 else V['white'], [(x, mid + 1), (x, mid + 2)])
        layer.dots(SOFT, [(x, mid + 3) for x in range(x0 - 1, x0 + w + 1) if x % 2])


def tree(layer, cx, h=22, r=8):
    vpart(layer, rect(cx - 1, GROUND - h // 2, cx, GROUND), V['trunk'])
    vpart(layer, ell(cx + 0.5, GROUND - h + r - 1, r, r - 1), V['leaf'])
    vpart(layer, ell(cx - 2.5, GROUND - h + r + 2, r - 3, r - 4), V['leaf'], 0.92)


def lamp(layer, x):
    layer.dots(SOFT, [(x, y) for y in range(GROUND - 15, GROUND + 1)])
    vpart(layer, rect(x - 1, GROUND - 18, x + 1, GROUND - 15), V['light'], 0.95)


def fence(layer, x0, x1):
    for x in range(x0, x1 + 1, 4):
        vpart(layer, rect(x, GROUND - 6, x + 1, GROUND), V['white'], 0.9)
    for y in (GROUND - 4, GROUND - 2):
        layer.dots(V['white'], [(x, y) for x in range(x0, x1 + 2)])


def well(layer, cx):
    vpart(layer, rect(cx - 6, GROUND - 5, cx + 5, GROUND), V['stone'])
    layer.dots(SOFT, [(x, GROUND - 3) for x in range(cx - 5, cx + 5) if x % 3 == 0])
    for x in (cx - 5, cx + 4):
        layer.dots(V['timber'], [(x, y) for y in range(GROUND - 13, GROUND - 5)])
    vpart(layer, tri(cx - 8, cx + 7, GROUND - 13, 5), V['red'])


def stall(layer, x0, color):
    vpart(layer, rect(x0, GROUND - 6, x0 + 17, GROUND), V['brown'])
    for x in (x0 + 1, x0 + 16):
        layer.dots(V['timber'], [(x, y) for y in range(GROUND - 16, GROUND - 6)])
    for x in range(x0 - 1, x0 + 19):
        layer.dots(color if (x // 2) % 2 else V['white'], [(x, GROUND - 17), (x, GROUND - 16)])
    for i, c in enumerate((V['red'], V['gold'], V['green'], V['red'])):
        vpart(layer, ell(x0 + 4 + i * 3.5, GROUND - 7.5, 1.6, 1.6), c, 0.85)


def ground_base(verge, curb, ground, specks=(), verge_rows=4, verge_mark=None):
    """The strip every tile shares: a verge the scenery stands on, a curb
    line, then the road in the exact ground color. Specks are (color,
    count, seed) and stay between the curb and FLAT_FROM."""
    layer = Layer(TILE)
    w, h = TILE
    verge_top = GROUND - verge_rows + 1
    layer.dots(verge, [(x, y) for x in range(w) for y in range(verge_top, GROUND + 1)])
    if verge_mark:
        color, period = verge_mark
        layer.dots(color, [(x, verge_top) for x in range(w) if x % period in (0, 1)])
    layer.dots(curb, [(x, ROAD_TOP) for x in range(w)])
    layer.dots(ground, [(x, y) for x in range(w) for y in range(ROAD_TOP + 1, h)])
    # Kept away from the edges so tiles join cleanly
    for color, count, seed in specks:
        for i in range(count):
            x = 4 + (i * 37 + (i * i + seed) % 23 + seed * 11) % (w - 9)
            y = ROAD_TOP + 2 + (i * 13 + seed) % (FLAT_FROM - ROAD_TOP - 3)
            layer.dots(color, [(x, y), (x + 1, y)])
    return layer


def street_base():
    return ground_base(
        V['grass'], V['curb'], V['road'],
        specks=[(V['road_dark'], 70, 0)],
        verge_mark=(V['grass_dark'], 8),  # periods must divide 256 (seamless)
    )


def village_tile_a():
    layer = street_base()
    tree(layer, 10)
    house(layer, 22, 30, 24, V['red'], chimney=True)
    lamp(layer, 60)
    house(layer, 68, 34, 20, V['blue'], warm=True, shop=V['blue'])
    fence(layer, 108, 132)
    tree(layer, 146, h=26, r=9)
    house(layer, 162, 28, 26, V['green'])
    well(layer, 206)
    tree(layer, 232, h=20, r=7)
    lamp(layer, 248)
    return layer


def village_tile_b():
    layer = street_base()
    lamp(layer, 6)
    house(layer, 16, 32, 22, V['slate'], warm=True, chimney=True)
    stall(layer, 56, V['red'])
    tree(layer, 92, h=24, r=8)
    house(layer, 108, 26, 28, V['red'])
    fence(layer, 140, 156)
    house(layer, 166, 36, 20, V['brown'], shop=V['green'])
    tree(layer, 216, h=22, r=8)
    stall(layer, 228, V['blue'])
    return layer


# Landmarks: up to 64 x 72, bottom row sits on the road line.
LANDMARK = (64, 72)
LB = 71  # bottom row


def landmark_gate():
    layer = Layer(LANDMARK)
    for x0 in (10, 46):
        vpart(layer, rect(x0, 30, x0 + 7, LB), V['stone'])
        layer.dots(SOFT, [(x, y) for x in range(x0 + 1, x0 + 7) for y in range(34, LB, 6)])
        vpart(layer, rect(x0 + 2, 24, x0 + 5, 29), V['light'], 0.95)  # lantern
    vpart(layer, tri(6, 57, 17, 8), V['red'])
    vpart(layer, rect(8, 18, 55, 24), V['timber'], 0.85)
    vpart(layer, rect(22, 19, 41, 23), V['white'])  # sign board
    layer.dots(SOFT, [(x, 21) for x in range(25, 39) if x % 3 != 2])
    return layer


def landmark_bakery():
    layer = Layer(LANDMARK)
    vpart(layer, rect(42, 12, 46, 30), V['stone'])  # chimney
    layer.dots(V['white'], [(43, 8), (44, 7), (46, 4), (47, 3), (45, 1)])  # smoke
    vpart(layer, tri(2, 61, 30, 16), V['brown'])
    vpart(layer, rect(5, 31, 58, LB), V['warm'])
    for x in range(4, 60):  # awning
        layer.dots(V['red'] if (x // 3) % 2 else V['white'], [(x, 46), (x, 47), (x, 48)])
    vpart(layer, rect(9, 52, 26, 63), V['window'])
    layer.dots(V['gold'], [(x, 61) for x in range(11, 25)])  # loaves in the window
    vpart(layer, rect(36, 56, 45, LB), V['door'])
    vpart(layer, ell(31.5, 39, 6, 4.5), V['gold'], 0.85)  # bread sign
    layer.dots(V['brown'], [(29, 38), (31, 38), (33, 38)])
    return layer


def landmark_townhall():
    layer = Layer(LANDMARK)
    # Clock tower
    vpart(layer, tri(22, 41, 9, 9), V['blue'])
    vpart(layer, rect(24, 10, 39, 34), V['stone'])
    vpart(layer, ell(32, 19, 5, 5), V['white'], 0.95)
    layer.dots(SOFT, [(32, 16), (32, 17), (32, 18), (33, 19), (34, 19)])
    layer.dots(V['gold'], [(31, 0), (32, 0), (31, 1), (32, 1)])
    # Pediment and hall
    vpart(layer, tri(1, 62, 39, 9), V['blue'])
    vpart(layer, rect(3, 40, 60, LB - 3), V['wall'])
    for x in range(6, 58, 8):  # columns
        vpart(layer, rect(x, 42, x + 3, LB - 4), V['white'], 0.9)
    vpart(layer, rect(27, 54, 36, LB - 3), V['door'])
    vpart(layer, rect(1, LB - 2, 62, LB), V['stone'])  # steps
    layer.dots(SOFT, [(x, LB - 1) for x in range(2, 62) if x % 4 == 0])
    return layer


def landmark_windmill():
    layer = Layer(LANDMARK)
    body = set()
    for y in range(26, LB + 1):
        inset = (LB - y) // 6
        body |= {(x, y) for x in range(20 + inset, 44 - inset)}
    vpart(layer, body, V['wall'])
    vpart(layer, rect(28, 58, 35, LB), V['door'])
    vpart(layer, rect(29, 40, 34, 45), V['window'])
    vpart(layer, tri(21, 42, 27, 8), V['red'])
    hub = (32, 22)
    for dx, dy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        blade = set()
        for t in range(3, 21):
            bx, by = hub[0] + dx * t, hub[1] + dy * t
            blade |= {(bx, by), (bx + dx, by), (bx, by + dy)}
        vpart(layer, blade, V['timber'], 0.85)
    vpart(layer, ell(32.5, 22.5, 2.5, 2.5), V['brown'])
    return layer


def save_scaled(layer, theme, name):
    """2x, 4x and 6x exports so React Native picks the right one per screen."""
    folder = os.path.join(MAPS_OUT, theme)
    os.makedirs(folder, exist_ok=True)
    for scale, suffix in ((2, ''), (4, '@2x'), (6, '@3x')):
        layer.save(f'{theme}_{name}', folder=folder, scale=scale, suffix=suffix)
        os.replace(
            os.path.join(folder, f'{theme}_{name}{suffix}.png'),
            os.path.join(folder, f'{name}{suffix}.png'),
        )


# ---------------------------------------------------------------- forest
FO = {
    'sky': '#cfeedd', 'ground': hexc('#3f5a2a'),
    'moss': hexc('#577a34'), 'moss_dark': hexc('#4a6a2c'), 'curb': hexc('#33491f'),
    'speck': hexc('#4d6b35'), 'litter': hexc('#5b4a2a'),
    'pine': hexc('#4f8a55'), 'pine2': hexc('#3f7448'), 'trunk': hexc('#7a5a3c'),
    'fern': hexc('#6fa35a'), 'cap': hexc('#d2604f'), 'dot': hexc('#f3ebe0'),
    'bush': hexc('#5f9a52'), 'wood': hexc('#a9805e'), 'water': hexc('#6fb0d4'),
    'rock': hexc('#8a958c'),
}


def forest_base():
    return ground_base(
        FO['moss'], FO['curb'], FO['ground'],
        specks=[(FO['speck'], 60, 1), (FO['litter'], 25, 7)],
        verge_mark=(FO['moss_dark'], 4),
    )


def pine(layer, cx, h=40, w=9, color=None, snow=None):
    color = color or FO['pine']
    vpart(layer, rect(cx - 1, GROUND - 6, cx, GROUND), FO['trunk'])
    tier_h = max(8, int(h * 0.42))
    for k in range(3):
        wk = w - k * 2.5
        base = GROUND - 5 - k * (h // 4)
        mask = tri(round(cx - wk), round(cx + wk), base, tier_h)
        vpart(layer, mask, color)
        if snow:
            top = base - tier_h + 1
            layer.dots(snow, [(x, y) for x, y in mask if y <= top + 2 and (x, y + 1) in mask])


def fern(layer, cx):
    vpart(layer, ell(cx + 0.5, GROUND - 2, 4.5, 3.5), FO['fern'])
    layer.dots(darker(FO['fern'], 0.8), [(cx, GROUND - 4), (cx - 2, GROUND - 3), (cx + 2, GROUND - 3)])


def mushroom(layer, cx):
    vpart(layer, rect(cx - 1, GROUND - 3, cx, GROUND), FO['dot'], 0.9)
    vpart(layer, ell(cx, GROUND - 4.5, 3.5, 2.5), FO['cap'])
    layer.dots(FO['dot'], [(cx - 1, GROUND - 6), (cx + 1, GROUND - 5)])


def bush(layer, cx, r=5):
    vpart(layer, ell(cx + 0.5, GROUND - r + 1.5, r + 2, r), FO['bush'])


def log(layer, x0):
    vpart(layer, rect(x0, GROUND - 3, x0 + 12, GROUND), FO['wood'])
    vpart(layer, ell(x0 + 12.5, GROUND - 1.5, 2, 2.5), darker(FO['wood'], 0.85))


def forest_tile_a():
    layer = forest_base()
    set_outline('#2f3f25')
    pine(layer, 12, 40, 9)
    fern(layer, 28)
    pine(layer, 46, 50, 11, FO['pine2'])
    mushroom(layer, 64)
    bush(layer, 80)
    pine(layer, 102, 36, 8)
    log(layer, 116)
    fern(layer, 138)
    pine(layer, 158, 52, 12, FO['pine2'])
    mushroom(layer, 178)
    mushroom(layer, 183)
    bush(layer, 198)
    pine(layer, 224, 42, 10)
    fern(layer, 245)
    return layer


def forest_tile_b():
    layer = forest_base()
    set_outline('#2f3f25')
    pine(layer, 11, 38, 8, FO['pine2'])
    bush(layer, 30)
    pine(layer, 52, 46, 11)
    log(layer, 68)
    mushroom(layer, 92)
    pine(layer, 112, 40, 9, FO['pine2'])
    fern(layer, 130)
    bush(layer, 147)
    pine(layer, 170, 54, 12)
    fern(layer, 192)
    mushroom(layer, 201)
    pine(layer, 226, 44, 10, FO['pine2'])
    bush(layer, 246, 4)
    return layer


def forest_start():  # trailhead sign
    layer = Layer(LANDMARK)
    for x0 in (14, 47):
        vpart(layer, rect(x0, 40, x0 + 2, LB), FO['wood'], 0.8)
    vpart(layer, tri(8, 55, 29, 7), FO['pine'])
    vpart(layer, rect(10, 30, 53, 45), FO['wood'])
    layer.dots(SOFT, [(x, 34) for x in range(14, 40) if x % 4 != 3])
    layer.dots(SOFT, [(x, 38) for x in range(14, 34) if x % 4 != 3])
    arrow = {(x, 41) for x in range(36, 48)} | {(46, 40), (45, 39), (46, 42), (45, 43)}
    layer.dots(FO['dot'], arrow)
    return layer


def forest_mid():  # log bridge over a stream
    layer = Layer(LANDMARK)
    vpart(layer, rect(0, 63, 63, LB), FO['water'], 0.9)
    layer.dots(FO['dot'], [(x, 66) for x in range(3, 62, 7)] + [(x, 69) for x in range(6, 62, 9)])
    deck = set()
    for x in range(2, 62):
        y = 52 + round(((x - 32) / 30) ** 2 * 8)
        deck |= {(x, y), (x, y + 1), (x, y + 2), (x, y + 3)}
    vpart(layer, deck, FO['wood'])
    layer.dots(SOFT, [(x, y + 1) for x in range(4, 60, 5) for y in [52 + round(((x - 32) / 30) ** 2 * 8)]])
    for x in range(4, 62, 9):
        y = 52 + round(((x - 32) / 30) ** 2 * 8)
        layer.dots(FO['trunk'], [(x, yy) for yy in range(y - 8, y)])
        layer.dots(FO['trunk'], [(x, y - 8), (x + 1, y - 8)])
    rail = [(x, 44 + round(((x - 32) / 30) ** 2 * 8)) for x in range(4, 59)]
    layer.dots(FO['trunk'], rail)
    for x in (0, 1, 62, 63):
        layer.dots(FO['trunk'], [(x, y) for y in range(52, LB + 1)])
    return layer


def forest_goal():  # the great tree
    layer = Layer(LANDMARK)
    vpart(layer, rect(25, 34, 38, LB), FO['trunk'])
    vpart(layer, tri(18, 45, LB, 5), FO['trunk'])  # roots
    vpart(layer, rect(29, 57, 34, LB), darker(FO['trunk'], 0.7))  # door
    layer.dots(FO['cap'], [(33, 64)])
    canopy = ell(32, 20, 23, 17) | ell(14, 30, 12, 9) | ell(50, 30, 12, 9)
    vpart(layer, canopy, FO['pine2'])
    vpart(layer, ell(25, 13, 9, 6), FO['pine'], 0.95)
    layer.dots(FO['cap'], [(12, 28), (44, 22), (30, 30), (52, 31)])  # fruit
    return layer


def forest_far():  # waterfall
    layer = Layer(LANDMARK)
    vpart(layer, rect(4, 10, 59, LB), FO['rock'])
    vpart(layer, ell(32, 11, 28, 5), FO['moss'])
    vpart(layer, rect(24, 12, 39, 64), FO['water'], 0.9)
    layer.dots(FO['dot'], [(x, y) for x in (26, 30, 34, 37) for y in range(14, 62, 3) if (x + y) % 2])
    vpart(layer, ell(32, 67, 24, 5), FO['water'], 0.9)
    layer.dots(FO['dot'], [(x, 65) for x in range(18, 47, 3)])
    return layer


# ---------------------------------------------------------------- city
CI = {
    'sky': '#c9d6e8', 'ground': hexc('#4a4f5a'),
    'walk': hexc('#b8bcc4'), 'seam': hexc('#a2a7b0'), 'curb': hexc('#8a8f99'),
    'speck': hexc('#555a66'), 'lane': hexc('#d8d2b0'),
    'window': hexc('#d9e6f2'), 'door': hexc('#5a5048'), 'post': hexc('#5a5f6a'),
    'light': hexc('#f3d98a'), 'leaf': hexc('#7fae6a'), 'red': hexc('#d2604f'),
    'white': hexc('#f3ebe0'), 'green': hexc('#4c9a5b'), 'stone': hexc('#bfb4a2'),
}
CITY_GROUND = 49  # buildings stand behind a 6-row sidewalk


def city_base():
    layer = ground_base(
        CI['walk'], CI['curb'], CI['ground'],
        specks=[(CI['speck'], 50, 3)], verge_rows=6,
    )
    w, _ = TILE
    layer.dots(CI['seam'], [(x, y) for x in range(0, w, 8) for y in range(50, 56)])
    # Dashed center line; period 16 divides 256, so it runs across the seam
    layer.dots(CI['lane'], [(x, y) for x in range(w) for y in (66, 67) if (x // 8) % 2 == 0])
    return layer


def building(layer, x0, w, h, color, awning=None):
    top = CITY_GROUND - h + 1
    vpart(layer, rect(x0, top, x0 + w - 1, CITY_GROUND), color)
    vpart(layer, rect(x0 - 1, top - 2, x0 + w, top), darker(color, 0.85))  # roof ledge
    for y in range(top + 3, CITY_GROUND - 11, 6):
        for x in range(x0 + 3, x0 + w - 4, 6):
            vpart(layer, rect(x, y, x + 2, y + 3), CI['window'], 0.9)
    vpart(layer, rect(x0 + 2, CITY_GROUND - 7, x0 + w // 2 - 2, CITY_GROUND - 2), CI['window'], 0.9)
    vpart(layer, rect(x0 + w - 7, CITY_GROUND - 8, x0 + w - 3, CITY_GROUND), CI['door'])
    if awning:
        for x in range(x0, x0 + w):
            layer.dots(awning if (x // 2) % 2 else CI['white'], [(x, CITY_GROUND - 10), (x, CITY_GROUND - 9)])


def city_lamp(layer, x):
    layer.dots(CI['post'], [(x, y) for y in range(CITY_GROUND - 18, CITY_GROUND + 1)])
    layer.dots(CI['post'], [(x + 1, CITY_GROUND - 18), (x + 2, CITY_GROUND - 18)])
    vpart(layer, rect(x + 2, CITY_GROUND - 17, x + 4, CITY_GROUND - 15), CI['light'], 0.95)


def planter(layer, cx):
    vpart(layer, rect(cx - 4, CITY_GROUND - 3, cx + 3, CITY_GROUND), CI['stone'])
    vpart(layer, rect(cx - 1, CITY_GROUND - 10, cx, CITY_GROUND - 4), V['trunk'])
    vpart(layer, ell(cx, CITY_GROUND - 13, 6, 5), CI['leaf'])


def hydrant(layer, cx):
    vpart(layer, rect(cx - 1, CITY_GROUND - 5, cx + 1, CITY_GROUND), CI['red'])
    vpart(layer, ell(cx + 0.5, CITY_GROUND - 5, 2, 1.5), CI['red'])


def bench(layer, x0):
    vpart(layer, rect(x0, CITY_GROUND - 4, x0 + 11, CITY_GROUND - 3), V['brown'])
    vpart(layer, rect(x0, CITY_GROUND - 8, x0 + 11, CITY_GROUND - 7), V['brown'])
    layer.dots(CI['post'], [(x, y) for x in (x0 + 1, x0 + 10) for y in range(CITY_GROUND - 2, CITY_GROUND + 1)])


def city_tile_a():
    layer = city_base()
    set_outline('#353a44')
    building(layer, 4, 40, 40, hexc('#c98f7a'))
    city_lamp(layer, 49)
    building(layer, 58, 36, 30, hexc('#8fa3c0'), awning=CI['red'])
    planter(layer, 102)
    building(layer, 112, 44, 44, hexc('#d8c38f'))
    hydrant(layer, 162)
    building(layer, 170, 38, 34, hexc('#9cb08a'), awning=hexc('#f7c948'))
    city_lamp(layer, 211)
    building(layer, 220, 32, 26, hexc('#b39cc0'))
    return layer


def city_tile_b():
    layer = city_base()
    set_outline('#353a44')
    building(layer, 3, 34, 36, hexc('#9cb08a'))
    planter(layer, 45)
    building(layer, 56, 42, 46, hexc('#c98f7a'), awning=CI['green'])
    city_lamp(layer, 102)
    building(layer, 110, 36, 28, hexc('#b39cc0'))
    bench(layer, 150)
    building(layer, 168, 40, 40, hexc('#8fa3c0'))
    city_lamp(layer, 212)
    building(layer, 221, 31, 30, hexc('#d8c38f'), awning=CI['red'])
    return layer


def city_start():  # subway entrance
    layer = Layer(LANDMARK)
    vpart(layer, rect(14, 50, 49, LB), hexc('#2f3440'), 0.95)
    layer.dots(hexc('#5a5f6a'), [(x, y) for y in range(54, LB + 1, 4) for x in range(16, 48)])
    for x0 in (12, 48):
        vpart(layer, rect(x0, 46, x0 + 3, LB), CI['green'])
    vpart(layer, rect(12, 44, 51, 47), CI['green'])
    layer.dots(CI['post'], [(56, y) for y in range(24, LB + 1)])
    vpart(layer, ell(56.5, 20, 6, 6), CI['green'])
    vpart(layer, rect(55, 16, 57, 24), CI['white'], 0.95)
    return layer


def city_mid():  # coffee cart
    layer = Layer(LANDMARK)
    vpart(layer, rect(12, 46, 51, 63), hexc('#c98f7a'))
    vpart(layer, rect(12, 44, 51, 46), hexc('#a9805e'))
    vpart(layer, rect(20, 51, 29, 58), CI['white'])  # menu
    layer.dots(SOFT, [(x, y) for y in (53, 55) for x in range(22, 28)])
    vpart(layer, rect(36, 50, 40, 55), CI['white'])  # cup sign
    vpart(layer, ell(20, 66, 4.5, 4.5), CI['post'])
    vpart(layer, ell(44, 66, 4.5, 4.5), CI['post'])
    layer.dots(CI['post'], [(31, y) for y in range(22, 44)])
    dome = ell(31.5, 24, 20, 9) & rect(0, 0, 63, 24)
    vpart(layer, dome, CI['red'])
    layer.dots(CI['white'], [(x, y) for x, y in dome if (x // 4) % 2 and y > 16])
    return layer


def city_goal():  # clock tower
    layer = Layer(LANDMARK)
    vpart(layer, tri(19, 44, 14, 14), hexc('#5f6f8a'))
    vpart(layer, rect(22, 14, 41, LB), CI['stone'])
    vpart(layer, ell(32, 24, 7.5, 7.5), CI['white'], 0.95)
    layer.dots(SOFT, [(32, 19), (32, 20), (32, 21), (32, 22), (33, 24), (34, 24), (35, 24)])
    for y in range(36, 58, 8):
        vpart(layer, rect(29, y, 34, y + 4), CI['window'], 0.9)
    vpart(layer, rect(15, 59, 48, LB), darker(CI['stone'], 0.9))
    vpart(layer, rect(28, 62, 35, LB), CI['door'])
    layer.dots(hexc('#e2c070'), [(31, 0), (32, 0), (31, 1), (32, 1)])
    return layer


def city_far():  # stadium
    layer = Layer(LANDMARK)
    for x in (5, 58):
        layer.dots(CI['post'], [(x, y) for y in range(8, 36)])
        vpart(layer, rect(x - 3, 5, x + 3, 9), CI['light'], 0.95)
    vpart(layer, rect(2, 34, 61, LB), hexc('#d8d2c8'))
    vpart(layer, rect(1, 31, 62, 35), hexc('#8fa3c0'))
    for x in range(6, 58, 10):
        vpart(layer, ell(x + 3.5, 58, 3.5, 6) & rect(0, 50, 63, LB), hexc('#5a5f6a'), 0.95)
    for x in range(8, 58, 6):
        layer.dots(CI['red'] if (x // 6) % 2 else CI['green'], [(x, 29), (x + 1, 29), (x, 28)])
    return layer


# ---------------------------------------------------------------- beach
BE = {
    'sky': '#9fdcf5', 'ground': hexc('#f0d9a0'),
    'sea': hexc('#5fb8d6'), 'sea_deep': hexc('#4aa3c4'), 'foam': hexc('#f3fbff'),
    'wet': hexc('#e3c98a'), 'curb': hexc('#e6cc90'), 'speck': hexc('#e0c487'),
    'shell': hexc('#f8ecd8'), 'trunk': hexc('#a9805e'), 'frond': hexc('#5f9a52'),
    'white': hexc('#f3ebe0'), 'red': hexc('#d2604f'), 'blue': hexc('#5b8def'),
    'yellow': hexc('#f7c948'), 'green': hexc('#4c9a5b'), 'wood': hexc('#b8916a'),
}


def beach_base():
    layer = ground_base(
        BE['wet'], BE['curb'], BE['ground'],
        specks=[(BE['speck'], 55, 5), (BE['shell'], 18, 9)],
    )
    w, _ = TILE
    # The sea, behind everything; waves repeat every 8 px (divides 256)
    layer.dots(BE['sea'], [(x, y) for x in range(w) for y in range(41, 47)])
    layer.dots(BE['sea_deep'], [(x, y) for x in range(w) for y in range(47, 52)])
    layer.dots(BE['foam'], [(x, 41) for x in range(w) if x % 8 in (0, 1, 2)])
    layer.dots(BE['foam'], [(x, 45) for x in range(w) if (x + 4) % 8 in (0, 1)])
    layer.dots(BE['foam'], [(x, 51) for x in range(w) if x % 4 != 0])
    return layer


def palm(layer, cx, h=34, lean=5):
    trunk = set()
    for i in range(h):
        x = cx + round(lean * (i / h) ** 2)
        trunk |= {(x, GROUND - i), (x + 1, GROUND - i)}
    vpart(layer, trunk, BE['trunk'])
    layer.dots(darker(BE['trunk'], 0.8), [(x, y) for x, y in trunk if y % 4 == 0 and (x - 1, y) in trunk])
    tx, ty = cx + lean, GROUND - h
    for dx, dy, rx, ry in ((-6, 2, 7, 2), (7, 2, 7, 2), (-4, -1, 5, 2), (5, -1, 5, 2), (0, -2, 3, 2)):
        vpart(layer, ell(tx + dx + 0.5, ty + dy, rx, ry), BE['frond'])
    layer.dots(darker(BE['trunk'], 0.7), [(tx - 1, ty + 2), (tx + 2, ty + 2)])


def umbrella(layer, cx, color):
    layer.dots(BE['white'], [(cx, y) for y in range(GROUND - 14, GROUND + 1)])
    dome = ell(cx + 0.5, GROUND - 13, 9, 5) & rect(0, 0, 255, GROUND - 13)
    vpart(layer, dome, color)
    layer.dots(BE['white'], [(x, y) for x, y in dome if ((x - cx) // 3) % 2 and y > GROUND - 17])


def beach_ball(layer, cx):
    vpart(layer, ell(cx + 0.5, GROUND - 1.5, 2.5, 2.5), BE['white'])
    layer.dots(BE['red'], [(cx - 1, GROUND - 2), (cx - 1, GROUND - 1)])
    layer.dots(BE['blue'], [(cx + 1, GROUND - 2), (cx + 1, GROUND - 1)])


def sandcastle(layer, x0):
    vpart(layer, rect(x0, GROUND - 5, x0 + 13, GROUND), hexc('#e3c48a'))
    vpart(layer, rect(x0 + 4, GROUND - 9, x0 + 9, GROUND - 5), hexc('#e3c48a'))
    layer.dots(SOFT, [(x0 + 6, GROUND - 2), (x0 + 7, GROUND - 2), (x0 + 6, GROUND - 1), (x0 + 7, GROUND - 1)])
    layer.dots(BE['red'], [(x0 + 7, y) for y in range(GROUND - 13, GROUND - 9)] + [(x0 + 8, GROUND - 13)])


def dune_grass(layer, cx):
    blades = [(cx - 2, GROUND - 3), (cx - 1, GROUND - 5), (cx, GROUND - 6), (cx + 1, GROUND - 4), (cx + 2, GROUND - 3)]
    pts = set()
    for bx, by in blades:
        pts |= {(bx, y) for y in range(by, GROUND + 1)}
    layer.dots(darker(BE['frond'], 0.95), pts)


def beach_tile_a():
    layer = beach_base()
    set_outline('#7a6a4a')
    palm(layer, 14, 34, 5)
    umbrella(layer, 46, BE['red'])
    beach_ball(layer, 61)
    sandcastle(layer, 78)
    palm(layer, 116, 40, -6)
    umbrella(layer, 142, BE['blue'])
    dune_grass(layer, 167)
    palm(layer, 196, 30, 4)
    umbrella(layer, 231, BE['yellow'])
    return layer


def beach_tile_b():
    layer = beach_base()
    set_outline('#7a6a4a')
    umbrella(layer, 16, BE['green'])
    palm(layer, 54, 38, -5)
    beach_ball(layer, 77)
    dune_grass(layer, 97)
    umbrella(layer, 125, BE['red'])
    palm(layer, 160, 34, 6)
    sandcastle(layer, 188)
    umbrella(layer, 226, BE['blue'])
    dune_grass(layer, 248)
    return layer


def beach_start():  # boardwalk arch
    layer = Layer(LANDMARK)
    vpart(layer, rect(2, 66, 61, LB), BE['wood'])
    layer.dots(SOFT, [(x, y) for x in range(6, 60, 6) for y in range(67, LB + 1)])
    for x0 in (8, 50):
        vpart(layer, rect(x0, 26, x0 + 5, 66), BE['wood'])
    arch = (ell(32, 30, 26, 14) - ell(32, 30, 19, 8)) & rect(0, 0, 63, 30)
    vpart(layer, arch, BE['wood'], 0.85)
    vpart(layer, rect(20, 10, 43, 19), BE['white'])
    layer.dots(BE['blue'], [(x, 14) for x in range(23, 41) if x % 3 != 2])
    return layer


def beach_mid():  # surf shack
    layer = Layer(LANDMARK)
    vpart(layer, rect(12, 40, 51, LB), hexc('#d8b880'))
    layer.dots(darker(hexc('#d8b880'), 0.85), [(x, y) for y in range(44, LB, 4) for x in range(13, 51)])
    vpart(layer, tri(5, 58, 40, 14), hexc('#c9a26b'))
    layer.dots(darker(hexc('#c9a26b'), 0.8), [(x, y) for x in range(8, 56, 3) for y in range(32, 40) if (x + y) % 3 == 0])
    vpart(layer, rect(18, 48, 29, 56), hexc('#a9c7d8'))
    vpart(layer, rect(36, 52, 45, LB), V['door'])
    vpart(layer, ell(6, 52, 2.5, 13), BE['blue'])
    vpart(layer, ell(57, 54, 2.5, 12), BE['red'])
    layer.dots(BE['white'], [(6, y) for y in range(44, 61, 2)] + [(57, y) for y in range(47, 62, 2)])
    return layer


def beach_goal():  # lighthouse
    layer = Layer(LANDMARK)
    body = set()
    for y in range(18, LB + 1):
        inset = (LB - y) // 9
        body |= {(x, y) for x in range(22 + inset, 42 - inset)}
    vpart(layer, body, BE['white'])
    layer.dots(BE['red'], [(x, y) for x, y in body if ((y - 18) // 8) % 2 and (x - 1, y) in body and (x + 1, y) in body])
    vpart(layer, rect(21, 14, 42, 17), hexc('#5a5f6a'))
    vpart(layer, rect(25, 6, 38, 13), BE['yellow'], 0.95)
    layer.dots(BE['white'], [(28, 8), (29, 8), (28, 9)])
    vpart(layer, tri(23, 40, 5, 6), BE['red'])
    vpart(layer, rect(29, 60, 34, LB), V['door'])
    return layer


def beach_far():  # pier
    layer = Layer(LANDMARK)
    for x in range(3, 63, 10):
        vpart(layer, rect(x, 50, x + 2, LB), darker(BE['wood'], 0.8))
    vpart(layer, rect(0, 46, 63, 50), BE['wood'])
    layer.dots(SOFT, [(x, 48) for x in range(0, 64, 5)])
    for x in range(1, 63, 6):
        layer.dots(BE['wood'], [(x, y) for y in range(38, 46)])
    layer.dots(BE['wood'], [(x, 38) for x in range(0, 64)])
    layer.dots(SOFT, [(55, y) for y in range(24, 46)])
    vpart(layer, rect(53, 20, 57, 24), BE['yellow'], 0.95)
    return layer


# ---------------------------------------------------------------- mountain
MO = {
    'sky': '#dfe8f5', 'ground': hexc('#5a5d6b'),
    'scree': hexc('#7a7d8a'), 'scree_dark': hexc('#6c6f7c'), 'curb': hexc('#4a4c57'),
    'rock_a': hexc('#6a6d7b'), 'rock_b': hexc('#4e505c'),
    'far': hexc('#aab4c8'), 'near': hexc('#8f9bb3'), 'snow': hexc('#f3f6fa'),
    'boulder': hexc('#9a9ca6'), 'pine': hexc('#4f7f62'), 'wood': hexc('#9a7b5c'),
    'orange': hexc('#e8894f'), 'yellow': hexc('#e8c34f'), 'red': hexc('#d2604f'),
    'stone': hexc('#bdb6aa'), 'dome': hexc('#e8ecf2'),
}


def mountain_base(peaks):
    layer = ground_base(
        MO['scree'], MO['curb'], MO['ground'],
        specks=[(MO['rock_a'], 50, 2), (MO['rock_b'], 35, 8)],
        verge_mark=(MO['scree_dark'], 16),
    )
    w, _ = TILE
    # Distant peaks with snow caps, fully inside the tile, then a band of
    # foothills that runs edge to edge (so the seam matches).
    for cx, half, h in peaks:
        mask = tri(cx - half, cx + half, 50, h)
        layer.part(mask, MO['far'], darker(MO['far'], 0.93), darker(MO['far'], 0.8))
        top = 50 - h + 1
        layer.dots(MO['snow'], [(x, y) for x, y in mask if y < top + h // 3 and (x, y - 1) in mask or (x, y) == (cx, top)])
    layer.dots(MO['near'], [(x, y) for x in range(w) for y in range(47, 52)])
    layer.dots(darker(MO['near'], 0.9), [(x, 47) for x in range(w) if x % 16 in (0, 1, 2, 3)])
    return layer


def boulder(layer, cx, r=4):
    vpart(layer, ell(cx + 0.5, GROUND - r + 1.5, r + 1.5, r), MO['boulder'])
    layer.dots(MO['snow'], [(cx - 1, GROUND - 2 * r + 2), (cx, GROUND - 2 * r + 2)])


def mountain_tile_a():
    layer = mountain_base([(60, 26, 30), (150, 32, 36), (215, 20, 24)])
    set_outline('#3f4250')
    pine(layer, 20, 34, 8, MO['pine'], MO['snow'])
    boulder(layer, 42)
    pine(layer, 96, 40, 9, MO['pine'], MO['snow'])
    boulder(layer, 120, 5)
    pine(layer, 176, 36, 8, MO['pine'], MO['snow'])
    boulder(layer, 206, 3)
    pine(layer, 238, 30, 8, MO['pine'], MO['snow'])
    return layer


def mountain_tile_b():
    layer = mountain_base([(44, 22, 28), (124, 30, 34), (204, 26, 30)])
    set_outline('#3f4250')
    boulder(layer, 14, 4)
    pine(layer, 58, 38, 9, MO['pine'], MO['snow'])
    pine(layer, 74, 26, 6, MO['pine'], MO['snow'])
    boulder(layer, 102, 5)
    pine(layer, 142, 42, 10, MO['pine'], MO['snow'])
    boulder(layer, 170, 4)
    pine(layer, 224, 36, 9, MO['pine'], MO['snow'])
    boulder(layer, 247, 3)
    return layer


def mountain_start():  # base camp
    layer = Layer(LANDMARK)
    vpart(layer, tri(2, 33, LB, 22), MO['orange'])
    vpart(layer, tri(13, 22, LB, 9), darker(MO['orange'], 0.6))
    vpart(layer, tri(32, 59, LB, 17), MO['yellow'])
    layer.dots(SOFT, [(62, y) for y in range(28, LB + 1)])
    vpart(layer, rect(54, 29, 61, 35), MO['red'])
    return layer


def mountain_mid():  # rope bridge
    layer = Layer(LANDMARK)
    sag = lambda x: round(6 * (1 - ((x - 32) / 27) ** 2))
    for x0 in (2, 58):
        vpart(layer, rect(x0, 42, x0 + 3, LB), MO['wood'])
    planks = set()
    for x in range(6, 58):
        y = 58 + sag(x)
        planks |= {(x, y), (x, y + 1)}
    vpart(layer, planks, MO['wood'], 0.85)
    layer.dots(darker(MO['wood'], 0.6), [(x, 50 + sag(x)) for x in range(4, 60)])
    layer.dots(darker(MO['wood'], 0.6), [(x, y) for x in range(8, 57, 4) for y in range(51 + sag(x), 58 + sag(x))])
    return layer


def mountain_goal():  # summit flag
    layer = Layer(LANDMARK)
    peak = tri(2, 61, LB, 50)
    vpart(layer, peak, hexc('#8f94a3'))
    layer.dots(MO['snow'], [(x, y) for x, y in peak if y < 38 and (x - 1, y) in peak and (x + 1, y) in peak])
    layer.dots(SOFT, [(32, y) for y in range(6, 23)])
    vpart(layer, rect(33, 6, 45, 13), MO['red'])
    return layer


def mountain_far():  # observatory
    layer = Layer(LANDMARK)
    vpart(layer, rect(10, 42, 53, LB), MO['stone'])
    vpart(layer, ell(32, 42, 19, 15) & rect(0, 0, 63, 42), MO['dome'], 0.92)
    vpart(layer, rect(30, 28, 33, 42), hexc('#3f4250'), 0.95)
    layer.dots(hexc('#3f4250'), [(34, 26), (35, 25), (36, 24), (37, 23)])
    vpart(layer, rect(28, 58, 35, LB), V['door'])
    for x in (15, 44):
        vpart(layer, rect(x, 50, x + 4, 54), V['window'])
    return layer


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

    os.makedirs(TRACK_OUT, exist_ok=True)
    goal_flag()

    THEMES = {
        'village': (village_tile_a, village_tile_b, landmark_gate, landmark_bakery,
                    landmark_townhall, landmark_windmill),
        'forest': (forest_tile_a, forest_tile_b, forest_start, forest_mid, forest_goal, forest_far),
        'city': (city_tile_a, city_tile_b, city_start, city_mid, city_goal, city_far),
        'beach': (beach_tile_a, beach_tile_b, beach_start, beach_mid, beach_goal, beach_far),
        'mountain': (mountain_tile_a, mountain_tile_b, mountain_start, mountain_mid,
                     mountain_goal, mountain_far),
    }
    OUTLINES = {'village': '#6b5a50', 'forest': '#2f3f25', 'city': '#353a44',
                'beach': '#7a6a4a', 'mountain': '#3f4250'}
    for theme, makers in THEMES.items():
        for name, make in zip(('tile_a', 'tile_b', 'start', 'mid', 'goal', 'far'), makers):
            set_outline(OUTLINES[theme])
            save_scaled(make(), theme, name)

    print(f'Wrote {len(os.listdir(OUT))} sprites to {os.path.normpath(OUT)}')
    print(f'Wrote {len(os.listdir(TRACK_OUT))} sprites to {os.path.normpath(TRACK_OUT)}')
    for theme in THEMES:
        folder = os.path.join(MAPS_OUT, theme)
        print(f'Wrote {len(os.listdir(folder))} images to {os.path.normpath(folder)}')
