#!/usr/bin/env node
/**
 * Draws the smooth default character (docs/art-spec.md) in code: the
 * body, the smile face, the spiky hair and the default outfit (red
 * hoodie, blue shorts, white sneakers), at 8x (256 x 448), into
 * assets/avatar/. A stand-in until the AI-made art replaces it, and the
 * pose reference for making that art: every shape keeps to the old pixel
 * body's outline, so the old pixel items still fit over it meanwhile.
 *
 * Uses CanvasKit, the same Skia the app draws with.
 *
 * Usage: node scripts/draw-base-art.mjs [name ...]   (default: all of them)
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const CK = await require('canvaskit-wasm/bin/full/canvaskit.js')();

const W = 256;
const H = 448;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'avatar');
const OUTLINE_W = 6; // outer outline width, in pixels

// Grays for the layers the app tints (body, hair): multiplying by the
// chosen color turns near-white into that color and keeps outlines dark.
const OUTLINE = [58, 58, 58];
const SKIN = { base: [242, 242, 242], shadow: [200, 200, 200], line: [150, 150, 150] };
const HAIR = { base: [226, 226, 226], shadow: [170, 170, 170], line: [140, 140, 140] };

/**
 * Tones for an item in color: the base, a shadow a little darker and
 * cooler (light is warm, shade is cool), and a line color for creases.
 */
function tones(hex) {
  const n = parseInt(hex.slice(1), 16);
  const base = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const shadow = base.map((v, i) => Math.round(v * 0.74 + (i === 2 ? 14 : 0)));
  const line = base.map((v) => Math.round(v * 0.55));
  return { base, shadow, line };
}

// ---------------------------------------------------------------- shapes
const color = ([r, g, b], a = 1) => CK.Color(r, g, b, a);

// Paths are immutable; a PathBuilder makes each one.
function build(draw, from) {
  const b = from ? new CK.PathBuilder(from) : new CK.PathBuilder();
  draw(b);
  return b.detachAndDelete();
}

function oval(cx, cy, rx, ry) {
  return build((b) => b.addOval(CK.LTRBRect(cx - rx, cy - ry, cx + rx, cy + ry)));
}

function rounded(x0, y0, x1, y1, r) {
  return build((b) => b.addRRect(CK.RRectXY(CK.LTRBRect(x0, y0, x1, y1), r, r)));
}

function union(...paths) {
  return paths.reduce((a, b) => CK.Path.MakeFromOp(a, b, CK.PathOp.Union));
}

function minus(a, b) {
  return CK.Path.MakeFromOp(a, b, CK.PathOp.Difference);
}

function shifted(p, dx, dy) {
  return build((b) => b.transform([1, 0, dx, 0, 1, dy, 0, 0, 1]), p);
}

/** The same shape mirrored around the canvas center. */
function mirrored(p) {
  return build((b) => b.transform([-1, 0, W, 0, 1, 0, 0, 0, 1]), p);
}

/** [x, y] to start, then [cx, cy, x, y] per quadratic segment. */
function curve(points, closed = false) {
  return build((b) => {
    b.moveTo(...points[0]);
    for (const seg of points.slice(1)) b.quadTo(...seg);
    if (closed) b.close();
  });
}

// ---------------------------------------------------------------- painting
function paint({ rgb, alpha = 1, stroke = 0, blur = 0 }) {
  const p = new CK.Paint();
  p.setAntiAlias(true);
  p.setColor(color(rgb, alpha));
  if (stroke) {
    p.setStyle(CK.PaintStyle.Stroke);
    p.setStrokeWidth(stroke);
    p.setStrokeJoin(CK.StrokeJoin.Round);
    p.setStrokeCap(CK.StrokeCap.Round);
  }
  if (blur) p.setMaskFilter(CK.MaskFilter.MakeBlur(CK.BlurStyle.Normal, blur, true));
  return p;
}

class Layer {
  constructor() {
    this.surface = CK.MakeSurface(W, H);
    this.canvas = this.surface.getCanvas();
    this.canvas.clear(CK.TRANSPARENT);
  }

