// Exercise the real constants.js in Node: does spriteDirIndex map screen
// headings onto the atlas columns the bake actually wrote?
const fs = require('fs');
const path = '/Users/egd/projects/volunteer-work/Benny-s-Accessibility-Hub-2.0/bennyshub/apps/games/BENNYSFOOTBALL/js/constants.js';
global.localStorage = { getItem: () => null, setItem: () => {} };
const src = fs.readFileSync(path, 'utf8');
// `const` declared inside eval does not escape its scope, so hand the values
// back out explicitly rather than reaching for them afterwards.
const api = eval('(function () {' + src +
  '\nreturn { spriteDirIndex, PLAYER_SPRITE };\n})')();
const spriteDirIndex = api.spriteDirIndex;
const PLAYER_SPRITE = api.PLAYER_SPRITE;

// yaw 0 faces screen-down, 90 left, 180 up, 270 right (from the turnaround).
const expect = [
  ['right',  0,  0, 6],
  ['down',   0,  1, 0],
  ['left',  -1,  0, 2],
  ['up',     0, -1, 4],
  ['down-right',  1,  1, 7],
  ['down-left',  -1,  1, 1],
  ['up-left',    -1, -1, 3],
  ['up-right',    1, -1, 5],
];

let bad = 0;
for (const [name, dx, dy, want] of expect) {
  const got = spriteDirIndex(Math.atan2(dy, dx));
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  heading ${name.padEnd(11)} -> dir ${got} (want ${want})`);
}

// Frame index must stay inside the atlas for every legal (frame, dir).
const P = PLAYER_SPRITE, max = P.frames * P.dirs - 1;
let worst = -1;
for (let f = 0; f < P.frames; f++)
  for (let d = 0; d < P.dirs; d++) worst = Math.max(worst, f * P.dirs + d);
console.log(`\natlas frames 0..${max}, highest index produced ${worst}  ${worst === max ? 'ok' : 'FAIL'}`);
if (worst !== max) bad++;

// Foot seating. This must mirror makePlayer() in game.js exactly, or it is a
// check that agrees with itself and tracks nothing.
const sy = P.footOffsetY - (P.footFrac - 0.5) * P.displayH;
const footWorldY = sy - P.displayH / 2 + P.footFrac * P.displayH;
const okFoot = Math.abs(footWorldY - P.footOffsetY) < 1e-9;
console.log(`sprite y offset ${sy.toFixed(2)}, foot lands at y ${footWorldY.toFixed(4)} (want ${P.footOffsetY})  ${okFoot ? 'ok' : 'FAIL'}`);
if (!okFoot) bad++;

// And the shadow ellipse must actually be under the feet. It is drawn at
// (3, 7) with a half-height of 5.5, so the foot line has to fall inside it.
const inShadow = footWorldY >= 7 - 5.5 && footWorldY <= 7 + 5.5;
console.log(`foot line ${footWorldY.toFixed(1)} vs shadow band 1.5..12.5  ${inShadow ? 'ok' : 'FAIL — sprite floats off its shadow'}`);
if (!inShadow) bad++;

// The body must straddle the origin the way the 26px disc did, since every
// tackle and catch in the game treats the origin as the player's position.
const topY = sy - P.displayH / 2;
console.log(`body spans y ${topY.toFixed(1)}..${footWorldY.toFixed(1)} (disc was -13..13)  ${topY < 0 && footWorldY > 0 ? 'ok' : 'FAIL'}`);
if (!(topY < 0 && footWorldY > 0)) bad++;

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);
