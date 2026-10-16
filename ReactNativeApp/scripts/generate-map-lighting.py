#!/usr/bin/env python3
"""
Time-of-day lighting for the map themes ("Pixel Art 2.5D").

Takes a theme's art from generate-avatar-sprites.py and writes a lit copy
of it for each part of the day (day, sunset, night) into
assets/maps/<theme>/<phase>/:

  tile_a, tile_b      the street, relit, with shadows cast on the road
  start ... far       the landmarks, relit
  *_shadow            each landmark's shadow on the road (drawn under it)
  sky                 the sky behind the scene: banded gradient, sun or
                      moon, stars, sunset rays (fixed to the screen)
  hills_far/near      seamless hill strips for the parallax layers

and the small sprites the app moves around (clouds, birds, a shooting
star) into assets/ambient/. src/track/lighting.generated.ts lists every
image, the colors the app paints around the road for each phase, and
where the chimneys and windows are, so smoke and window flicker line up
with the art.

Relighting, in order: outlines take a dark, cooler shade of what they
border (edges against the sky stay darkest so shapes read); edges facing
the light get a warm rim and edges facing away a cool shade; then a grade
per phase (light color, a tinted lift in the darks, a little saturation).

Usage: python3 scripts/generate-map-lighting.py
(Run generate-avatar-sprites.py first if the base art changed.)
"""
import importlib.util
import sys
import json
import math
import os
import struct
import zlib

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
HERE = os.path.dirname(__file__)
spec = importlib.util.spec_from_file_location('sprites', os.path.join(HERE, 'generate-avatar-sprites.py'))
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

MAPS_OUT = os.path.join(HERE, '..', 'assets', 'maps')
AMBIENT_OUT = os.path.join(HERE, '..', 'assets', 'ambient')
TS_OUT = os.path.join(HERE, '..', 'src', 'track', 'lighting.generated.ts')

TILE_W, TILE_H = gen.TILE
GROUND, ROAD_TOP, FLAT_FROM = gen.GROUND, gen.ROAD_TOP, gen.FLAT_FROM
LANDMARK_W, LANDMARK_H = gen.LANDMARK
SCENE_H = 96  # StepTrack's SCENE_H (192 points) in art pixels
SKY_H = SCENE_H - TILE_H + ROAD_TOP  # scene rows above the road: 72
SKY_W = 256  # 512 points, wider than any phone
HILLS_H = 40
SCALES = ((2, ''), (4, '@2x'), (6, '@3x'))  # 2 points per art pixel, like the maps


# ---------------------------------------------------------------- colors
def hexc(s):
    return tuple(int(s[i:i + 2], 16) for i in (1, 3, 5))


def to_hex(c):
    return '#' + ''.join(f'{max(0, min(255, round(v))):02x}' for v in c[:3])


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def mul(a, m):
    return tuple(x * y for x, y in zip(a, m))


def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def saturate(c, s):
    l = lum(c)
    return tuple(l + (v - l) * s for v in c)


def clamp(c):
    return tuple(max(0, min(255, round(v))) for v in c)