  /**
   * One part: a dark outline around it, the base color, a shadow along
   * the bottom right (the light is top left) and an optional highlight.
   * Later parts cover earlier ones, so their outlines show the overlap.
   */
  part(shape, tones, { shadow = [-10, -12], highlight = null } = {}) {
    const c = this.canvas;
    c.drawPath(shape, paint({ rgb: OUTLINE, stroke: OUTLINE_W * 2 }));
    c.drawPath(shape, paint({ rgb: tones.base }));
    c.save();
    c.clipPath(shape, CK.ClipOp.Intersect, true);
    if (shadow) c.drawPath(minus(shape, shifted(shape, ...shadow)), paint({ rgb: tones.shadow, blur: 1.2 }));
    if (highlight) highlight(c);
    c.restore();
    return this;
  }

  /** A thin line inside a part (a crease, an ear, a strand of hair). */
  line(p, rgb, width = 3.5) {
    this.canvas.drawPath(p, paint({ rgb, stroke: width }));
    return this;
  }

  save(name) {
    const png = this.surface.makeImageSnapshot().encodeToBytes();
    writeFileSync(path.join(OUT, `${name}.png`), png);
    console.log(`wrote assets/avatar/${name}.png`);
  }
}

// ---------------------------------------------------------------- body
// Pixel coordinates on the 256 x 448 canvas. Fills stop OUTLINE_W short
// of the guides in docs/art-template.png so the outline lands on them.
const HEAD = oval(128, 178, 88, 84);
const EAR = oval(40, 186, 13, 17);

function body() {
  const layer = new Layer();
  const leg = rounded(92, 350, 124, 424, 12);
  const foot = curve([
    [84, 434],
    [82, 412, 104, 410],
    [126, 410, 126, 424],
    [127, 434, 116, 434],
  ], true);
  const legs = union(leg, mirrored(leg));
  const feet = union(foot, mirrored(foot));
  // A little narrower at the shoulders than the hips
  const torso = curve([
    [100, 278],
    [128, 270, 156, 278],
    [166, 320, 164, 362],
    [128, 368, 92, 362],
    [90, 320, 100, 278],
  ], true);
  const arm = union(
    curve([[96, 282], [72, 284, 70, 312], [68, 336, 70, 352], [90, 356, 90, 340], [90, 312, 100, 296]], true),
    oval(77, 360, 13, 13), // the hand, in the orange box
  );
  const neck = rounded(114, 248, 142, 286, 8);

  layer.part(legs, SKIN, { shadow: [-8, 0] });
  layer.part(feet, SKIN, { shadow: [0, -6] });
  // Arms under the torso, so the shoulders are one clean line
  layer.part(arm, SKIN, { shadow: [-8, -4] });
  layer.part(mirrored(arm), SKIN, { shadow: [-8, -4] });
  layer.part(torso, SKIN);
  layer.part(neck, SKIN, { shadow: [-8, 0] });
  // Ears go under the head so only their outer half shows
  for (const ear of [EAR, mirrored(EAR)]) {
    layer.part(ear, SKIN, { shadow: [-4, -4] });
  }
  layer.line(curve([[38, 176], [32, 188, 40, 198]]), SKIN.line, 3);
  layer.line(mirrored(curve([[38, 176], [32, 188, 40, 198]])), SKIN.line, 3);
  layer.part(HEAD, SKIN, {
    shadow: [-12, -14],
    highlight: (c) => c.drawPath(oval(84, 128, 26, 16), paint({ rgb: [255, 255, 255], alpha: 0.7, blur: 8 })),
  });
  layer.save('body_base');
}

// ---------------------------------------------------------------- faces (in color)
const EYE_DARK = [43, 30, 36];
const EYE_IRIS = [107, 69, 90];
const MOUTH = [138, 59, 59];
const BLUSH = [242, 156, 156];

