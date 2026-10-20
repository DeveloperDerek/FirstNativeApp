#!/usr/bin/env python3
"""
The casino behind the Daily Roll ("Pixel Art 2.5D").

Writes assets/roll/casino.png (and @2x, @3x): a 150 x 320 pixel-art hall
at night, drawn at 3 points per art pixel so it covers any phone at
450 x 960 points. The app centers it behind the screen and lets the edges
crop. Only a ceiling and a floor, casino emerald with gold lights (the
red machine stands out most against green): a beamed ceiling with
spotlights in its coffers, a polished tiled floor that mirrors them,
and the hall fading to dark where the two meet. No props; the machine
(and its shadow, drawn by the app) is the only thing in the room.

How it is drawn: ceiling and floor are two planes in one-point
perspective; each pixel finds the plane it looks at and is painted flat.
The spotlights then add a warm glow, and each is mirrored in the floor.
Last, the picture is fitted to a small palette with a 4 x 4 ordered
dither, so light falls off in hard pixel bands rather than smooth
gradients.

Usage: python3 scripts/generate-roll-background.py [scheme] [out folder]
(scheme is one of THEMES; emerald, into assets/roll/, by default)
"""
import math
import os
import struct
import sys
import zlib

W, H = 150, 320
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'roll')


def hexc(s):
    return tuple(int(s[i:i + 2], 16) for i in (1, 3, 5))


GOLD = ['#4a2a14', '#6b3a14', '#93541a', '#bd7a24', '#e0a43a', '#f7cc62', '#ffe9a8']

# Color schemes: the darks of the room, its ceiling and floor colors, and
# the color the floor reflects. Every scheme keeps the gold spotlights.
THEMES = {
    'plum': {
        'darks': ['#0b0710', '#130a17', '#1b0e1e', '#241226', '#2f162d', '#3c1b33', '#4b2139',
                  '#5c2a40', '#3a1418', '#521c22'],
        'ceil': '#291430', 'beam': '#3c1b33', 'floor': '#241226', 'seam': '#3c1b33',
        'reflect': '#ffb050', 'accents': [],
    },
    'violet': {
        'darks': ['#07051a', '#0d0926', '#140b33', '#1c1045', '#251757', '#2e1a6b', '#3a2386',
                  '#4b2fa0'],
        'ceil': '#1c1045', 'beam': '#2e1a6b', 'floor': '#140b33', 'seam': '#3a2386',
        'reflect': '#ff4fb0', 'accents': ['#4a1650', '#7a2272', '#b03490', '#e84aa8', '#ff8fd0'],
    },
    'emerald': {
        'darks': ['#020d0a', '#041611', '#06231d', '#0a2e25', '#0e3b30', '#14493b', '#1a5946',
                  '#1f6b52'],
        'ceil': '#0a2e25', 'beam': '#14493b', 'floor': '#06231d', 'seam': '#1a5946',
        'reflect': '#ffc860', 'accents': ['#1f2a12', '#3a3a16', '#5e5220', '#8a7228', '#b8963a'],
    },
    'arcade': {
        'darks': ['#04061a', '#070b24', '#0a1030', '#0f173f', '#131d4d', '#16245c', '#1d3070',
                  '#263d88'],
        'ceil': '#0f173f', 'beam': '#1d3070', 'floor': '#0a1030', 'seam': '#1d3070',
        'reflect': '#3de0ff', 'accents': ['#0c3a5a', '#11607e', '#1f8fae', '#34c2dc', '#8aefff'],
    },
}
THEME = THEMES[sys.argv[1] if len(sys.argv) > 1 else 'emerald']
if len(sys.argv) > 2:
    OUT = sys.argv[2]
PALETTE = [hexc(c) for c in THEME['darks'] + THEME['accents'] + GOLD]

BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]

# World units: x across, y down (ceiling CEIL, floor FLOOR), z depth.
# A point lands on screen at VP + (world - VP) / z.
VPX, VPY = 75, 128
CEIL, FLOOR = -40, 240
BEAM = 46  # coffer width across
ROW = 0.55  # coffer depth


def proj(wx, wy, z):
    return VPX + (wx - VPX) / z, VPY + (wy - VPY) / z


img = [[(0.0, 0.0, 0.0)] * W for _ in range(H)]
emit = [[False] * W for _ in range(H)]
gloss = [[0.0] * W for _ in range(H)]

for y in range(H):
    for x in range(W):
        px, py = x + 0.5, y + 0.5
        if py < VPY:
            z = (VPY - CEIL) / (VPY - py)
            wx = VPX + (px - VPX) * z
            beam = (wx - VPX - BEAM / 2) % BEAM < 5 or z % ROW < 0.07
            c = hexc(THEME['beam'] if beam else THEME['ceil'])
        else:
            z = (FLOOR - VPY) / max(0.01, py - VPY)
            wx = VPX + (px - VPX) * z
            # big polished tiles; the seams are a touch lighter
            seam = (wx - VPX - BEAM / 2) % BEAM < 1.6 * z ** 0.5 or z % 0.42 < 0.012 * z * z
            c = hexc(THEME['seam'] if seam else THEME['floor'])
            gloss[y][x] = 0.55 if seam else 1.0
        fog = 1.3 / (1 + (z - 1) * 0.32)  # far away sinks into the dark
        img[y][x] = tuple(v * min(1.0, fog) for v in c)