def rel_lum(c):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(v) for v in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((rel_lum(a), rel_lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


BAYER = ((0, 8, 2, 10), (12, 4, 14, 6), (3, 11, 1, 9), (15, 7, 13, 5))


def dither(x, y, t):
    """True on a share t of pixels, in an ordered (Bayer) pattern."""
    return (BAYER[y & 3][x & 3] + 0.5) / 16 < t


# ---------------------------------------------------------------- phases
# side: which way the light comes from (1 = from the left, so shadows
# fall to the right). shadow_len: how far a shadow reaches per pixel of
# height. sun: where the sun or moon sits in the sky image.
PHASES = {
    'day': dict(
        sky=['#9fd3ff', '#b2ddff', '#c4e6ff', '#d6eefc', '#e6f3f2'],
        light='#ffffff', lift_to='#3a4a7a', lift=0.15, sat=1.25,
        rim='#fff6d8', shade=(0.8, 0.84, 0.98), side=1,
        hills=('#8fb98a', '#a9c9b0'), haze='#e6f3f2', ridge=0.2,
        shadow=(0.78, 0.8, 0.92), shadow_len=0.25, front=(1, 1, 1),
        sun=(150, 12), sun_color='#fff8e0', glow=28, glow_strength=0.9,
    ),
    'sunset': dict(
        sky=['#f2a07a', '#f7b583', '#fbc98e', '#fdd9a0', '#ffe6b8'],
        light='#ffd8b0', lift_to='#6a3a6a', lift=0.3, sat=1.15,
        rim='#ffb060', shade=(0.7, 0.62, 0.85), side=1,
        hills=('#b07a78', '#d29a88'), haze='#ffe0b0', ridge=0.5,
        shadow=(0.62, 0.55, 0.78), shadow_len=0.9, front=(1.03, 1.02, 1.02),
        sun=(150, 42), sun_color='#fff0c0', glow=46, glow_strength=1.4, rays=True,
    ),
    'night': dict(
        sky=['#141a3a', '#1a2148', '#222a56', '#2c3462', '#3a406c'],
        light='#7f8fc8', lift_to='#141a3a', lift=0.35, sat=1.0,
        rim='#bcd0ff', shade=(0.75, 0.75, 0.9), side=-1,
        hills=('#2a3058', '#353c66'), haze='#3a406c', ridge=0.2,
        shadow=(0.7, 0.72, 0.85), shadow_len=0.2, front=(0.86, 0.84, 0.9),
        sun=(170, 16), moon=True, stars=70, windows='#ffd77a',
    ),
}
DARK_INK, LIGHT_INK = hexc('#2a1a1a'), hexc('#ffffff')


def phase(name):
    p = dict(PHASES[name])
    for k in ('light', 'lift_to', 'rim', 'haze', 'sun_color', 'windows'):
        if k in p:
            p[k] = hexc(p[k])
    p['sky'] = [hexc(c) for c in p['sky']]
    p['hills'] = tuple(hexc(c) for c in p['hills'])
    return p


def avatar_matrix(p, strength=0.8):
    """grade() as a 4 x 5 color matrix for the app (Skia ColorMatrix, the
    last column in 0..1), so characters on the road take the same light.
    The tinted lift in the darks is linear here (its average strength), and
    characters get 80% of the grade so they stay easy to tell apart."""
    w = (0.299, 0.587, 0.114)
    s, k = p['sat'], p['lift'] * 0.5
    light = [v / 255 for v in p['light']]
    lift = [v / 255 for v in p['lift_to']]
    sat = [[(1 - s) * w[j] + (s if i == j else 0) for j in range(3)] for i in range(3)]
    m = []
    for i in range(3):
        row = [(1 - strength) * (i == j) + strength * (1 - k) * sat[i][j] * light[j] for j in range(3)]
        offset = strength * k * sum(sat[i][j] * lift[j] for j in range(3))
        m += [round(v, 4) for v in row] + [0, round(offset, 4)]
    return m + [0, 0, 0, 1, 0]


def grade(c, p):
    l = lum(c) / 255
    g = mul(c, tuple(v / 255 for v in p['light']))
    g = lerp(g, p['lift_to'], (1 - l) * p['lift'])
    return clamp(saturate(g, p['sat']))


def road_row(c, y, p):
    """The road is lighter toward the back (hazier) and takes the phase's
    front tint toward the bottom (darker at night), reaching its final
    color by FLAT_FROM so the flat rows stay one exact color. Day and
    sunset fronts stay light enough for dark text on the ground."""
    g = grade(c, p)
    if y <= ROAD_TOP:
        return g
    back = lerp(g, p['haze'], 0.25)
    front = mul(g, p['front'])
    if y < 64:
        return clamp(lerp(g, back, 1 - (y - ROAD_TOP) / 8))
    return clamp(lerp(g, front, min(1, (y - 64) / (FLAT_FROM - 64))))


# ---------------------------------------------------------------- relighting
def color_outlines(px, outline, shade):
    near = lambda c: c is not None and sum(abs(a - b) for a, b in zip(c, outline)) < 30
    out = dict(px)
    for (x, y), c in px.items():
        if not near(c):
            continue
        fills, edge = [], False
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = px.get((x + dx, y + dy))
            if n is None:
                edge = True
            elif not near(n):
                fills.append(n)
        if not fills:
            continue
        avg = tuple(sum(f[i] for f in fills) / len(fills) for i in range(3))
        out[(x, y)] = clamp(mul(saturate(avg, 1.3), tuple(v * (0.42 if edge else 0.6) for v in shade)))
    return out


def rim_light(px, p, below=None):
    """Warm rim on edges facing the light, cool band on edges facing away.
    Rows from `below` down (the road) are left alone."""
    side, out = p['side'], dict(px)
    for (x, y), c in px.items():
        if below is not None and y >= below:
            continue
        lit = (x - side, y) not in px or (x, y - 1) not in px
        away = (x + side, y) not in px or (x + 2 * side, y) not in px
        if lit and lum(c) > 60:
            out[(x, y)] = clamp(lerp(c, p['rim'], 0.35))
        elif away:
            out[(x, y)] = clamp(lerp(c, mul(c, p['shade']), 0.7))
    return out


def light_windows(px, base_px, p, window, lamp):
    """At night windows and lamps glow, with a dithered halo on the wall."""
    lights = [q for q, c in base_px.items() if c in (window, lamp)]
    out = dict(px)
    for q in lights:
        out[q] = p['windows']
    halo = (1.0, 0.78, 0.42)
    for x, y in lights:
        for dy in range(-3, 4):
            for dx in range(-3, 4):
                q = (x + dx, y + dy)
                if q in out and q not in lights and q[1] < GROUND:
                    d = math.hypot(dx, dy) / 4
                    if d < 1 and dither(q[0], q[1], 0.18 * (1 - d)):
                        out[q] = clamp(lerp(out[q], mul(p['windows'], halo), 0.45))
    return out


def window_rects(base_px, window):
    """Each lit window as [x, y, w, h], for the app's flicker."""
    seen, rects = set(), []
    for q, c in sorted(base_px.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        if c != window or q in seen:
            continue
        stack, comp = [q], []
        seen.add(q)
        while stack:
            x, y = stack.pop()
            comp.append((x, y))
            for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if n not in seen and base_px.get(n) == window:
                    seen.add(n)
                    stack.append(n)
        xs, ys = [x for x, _ in comp], [y for _, y in comp]
        rects.append([min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1])
    return rects


def road_colors(tile_px):
    """The usual road color on each row (ignoring specks)."""
    rows = {}
    for y in range(ROAD_TOP, TILE_H):
        counts = {}
        for x in range(TILE_W):
            c = tile_px.get((x, y))
            counts[c] = counts.get(c, 0) + 1
        rows[y] = max(counts, key=counts.get)
    return rows


def cast(px, p, ox, base_y, height_from):
    """Shadow pixels on the road for a silhouette standing on base_y."""
    out = set()
    for (x, y) in px:
        if y >= height_from:
            continue
        h = height_from - y
        sy = base_y + round(h * 0.18)
        sx = ox + x + p['side'] * round(h * p['shadow_len'])
        if ROAD_TOP < sy < FLAT_FROM:
            out.add((sx, sy))
    return out


# ---------------------------------------------------------------- png
def write_png(path, w, h, get):
    """get(x, y) -> (r, g, b) or (r, g, b, a) or None. Saved at every scale."""
    for scale, suffix in SCALES:
        rows = []
        for y in range(h * scale):
            row = bytearray([0])
            for x in range(w * scale):
                c = get(x // scale, y // scale)
                if c is None:
                    row += bytes(4)
                else:
                    row += bytes((*clamp(c[:3]), c[3] if len(c) > 3 else 255))
            rows.append(bytes(row))

        def chunk(kind, data):
            body = kind + data
            return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))

        png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w * scale, h * scale, 8, 6, 0, 0, 0))
               + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b''))
        with open(f'{path}{suffix}.png', 'wb') as f:
            f.write(png)