function eye(layer, cx, cy) {
  const c = layer.canvas;
  const shape = oval(cx, cy, 13, 19);
  c.drawPath(shape, paint({ rgb: EYE_DARK }));
  c.save();
  c.clipPath(shape, CK.ClipOp.Intersect, true);
  c.drawPath(oval(cx, cy + 14, 14, 12), paint({ rgb: EYE_IRIS, blur: 2 }));
  c.restore();
  // Lashes: a heavier line along the top, a little wider than the eye
  layer.line(curve([[cx - 16, cy - 10], [cx, cy - 26, cx + 16, cy - 10]]), EYE_DARK, 5);
  c.drawPath(oval(cx - 4, cy - 7, 5.5, 6.5), paint({ rgb: [255, 255, 255] }));
  c.drawPath(oval(cx + 5, cy + 8, 2.5, 2.5), paint({ rgb: [255, 255, 255] }));
}

function faceSmile() {
  const layer = new Layer();
  eye(layer, 90, 192);
  eye(layer, 166, 192);
  for (const cx of [64, 192]) {
    layer.canvas.drawPath(oval(cx, 222, 14, 7), paint({ rgb: BLUSH, alpha: 0.75, blur: 3 }));
  }
  layer.line(curve([[116, 226], [128, 238, 140, 226]]), MOUTH, 4.5);
  layer.save('face_smile');
}

// ---------------------------------------------------------------- hair (grayscale)
function hairSpiky() {
  const layer = new Layer();
  // The cap: the top of the head, a little bigger than it
  const cap = minus(oval(128, 172, 100, 98), rounded(0, 150, W, H, 0));
  // Spikes leaning out from the middle, tall and short in turn
  const spikes = [
    [58, 92, -20],
    [94, 74, -10],
    [128, 64, 0],
    [162, 74, 10],
    [198, 92, 20],
  ].map(([cx, apex, lean]) => {
    return curve([
      [cx - 30, 124],
      [cx - 18 + lean / 2, apex + 26, cx + lean, apex],
      [cx + 10 + lean / 2, apex + 30, cx + 30, 124],
    ], true);
  });
  // Bangs: tufts pointing down over the forehead
  const bangs = [
    [50, 150, 82, 172],
    [78, 150, 110, 164],
    [108, 148, 140, 170],
    [138, 150, 170, 162],
    [166, 150, 206, 172],
  ].map(([x0, y0, x1, tip]) => {
    return curve([
      [x0, y0 - 20],
      [x0 + 4, y0 + 6, (x0 + x1) / 2 + 6, tip],
      [x1 - 2, y0 + 4, x1, y0 - 20],
    ], true);
  });
  // Sides down past the top of the ears
  const side = curve([[34, 120], [28, 170, 44, 204], [52, 180, 62, 140]], true);
  const hair = union(cap, ...spikes, ...bangs, side, mirrored(side));

  layer.part(hair, HAIR, {
    shadow: [-12, -16],
    highlight: (c) =>
      c.drawPath(
        curve([[64, 120], [96, 92, 140, 98]]),
        paint({ rgb: [255, 255, 255], stroke: 9, alpha: 0.95, blur: 1 }),
      ),
  });
  // A few strands
  layer.line(curve([[94, 112], [100, 132, 96, 150]]), HAIR.line);
  layer.line(curve([[128, 104], [130, 128, 124, 148]]), HAIR.line);
  layer.line(curve([[162, 112], [158, 132, 162, 150]]), HAIR.line);
  layer.save('hair_spiky');
}

// ---------------------------------------------------------------- clothes (in color)
// Tops are drawn over the body layer, head included, so they stay below
// the chin (y 268). Bottoms go under the top, shoes under both.

