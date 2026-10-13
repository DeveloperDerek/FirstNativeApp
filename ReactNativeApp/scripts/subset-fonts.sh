#!/usr/bin/env bash
# Shrinks the Maplestory fonts by leaving out the Korean characters (about
# 11,000 of their 12,000 glyphs; 1.4 MB -> 0.2 MB each). Latin, symbols,
# arrows and punctuation stay; names, metrics and kerning are unchanged, so
# text looks the same. Korean in display names falls back to the phone's
# own font. Run it on the original font files, e.g. after replacing them:
#   pip install fonttools && bash scripts/subset-fonts.sh path/to/originals
set -euo pipefail

SRC=${1:?folder with the original Maplestory-Light.ttf and Maplestory-Bold.ttf}
OUT=$(dirname "$0")/../assets/fonts

# Everything but Hangul: jamo (1100-11FF), compatibility jamo (3130-318F),
# parenthesized and circled Hangul (3200-321F, 3260-327F), syllables
# (AC00-D7AF) and half-width Hangul (FFA0-FFDF).
UNICODES='U+0000-10FF,U+1200-2FFF,U+3000-312F,U+3190-31FF,U+3220-325F,U+3280-ABFF,U+D7B0-FF9F,U+FFE0-FFFF'

for w in Light Bold; do
  pyftsubset "$SRC/Maplestory-$w.ttf" --output-file="$OUT/Maplestory-$w.ttf" \
    --unicodes="$UNICODES" --layout-features='*' --name-IDs='*' --name-languages='*' \
    --name-legacy --legacy-kern --notdef-outline --glyph-names --hinting
done
ls -l "$OUT"
