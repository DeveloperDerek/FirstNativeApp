#!/usr/bin/env python3
"""
Checks the art in assets/ against docs/art-spec.md before it goes in the
app: canvas sizes, the 1x/2x/3x map copies, grayscale on the layers the
app tints, and the body's feet on the right row. Prints one line per
problem and exits 1 if there are any.

Old pixel art (1 pixel per unit) and new art (any whole multiple) both
pass, so the art can be swapped a few files at a time.

Usage: python3 scripts/check-art.py
"""
import glob
import os
import struct
import sys
import zlib

ASSETS = os.path.join(os.path.dirname(__file__), '..', 'assets')

# Sizes in layout units (see src/avatar/Avatar.tsx, pets.ts, achievement-badge.tsx)
AVATAR_W, AVATAR_H = 32, 56
FEET_ROW = 54  # last row of the feet, in units: 8 headroom + row 46
PET = 16
BADGE = 22
SOLID = 128  # alpha at or above this counts as covered (as in pet-spot.ts)
GRAY_TOLERANCE = 10  # how far apart r, g and b may be on a tinted layer

problems = []


def problem(path, message):
    problems.append(f'{os.path.relpath(path, ASSETS)}: {message}')


# ---------------------------------------------------------------- PNG reading
def read_png(path):
    """(width, height, rows of (r, g, b, a) tuples). 8-bit, non-interlaced only."""
    with open(path, 'rb') as f:
        data = f.read()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a PNG')
    pos, idat, palette, trns = 8, b'', None, None
    while pos < len(data):
        length, kind = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b'IHDR':
            w, h, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', body)
        elif kind == b'PLTE':
            palette = [tuple(body[i:i + 3]) for i in range(0, len(body), 3)]
        elif kind == b'tRNS':
            trns = body
        elif kind == b'IDAT':
            idat += body
    if depth != 8 or interlace:
        raise ValueError(f'save as 8-bit, non-interlaced (this is {depth}-bit, interlace {interlace})')
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    raw = zlib.decompress(idat)
    stride = w * channels
    rows, prev = [], bytearray(stride)
    for y in range(h):
        filt = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if filt == 1:
                line[i] = (line[i] + a) & 0xFF
            elif filt == 2:
                line[i] = (line[i] + b) & 0xFF
            elif filt == 3:
                line[i] = (line[i] + (a + b) // 2) & 0xFF
            elif filt == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 0xFF
        prev = line
        px = []
        for x in range(w):
            v = line[x * channels:(x + 1) * channels]
            if color == 6:
                px.append(tuple(v))
            elif color == 2:
                px.append((v[0], v[1], v[2], 255))
            elif color == 4:
                px.append((v[0], v[0], v[0], v[1]))
            elif color == 0:
                px.append((v[0], v[0], v[0], 255))
            else:
                alpha = trns[v[0]] if trns and v[0] < len(trns) else 255
                px.append((*palette[v[0]], alpha))
        rows.append(px)
    return w, h, rows


def png_size(path):
    """(width, height) from the PNG header, without decoding the pixels."""
    with open(path, 'rb') as f:
        head = f.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a PNG')
    return struct.unpack('>II', head[16:24])


def load(path, pixels=True):
    """read_png(), or just (width, height) without pixels; None if unreadable."""
    try:
        return read_png(path) if pixels else png_size(path)
    except Exception as e:  # noqa: BLE001 - report and keep checking the rest
        problem(path, f"can't read: {e}")
        return None


def multiple_of(path, w, h, unit_w, unit_h):
    """The whole-number scale of a w x h image over a unit_w x unit_h canvas, or None."""
    if w % unit_w or w * unit_h != h * unit_w:
        problem(path, f'is {w} x {h}; must be {unit_w} x {unit_h} times a whole number '
                      f'(e.g. {unit_w * 8} x {unit_h * 8})')
        return None
    return w // unit_w


# ---------------------------------------------------------------- checks
def check_avatar():
    scales = {}
    for path in sorted(glob.glob(os.path.join(ASSETS, 'avatar', '*.png'))):
        png = load(path)
        if not png:
            continue
        w, h, rows = png
        k = multiple_of(path, w, h, AVATAR_W, AVATAR_H)
        if k is None:
            continue
        scales.setdefault(k, []).append(os.path.basename(path))
        name = os.path.basename(path)
        if name == 'body_base.png' or name.startswith('hair_'):
            off = sum(1 for row in rows for r, g, b, a in row
                      if a >= SOLID and max(r, g, b) - min(r, g, b) > GRAY_TOLERANCE)
            if off:
                problem(path, f'the app tints this layer, so it must be grayscale; '
                              f'{off} pixels have color')
        if name == 'body_base.png':
            solid = [y for y, row in enumerate(rows) if any(p[3] >= SOLID for p in row)]
            if solid:
                feet = solid[-1] // k
                if abs(feet - FEET_ROW) > 1:
                    problem(path, f'feet end on unit row {feet}; must be {FEET_ROW} '
                                  f'(pixel row {FEET_ROW * k} of {h})')
    if len(scales) > 1:
        # Allowed while the art is being replaced, but worth knowing
        summary = ', '.join(f'{len(v)} at {k}x' for k, v in sorted(scales.items()))
        print(f'note: avatar layers are at mixed sizes ({summary})')


def check_pets():
    for path in sorted(glob.glob(os.path.join(ASSETS, 'pets', '*_a.png'))):
        other = path[:-6] + '_b.png'
        a = load(path, pixels=False)
        if a:
            multiple_of(path, a[0], a[1], PET, PET)
        if not os.path.exists(other):
            problem(path, f'has no second walk frame {os.path.basename(other)}')
            continue
        b = load(other, pixels=False)
        if a and b and (a[0], a[1]) != (b[0], b[1]):
            problem(other, f'is {b[0]} x {b[1]}; must match frame a ({a[0]} x {a[1]})')


def check_badges():
    for path in sorted(glob.glob(os.path.join(ASSETS, 'badges', '*.png'))):
        png = load(path, pixels=False)
        if png:
            multiple_of(path, png[0], png[1], BADGE, BADGE)


def check_maps():
    for path in sorted(glob.glob(os.path.join(ASSETS, 'maps', '*', '*.png'))):
        if '@' in os.path.basename(path):
            continue
        base = load(path, pixels=False)
        if not base:
            continue
        for n in (2, 3):
            copy = path[:-4] + f'@{n}x.png'
            if not os.path.exists(copy):
                problem(path, f'has no @{n}x copy')
                continue
            png = load(copy, pixels=False)
            if png and (png[0], png[1]) != (base[0] * n, base[1] * n):
                problem(copy, f'is {png[0]} x {png[1]}; must be {base[0] * n} x {base[1] * n} '
                              f'({n} times {os.path.basename(path)})')


check_avatar()
check_pets()
check_badges()
check_maps()
for p in problems:
    print(p)
print(f'{len(problems)} problem(s)' if problems else 'art OK')
sys.exit(1 if problems else 0)