function topHoodieRed() {
  const layer = new Layer();
  const red = tones('#d9534f');
  const dark = tones('#b8433f');
  // Sleeves a little bigger than the arms, ending above the hands
  const sleeve = curve(
    [[102, 276], [68, 276, 62, 308], [58, 330, 62, 348], [94, 354, 96, 336], [96, 312, 106, 294]],
    true,
  );
  const body = curve(
    [[96, 274], [128, 268, 160, 274], [172, 320, 168, 366], [128, 374, 88, 366], [84, 320, 96, 274]],
    true,
  );
  const cuffs = rounded(0, 334, W, H, 0);
  for (const s of [sleeve, mirrored(sleeve)]) {
    layer.part(s, red, {
      shadow: [-8, -6],
      highlight: (c) => c.drawPath(CK.Path.MakeFromOp(s, cuffs, CK.PathOp.Intersect), paint({ rgb: dark.base })),
    });
  }
  layer.part(body, red, {
    shadow: [-12, -10],
    // The ribbed band along the hem
    highlight: (c) => c.drawPath(rounded(0, 356, W, H, 0), paint({ rgb: dark.base })),
  });
  // The hood, folded down around the neck, under the chin
  const hood = curve([[98, 276], [128, 264, 158, 276], [150, 300, 128, 302], [106, 300, 98, 276]], true);
  layer.part(hood, dark, { shadow: [0, -6] });
  layer.line(curve([[110, 282], [128, 292, 146, 282]]), red.line, 3);
  // Kangaroo pocket
  const pocket = curve([[104, 324], [128, 320, 152, 324], [158, 338, 156, 350], [128, 354, 100, 350], [98, 338, 104, 324]], true);
  layer.canvas.drawPath(pocket, paint({ rgb: red.shadow }));
  layer.line(pocket, red.line, 3.5);
  // Drawstrings with white tips
  for (const [x, dx] of [[118, -3], [138, 3]]) {
    layer.line(curve([[x, 296], [x + dx, 306, x + dx, 318]]), [255, 255, 255], 4);
    layer.canvas.drawPath(oval(x + dx, 320, 3.5, 4.5), paint({ rgb: [255, 255, 255] }));
  }
  layer.save('top_hoodie_red');
}

function bottomShortsBlue() {
  const layer = new Layer();
  const blue = tones('#3f6fd8');
  const leg = curve([[90, 352], [128, 346, 128, 352], [128, 372, 126, 388], [106, 392, 86, 386], [86, 368, 90, 352]], true);
  const shorts = union(leg, mirrored(leg));
  layer.part(shorts, blue, { shadow: [-10, -8] });
  // The gap between the legs, the waistband and the hems
  layer.line(curve([[128, 368], [128, 380, 128, 392]]), [58, 58, 58], 6);
  layer.line(curve([[90, 362], [128, 358, 166, 362]]), blue.line, 3);
  layer.line(curve([[90, 378], [108, 382, 124, 380]]), blue.line, 3);
  layer.line(mirrored(curve([[90, 378], [108, 382, 124, 380]])), blue.line, 3);
  layer.save('bottom_shorts_blue');
}

function shoesWhite() {
  const layer = new Layer();
  const white = { base: [242, 242, 242], shadow: [200, 205, 216], line: [154, 163, 181] };
  const sole = tones('#b8b8b8');
  // Each shoe covers the foot, toe pointing a little outward
  const shoe = curve([[80, 434], [76, 410, 102, 406], [128, 404, 130, 424], [130, 434, 118, 434]], true);
  for (const s of [shoe, mirrored(shoe)]) {
    layer.part(s, white, {
      shadow: [-6, -6],
      highlight: (c) => c.drawPath(rounded(0, 424, W, H, 0), paint({ rgb: sole.base })),
    });
  }
  // A stripe on the side and the laces
  const stripe = curve([[88, 420], [104, 413, 120, 417]]);
  for (const flip of [false, true]) {
    const m = (p) => (flip ? mirrored(p) : p);
    layer.line(m(stripe), white.line, 5);
    layer.line(m(curve([[104, 410], [110, 408, 116, 410]])), white.line, 3);
    layer.line(m(curve([[80, 424], [104, 426, 130, 424]])), [58, 58, 58], 3);
  }
  layer.save('shoes_white');
}

const ALL = {
  body_base: body,
  face_smile: faceSmile,
  hair_spiky: hairSpiky,
  top_hoodie_red: topHoodieRed,
  bottom_shorts_blue: bottomShortsBlue,
  shoes_white: shoesWhite,
};
const names = process.argv.slice(2);
for (const name of names.length ? names : Object.keys(ALL)) {
  if (!ALL[name]) throw new Error(`unknown layer ${name}; one of ${Object.keys(ALL).join(', ')}`);
  ALL[name]();
}
