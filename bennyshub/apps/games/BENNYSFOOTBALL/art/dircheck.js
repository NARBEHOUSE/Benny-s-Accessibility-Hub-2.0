// Verify the JS sprite wiring against the real constants.js and the real bake
// manifest. Run after any re-bake:  node dircheck.js
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const CONSTANTS = path.join(HERE, '../js/constants.js');
const MANIFEST = path.join(HERE, '../images/players/gridiron.json');

global.localStorage = { getItem: () => null, setItem: () => {} };
const src = fs.readFileSync(CONSTANTS, 'utf8');
// `const` declared inside eval does not escape its scope, so hand the values
// back out explicitly rather than reaching for them afterwards.
const api = eval('(function () {' + src +
  '\nreturn { spriteDirIndex, PLAYER_SPRITE };\n})')();
const spriteDirIndex = api.spriteDirIndex;
const P = api.PLAYER_SPRITE;
const meta = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

let bad = 0;
const check = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`); };

// ── facing ────────────────────────────────────────────────────────────────
// yaw 0 faces screen-down, 90 left, 180 up, 270 right (from the turnaround).
console.log('facing');
for (const [name, dx, dy, want] of [
  ['right', 1, 0, 6], ['down', 0, 1, 0], ['left', -1, 0, 2], ['up', 0, -1, 4],
  ['down-right', 1, 1, 7], ['down-left', -1, 1, 1],
  ['up-left', -1, -1, 3], ['up-right', 1, -1, 5],
]) {
  const got = spriteDirIndex(Math.atan2(dy, dx));
  check(got === want, `heading ${name.padEnd(11)} -> dir ${got} (want ${want})`);
}

// ── the clip table is hand-copied into constants.js, so drift here would ──
// ── silently play the wrong animation rather than fail loudly ────────────
console.log('\nclip table vs bake manifest');
check(P.dirs === meta.directions, `directions ${P.dirs} == ${meta.directions}`);
check(P.frameW === meta.frameWidth && P.frameH === meta.frameHeight,
  `frame ${P.frameW}x${P.frameH} == ${meta.frameWidth}x${meta.frameHeight}`);
check(Math.abs(P.footFrac - meta.footFrac) < 1e-6,
  `footFrac ${P.footFrac} == ${meta.footFrac}`);

for (const name of Object.keys(meta.anims)) {
  const m = meta.anims[name], c = P.anims[name];
  if (!c) { check(false, `${name}: missing from PLAYER_SPRITE.anims`); continue; }
  check(c.row === m.row && c.frames === m.frames,
    `${name.padEnd(7)} row ${c.row} x${c.frames} == baked row ${m.row} x${m.frames}`);
  check(!!c.loop === !!m.loop, `${name.padEnd(7)} loop ${!!c.loop} == ${!!m.loop}`);
  if (!m.loop) check(typeof c.fps === 'number' && c.fps > 0,
    `${name.padEnd(7)} one-shot declares an fps (${c.fps})`);
}
for (const name of Object.keys(P.anims)) {
  check(!!meta.anims[name], `${name.padEnd(7)} declared in JS is present in the bake`);
}

// ── atlas indexing ────────────────────────────────────────────────────────
console.log('\natlas indexing');
const maxIdx = meta.rows * meta.directions - 1;
let worst = -1;
for (const name of Object.keys(P.anims)) {
  const c = P.anims[name];
  for (let f = 0; f < c.frames; f++)
    for (let d = 0; d < P.dirs; d++) worst = Math.max(worst, (c.row + f) * P.dirs + d);
}
check(worst === maxIdx, `highest frame index ${worst} == atlas max ${maxIdx}`);

// ── seating ───────────────────────────────────────────────────────────────
// Mirrors makePlayer() in game.js exactly; a formula that only agrees with
// itself tracks nothing.
console.log('\nseating');
const sy = P.footOffsetY - (P.footFrac - 0.5) * P.displayH;
const footY = sy - P.displayH / 2 + P.footFrac * P.displayH;
check(Math.abs(footY - P.footOffsetY) < 1e-9,
  `foot lands at y ${footY.toFixed(4)} (want ${P.footOffsetY})`);
// The shadow ellipse is drawn at (3, 7) with a half-height of 5.5.
check(footY >= 1.5 && footY <= 12.5,
  `foot line ${footY.toFixed(1)} sits inside the shadow band 1.5..12.5`);
const topY = sy - P.displayH / 2;
check(topY < 0 && footY > 0,
  `body spans y ${topY.toFixed(1)}..${footY.toFixed(1)} (the disc was -13..13)`);

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);