# ---------------------------------------------------------------- sky and hills
def rng(seed):
    a = seed

    def next_():
        nonlocal a
        a = (a * 1103515245 + 12345) & 0x7FFFFFFF
        return a / 0x7FFFFFFF
    return next_


def sky_image(p):
    bands, px, stars = p['sky'], {}, []
    for y in range(SKY_H):
        f = y / SKY_H * (len(bands) - 1)
        i = int(f)
        frac = f - i
        a, b = bands[i], bands[min(i + 1, len(bands) - 1)]
        for x in range(SKY_W):
            px[(x, y)] = b if dither(x, y, (frac - 0.5) * 3 + 0.5) else a

    sx, sy = p['sun']

    def glow(r, color, strength):
        for y in range(sy - r, sy + r + 1):
            for x in range(sx - r, sx + r + 1):
                d = math.hypot(x - sx, y - sy) / r
                if d < 1 and (x, y) in px and dither(x, y, (1 - d) * strength):
                    px[(x, y)] = lerp(px[(x, y)], color, 0.25)

    if p.get('moon'):
        r = rng(7)
        for _ in range(p['stars']):
            x, y = int(r() * SKY_W), int(r() * (SKY_H - 24))
            px[(x, y)] = (255, 255, 255) if r() < 0.3 else hexc('#aeb8e8')
            stars.append([x, y])
        glow(22, hexc('#cfd8ff'), 0.8)
        for y in range(-6, 7):
            for x in range(-6, 7):
                if math.hypot(x, y) <= 6 and math.hypot(x - 3, y - 2) > 5:
                    px[(sx + x, sy + y)] = hexc('#f4f1dc')
    else:
        glow(p['glow'], p['sun_color'], p['glow_strength'])
        for y in range(-7, 8):
            for x in range(-7, 8):
                if math.hypot(x, y) <= 7 and (sx + x, sy + y) in px:
                    px[(sx + x, sy + y)] = p['sun_color']
    if p.get('rays'):
        for y in range(SKY_H):
            for x in range(sx, SKY_W):
                ang = math.atan2(y - sy, x - sx)
                fade = 1 - min(1, math.hypot(x - sx, y - sy) / 420)
                if math.sin(ang * 18) > 0.82 and dither(x, y, 0.35 * fade):
                    px[(x, y)] = lerp(px[(x, y)], hexc('#fff2c8'), 0.4)
    return px, stars


