#!/usr/bin/env python3
"""
Time-of-day lighting for the map themes ("Pixel Art 2.5D").

Takes each map's art from generate-avatar-sprites.py and writes a lit copy
of it for each part of the day (day, sunset, night) into
assets/maps/<map>/<phase>/:

  tile_a, tile_b      the street, relit, with shadows cast on the road
  start ... far       the landmarks, relit
  *_shadow            each landmark's shadow on the road (drawn under it)
  *_b                 a second frame where part of the art moves (swaying
                      pines, waves, torches, signs, a waterfall...)
  sky                 the sky behind the scene, fixed to the screen
  depth_far/near      seamless strips for the parallax layers
  walker_shadow       a character's shadow on the road

and the small sprites the app moves around into assets/ambient/.
src/track/lighting.generated.ts lists every image, the colors the app
paints around the road for each phase, and where chimneys, vents and
windows are, so smoke and window flicker line up with the art. Which
movements each map has is in src/track/ambient.tsx; the plan they follow
is docs/step-tracker-map-restyle.txt.

Relighting, in order: outlines take a dark, cooler shade of what they
border (edges against the sky stay darkest so shapes read); edges facing
the light get a warm rim and edges facing away a cool shade; then a grade
per phase (light color, a tinted lift in the darks, a little saturation).
Lights (windows, lamps, torches, neon) skip the grade when they are on,
and glow a little onto what is around them.

Usage: python3 scripts/generate-map-lighting.py
(Run generate-avatar-sprites.py first if the base art changed.)
"""
import importlib.util
import json
import math
import os
import struct
import sys
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
TILE_TOP = SCENE_H - TILE_H  # 16: where tiles start in the scene
SKY_H = TILE_TOP + ROAD_TOP  # scene rows above the road: 72
SKY_W = 256  # 512 points, wider than any phone
# The sky picture reaches this far above the scene too, so the page's
# header (coins, today's count, page titles) sits on it, up to the top of
# the screen. Sun, moon and Earth stay where they were over the scene.
SKY_ABOVE = 160
SKY_FULL_H = SKY_ABOVE + SKY_H
DEPTH_H = 40
SCALES = ((2, ''), (4, '@2x'), (6, '@3x'))  # 2 points per art pixel, like the maps
PHASE_NAMES = ('day', 'sunset', 'night')
LANDMARK_NAMES = ('start', 'mid', 'goal', 'far')


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


def rng(seed):
    a = seed

    def next_():
        nonlocal a
        a = (a * 1103515245 + 12345) & 0x7FFFFFFF
        return a / 0x7FFFFFFF
    return next_


def h01(n):
    """A repeatable number in [0, 1) for each n."""
    s = math.sin(n * 12.9898) * 43758.5453
    return s - math.floor(s)


DARK_INK, LIGHT_INK = hexc('#2a1a1a'), hexc('#ffffff')


# ---------------------------------------------------------------- phases
# Every map has a day, sunset and night. Keys (colors as hex):
#   sky        bands from the top of the sky down to the horizon
#   light      multiplies every color; lift_to/lift tint the darks
#   sat        saturation; rim/shade the lit and shaded edges
#   side       1: light from the left (shadows fall right), -1 the other way
#   depth      far and near depth-layer colors; haze what they fade into
#   shadow     how much a shadow darkens the road; shadow_len its reach
#   front      tint of the road toward the bottom (kept light enough for
#              the dark text some maps put on the ground)
#   sun / moon (x, y) in the sky image, or none; stars a count
#   rays       sunset light rays from the sun
#   lights     which lights are on (see THEMES)
COMMON = {
    'day': dict(lift=0.15, sat=1.2, rim='#fff6d8', shade=(0.8, 0.84, 0.98), side=1,
                shadow=(0.78, 0.8, 0.92), shadow_len=0.25, front=(1, 1, 1), ridge=0.2,
                sun=(150, 12), sun_color='#fff8e0', glow=28, glow_strength=0.9),
    'sunset': dict(lift=0.3, sat=1.15, rim='#ffb060', shade=(0.7, 0.62, 0.85), side=1,
                   shadow=(0.62, 0.55, 0.78), shadow_len=0.9, front=(1.03, 1.02, 1.02), ridge=0.5,
                   sun=(150, 42), sun_color='#fff0c0', glow=46, glow_strength=1.4, rays=True),
    'night': dict(lift=0.35, sat=1.0, rim='#bcd0ff', shade=(0.75, 0.75, 0.9), side=-1,
                  shadow=(0.7, 0.72, 0.85), shadow_len=0.2, front=(0.86, 0.84, 0.9), ridge=0.2,
                  moon=(170, 16), stars=70),
}


def phases(day, sunset, night):
    return {'day': {**COMMON['day'], **day}, 'sunset': {**COMMON['sunset'], **sunset},
            'night': {**COMMON['night'], **night}}


def prepare(p):
    p = dict(p)
    for k in ('light', 'lift_to', 'rim', 'haze', 'sun_color'):
        if k in p:
            p[k] = hexc(p[k])
    p['sky'] = [hexc(c) for c in p['sky']]
    p['depth'] = tuple(hexc(c) for c in p['depth'])
    return p


def grade(c, p):
    l = lum(c) / 255
    g = mul(c, tuple(v / 255 for v in p['light']))
    g = lerp(g, p['lift_to'], (1 - l) * p['lift'])
    return clamp(saturate(g, p['sat']))


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


def road_row(c, y, p):
    """The road is lighter toward the back (hazier) and takes the phase's
    front tint toward the bottom, reaching its final color by FLAT_FROM so
    the flat rows stay one exact color."""
    g = grade(c, p)
    if y <= ROAD_TOP:
        return g
    back = lerp(g, p['haze'], 0.25)
    front = mul(g, p['front'])
    if y < 64:
        return clamp(lerp(g, back, 1 - (y - ROAD_TOP) / 8))
    return clamp(lerp(g, front, min(1, (y - 64) / (FLAT_FROM - 64))))


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


def rim_light(px, p, only=None):
    """Warm rim on edges facing the light, cool band on edges facing away;
    only the pixels in `only` (the scenery) when given."""
    side, out = p['side'], dict(px)
    for (x, y), c in px.items():
        if only is not None and (x, y) not in only:
            continue
        lit = (x - side, y) not in px or (x, y - 1) not in px
        away = (x + side, y) not in px or (x + 2 * side, y) not in px
        if lit and lum(c) > 60:
            out[(x, y)] = clamp(lerp(c, p['rim'], 0.35))
        elif away:
            out[(x, y)] = clamp(lerp(c, mul(c, p['shade']), 0.7))
    return out


# vpart() shades a part with darker(color, f); small parts like a window
# pane can be all shade, so a color is matched with its shades
SHADES = (1, 0.95, 0.92, 0.9, 0.88, 0.85, 0.8)


def family(color):
    return {gen.darker(color, f) if f != 1 else color for f in SHADES}


