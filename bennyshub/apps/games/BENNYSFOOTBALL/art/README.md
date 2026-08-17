# Player art pipeline

The on-field players can render as the original flat colour discs or as baked
sprites of a low-poly 3D model. This directory holds the **source** for those
sprites; the game only ever loads the baked PNGs in `../images/players/`.

Toggle at runtime: **Settings → Players: 3D / CLASSIC**. It reads on team
creation, so it takes effect at the start of the next game. To change the
shipped default, flip the fallback in `sprite3dOn()` in `js/constants.js`.

## Why baked sprites and not real-time 3D

The model compiles to glTF, so real-time 3D is technically possible. It was
rejected deliberately. The game is ~4,000 lines of Phaser positioned in field
pixel coordinates, the colourblind correction is an SVG filter over the whole
2D canvas, and the switch-scanning overlay assumes Phaser game objects. Baking
to sprites keeps every tween, the y-sort in `_sortPlayerDepths()`, and the
whole accessibility layer untouched — the integration point is `makePlayer()`
and one call in `update()`.

## The model

`gridiron.wam` — WAM (see the `wam` skill / toolchain). Designed to read at
roughly 26–46px on a green field, which drives every decision in it:

- **Signature:** the helmet sits down *into* the shoulder pads so there is no
  neck. That is what separates a football player from a hockey player at
  thumbnail size, and it is asserted, not eyeballed:
  `assert ymin(helmet) < ymax(pads)`.
- **Pads are one part spanning the centreline**, not a mirrored pair — real
  pads are a single arched shell, and a mirror block would seam down the middle.
- **`jersey` is pure white** because it is tinted per team at runtime. The
  helmet shares that material: in football the helmet carries team colour
  (unlike hockey or basketball), so one mask covers both.
- Pants, facemask, skin, socks and the black outline are **never tinted**, so
  the figure stays visible even when hue collapses under a colourblind filter.

The `checks` block is the model's regression suite; it runs on every compile.

## Animations

Four clips: `run` (looping) plus `throw`, `catch` and `tackle` (one-shots).

Two constraints shaped all of them, both learned the hard way:

- **Keys must land on the frame sample grid.** A one-shot with N frames is
  sampled at `i/(N-1)`, so an extreme placed between samples is never rendered.
  The throw's release sat at 62% of an 8-frame clip and baked as -42 then -78,
  which read as the arm bobbing back up through its own follow-through. Keys
  now sit on 0/29/43/57/71/86/100 for 8 frames and 0/20/40/60/80/100 for 6.
- **There is no root translation an animation can reach.** `shift` parses on a
  pose and `global_transforms` would honour it, but `anim_rotations_at` blends
  only pitch/yaw/roll/tilt, so it never arrives — editing it changes nothing at
  all. Rotating the root instead pivots the body about the pelvis and lifts the
  feet. The first tackle levitated 0.21 above the field with every model check
  passing. The fall is therefore pure rotation and the **bake** translates the
  figure back down (`tackle:6:ground`).

`groundcheck.py` exists because WAM's own `lowest(anim)` is one-sided: it
catches geometry sinking through the floor and says nothing about geometry
floating above it. A gait legitimately leaves the ground, so `run` carries a
looser limit than a fall.

## The ball

`football.wam` is its own model rather than part of the player, because it is
genuinely handed around — quarterback, back, receiver, and a defender on an
interception all hold the same object, and it also has to exist detached while
in flight. That is the case the language's own guidance says to split on.

`gridiron.wamset` composes the two: one `carry` composition grafting the ball
into the right hand. One is enough, because the arm is in a different place in
each clip — the same graft reads as a ball cocked beside the helmet through the
throw and as one carried at the hip through the run.

Grafting it, rather than drawing the ball as a separate sprite positioned over
the player, buys **occlusion**: facing away from camera the ball is correctly
hidden behind the body. A separate sprite would float on top in about three of
the eight facings.

Two things were tried first and abandoned, both recorded in the `.wamset`:
a tuck against the ribs (grafted to the forearm, it put both ends of the ball
equally near the torso, so `hold`'s points-away check fired on every
forward-facing orientation), and clearing the resulting body overlap with
bone-space offsets (which rotate with the bone — the hand-derived transform the
language exists to avoid).