def hills_image(p, layer):
    """Seamless (every wave divides 256) hill strip; the far one is hazier
    and its foot fades into the horizon color."""
    color = lerp(p['hills'][layer], p['haze'], 0.55 if layer == 0 else 0.25)
    base = HILLS_H - (14 if layer == 0 else 2)
    amp = 9 if layer == 0 else 6
    phase_shift = 0.7 if layer == 0 else 2.1
    px = {}
    for x in range(TILE_W):
        t = 2 * math.pi * x / TILE_W
        top = base - round(amp * (0.5 * math.sin(t * 2 + phase_shift) + 0.3 * math.sin(t * 4 + 1)
                                  + 0.2 * math.sin(t * 8 + phase_shift)))
        for y in range(top, HILLS_H):
            hz = (y - top) / max(1, HILLS_H - top)
            px[(x, y)] = clamp(lerp(color, p['haze'], 0.35) if dither(x, y, hz * 0.6) else color)
        px[(x, top)] = clamp(lerp(color, p['rim'], p['ridge']))
    return px


def walker_shadow(p):
    """A character's shadow on the road: the plain body (and a head of
    hair) cast flat along the ground, see-through so it darkens whatever
    road color is under it. Row 0 is the feet; returns the pixels and
    where the image sits from the sprite's left edge."""
    feet = 46  # the character's feet row (generate-avatar-sprites.py)
    mask = gen.HEAD | gen.EARS | gen.NECK | gen.TORSO | gen.ARMS | gen.LEGS | gen.FEET
    mask |= gen.ellipse(16, 12, 12.5, 12.5)  # hair
    reach = math.ceil(feet * abs(p['shadow_len'])) + 1
    left = -reach if p['side'] < 0 else 0
    alpha = round(255 * (1 - sum(p['shadow']) / 3) * 1.3)
    px = {}
    for x, y in mask:
        if y > feet:
            continue
        h = feet - y
        sx = x + p['side'] * round(h * p['shadow_len']) - left
        px[(sx, round(h * 0.1))] = (25, 20, 55, alpha)
    height = round(feet * 0.1) + 1
    return px, {'left': left, 'width': gen.W + reach, 'height': height}


