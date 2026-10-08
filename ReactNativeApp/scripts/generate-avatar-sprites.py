#!/usr/bin/env python3
"""
Generates the placeholder sprites in assets/avatar/, assets/track/ and
assets/village/.

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


# ---------------------------------------------------------------- village
# Background for the scrolling step road (step-tracker-stage6.txt, Part 1).
# Calmer than the characters: softer outlines (never black), lower
# contrast and saturation. Exported at 2x, 4x and 6x with nearest
# neighbor as name.png, name@2x.png, name@3x.png.
VILLAGE_OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'village')
TILE = (256, 80)
GROUND = 55  # last row of grass; buildings stand on it
ROAD_TOP = 56  # bottom 24 rows are road
SOFT = hexc('#6b5a50')  # outline for village art

V = {
    'grass': hexc('#9cc07a'), 'grass_dark': hexc('#86aa66'),
    'road': hexc('#c8ad84'), 'road_dark': hexc('#b59a72'), 'curb': hexc('#a98e66'),
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


def street_base():
    layer = Layer(TILE)
    w, h = TILE
    layer.dots(V['grass'], [(x, y) for x in range(w) for y in range(GROUND - 3, GROUND + 1)])
    layer.dots(V['grass_dark'], [(x, GROUND - 3) for x in range(w) if x % 5 in (0, 1)])
    layer.dots(V['curb'], [(x, ROAD_TOP) for x in range(w)])
    layer.dots(V['road'], [(x, y) for x in range(w) for y in range(ROAD_TOP + 1, h)])
    # Sparse pebbles: kept away from the edges so tiles join cleanly
    for i in range(70):
        x = 4 + (i * 37 + (i * i) % 23) % (w - 8)
        y = ROAD_TOP + 3 + (i * 13) % (h - ROAD_TOP - 5)
        layer.dots(V['road_dark'], [(x, y), (x + 1, y)])
    return layer


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


def save_scaled(layer, name):
    """2x, 4x and 6x exports so React Native picks the right one per screen."""
    for scale, suffix in ((2, ''), (4, '@2x'), (6, '@3x')):
        layer.save(name, folder=VILLAGE_OUT, scale=scale, suffix=suffix)


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

    os.makedirs(VILLAGE_OUT, exist_ok=True)
    save_scaled(village_tile_a(), 'village_tile_a')
    save_scaled(village_tile_b(), 'village_tile_b')
    save_scaled(landmark_gate(), 'landmark_gate')
    save_scaled(landmark_bakery(), 'landmark_bakery')
    save_scaled(landmark_townhall(), 'landmark_townhall')
    save_scaled(landmark_windmill(), 'landmark_windmill')

    print(f'Wrote {len(os.listdir(OUT))} sprites to {os.path.normpath(OUT)}')
    print(f'Wrote {len(os.listdir(TRACK_OUT))} sprites to {os.path.normpath(TRACK_OUT)}')
    print(f'Wrote {len(os.listdir(VILLAGE_OUT))} images to {os.path.normpath(VILLAGE_OUT)}')
