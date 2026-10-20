#!/usr/bin/env python3
"""Placeholder 8-bit sounds for the daily roll, written to assets/sounds/.

Square waves and noise, like an old console: swap any of these for a
real sound by dropping a file with the same name in.

    python3 scripts/generate-roll-sounds.py
"""
import math
import os
import random
import struct
import wave

RATE = 22050
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'sounds')


def square(freq, t, duty=0.5):
    return 1.0 if (freq * t) % 1.0 < duty else -1.0


def tone(freqs, ms, vol=0.35, duty=0.5, decay=0.0, slide=None):
    """One note per freq, back to back. slide: (from, to) sweeps one note."""
    out = []
    for f in freqs:
        n = int(RATE * ms / 1000)
        for i in range(n):
            t = i / RATE
            u = i / n
            hz = f if slide is None else slide[0] + (slide[1] - slide[0]) * u
            env = (1 - u) ** decay if decay else 1.0
            # 2 ms in and out so notes don't click
            env *= min(1.0, i / (RATE * 0.002), (n - i) / (RATE * 0.002))
            out.append(square(hz, t, duty) * vol * env)
    return out


def noise(ms, vol=0.3, decay=2.0, step=4):
    """Crunchy noise: holds each random value for `step` samples, like the NES."""
    rnd = random.Random(7)
    n = int(RATE * ms / 1000)
    v = 0.0
    out = []
    for i in range(n):
        if i % step == 0:
            v = rnd.uniform(-1, 1)
        out.append(v * vol * (1 - i / n) ** decay)
    return out


def mix(*tracks):
    n = max(len(t) for t in tracks)
    return [max(-1, min(1, sum(t[i] for t in tracks if i < len(t)))) for i in range(n)]


def silence(ms):
    return [0.0] * int(RATE * ms / 1000)


def save(name, samples):
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(s * 32767)) for s in samples))


# The lever: a clunk, then a ratchet
save('pull.wav', mix(noise(90, 0.4, 3, 8), tone([110], 90, 0.3, 0.25, 2, slide=(160, 70))) + noise(40, 0.15, 1, 2))
# One tile passing the line: a short blip
save('tick.wav', tone([1760], 18, 0.18, 0.25, 1.5))
# The reel stops: a low thunk
save('stop.wav', mix(tone([0], 120, 0.4, 0.5, 2.5, slide=(220, 55)), noise(60, 0.25, 3, 6)))
# A win: a rising arpeggio, C E G C
save('win.wav', tone([523, 659, 784], 70, 0.3, 0.5) + tone([1047], 260, 0.3, 0.5, 1.5))
# A big win: the arpeggio, then a fanfare trill
save(
    'win-big.wav',
    tone([523, 659, 784, 1047], 60, 0.3, 0.5)
    + tone([784, 1047] * 4, 45, 0.28, 0.25)
    + tone([1568], 380, 0.3, 0.5, 1.2),
)
# Coins out of the tray: a few two-note dings
coin = tone([988], 50, 0.25, 0.5) + tone([1319], 160, 0.25, 0.5, 2)
save('coins.wav', mix(coin, silence(90) + coin, silence(200) + coin, silence(330) + coin))