# ---------------------------------------------------------------- one theme
def capture(make):
    """Draws an image and records where its chimneys are."""
    chimneys = []
    original = gen.house

    def house(layer, x0, w, wall_h, roof, warm=False, chimney=False, shop=None):
        if chimney:
            chimneys.append([x0 + w - 6, GROUND - wall_h + 1 - 10])
        return original(layer, x0, w, wall_h, roof, warm=warm, chimney=chimney, shop=shop)

    gen.house = house
    try:
        layer = make()
    finally:
        gen.house = original
    return layer, chimneys


def build_theme(theme, makers, outline, palette, extra_chimneys, erase):
    """Writes every phase of one theme; returns its entry for the TS table."""
    window, lamp = palette['window'], palette['light']
    gen.set_outline(outline)
    outline = hexc(outline)
    tiles, landmarks = [], []
    for name, make in zip(('tile_a', 'tile_b'), makers[:2]):
        layer, chimneys = capture(make)
        tiles.append((name, layer.px, chimneys))
    for name, make in zip(('start', 'mid', 'goal', 'far'), makers[2:]):
        layer, chimneys = capture(make)
        px = {q: c for q, c in layer.px.items() if (name, q) not in erase}
        landmarks.append((name, px, chimneys + extra_chimneys.get(name, [])))

    entry = {'phases': {}}
    for ph in PHASES:
        p = phase(ph)
        folder = os.path.join(MAPS_OUT, theme, ph)
        os.makedirs(folder, exist_ok=True)

        # Tiles: relight the scenery, grade the road by row, then shadows.
        # Tiles alternate a, b, a, b, so each one's shadow spills into the
        # other's left (or right) edge.
        lit = []
        for name, base, _ in tiles:
            scenery = {q: c for q, c in base.items() if q[1] < ROAD_TOP}
            relit = rim_light(color_outlines(scenery, outline, p['shade']), p, below=GROUND - 3)
            px = {q: grade(c, p) for q, c in relit.items()}
            for q, c in base.items():
                if q[1] >= ROAD_TOP:
                    px[q] = road_row(c, q[1], p)
            if p.get('windows'):
                px = light_windows(px, base, p, window, lamp)
            lit.append(px)
        silhouettes = [{q for q in base if q[1] < GROUND - 3} for _, base, _ in tiles]
        for i, px in enumerate(lit):
            other = silhouettes[1 - i]
            shade_at = cast(silhouettes[i], p, 0, ROAD_TOP, GROUND - 3)
            shade_at |= {(x - TILE_W, y) for x, y in cast(other, p, 0, ROAD_TOP, GROUND - 3)}  # from the left
            shade_at |= {(x + TILE_W, y) for x, y in cast(other, p, 0, ROAD_TOP, GROUND - 3)}  # from the right
            for q in shade_at:
                if q in px and ROAD_TOP < q[1] < FLAT_FROM:
                    px[q] = clamp(mul(px[q], p['shadow']))
            write_png(os.path.join(folder, tiles[i][0]), TILE_W, TILE_H, lambda x, y, px=px: px.get((x, y)))

        # Landmarks, and their shadows as separate images drawn under them
        shadows = {}
        for name, base, _ in landmarks:
            relit = rim_light(color_outlines(base, outline, p['shade']), p)
            px = {q: grade(c, p) for q, c in relit.items()}
            if p.get('windows'):
                px = light_windows(px, base, p, window, lamp)
            write_png(os.path.join(folder, name), LANDMARK_W, LANDMARK_H, lambda x, y, px=px: px.get((x, y)))
            # Landmark row LANDMARK_H - 1 stands on the road line (tile row ROAD_TOP)
            spots = cast(set(base), p, 0, ROAD_TOP, LANDMARK_H)
            road = road_colors(tiles[0][1])
            reach = math.ceil(LANDMARK_H * p['shadow_len']) + 1
            left = -reach if p['side'] < 0 else 0
            w = LANDMARK_W + reach
            shade = {}
            for x, y in spots:
                # The road's own color at that row, in shadow (opaque, so
                # it matches the tile shadows exactly where they overlap)
                shade[(x - left, y - ROAD_TOP)] = clamp(mul(road_row(road[y], y, p), p['shadow']))
            write_png(os.path.join(folder, f'{name}_shadow'), w, TILE_H - ROAD_TOP,
                      lambda x, y, s=shade: s.get((x, y)))
            shadows[name] = {'left': left, 'width': w}

        shadow_px, walker_box = walker_shadow(p)
        write_png(os.path.join(folder, 'walker_shadow'), walker_box['width'], walker_box['height'],
                  lambda x, y: shadow_px.get((x, y)))

        sky, stars = sky_image(p)
        write_png(os.path.join(folder, 'sky'), SKY_W, SKY_H, lambda x, y: sky.get((x, y)))
        for layer, label in ((0, 'hills_far'), (1, 'hills_near')):
            hills = hills_image(p, layer)
            write_png(os.path.join(folder, label), TILE_W, HILLS_H, lambda x, y, h=hills: h.get((x, y)))

        ground = road_row(tiles[0][1][(5, TILE_H - 1)], TILE_H - 1, p)
        ink = DARK_INK if contrast(ground, DARK_INK) >= contrast(ground, LIGHT_INK) else LIGHT_INK
        sky_ink = DARK_INK if contrast(p['sky'][0], DARK_INK) >= contrast(p['sky'][0], LIGHT_INK) else LIGHT_INK
        entry['phases'][ph] = {
            'sky': to_hex(p['sky'][0]),
            'skyInk': to_hex(sky_ink),
            'statusBar': 'dark' if sky_ink == DARK_INK else 'light',
            'ground': to_hex(ground),
            'ink': to_hex(ink),
            'stars': stars,
            'shadows': shadows,
            'shadowColor': to_hex(mul(ground, p['shadow'])),
            'avatarMatrix': avatar_matrix(p),
            'walkerShadow': walker_box,
            'shadowLength': p['shadow_len'] * p['side'],
        }

    entry['chimneys'] = {name: ch for name, _, ch in tiles + landmarks}
    entry['windows'] = {name: window_rects(base, window) for name, base, _ in tiles + landmarks}
    return entry