# Spotlights in the coffers: (x, y, z, radius, strength).
LIGHTS = []
HIDDEN = []  # lights behind the machine: only their shine on the floor shows
SHINE_FROM = 236  # that shine starts below the machine's feet
LIGHTS_BELOW = 48  # no spotlight lower than this row
for z in [1.0 + ROW * (i + 0.5) for i in range(7)]:
    for wx in [VPX + BEAM * j for j in (-2, -1, 1, 2)]:
        x, y = proj(wx, CEIL, z)
        # only the near lights, high above the machine's sign
        if -6 <= x < W + 6:
            light = (x, y + 1, z, 40 / z, 1.2 / (1 + (z - 1) * 0.4))
            (LIGHTS if y < LIGHTS_BELOW else HIDDEN).append(light)
for x, y, z, _, _ in LIGHTS:
    r = max(0.6, 4.5 / z)
    for yy in range(math.floor(y - 1), math.ceil(y + 1.2)):
        for xx in range(math.floor(x - r), math.ceil(x + r)):
            if 0 <= xx < W and 0 <= yy < H:
                bright = abs(xx + 0.5 - x) < r * 0.5 and z < 3
                img[yy][xx] = hexc('#ffe9a8' if bright else '#f7cc62')
                emit[yy][xx] = True

AMBER = hexc('#ffb050')
REFLECT = hexc(THEME['reflect'])
SHINE = THEME.get('shine', ['#b8963a', '#8a7228', '#5e5220'])  # brightest first


def glow_at(x, y):
    t = 0.0
    for lx, ly, _, rad, s in LIGHTS:
        d = math.hypot(x - lx, (y - ly) * 1.3)
        if d < rad:
            t += s * (1 - d / rad) ** 2.2
    return t


def reflection_at(x, y):
    """Each spotlight mirrored in the polished floor, stretched into a streak."""
    t = 0.0
    for lx, ly, z, rad, s in LIGHTS:
        floor_y = VPY + (FLOOR - VPY) / z
        my = 2 * floor_y - ly  # the mirror image
        dy = (y - my) / (rad * 1.5 + 8 / z)
        dx = (x - lx) / (1.2 + rad * 0.09)
        t += s * 1.1 * math.exp(-dx * dx - dy * dy * 0.6)
    if y > SHINE_FROM:
        fade = min(1.0, (y - SHINE_FROM) / 16)
        for lx, ly, z, rad, s in HIDDEN:
            floor_y = VPY + (FLOOR - VPY) / z
            dy = (y - (2 * floor_y - ly)) / (rad * 1.5 + 8 / z)
            dx = (x - lx) / (1.4 + rad * 0.1)
            t += fade * s * 1.1 * math.exp(-dx * dx - dy * dy * 0.6)
    return t


def quiet(x, y):
    """A little darker in the middle, behind the machine (0 to 1)."""
    d = math.hypot((x - W / 2) / 50, (y - 150) / 110)
    return max(0.0, 1 - d) ** 0.8 * 0.35


for y in range(H):
    for x in range(W):
        if emit[y][x]:
            continue
        c = img[y][x]
        g = glow_at(x + 0.5, y + 0.5)
        r = reflection_at(x + 0.5, y + 0.5) * gloss[y][x] if gloss[y][x] else 0.0
        if gloss[y][x]:
            g *= 0.25
        c = tuple(c[i] * (1 + g * 0.6) + AMBER[i] * g * 0.4 for i in range(3))
        a = min(0.35, r * 0.25)  # a faint wash around the shine
        c = tuple(c[i] * (1 - a) + REFLECT[i] * 0.35 * a for i in range(3))
        if r > 0.7 and (y // 2) % 3 != 0:  # crisp glints, broken like ripples
            c = hexc(SHINE[0 if r > 1.5 else 1 if r > 1.05 else 2])
            emit[y][x] = True  # already final: no dither, no darkening
        k = (1 - quiet(x, y)) * (1 - max(0, (y - 280) / 40) * 0.3)
        img[y][x] = tuple(v * k for v in c)


def nearest(c):
    best, bd = None, 1e18
    for p in PALETTE:
        d = 2 * (c[0] - p[0]) ** 2 + 4 * (c[1] - p[1]) ** 2 + 3 * (c[2] - p[2]) ** 2
        if d < bd:
            best, bd = p, d
    return best


pixels = []
for y in range(H):
    row = []
    for x in range(W):
        t = (BAYER[y % 4][x % 4] + 0.5) / 16 - 0.5
        spread = 4 if emit[y][x] else 14
        row.append(nearest(tuple(v + t * spread for v in img[y][x])))
    pixels.append(row)


def write(name, scale):
    rows = []
    for row in pixels:
        line = b''.join(bytes(p) * scale for p in row)
        rows.append((b'\x00' + line) * scale)

    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))

    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', W * scale, H * scale, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(b''.join(rows), 9))
        + chunk(b'IEND', b'')
    )
    with open(os.path.join(OUT, name), 'wb') as f:
        f.write(png)


os.makedirs(OUT, exist_ok=True)
write('casino.png', 3)
write('casino@2x.png', 6)
write('casino@3x.png', 9)