The graft carries `overlap` because a fist closing on a ball necessarily
intersects it: the hand is a plain loft with no modelled fingers. The depth is
bounded by a check rather than left unbounded.

## Rebuilding

Requires the WAM toolchain. Point `PYTHONPATH` at its root and use its venv:

```bash
WAM=~/.claude/plugins/cache/wam/wam/0.1.0
export PYTHONPATH=$WAM
PY=$WAM/.venv/bin/python3

# 1. Check the model still compiles clean and passes its own checks.
$PY -m wam.codex_cli compile gridiron.wam

# 2. Judge the shape with shading removed — read the SMALLEST thumbnail row.
$PY $WAM/scripts/silhouette.py gridiron.wam --thumbs 24,32,48

# 3. Every frame of every clip must stay on the field.
$PY groundcheck.py gridiron.wam

# 4. Bake. Pitch 30 was chosen from a contact sheet; steeper angles collapse
#    the legs, shallower ones stop reading as a top-down field.
$PY bake.py gridiron.wam --pitch 30 -o ../images/players

# 5. Look at it the way the game will: tinted, on turf, at game size.
$PY preview.py ../images/players/gridiron --teams Red,Blue
$PY preview.py ../images/players/gridiron --anim tackle    # one clip's frames

# 6. Check the worst team pairing through the hub's own colourblind filters.
$PY preview.py ../images/players/gridiron --teams Red,Green --scales 2
$PY cbcheck.py ../images/players/gridiron_preview.png

# 7. Full-field comparison against the classic discs.
$PY fieldmock.py

# 8. Verify the JS wiring: facings, seating, and that PLAYER_SPRITE.anims
#    still matches the rows the bake actually wrote.
node dircheck.js
```

`bake.py --contact` re-runs the camera-pitch comparison if the model changes
enough to want a different angle.

## Atlas layout

`gridiron_base.png` and `_jersey.png` are 8 columns (directions) x 36 rows
(every frame of every clip, stacked) of 64px cells, so Phaser's frame index is
`(clip.row + frame) * 8 + direction`. `gridiron.json` carries the row table and
`footFrac`, both measured at bake time — `makePlayer()` uses `footFrac` to seat
the sprite on the existing shadow ellipse rather than having the offset
hand-tuned, and it is taken from the **run** clip only, since that is the
standing player the shadow has to line up with.

`PLAYER_SPRITE.anims` in `constants.js` is a hand-copy of that row table, so
`dircheck.js` asserts the two agree — drift there would silently play the wrong
animation rather than fail.

Each clip also carries `ballFrames`: the frames whose art already contains the
football. Only `run` needs both an empty-handed and a carrying row set — every
`tackleShake` call site passes the ball carrier, only the quarterback throws,
and only a receiver catches, so those three clips are carrier-only. That audit
is what keeps the atlas at 36 rows instead of 56.

The handover is baked into the frames rather than toggled by the game: the
throw holds the ball to frame 5 and the catch receives it at frame 4. The game
reads `ballFrames` to hide its own drawn ball while the art is carrying one,
and to delay a throw's flight until the release frame instead of launching it
during the wind-up.

One camera fits every clip at once, so the player never changes size when it
turns, strides or starts an action. The cost is that adding a wide low pose
shrinks everything else inside its cell; `displayH` compensates so the on-field
size stays put.

Direction 0 faces screen-down and they run anticlockwise from there; the game
maps a heading to a column in `spriteDirIndex()`. `dircheck.js` asserts that
mapping against the turnaround, so a re-bake with a different `--dirs` will
fail loudly rather than silently render players running sideways.

## Known gaps

- **Kicking and celebrating** have no clip yet and fall back to the run; the
  rig supports both.
- The **tackle holds its last frame** until the next snap clears it
  (`_clearPlayerActions()`), which is intended — a tackled player should stay
  down — but any new code path that resets players without going through
  `repositionFormation`/`tweenFormation` has to clear it too.
- The compiler still warns that the throw, catch and tackle rotate a forearm
  ~120° and are "very likely folding through" the body. They are not:
  `noclip in=*` sweeps all four clips and reports 51 pairs clear.
- `gridiron.wam` compiles with one warning — the pads are hosted on `chest`
  while their loft origin sits nearer `upperarm.r`. That is deliberate: pads
  are a rigid shell on the torso, and taking the warning's advice would skin
  them to one arm.