# ---------------------------------------------------------------- ambient sprites
def ambient_sprites():
    os.makedirs(AMBIENT_OUT, exist_ok=True)
    sizes = {}

    def save(name, w, h, px):
        write_png(os.path.join(AMBIENT_OUT, name), w, h, lambda x, y: px.get((x, y)))
        sizes[name] = [w, h]

    def cloud(body, shadow):
        px = {}
        for cx, cy, r in ((4, 6, 4), (10, 4, 5), (17, 6, 4), (11, 7, 4)):
            for y in range(cy - r, cy + r + 1):
                for x in range(cx - r - 2, cx + r + 3):
                    if ((x - cx) / (r + 2)) ** 2 + ((y - cy) / r) ** 2 <= 1 and y <= 9 and x >= 0:
                        px[(x, y)] = body
        for (x, y) in list(px):
            if (x, y + 1) not in px:
                px[(x, y)] = shadow  # flat, shaded underside
        return px

    save('cloud_day', 24, 10, cloud(hexc('#ffffff'), hexc('#dcebf7')))
    save('cloud_sunset', 24, 10, cloud(hexc('#ffe2c4'), hexc('#e8a888')))

    # Bird, two wing frames (a "v" and a flat glide)
    ink = hexc('#3a2f45')
    save('bird_up', 7, 4, {q: ink for q in ((0, 0), (1, 1), (2, 2), (3, 2), (4, 2), (5, 1), (6, 0))})
    save('bird_down', 7, 4, {q: ink for q in ((0, 3), (1, 2), (2, 2), (3, 2), (4, 2), (5, 2), (6, 3))})

    # Shooting star going down-left: the bright head at the bottom left,
    # its tail fading up to the right
    star = {}
    for i in range(12):
        c = lerp((255, 255, 255), (160, 175, 230), i / 11)
        if i < 4 or dither(i, 0, 1 - i / 12):
            star[(i, 6 - i // 2)] = (*clamp(c), 255 if i < 6 else 170)
    star[(0, 5)] = (255, 255, 255, 200)
    save('shooting_star', 12, 7, star)

    # The goal flag's second frame: the same flag as
    # generate-avatar-sprites.py's goal_flag(), its cloth rippled a pixel
    red = hexc('#e2483d')
    cloth = {(x + (1 if 4 <= y <= 8 and x >= 6 else 0), y)
             for y in range(2, 11) for x in range(3, 11) if x - 3 <= 7 - abs(y - 6)}
    layer = gen.Layer((gen.FLAG_W, gen.FLAG_H)).part(cloth, red, gen.darker(red))
    layer.part(gen.rect(1, 1, 2, 23), (0xC8, 0xB0, 0x90), (0x9A, 0x82, 0x66))
    layer.dots((0xF7, 0xC9, 0x48), [(1, 0), (2, 0)])
    layer.dots((255, 255, 255), [(5, 6), (6, 6), (5, 7)])
    save('flag_wave', gen.FLAG_W, gen.FLAG_H, layer.px)
    return sizes


# ---------------------------------------------------------------- output
def ts_table(entries, sprites):
    lines = [
        '// Generated by scripts/generate-map-lighting.py. Do not edit.',
        '',
        "import type { LightingTable } from './lighting';",
        '',
        'export const LIGHTING: LightingTable = {',
    ]
    for theme, e in entries.items():
        lines.append(f'  {theme}: {{')
        lines.append('    phases: {')
        for ph, v in e['phases'].items():
            base = f'@/assets/maps/{theme}/{ph}'
            req = lambda n: f"require('{base}/{n}.png')"
            lines += [
                f'      {ph}: {{',
                f"        sky: '{v['sky']}', skyInk: '{v['skyInk']}', statusBar: '{v['statusBar']}',",
                f"        ground: '{v['ground']}', ink: '{v['ink']}', shadowColor: '{v['shadowColor']}',",
                f"        tiles: [{req('tile_a')}, {req('tile_b')}],",
                f"        landmarks: [{', '.join(req(n) for n in ('start', 'mid', 'goal', 'far'))}],",
                f"        landmarkShadows: [{', '.join(req(n + '_shadow') for n in ('start', 'mid', 'goal', 'far'))}],",
                f"        shadowBoxes: {json.dumps([v['shadows'][n] for n in ('start', 'mid', 'goal', 'far')])},",
                f"        skyImage: {req('sky')},",
                f"        hills: [{req('hills_far')}, {req('hills_near')}],",
                f"        stars: {json.dumps(v['stars'])},",
                f"        avatarMatrix: {json.dumps(v['avatarMatrix'])},",
                f"        shadowLength: {v['shadowLength']},",
                f"        walkerShadow: {{ source: {req('walker_shadow')}, "
                + ', '.join(f'{k}: {n}' for k, n in v['walkerShadow'].items()) + ' },',
                '      },',
            ]
        lines.append('    },')
        lines.append(f"    chimneys: {json.dumps([e['chimneys'][n] for n in ('tile_a', 'tile_b')])},")
        lines.append(f"    landmarkChimneys: {json.dumps([e['chimneys'][n] for n in ('start', 'mid', 'goal', 'far')])},")
        lines.append(f"    windows: {json.dumps([e['windows'][n] for n in ('tile_a', 'tile_b')])},")
        lines.append(f"    landmarkWindows: {json.dumps([e['windows'][n] for n in ('start', 'mid', 'goal', 'far')])},")
        lines.append('  },')
    lines.append('};')
    lines.append('')
    lines.append('export const AMBIENT_SPRITES = {')
    for name, (w, h) in sprites.items():
        lines.append(f"  {name}: {{ source: require('@/assets/ambient/{name}.png'), width: {w}, height: {h} }},")
    lines.append('};')
    with open(TS_OUT, 'w') as f:
        f.write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    V = gen.V
    entries = {
        'village': build_theme(
            'village',
            (gen.village_tile_a, gen.village_tile_b, gen.landmark_gate, gen.landmark_bakery,
             gen.landmark_townhall, gen.landmark_windmill),
            '#6b5a50',
            {'window': V['window'], 'light': V['light']},
            # The bakery's chimney is drawn by hand; its painted smoke is
            # taken out because the app animates it
            extra_chimneys={'mid': [[44, 11]]},
            erase={('mid', q) for q in ((43, 8), (44, 7), (46, 4), (47, 3), (45, 1))},
        ),
    }
    sprites = ambient_sprites()
    ts_table(entries, sprites)
    print(f'Wrote lighting for {", ".join(entries)} and {len(sprites)} ambient sprites')