def components(px, color):
    """Connected areas of `color` (and its shades), as lists of pixels,
    top to bottom."""
    shades = family(color)
    seen, comps = set(), []
    for q, c in sorted(px.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        if c not in shades or q in seen:
            continue
        stack, comp = [q], []
        seen.add(q)
        while stack:
            x, y = stack.pop()
            comp.append((x, y))
            for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if n not in seen and px.get(n) in shades:
                    seen.add(n)
                    stack.append(n)
        comps.append(comp)
    return comps


def rect_of(comp):
    xs, ys = [x for x, _ in comp], [y for _, y in comp]
    return [min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1]


def lights_on(base, lights, share, salt):
    """{pixel: lit color} for the lights that are on. lights maps a base
    color to its lit color (None: keeps its own color, it just skips the
    grade). Window colors (in share) light only that share of panes."""
    on = {}
    for color, lit in lights.items():
        for i, comp in enumerate(components(base, hexc(color))):
            if color in share and h01(i * 7.31 + salt) >= share[color]:
                continue
            for q in comp:
                on[q] = hexc(lit) if lit else hexc(color)
    return on


def add_glow(px, on, limit_y=None):
    """A dithered halo of each light's color on what is around it."""
    out = dict(px)
    for (x, y), c in on.items():
        for dy in range(-3, 4):
            for dx in range(-3, 4):
                q = (x + dx, y + dy)
                if q in out and q not in on and (limit_y is None or q[1] < limit_y):
                    d = math.hypot(dx, dy) / 4
                    if d < 1 and dither(q[0], q[1], 0.16 * (1 - d)):
                        out[q] = clamp(lerp(out[q], c, 0.4))
    return out


def cast(px, p, base_y, stand):
    """Shadow pixels on the road for a silhouette standing on row `stand`."""
    out = set()
    for (x, y) in px:
        if y >= stand:
            continue
        h = stand - y
        sy = base_y + round(h * 0.18)
        sx = x + p['side'] * round(h * p['shadow_len'])
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


# ---------------------------------------------------------------- skies
def sky_image(p, style):
    """The sky behind the scene. style: 'open' (gradient, sun or moon,
    stars, rays), 'ceiling' (the dungeon: dark vault, light through high
    grates by day), 'space' (black with stars; a harsh sun, an Earthrise
    or neither), 'water' (under the sea: lighter toward the surface, with
    sunbeams by day)."""
    bands, px, stars = p['sky'], {}, []
    for y in range(SKY_FULL_H):
        f = y / SKY_FULL_H * (len(bands) - 1)
        i = int(f)
        frac = f - i
        a, b = bands[i], bands[min(i + 1, len(bands) - 1)]
        for x in range(SKY_W):
            px[(x, y)] = b if dither(x, y, (frac - 0.5) * 3 + 0.5) else a

    def glow(cx, cy, r, color, strength):
        for y in range(cy - r, cy + r + 1):
            for x in range(cx - r, cx + r + 1):
                d = math.hypot(x - cx, y - cy) / r
                if d < 1 and (x, y) in px and dither(x, y, (1 - d) * strength):
                    px[(x, y)] = lerp(px[(x, y)], color, 0.25)

    def disc(cx, cy, r, color, bite=None):
        for y in range(-r, r + 1):
            for x in range(-r, r + 1):
                if math.hypot(x, y) <= r and (bite is None or math.hypot(x - bite[0], y - bite[1]) > r - 1):
                    if (cx + x, cy + y) in px:
                        px[(cx + x, cy + y)] = color

    def starfield(count, seed, bottom):
        r = rng(seed)
        for _ in range(count):
            x, y = int(r() * SKY_W), int(r() * bottom)
            px[(x, y)] = (255, 255, 255) if r() < 0.3 else hexc('#aeb8e8')
            stars.append([x, y])

    def beams(color, strength, slant):
        """Shafts of light from the top, leaning by `slant`."""
        for k, x0 in enumerate((30, 92, 150, 214)):
            width = 8 + (k % 2) * 5
            for y in range(SKY_FULL_H):
                for x in range(x0 + round(y * slant), x0 + round(y * slant) + width):
                    fade = 1 - y / SKY_FULL_H
                    if (x % SKY_W, y) in px and dither(x, y, strength * fade):
                        px[(x % SKY_W, y)] = lerp(px[(x % SKY_W, y)], color, 0.35)

    if style == 'open':
        if p.get('moon'):
            sx, sy = p['moon']
            sy += SKY_ABOVE
            starfield(p['stars'] * SKY_FULL_H // SKY_H, 7, SKY_FULL_H - 24)
            glow(sx, sy, 22, hexc('#cfd8ff'), 0.8)
            disc(sx, sy, 6, hexc('#f4f1dc'), bite=(3, 2))
        elif p.get('sun'):  # an overcast day has none
            sx, sy = p['sun']
            sy += SKY_ABOVE
            glow(sx, sy, p['glow'], p['sun_color'], p['glow_strength'])
            disc(sx, sy, 7, p['sun_color'])
            if p.get('rays'):
                for y in range(SKY_FULL_H):
                    for x in range(sx, SKY_W):
                        ang = math.atan2(y - sy, x - sx)
                        fade = 1 - min(1, math.hypot(x - sx, y - sy) / 420)
                        if math.sin(ang * 18) > 0.82 and dither(x, y, 0.35 * fade):
                            px[(x, y)] = lerp(px[(x, y)], hexc('#fff2c8'), 0.4)
    elif style == 'ceiling':
        if p.get('grates'):
            beams(hexc(p['grates']), p.get('grate_strength', 0.45), 0.35)
    elif style == 'space':
        starfield(p['stars'] * SKY_FULL_H // SKY_H, 11, SKY_FULL_H - 8)
        if p.get('sun'):
            sx, sy = p['sun']
            sy += SKY_ABOVE
            glow(sx, sy, 16, (255, 255, 255), 0.7)
            disc(sx, sy, 5, (255, 255, 250))
        if p.get('earthrise'):
            ex, ey = p['earthrise']
            ey += SKY_ABOVE
            glow(ex, ey, 30, hexc('#7fb0ff'), 1.0)
            for y in range(-16, 17):
                for x in range(-16, 17):
                    if math.hypot(x, y) <= 16 and (ex + x, ey + y) in px:
                        land = h01((x // 3) * 3.7 + (y // 3) * 1.3) < 0.35
                        lit = x - y < 4
                        c = hexc('#5fae6a') if land else hexc('#4f8fd6')
                        px[(ex + x, ey + y)] = c if lit else mul(c, (0.45, 0.45, 0.6))
    elif style == 'water':
        if p.get('beams'):
            beams(hexc(p['beams']), 0.5, -0.25)
        if p.get('moon'):
            glow(p['moon'][0], 0, 30, hexc('#6a8ac0'), 0.7)  # moonlight on the surface
    return px, stars


# ---------------------------------------------------------------- depth layers
def depth_image(p, layer, style):
    """A seamless strip (every shape repeats within 256 px) for the
    parallax layers: the far one hazier, its foot fading into the haze.
    The strip's bottom row sits on the road line unless the theme moves it."""
    color = lerp(p['depth'][layer], p['haze'], 0.5 if layer == 0 else 0.2)
    px = {}

    def column(x, top, bottom=DEPTH_H):
        for y in range(top, bottom):
            hz = (y - top) / max(1, bottom - top)
            px[(x, y)] = clamp(lerp(color, p['haze'], 0.35) if dither(x, y, hz * 0.6) else color)
        if top < bottom:
            px[(x, top)] = clamp(lerp(color, p['rim'], p['ridge']))

    def wave(x, amp, shift, base):
        t = 2 * math.pi * x / TILE_W
        return base - round(amp * (0.5 * math.sin(t * 2 + shift) + 0.3 * math.sin(t * 4 + 1)
                                   + 0.2 * math.sin(t * 8 + shift)))

    if style == 'hills':
        for x in range(TILE_W):
            column(x, wave(x, 9 if layer == 0 else 6, 0.7 if layer == 0 else 2.1,
                           DEPTH_H - (14 if layer == 0 else 2)))
    elif style == 'pines':
        # A row of pine silhouettes; every tree repeats within the strip
        step = 9 if layer == 0 else 14
        tops = {}
        for i in range(TILE_W // step + 1):
            cx = i * step + (i * 5) % 4
            h = (16 if layer == 0 else 24) + round(h01(i * 3.3 + layer) * (8 if layer == 0 else 10))
            half = h * 0.32
            for x in range(round(cx - half), round(cx + half) + 1):
                top = DEPTH_H - 4 - round(h * (1 - abs(x - cx) / half)) if half else DEPTH_H
                xx = x % TILE_W
                tops[xx] = min(tops.get(xx, DEPTH_H), top)
        for x in range(TILE_W):
            column(x, tops.get(x, DEPTH_H - 4))
    elif style == 'skyline':
        x = 0
        i = 0
        lit = hexc(p['far_windows']) if p.get('far_windows') else None
        while x < TILE_W:
            w = 8 + round(h01(i * 2.1 + layer) * (8 if layer == 0 else 14))
            w = min(w, TILE_W - x)
            h = (12 if layer == 0 else 18) + round(h01(i * 5.7 + layer * 3) * (14 if layer == 0 else 16))
            top = DEPTH_H - h
            for xx in range(x, x + w):
                column(xx, top)
                if lit and layer == 1:
                    for yy in range(top + 3, DEPTH_H - 3, 4):
                        if (xx - x) % 3 == 1 and h01(xx * 1.7 + yy * 3.1) < 0.35:
                            px[(xx, yy)] = lit
            x += w
            i += 1
    elif style == 'islands':
        # A couple of low headlands sitting on the sea's horizon line
        horizon = p['horizon_in_depth']
        if layer == 0:
            for cx, half, h in ((60, 40, 7), (190, 26, 5)):
                for x in range(cx - half, cx + half + 1):
                    top = horizon - round(h * max(0, math.sin(math.pi * (x - cx + half) / (2 * half))) ** 0.7)
                    column(x % TILE_W, top, horizon + 1)
    elif style == 'range':
        snow = hexc(p['snow'])
        peaks = ((20, 16), (70, 22), (118, 14), (164, 24), (220, 18)) if layer == 0 else \
            ((44, 12), (128, 15), (200, 10))
        tops, snowline = {}, {}
        for cx, h in peaks:
            half = h * 1.4
            for x in range(round(cx - half), round(cx + half) + 1):
                top = DEPTH_H - 6 - round(h * (1 - abs(x - cx) / half))
                xx = x % TILE_W
                if top < tops.get(xx, DEPTH_H):
                    tops[xx] = top
                    snowline[xx] = DEPTH_H - 6 - round(h * 0.65)
        for x in range(TILE_W):
            column(x, tops.get(x, DEPTH_H - 6))
        if layer == 0:
            for (x, y), c in list(px.items()):
                if y < snowline.get(x, -1):
                    px[(x, y)] = clamp(lerp(snow, p['haze'], 0.45))
    elif style == 'arches':
        # Vaults in the dark above the dungeon wall: piers with round
        # arches between them (the far layer only)
        if layer == 0:
            span = 64
            for x in range(TILE_W):
                u = (x % span) / span
                pier = abs(u - 0.5) > 0.42
                crown = 4 + round(14 * (1 - math.sqrt(max(0, 1 - ((u - 0.5) / 0.42) ** 2))))
                for y in range(0, DEPTH_H if pier else crown):
                    px[(x, y)] = color
    elif style == 'ridges':
        for x in range(TILE_W):
            top = wave(x, 7 if layer == 0 else 5, 1.3 if layer == 0 else 0.2,
                       DEPTH_H - (12 if layer == 0 else 4))
            # Crater rims: little notches every 64 px
            if layer == 0 and x % 64 in (20, 21, 26, 27):
                top -= 1
            column(x, top)
    elif style == 'shelves':
        for x in range(TILE_W):
            seg = x // 32
            top = DEPTH_H - (10 if layer == 0 else 4) - round(h01(seg * 4.1 + layer) * (12 if layer == 0 else 8))
            column(x, top)
    return px


# ---------------------------------------------------------------- a character's shadow
def walker_shadow(p):
    """The plain body (and a head of hair) cast flat along the ground,
    see-through so it darkens whatever road color is under it. Row 0 is
    the feet; returns the pixels and where the image sits from the
    sprite's left edge."""
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
    return px, {'left': left, 'width': gen.W + reach, 'height': round(feet * 0.1) + 1}


# ---------------------------------------------------------------- drawing with patches
class Patched:
    """Draws with some of generate-avatar-sprites.py's functions swapped,
    e.g. a pine whose top leans for a sway frame, and records the spots
    the app needs (chimney tops)."""

    def __init__(self, **swaps):
        self.swaps = swaps
        self.saved = {}

    def __enter__(self):
        for name, fn in self.swaps.items():
            self.saved[name] = getattr(gen, name)
            setattr(gen, name, fn(self.saved[name]) if callable(fn) else fn)
        return self

    def __exit__(self, *exc):
        for name, fn in self.saved.items():
            setattr(gen, name, fn)


def draw(make, outline, **swaps):
    """(pixels, base pixels, chimneys) for one tile or landmark. `base`
    is the ground strip the tile was drawn on (so its backdrop, like the
    sea or a wall, isn't treated as scenery)."""
    chimneys, bases = [], []
    house = gen.house

    def record_house(layer, x0, w, wall_h, roof, warm=False, chimney=False, shop=None):
        if chimney:
            chimneys.append([x0 + w - 6, GROUND - wall_h + 1 - 10])
        return house(layer, x0, w, wall_h, roof, warm=warm, chimney=chimney, shop=shop)

    def record_base(fn):
        def wrapped(*a, **k):
            layer = fn(*a, **k)
            bases.append(dict(layer.px))
            return layer
        return wrapped

    base_names = ('street_base', 'forest_base', 'city_base', 'beach_base', 'mountain_base',
                  'dungeon_base', 'space_base', 'ocean_base', 'neon_base')
    patches = {'house': lambda _: record_house, **{n: record_base for n in base_names}, **swaps}
    with Patched(**patches):
        gen.set_outline(outline)
        layer = make()
    base = bases[0] if bases else {}
    return dict(layer.px), base, chimneys


# ---------------------------------------------------------------- one map
def light_image(px, base, outline, p, lights, share, salt, scenery_only=True):
    """Relight and grade one image; lights that are on skip the grade."""
    scenery = {q for q, c in px.items() if base.get(q) != c} if scenery_only else None
    relit = rim_light(color_outlines(px, outline, p['shade']), p, only=scenery)
    out = {}
    for q, c in relit.items():
        out[q] = road_row(c, q[1], p) if base and q[1] >= ROAD_TOP and q in base and base[q] == px[q] else grade(c, p)
    on = lights_on(px, lights, share, salt) if lights else {}
    out.update(on)
    return add_glow(out, on, limit_y=ROAD_TOP) if on else out


def build_theme(key, cfg):
    """Writes every phase of one map; returns its entry for the TS table."""
    outline = hexc(cfg['outline'])
    makers = cfg['makers']
    entry = {'phases': {}}
    all_chimneys, all_windows = {}, {}

    for ph in PHASE_NAMES:
        p = prepare(cfg['phases'][ph])
        folder = os.path.join(MAPS_OUT, key, ph)
        os.makedirs(folder, exist_ok=True)
        lights = cfg.get('lights', {}).get(ph, {})
        share = cfg.get('window_share', {}).get(ph, {})
        swaps_now = cfg.get('swaps', {}).get(ph, {})
        stand = cfg.get('stand', GROUND)
        shadow_from = cfg.get('shadow_from', 0)

        def recolor(px):
            if not swaps_now:
                return px
            table = {gen.darker(hexc(a), f) if f != 1 else hexc(a): gen.darker(hexc(b), f) if f != 1 else hexc(b)
                     for a, b in swaps_now.items() for f in SHADES}
            return {q: table.get(c, c) for q, c in px.items()}

        def extras(name, px, frame):
            for fn in cfg.get('extras', {}).get(name, []):
                px = fn(px, ph, frame)
            return px

        # ---- tiles (frame A, and frame B where the map has one)
        frames_cfg = cfg.get('tile_frames')
        frame_on = bool(frames_cfg) and ph in frames_cfg['phases']
        tiles = []
        for i, name in enumerate(('tile_a', 'tile_b')):
            px, base, chimneys = draw(makers[i], cfg['outline'])
            all_chimneys[name] = chimneys + cfg.get('vents', {}).get(name, [])
            all_windows[name] = [rect_of(c) for color in cfg.get('flicker', []) for c in components(px, hexc(color))]
            frames = [extras(name, recolor(px), 0)]
            if frame_on:
                bpx, _, _ = draw(makers[i], cfg['outline'], **frames_cfg['swaps'])
                frames.append(extras(name, recolor(bpx), 1))
            tiles.append((name, base, frames))

        silhouettes = [{q for q, c in frames[0].items() if base.get(q) != c and shadow_from <= q[1] < stand - 2}
                       for _, base, frames in tiles]
        for i, (name, base, frames) in enumerate(tiles):
            shade_at = cast(silhouettes[i], p, ROAD_TOP, stand - 2)
            other = cast(silhouettes[1 - i], p, ROAD_TOP, stand - 2)
            shade_at |= {(x - TILE_W, y) for x, y in other} | {(x + TILE_W, y) for x, y in other}
            for k, fpx in enumerate(frames):
                lit = light_image(fpx, recolor(base), outline, p, lights, share, salt=i * 13)
                for q in shade_at:
                    if q in lit and ROAD_TOP < q[1] < FLAT_FROM:
                        lit[q] = clamp(mul(lit[q], p['shadow']))
                write_png(os.path.join(folder, name + ('_b' if k else '')), TILE_W, TILE_H,
                          lambda x, y, px=lit: px.get((x, y)))

        # ---- landmarks, their shadows, and frame B where they have one
        road = road_colors(tiles[0][2][0])
        shadows, lframes = {}, {}
        for i, (name, make) in enumerate(zip(LANDMARK_NAMES, makers[2:])):
            px, _, chimneys = draw(make, cfg['outline'])
            all_chimneys[name] = chimneys + cfg.get('landmark_vents', {}).get(name, [])
            all_windows[name] = [rect_of(c) for color in cfg.get('flicker', []) for c in components(px, hexc(color))]
            lf = cfg.get('landmark_frames', {}).get(name)
            variants = [extras(name, recolor(px), 0)]
            if lf and ph in lf['phases']:
                if 'swaps' in lf:
                    bpx, _, _ = draw(make, cfg['outline'], **lf['swaps'])
                    variants.append(extras(name, recolor(bpx), 1))
                else:
                    variants.append(extras(name, recolor(px), 1))
                lframes[name] = {'mode': lf['mode'], 'rate': lf['rate']}
            for k, vpx in enumerate(variants):
                lit = light_image(vpx, {}, outline, p, lights, share, salt=100 + i * 7, scenery_only=False)
                write_png(os.path.join(folder, name + ('_b' if k else '')), LANDMARK_W, LANDMARK_H,
                          lambda x, y, px=lit: px.get((x, y)))
            spots = cast(set(variants[0]), p, ROAD_TOP, LANDMARK_H)
            reach = math.ceil(LANDMARK_H * p['shadow_len']) + 1
            left = -reach if p['side'] < 0 else 0
            shade = {(x - left, y - ROAD_TOP): clamp(mul(road_row(road[y], y, p), p['shadow'])) for x, y in spots}
            write_png(os.path.join(folder, f'{name}_shadow'), LANDMARK_W + reach, TILE_H - ROAD_TOP,
                      lambda x, y, s=shade: s.get((x, y)))
            shadows[name] = {'left': left, 'width': LANDMARK_W + reach}

        shadow_px, walker_box = walker_shadow(p)
        write_png(os.path.join(folder, 'walker_shadow'), walker_box['width'], walker_box['height'],
                  lambda x, y: shadow_px.get((x, y)))

        sky, stars = sky_image(p, cfg.get('sky_style', 'open'))
        write_png(os.path.join(folder, 'sky'), SKY_W, SKY_FULL_H, lambda x, y: sky.get((x, y)))
        if cfg.get('horizon') is not None:
            p['horizon_in_depth'] = cfg['horizon'] + TILE_TOP - (cfg.get('depth_top', SKY_H - DEPTH_H))
        for layer, label in ((0, 'depth_far'), (1, 'depth_near')):
            d = depth_image(p, layer, cfg['depth_style'])
            write_png(os.path.join(folder, label), TILE_W, DEPTH_H, lambda x, y, d=d: d.get((x, y)))

        ground = road_row(tiles[0][2][0][(5, TILE_H - 1)], TILE_H - 1, p)
        ink = DARK_INK if contrast(ground, DARK_INK) >= contrast(ground, LIGHT_INK) else LIGHT_INK
        sky_ink = DARK_INK if contrast(p['sky'][0], DARK_INK) >= contrast(p['sky'][0], LIGHT_INK) else LIGHT_INK
        # What a flickering window turns into: the unlit glass (windows
        # switching off) or a dimmer glow (a flame or a TV)
        if cfg.get('flicker_to') == 'unlit':
            window_alt = grade(hexc(cfg['flicker'][0]), p)
        else:
            window_alt = mul(hexc(cfg.get('window_lit', '#ffd77a')), (0.78, 0.7, 0.5))
        entry['phases'][ph] = {
            'sky': to_hex(p['sky'][0]),
            'skyInk': to_hex(sky_ink),
            'statusBar': 'dark' if sky_ink == DARK_INK else 'light',
            'ground': to_hex(ground),
            'ink': to_hex(ink),
            'shadowColor': to_hex(mul(ground, p['shadow'])),
            'smokeColor': to_hex(grade(hexc(cfg.get('smoke', '#f4efe6')), p)),
            'windowAlt': to_hex(window_alt),
            'stars': stars,
            'shadows': shadows,
            'avatarMatrix': avatar_matrix(p),
            'shadowLength': p['shadow_len'] * p['side'],
            'walkerShadow': walker_box,
            'tileFrames': {'mode': frames_cfg['mode'], 'rate': frames_cfg['rate']} if frame_on else None,
            'landmarkFrames': [lframes.get(n) for n in LANDMARK_NAMES],
        }

    entry['chimneys'] = [all_chimneys[n] for n in ('tile_a', 'tile_b')]
    entry['landmarkChimneys'] = [all_chimneys[n] for n in LANDMARK_NAMES]
    entry['windows'] = [all_windows[n] for n in ('tile_a', 'tile_b')]
    entry['landmarkWindows'] = [all_windows[n] for n in LANDMARK_NAMES]
    entry['depthTop'] = cfg.get('depth_top', SKY_H - DEPTH_H)
    entry['horizon'] = cfg.get('horizon')
    entry['clock'] = cfg.get('clock')
    return entry


# ---------------------------------------------------------------- frame helpers
def leaning_pine(original):
    """A pine whose upper tiers lean a pixel, for the sway frame."""
    def pine(layer, cx, h=40, w=9, color=None, snow=None):
        color = color or gen.FO['pine']
        gen.vpart(layer, gen.rect(cx - 1, GROUND - 6, cx, GROUND), gen.FO['trunk'])
        tier_h = max(8, int(h * 0.42))
        for k in range(3):
            wk = w - k * 2.5
            base = GROUND - 5 - k * (h // 4)
            lean = (0, 1, 1)[k]
            mask = gen.tri(round(cx - wk) + lean, round(cx + wk) + lean, base, tier_h)
            if k == 2:
                mask = {(x + (1 if y < base - tier_h // 2 else 0), y) for x, y in mask}
            gen.vpart(layer, mask, color)
            if snow:
                top = base - tier_h + 1
                layer.dots(snow, [(x, y) for x, y in mask if y <= top + 2 and (x, y + 1) in mask])
    return pine


def swaying_kelp(original):
    def kelp(layer, cx, h=36, color=None):
        color = color or gen.OC['kelp']
        shadow = gen.darker(color, 0.8)
        for i in range(h):
            x = cx + round(2 * math.sin(i / 4 + 1.6) * min(1, i / 8))
            y = GROUND - i
            layer.dots(color, [(x, y)])
            layer.dots(shadow, [(x + 1, y)])
            if i % 6 == 3 and i > 4:
                side = 1 if (i // 6) % 2 else -1
                leaf = [(x + side * 2, y), (x + side * 2, y - 1), (x + side * 3, y - 1), (x + side * 3, y - 2)]
                layer.dots(color if side < 0 else shadow, leaf)
    return kelp


def rolling_beach(original):
    """The beach with its waves a few pixels further along."""
    def beach_base():
        BE = gen.BE
        layer = gen.ground_base(BE['wet'], BE['curb'], BE['ground'],
                                specks=[(BE['speck'], 55, 5), (BE['shell'], 18, 9)])
        w, _ = TILE_W, TILE_H
        layer.dots(BE['sea'], [(x, y) for x in range(w) for y in range(41, 47)])
        layer.dots(BE['sea_deep'], [(x, y) for x in range(w) for y in range(47, 52)])
        layer.dots(BE['foam'], [(x, 41) for x in range(w) if (x + 4) % 8 in (0, 1, 2)])
        layer.dots(BE['foam'], [(x, 45) for x in range(w) if x % 8 in (0, 1)])
        layer.dots(BE['foam'], [(x, 51) for x in range(w) if (x + 2) % 4 != 0])
        layer.dots(BE['foam'], [(x, 52) for x in range(w) if x % 16 in (5, 6, 7)])
        return layer
    return beach_base


def fluttering_umbrella(original):
    def umbrella(layer, cx, color):
        BE = gen.BE
        layer.dots(BE['white'], [(cx, y) for y in range(GROUND - 14, GROUND + 1)])
        dome = gen.ell(cx + 0.5, GROUND - 13, 9, 5) & gen.rect(0, 0, 255, GROUND - 13)
        dome |= {(cx + 9, GROUND - 13)}  # the edge lifts in the wind
        gen.vpart(layer, dome, color)
        layer.dots(BE['white'], [(x, y) for x, y in dome if ((x - cx + 1) // 3) % 2 and y > GROUND - 17])
    return umbrella


def flickering_torch(original):
    def torch(layer, x, y=34):
        DU = gen.DU
        layer.dots(gen.SOFT, [(x, y), (x, y + 1), (x, y + 2), (x - 1, y + 3), (x + 1, y + 3)])
        gen.vpart(layer, gen.ell(x + 0.5, y - 3, 2, 4), DU['flame'], 0.95)
        layer.dots(DU['core'], [(x, y - 3), (x, y - 2), (x + 1, y - 1)])
    return torch


def dark_sign(original):
    def neon_sign(layer, x, y, h, color, reflect=True):
        return original(layer, x, y, h, gen.hexc('#3a3448'), reflect=False)  # off: nothing on the road
    return neon_sign


def dark_antenna(original):
    def antenna(layer, x, h=18):
        SP = gen.SP
        layer.dots(SP['metal'], [(x, y) for y in range(GROUND - h, GROUND + 1)])
        layer.dots(SP['metal'], [(x - 2, GROUND - h + 4), (x - 1, GROUND - h + 4), (x + 1, GROUND - h + 4),
                                 (x + 2, GROUND - h + 4)])
        gen.vpart(layer, gen.ell(x + 0.5, GROUND - h - 0.5, 1.6, 1.6), gen.hexc('#5a3a40'), 0.9)
    return antenna


def replace_colors(table, region=None):
    """An extras step: swap colors (in a region (x0, y0, x1, y1)) on frame B."""
    table = {hexc(a): hexc(b) for a, b in table.items()}

    def step(px, ph, frame):
        if frame != 1:
            return px
        return {q: (table.get(c, c) if region is None or (region[0] <= q[0] <= region[2] and region[1] <= q[1] <= region[3])
                    else c) for q, c in px.items()}
    return step


def paint(points, color, frames=(0, 1), phases=PHASE_NAMES):
    """An extras step: draw pixels (on the given frames and phases)."""
    color = hexc(color) if isinstance(color, str) else color

    def step(px, ph, frame):
        if frame not in frames or ph not in phases:
            return px
        out = dict(px)
        for q in points:
            out[q] = color
        return out
    return step


def erase(points):
    """An extras step: take pixels out (on every frame)."""
    def step(px, ph, frame):
        return {q: c for q, c in px.items() if q not in points}
    return step


def waterfall_flow(px, ph, frame):
    """The waterfall's foam streaks a step further down on frame B."""
    if frame != 1:
        return px
    water, dot = gen.FO['water'], gen.FO['dot']
    out = dict(px)
    for x in range(25, 39):
        for y in range(13, 63):
            if out.get((x, y)) in (water, dot):
                streak = x in (26, 30, 34, 37) and (y - 15) % 3 == 0 and (x + y + 1) % 2
                out[(x, y)] = dot if streak else water
    return out


def owl(px, ph, frame):
    """An owl in the great tree at night; frame B blinks."""
    if ph != 'night':
        return px
    out = dict(px)
    body, belly, eye = hexc('#b08860'), hexc('#e0c8a0'), hexc('#ffe070')
    for x in range(9, 15):
        for y in range(31, 38):
            if not ((x in (9, 14)) and y in (31, 37)):
                out[(x, y)] = body
    for x in range(11, 13):
        for y in range(34, 37):
            out[(x, y)] = belly
    out[(9, 30)] = out[(14, 30)] = body  # ear tufts
    out[(11, 34)] = out[(12, 34)] = hexc('#e8894f')  # beak
    if frame == 0:  # eyes open; frame B blinks
        for q in ((10, 32), (10, 33), (13, 32), (13, 33)):
            out[q] = eye
    return out


def lighthouse_beam(px, ph, frame):
    """At night the lamp sweeps: the beam to the left, then the right."""
    if ph != 'night':
        return px
    out = dict(px)
    lamp = (32, 9)
    for x in range(0, 64):
        if (frame == 0 and x < 24) or (frame == 1 and x > 40):
            spread = abs(x - lamp[0]) * 0.22
            for y in range(round(lamp[1] - spread), round(lamp[1] + spread) + 1):
                if (x, y) not in out and dither(x, y, 0.55 - abs(x - lamp[0]) / 90):
                    out[(x, y)] = hexc('#fff3b0')
    return out


def crane_light(px, ph, frame):
    out = dict(px)
    if frame == 0:
        out[(61, 4)] = out[(62, 4)] = out[(61, 5)] = out[(62, 5)] = hexc('#ff5050')
    return out


def chest_sparkle(px, ph, frame):
    if frame != 1:
        return px
    out = dict(px)
    for q in ((22, 31), (32, 29), (42, 31), (27, 27), (37, 27)):
        out.pop(q, None)
    core = hexc('#f7d36b')
    for cx, cy in ((25, 29), (39, 30)):
        for q in ((cx, cy), (cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
            out[q] = core
    return out


def crystal_pulse(px, ph, frame):
    if frame != 1:
        return px
    table = {gen.DU['crystal']: hexc('#c2a6ff'), gen.DU['crystal2']: hexc('#b6f4fa')}
    out = {q: table.get(c, c) for q, c in px.items()}
    for q in ((22, 16), (42, 10), (14, 32), (50, 26), (32, 1)):
        out[q] = hexc('#f7d36b')
    return out


def flag_wave(px, ph, frame):
    """The summit flag's fly end ripples down a pixel on frame B."""
    if frame != 1:
        return px
    red = gen.MO['red']
    flag = {q: c for q, c in px.items() if 39 <= q[0] <= 46 and 5 <= q[1] <= 14 and q[0] > 32}
    out = {q: c for q, c in px.items() if q not in flag}
    for (x, y), c in flag.items():
        out[(x, y + (1 if x >= 41 else 0))] = c
    return out


def clock_face(px, ph, frame):
    """The clock tower without painted hands; the app draws the real time."""
    out = dict(px)
    for q in ((32, 19), (32, 20), (32, 21), (32, 22), (33, 24), (34, 24), (35, 24)):
        out[q] = gen.CI['white']
    return out


# ---------------------------------------------------------------- the maps
V, FO, CI, BE, MO, DU, SP, OC, NE = gen.V, gen.FO, gen.CI, gen.BE, gen.MO, gen.DU, gen.SP, gen.OC, gen.NE
h = to_hex

THEMES = {
    'village': dict(
        makers=(gen.village_tile_a, gen.village_tile_b, gen.landmark_gate, gen.landmark_bakery,
                gen.landmark_townhall, gen.landmark_windmill),
        outline='#6b5a50', depth_style='hills',
        lights={'night': {h(V['window']): '#ffd77a', h(V['light']): None}},
        flicker=[h(V['window'])], window_lit='#ffd77a',
        landmark_vents={'mid': [[44, 11]]},
        # The bakery's painted smoke comes out; the app animates it
        extras={'mid': [erase([(43, 8), (44, 7), (46, 4), (47, 3), (45, 1)])]},
        phases=phases(
            dict(sky=['#9fd3ff', '#b2ddff', '#c4e6ff', '#d6eefc', '#e6f3f2'], light='#ffffff',
                 lift_to='#3a4a7a', sat=1.25, depth=('#8fb98a', '#a9c9b0'), haze='#e6f3f2'),
            dict(sky=['#f2a07a', '#f7b583', '#fbc98e', '#fdd9a0', '#ffe6b8'], light='#ffd8b0',
                 lift_to='#6a3a6a', depth=('#b07a78', '#d29a88'), haze='#ffe0b0'),
            dict(sky=['#141a3a', '#1a2148', '#222a56', '#2c3462', '#3a406c'], light='#7f8fc8',
                 lift_to='#141a3a', depth=('#2a3058', '#353c66'), haze='#3a406c'),
        ),
    ),
    'forest': dict(
        makers=(gen.forest_tile_a, gen.forest_tile_b, gen.forest_start, gen.forest_mid,
                gen.forest_goal, gen.forest_far),
        outline='#2f3f25', depth_style='pines',
        tile_frames=dict(phases=PHASE_NAMES, mode='sway', rate=1.5, swaps={'pine': leaning_pine}),
        landmark_frames={'far': dict(phases=PHASE_NAMES, mode='sway', rate=5),
                         'goal': dict(phases=('night',), mode='flicker', rate=1)},
        extras={'far': [waterfall_flow], 'goal': [owl]},
        lights={'night': {'#ffe070': None}},
        phases=phases(
            dict(sky=['#bfe3c8', '#cdebd2', '#dbf1dc', '#e6f4dc', '#eef6d8'], light='#fff6e0',
                 lift_to='#2f4a3a', lift=0.18, rim='#fff2c0', shade=(0.8, 0.86, 0.9),
                 depth=('#5f8f6a', '#7fa88a'), haze='#e6f2dc', shadow=(0.75, 0.8, 0.85), shadow_len=0.3),
            dict(sky=['#e89a6a', '#f0ae78', '#f5c288', '#f8d29a', '#fbe0b0'], light='#ffcf98',
                 lift_to='#5a3050', depth=('#8a6a58', '#a57f62'), haze='#f8d8a8',
                 shadow=(0.6, 0.55, 0.75), front=(1.05, 1.03, 1.03)),
            dict(sky=['#0f1a24', '#132230', '#182a3a', '#1e3242', '#263c4a'], light='#6f8fb0',
                 lift_to='#0f1a24', rim='#b0d0ff', shade=(0.75, 0.78, 0.9), depth=('#1c2c34', '#22363c'),
                 haze='#263c4a', front=(0.9, 0.9, 0.95), stars=50),
        ),
    ),
    'city': dict(
        makers=(gen.city_tile_a, gen.city_tile_b, gen.city_start, gen.city_mid, gen.city_goal, gen.city_far),
        outline='#353a44', depth_style='skyline', stand=gen.CITY_GROUND + 1,
        lights={'sunset': {h(CI['window']): '#ffe08a'},
                'night': {h(CI['window']): '#ffe08a', h(CI['light']): None}},
        window_share={'sunset': {h(CI['window']): 0.3}, 'night': {h(CI['window']): 0.75}},
        flicker=[h(CI['window'])], window_lit='#ffe08a', flicker_to='unlit',
        extras={'goal': [clock_face]},
        clock={'cx': 32, 'cy': 24, 'r': 6},
        phases=phases(
            dict(sky=['#8fc4f0', '#a4d0f4', '#b8dbf6', '#cbe4f6', '#dbeaf2'], light='#ffffff',
                 lift_to='#3a4a7a', sat=1.15, depth=('#9fb2cc', '#b4c3d8'), haze='#dbeaf2',
                 shadow=(0.78, 0.8, 0.9), shadow_len=0.3),
            dict(sky=['#f08a6a', '#f5a07a', '#f8b88a', '#fbcc9c', '#fde0b4'], light='#ffd2a8',
                 lift_to='#5a3060', rim='#ffb070', depth=('#a07890', '#c0909c'), haze='#fde0b4',
                 front=(1.02, 1, 1)),
            dict(sky=['#101833', '#162040', '#1c284c', '#243258', '#2e3c62'], light='#7f8fc8',
                 lift_to='#101833', depth=('#1e2440', '#262e4c'), haze='#2e3c62', front=(0.9, 0.9, 0.95),
                 stars=30, far_windows='#e8c870'),
        ),
    ),
    'beach': dict(
        makers=(gen.beach_tile_a, gen.beach_tile_b, gen.beach_start, gen.beach_mid, gen.beach_goal, gen.beach_far),
        outline='#7a6a4a', depth_style='islands', horizon=41,
        tile_frames=dict(phases=PHASE_NAMES, mode='sway', rate=0.8,
                         swaps={'beach_base': rolling_beach, 'umbrella': fluttering_umbrella}),
        landmark_frames={'goal': dict(phases=('night',), mode='sway', rate=0.7)},
        lights={'night': {'#a9c7d8': '#ffd77a', h(BE['yellow']): None}},
        extras={'goal': [lighthouse_beam]},
        phases=phases(
            dict(sky=['#7fd0f2', '#94daf5', '#aae2f6', '#c0eaf6', '#d6f0f2'], light='#ffffff',
                 lift_to='#2a5a7a', lift=0.12, rim='#fff8dc', shade=(0.82, 0.86, 0.98),
                 depth=('#7fb0a0', '#98c0b0'), haze='#d6f0f2', shadow=(0.8, 0.8, 0.88), shadow_len=0.3),
            dict(sky=['#e87a8a', '#f0928a', '#f6ac8e', '#f9c496', '#fcdaa6'], light='#ffd0b0',
                 lift_to='#6a3a6a', lift=0.28, rim='#ffa070', shade=(0.72, 0.64, 0.86),
                 depth=('#a0708a', '#b88894'), haze='#fcdaa6', shadow=(0.66, 0.58, 0.8), sun=(150, 54),
                 front=(1, 1, 1)),
            dict(sky=['#0e1630', '#12203c', '#182848', '#1e3052', '#263a5c'], light='#7f90c8',
                 lift_to='#0e1630', depth=('#1a2440', '#202c48'), haze='#263a5c', front=(0.9, 0.9, 0.95),
                 stars=50),
        ),
    ),
    'mountain': dict(
        makers=(gen.mountain_tile_a, gen.mountain_tile_b, gen.mountain_start, gen.mountain_mid,
                gen.mountain_goal, gen.mountain_far),
        outline='#3f4250', depth_style='range',
        landmark_frames={'goal': dict(phases=PHASE_NAMES, mode='sway', rate=2.5)},
        extras={'goal': [flag_wave]},
        lights={'night': {h(V['window']): '#ffd77a'}},
        phases=phases(
            dict(sky=['#a8c8ec', '#b8d2ef', '#c8dcf2', '#d8e6f4', '#e6eef6'], light='#ffffff',
                 lift_to='#3a4a7a', sat=1.15, rim='#fff8e8', shade=(0.82, 0.86, 1.0),
                 depth=('#b8c4d8', '#9eacc4'), haze='#e6eef6', snow='#f3f6fa', shadow_len=0.3),
            dict(sky=['#c87aa0', '#dc8ea0', '#eca8a4', '#f6c0a8', '#fbd4b0'], light='#ffc8d0',
                 lift_to='#4a3a6a', lift=0.28, rim='#ffa0b0', shade=(0.72, 0.66, 0.88),
                 depth=('#c890a8', '#a87890'), haze='#fbd4b0', snow='#ffd8e0',
                 shadow=(0.64, 0.58, 0.8), sun=(150, 46)),
            dict(sky=['#0c1430', '#101a3a', '#162246', '#1c2a52', '#24345c'], light='#8090c8',
                 lift_to='#0c1430', rim='#c0d4ff', shade=(0.75, 0.78, 0.92), depth=('#2a3458', '#323e64'),
                 haze='#24345c', snow='#a8b8e0', front=(0.9, 0.9, 0.95), stars=90),
        ),
    ),
    'dungeon': dict(
        makers=(gen.dungeon_tile_a, gen.dungeon_tile_b, gen.dungeon_start, gen.dungeon_mid,
                gen.dungeon_goal, gen.dungeon_far),
        outline='#1e1a26', depth_style='arches', sky_style='ceiling', depth_top=-4,
        tile_frames=dict(phases=PHASE_NAMES, mode='sway', rate=4, swaps={'torch': flickering_torch}),
        landmark_frames={'start': dict(phases=PHASE_NAMES, mode='sway', rate=4, swaps={'torch': flickering_torch}),
                         'mid': dict(phases=PHASE_NAMES, mode='flicker', rate=1),
                         'goal': dict(phases=PHASE_NAMES, mode='pulse', rate=1)},
        extras={'mid': [chest_sparkle], 'goal': [crystal_pulse]},
        lights={ph: {h(DU['flame']): None, h(DU['core']): None, h(DU['crystal']): None,
                     h(DU['crystal2']): None, '#c2a6ff': None, '#b6f4fa': None, '#f7d36b': None}
                for ph in PHASE_NAMES},
        phases=phases(
            dict(sky=['#2b2635', '#2f2a3a', '#332d40', '#383246', '#3d364c'], light='#d8d0e8',
                 lift_to='#1e1a26', lift=0.2, sat=1.05, rim='#e8e0ff', shade=(0.75, 0.75, 0.88),
                 depth=('#3a3348', '#433b52'), haze='#3d364c', shadow=(0.7, 0.7, 0.82), shadow_len=0.3,
                 sun=None, grates='#8a84a0', front=(1, 1, 1)),
            dict(sky=['#2e2532', '#33283a', '#382c40', '#3e3046', '#44344c'], light='#e8c8a0',
                 lift_to='#2a1a26', lift=0.25, sat=1.1, rim='#ffb060', shade=(0.7, 0.65, 0.82),
                 depth=('#3d3040', '#46384a'), haze='#44344c', shadow=(0.62, 0.58, 0.75), shadow_len=0.6,
                 sun=None, rays=False, grates='#a07a60', grate_strength=0.25, front=(1, 1, 1)),
            dict(sky=['#16121e', '#1a1522', '#1e1826', '#221b2a', '#261e2e'], light='#a090b8',
                 lift_to='#120e18', rim='#ffb060', shade=(0.7, 0.7, 0.85), side=1,
                 depth=('#221c2c', '#2a2234'), haze='#261e2e', shadow=(0.7, 0.7, 0.82), shadow_len=0.3,
                 moon=None, front=(0.92, 0.92, 0.95)),
        ),
    ),
    'space': dict(
        makers=(gen.space_tile_a, gen.space_tile_b, gen.space_start, gen.space_mid, gen.space_goal, gen.space_far),
        outline='#2a2f4a', depth_style='ridges', sky_style='space', shadow_from=30,
        tile_frames=dict(phases=PHASE_NAMES, mode='pulse', rate=1, swaps={'antenna': dark_antenna}),
        landmark_frames={'goal': dict(phases=PHASE_NAMES, mode='pulse', rate=1),
                         'far': dict(phases=PHASE_NAMES, mode='pulse', rate=1)},
        extras={'goal': [replace_colors({h(SP['red']): '#5a3a40'}, (28, 4, 37, 13))],
                'far': [replace_colors({h(SP['red']): '#5a3a40'}, (28, 1, 37, 10))]},
        landmark_vents={'start': [[20, 63], [44, 63]]},
        smoke='#e8ecf2',
        lights={'night': {h(SP['glass']): '#ffe08a', h(SP['red']): None}},
        phases=phases(
            dict(sky=['#0a0d1c', '#0e1224', '#12172c', '#161c34', '#1a213c'], light='#ffffff',
                 lift_to='#141a33', lift=0.1, sat=1.1, rim='#ffffff', shade=(0.6, 0.62, 0.75),
                 depth=('#3a3e58', '#4a4e66'), haze='#1a213c', shadow=(0.6, 0.62, 0.72), shadow_len=0.6,
                 sun=(150, 14), stars=60),
            dict(sky=['#0c1024', '#10162c', '#141c36', '#182240', '#1e2a4a'], light='#d0e0ff',
                 lift_to='#141a33', lift=0.2, sat=1.1, rim='#9fc8ff', shade=(0.65, 0.68, 0.82),
                 depth=('#2e3452', '#3a4060'), haze='#1e2a4a', shadow=(0.62, 0.64, 0.76), sun=None,
                 rays=False, earthrise=(150, 62), stars=60, front=(1, 1, 1)),
            dict(sky=['#06080f', '#080b16', '#0b0f1e', '#0e1326', '#12182e'], light='#8a90b8',
                 lift_to='#06080f', lift=0.3, rim='#c0d0ff', shade=(0.72, 0.74, 0.88),
                 depth=('#1e2238', '#262a42'), haze='#12182e', shadow=(0.7, 0.72, 0.84), stars=90,
                 front=(0.92, 0.92, 0.95)),
        ),
    ),
    'ocean': dict(
        makers=(gen.ocean_tile_a, gen.ocean_tile_b, gen.ocean_start, gen.ocean_mid, gen.ocean_goal, gen.ocean_far),
        outline='#1f4a66', depth_style='shelves', sky_style='water',
        tile_frames=dict(phases=PHASE_NAMES, mode='sway', rate=1.2, swaps={'kelp': swaying_kelp}),
        lights={'night': {h(OC['glass']): '#ffe08a', '#f8d0d6': '#ff9ad0', h(OC['pearl']): None}},
        phases=phases(
            dict(sky=['#3a8cbc', '#3584b4', '#307cac', '#2b74a4', '#276e9c'], light='#e8fbff',
                 lift_to='#103a5a', lift=0.15, sat=1.1, rim='#c8f4ff', shade=(0.75, 0.85, 0.95),
                 depth=('#2f6f96', '#2a6890'), haze='#276e9c', shadow=(0.75, 0.82, 0.9), sun=None,
                 beams='#bfeaff'),
            dict(sky=['#d89a5a', '#b88a66', '#7a7e80', '#46708c', '#2a6690'], light='#ffd8a8',
                 lift_to='#2a3050', lift=0.25, sat=1.1, rim='#ffc880', shade=(0.7, 0.72, 0.88),
                 depth=('#3a6080', '#40688a'), haze='#2a6690', shadow=(0.66, 0.66, 0.82), shadow_len=0.7,
                 sun=None, rays=False, front=(1, 1, 1)),
            dict(sky=['#081428', '#0a1830', '#0c1c38', '#0e2040', '#102448'], light='#5a7ab0',
                 lift_to='#061020', rim='#80c8ff', shade=(0.72, 0.78, 0.92), depth=('#0c2038', '#102640'),
                 haze='#102448', shadow=(0.7, 0.74, 0.86), moon=(170, 0), front=(0.92, 0.92, 0.96)),
        ),
    ),
    'neon': dict(
        makers=(gen.neon_tile_a, gen.neon_tile_b, gen.neon_start, gen.neon_mid, gen.neon_goal, gen.neon_far),
        outline='#1c1828', depth_style='skyline', stand=gen.NEON_GROUND + 1,
        tile_frames=dict(phases=('sunset', 'night'), mode='flicker', rate=1, swaps={'neon_sign': dark_sign}),
        landmark_frames={'goal': dict(phases=('sunset', 'night'), mode='flicker', rate=1,
                                      swaps={'neon_sign': dark_sign}),
                         'far': dict(phases=PHASE_NAMES, mode='pulse', rate=1)},
        extras={'far': [crane_light]},
        vents={'tile_a': [[88, 49]], 'tile_b': [[147, 49]]},
        smoke='#c8c0d8',
        swaps={'day': {h(NE['pink']): '#5a5068', h(NE['cyan']): '#4e5a68', h(NE['lime']): '#58604e',
                       h(NE['lit']): '#8a8ea0', h(NE['tv']): '#8a8ea0', h(NE['far_lit']): h(NE['far']),
                       # signs off by day: the wet road just looks wet
                       h(NE['ref_pink']): h(NE['ground']), h(NE['ref_cyan']): h(NE['ground']),
                       h(NE['ref_lime']): h(NE['ground'])}},
        lights={ph: {h(NE['pink']): None, h(NE['cyan']): None, h(NE['lime']): None, h(NE['lit']): None,
                     h(NE['tv']): None, h(NE['far_lit']): None, h(NE['glint']): None, '#ff5050': None,
                     h(NE['ref_pink']): None, h(NE['ref_cyan']): None, h(NE['ref_lime']): None}
                for ph in ('sunset', 'night')},
        flicker=[h(NE['lit'])], window_lit=h(NE['lit']),
        phases=phases(
            dict(sky=['#8a8e9c', '#969aa6', '#a2a5b0', '#adb0ba', '#b8bac2'], light='#e0e2ea',
                 lift_to='#3a3a4a', lift=0.2, sat=0.85, rim='#f0f0f4', shade=(0.82, 0.84, 0.92),
                 depth=('#6e7080', '#7e8090'), haze='#b8bac2', shadow=(0.85, 0.86, 0.9), shadow_len=0.15,
                 sun=None),
            dict(sky=['#e0705a', '#e8866a', '#ee9e7a', '#f2b48c', '#f4c8a0'], light='#ffc8a0',
                 lift_to='#4a2a50', rim='#ff9a70', depth=('#6a4060', '#7a4a68'), haze='#f4c8a0',
                 far_windows='#f0d27a', front=(1, 1, 1)),
            dict(sky=['#1c1630', '#221a3a', '#2c2046', '#3c2652', '#52305e'], light='#9a90c8',
                 lift_to='#1c1630', lift=0.3, sat=1.05, rim='#ff8fd0', shade=(0.75, 0.72, 0.9),
                 depth=('#2a2246', '#33295a'), haze='#382a56', far_windows='#f0d27a', stars=20,
                 front=(0.92, 0.92, 0.95)),
        ),
    ),
}


# ---------------------------------------------------------------- ambient sprites
def ambient_sprites():
    os.makedirs(AMBIENT_OUT, exist_ok=True)
    sizes = {}

    def save(name, w, hgt, px):
        write_png(os.path.join(AMBIENT_OUT, name), w, hgt, lambda x, y: px.get((x, y)))
        sizes[name] = [w, hgt]

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

    # Birds of a few kinds, each with two wing frames: up (a "v") and down
    def bird(name, body, tip=None):
        up = {q: body for q in ((0, 0), (1, 1), (2, 2), (3, 2), (4, 2), (5, 1), (6, 0))}
        down = {q: body for q in ((0, 3), (1, 2), (2, 2), (3, 2), (4, 2), (5, 2), (6, 3))}
        if tip:
            up[(0, 0)] = up[(6, 0)] = tip
            down[(0, 3)] = down[(6, 3)] = tip
        save(f'{name}_up', 7, 4, up)
        save(f'{name}_down', 7, 4, down)

    bird('bird', hexc('#3a2f45'))
    bird('gull', hexc('#f4f6f8'), hexc('#5a5f6a'))
    bird('pigeon', hexc('#7a7f8c'), hexc('#4a4f5a'))
    bird('bat', hexc('#2a2036'))

    # Eagle: broad wings, two frames
    brown, white = hexc('#6a4a32'), hexc('#f3ebe0')
    wings_up = {(x, 2 - min(2, abs(x - 6) // 2)) for x in range(0, 13)} | {(x, 3) for x in range(4, 9)}
    wings_flat = {(x, 3) for x in range(0, 13)} | {(x, 2) for x in range(3, 10)}
    for name, wings in (('eagle_up', wings_up), ('eagle_down', wings_flat)):
        px = {q: brown for q in wings}
        px[(6, 1)] = px[(7, 1)] = white  # head
        px[(6, 4)] = brown
        save(name, 13, 5, px)

    # Shooting star going down-left: the bright head at the bottom left,
    # its tail fading up to the right
    star = {}
    for i in range(12):
        c = lerp((255, 255, 255), (160, 175, 230), i / 11)
        if i < 4 or dither(i, 0, 1 - i / 12):
            star[(i, 6 - i // 2)] = (*clamp(c), 255 if i < 6 else 170)
    star[(0, 5)] = (255, 255, 255, 200)
    save('shooting_star', 12, 7, star)

    # Satellite: a body with two solar panels
    sat = {}
    for x in range(0, 4):
        for y in range(1, 4):
            sat[(x, y)] = hexc('#3f6fd8')
            sat[(x + 7, y)] = hexc('#3f6fd8')
    for x in range(4, 7):
        sat[(x, 2)] = hexc('#c8ccd8')
    sat[(5, 1)] = sat[(5, 3)] = hexc('#c8ccd8')
    save('satellite', 11, 5, sat)

    # Plane seen from below at night: a dark shape, its light on or off
    for name, lit in (('plane_on', True), ('plane_off', False)):
        px = {(x, 2): hexc('#3a3f52') for x in range(0, 11)}
        px.update({(x, y): hexc('#3a3f52') for x in (4, 5, 6) for y in (0, 1, 3, 4)})
        px[(10, 1)] = hexc('#3a3f52')
        if lit:
            px[(0, 2)] = hexc('#ff5050')
            px[(5, 2)] = hexc('#ffffff')
        save(name, 11, 5, px)

    # Sailboat on the horizon
    boat = {}
    for x in range(1, 10):
        boat[(x, 8)] = hexc('#8a5a3c')
    for x in range(2, 9):
        boat[(x, 9)] = hexc('#6a4430')
    for y in range(1, 8):
        boat[(5, y)] = hexc('#5a4a3a')
        for x in range(6, 6 + (7 - y) // 2 + 1):
            boat[(x, y)] = hexc('#f8f4ec')
        for x in range(5 - (y - 1) // 3, 5):
            boat[(x, y)] = hexc('#e8dcc8')
    save('sailboat', 11, 10, boat)

    # Moon's reflection on the sea, two shimmer frames
    for k in (0, 1):
        px = {}
        for y in range(10):
            half = 1 + y // 3
            for x in range(6 - half, 6 + half + 1):
                if dither(x + k * 2, y + k, 0.6 - y * 0.04) and (x + y + k) % 3:
                    px[(x, y)] = (240, 240, 210, 220)
        save(f'moon_glint_{k}', 13, 10, px)

    # Aurora: two frames of a soft green curtain, see-through
    for k in (0, 1):
        px = {}
        for x in range(128):
            top = 4 + round(3 * math.sin(x / 11 + k * 1.3) + 2 * math.sin(x / 5 + k))
            for y in range(top, top + 10):
                t = (y - top) / 10
                if dither(x, y, 0.55 * (1 - t)):
                    c = lerp(hexc('#7affb0'), hexc('#7aa8ff'), t)
                    px[(x, y)] = (*clamp(c), 150)
        save(f'aurora_{k}', 128, 20, px)

    # Fish (for schools) and a jellyfish
    for name, body in (('fish_yellow', hexc('#f7c948')), ('fish_orange', hexc('#f08a5a'))):
        px = {(x, y): body for x in range(1, 5) for y in range(0, 3)}
        px.pop((1, 0)), px.pop((1, 2))
        px[(0, 0)] = px[(0, 2)] = body  # tail
        px[(4, 1)] = hexc('#1f2a3a')  # eye
        save(name, 5, 3, px)
    for k in (0, 1):
        bell, glow, tent = hexc('#e8a8ff'), hexc('#ffd8ff'), hexc('#c890e8')
        px = {}
        width = 6 if k == 0 else 5
        for x in range(width):
            for y in range(0, 3):
                if not (y == 0 and x in (0, width - 1)):
                    px[(x + (6 - width) // 2, y)] = bell
        px[(2, 1)] = glow
        for x in (1, 3, 5) if k == 0 else (1, 2, 4):
            for y in range(3, 7 + (x % 2)):
                if (y + x + k) % 3:
                    px[(x, y)] = tent
        save(f'jelly_{k}', 7, 8, px)

    # Sunbeams under the water: two frames that shimmer
    for k in (0, 1):
        px = {}
        for b, x0 in enumerate((20, 70, 128, 180, 230)):
            for y in range(SKY_FULL_H):
                for x in range(x0 - round(y * 0.25), x0 - round(y * 0.25) + 4 + b % 2 * 2):
                    if dither(x + k, y + k * 2, 0.4 * (1 - y / SKY_FULL_H)):
                        px[(x % SKY_W, y)] = (220, 248, 255, 150)
        save(f'sunbeams_{k}', SKY_W, SKY_FULL_H, px)

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
            frames = v['tileFrames']
            lframes = v['landmarkFrames']
            lines += [
                f'      {ph}: {{',
                f"        sky: '{v['sky']}', skyInk: '{v['skyInk']}', statusBar: '{v['statusBar']}',",
                f"        ground: '{v['ground']}', ink: '{v['ink']}', shadowColor: '{v['shadowColor']}',",
                f"        smokeColor: '{v['smokeColor']}', windowAlt: '{v['windowAlt']}',",
                f"        tiles: [{req('tile_a')}, {req('tile_b')}],",
                (f"        tileFrames: {{ sources: [{req('tile_a_b')}, {req('tile_b_b')}], "
                 f"mode: '{frames['mode']}', rate: {frames['rate']} }}," if frames else '        tileFrames: null,'),
                f"        landmarks: [{', '.join(req(n) for n in LANDMARK_NAMES)}],",
                '        landmarkFrames: [' + ', '.join(
                    f"{{ source: {req(n + '_b')}, mode: '{f['mode']}', rate: {f['rate']} }}" if f else 'null'
                    for n, f in zip(LANDMARK_NAMES, lframes)) + '],',
                f"        landmarkShadows: [{', '.join(req(n + '_shadow') for n in LANDMARK_NAMES)}],",
                f"        shadowBoxes: {json.dumps([v['shadows'][n] for n in LANDMARK_NAMES])},",
                f"        skyImage: {req('sky')},",
                f"        depth: [{req('depth_far')}, {req('depth_near')}],",
                f"        stars: {json.dumps(v['stars'])},",
                f"        avatarMatrix: {json.dumps(v['avatarMatrix'])},",
                f"        shadowLength: {v['shadowLength']},",
                f"        walkerShadow: {{ source: {req('walker_shadow')}, "
                + ', '.join(f'{k}: {n}' for k, n in v['walkerShadow'].items()) + ' },',
                '      },',
            ]
        lines.append('    },')
        lines.append(f"    chimneys: {json.dumps(e['chimneys'])},")
        lines.append(f"    landmarkChimneys: {json.dumps(e['landmarkChimneys'])},")
        lines.append(f"    windows: {json.dumps(e['windows'])},")
        lines.append(f"    landmarkWindows: {json.dumps(e['landmarkWindows'])},")
        lines.append(f"    depthTop: {e['depthTop']},")
        lines.append(f"    horizon: {json.dumps(e['horizon'])},")
        lines.append(f"    clock: {json.dumps(e['clock'])},")
        lines.append('  },')
    lines.append('};')
    lines.append('')
    lines.append('export const AMBIENT_SPRITES = {')
    for name, (w, hgt) in sprites.items():
        lines.append(f"  {name}: {{ source: require('@/assets/ambient/{name}.png'), width: {w}, height: {hgt} }},")
    lines.append('};')
    with open(TS_OUT, 'w') as f:
        f.write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    only = sys.argv[1:]  # optional: just these maps (the table still needs all of them)
    entries = {}
    for key, cfg in THEMES.items():
        if only and key not in only:
            continue
        entries[key] = build_theme(key, cfg)
        print(f'  {key}')
    sprites = ambient_sprites()
    if not only:
        ts_table(entries, sprites)
    print(f'Wrote lighting for {len(entries)} maps and {len(sprites)} ambient sprites')
