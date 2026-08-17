# Player art pipeline

The on-field players can render as the original flat colour discs or as baked
sprites of a low-poly 3D model. This directory holds the **source** for those
sprites; the game only ever loads the baked PNGs in `../images/players/`.

Toggle at runtime: **Settings → Players: 3D / CLASSIC**. It reads on team
creation, so it takes effect at the start of the next game. To change the
shipped default, flip the fallback in `sprite3dOn()` in `js/constants.js`.

**If you only want to run the game, you can stop reading — nothing here is
needed for that.** Read on to change the player art. The 3D models are written
in [WAM](https://github.com/elliottdehn/wam), a text language for low-poly
characters; jump to [Setting up the toolchain](#setting-up-the-toolchain) for
how to install it, then [Rebuilding](#rebuilding) for the exact sequence.

What lives here:

| File | What it is |
|---|---|
| `gridiron.wam` | the player: skeleton, geometry, four animations, and its own checks |
| `football.wam` | the ball, as its own model so it can be grafted into a hand |
| `gridiron.wamset` | composes the two — the player holding the ball |
| `bake.py` | renders the models to the sprite sheets the game loads |
| `groundcheck.py` | asserts no animation frame leaves the ground |
| `dircheck.js` | asserts the JS wiring matches what the bake wrote |
| `preview.py` `fieldmock.py` `highlightcheck.py` `cbcheck.py` | render the result the way the game will show it, for judging by eye |

## Why baked sprites and not real-time 3D

The model compiles to glTF, so real-time 3D is technically possible. It was
rejected deliberately. The game is ~4,000 lines of Phaser positioned in field
pixel coordinates, the colourblind correction is an SVG filter over the whole
2D canvas, and the switch-scanning overlay assumes Phaser game objects. Baking
to sprites keeps every tween, the y-sort in `_sortPlayerDepths()`, and the
whole accessibility layer untouched — the integration point is `makePlayer()`
and one call in `update()`.

## The model

`gridiron.wam` is written in WAM. Designed to read at roughly 26–46px on a
green field, which drives every decision in it:

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

## Coverage cues

Open / covered / doubled is shown as a **glow around the player**, chosen by
Ari and Ben over the circle/triangle/square shapes the discs use. It is traced
from each frame's own silhouette, so unlike a shape drawn at a fixed radius it
always frames the player in any pose at any size — which is what went wrong
when the taller sprite replaced the disc, leaving the shape ringing the
player's legs.

The aura ships as a third baked layer (`gridiron_glow.png`), white, tinted at
runtime. It is baked rather than produced with Phaser's `preFX.addGlow` on
purpose: preFX is WebGL-only, and this is the cue that says who is open — it
must not quietly vanish on a machine that fails to get a WebGL context.

The glow has its own palette (`coverageGlowColor`), not `cbHighlightColor`'s,
because a glow must be **luminous**. The colourblind `doubled` in that older
palette is dark slate `#546e7a`, which is perfectly legible as a fill inside a
stroked shape and cannot work as an aura at all. The glow's colourblind triad
is blue / yellow / **white** — white is maximally bright and the one colour
that survives all three filters untouched, since every row of those matrices
sums to 1. Verified with `cbcheck.py`: all three states stay separable under
protanopia, with doubled the brightest.

Discs keep the shapes. They have no glow layer, and the shape path is still
there for them.

One residual to know about: in **normal** mode the doubled glow is red, and red
is the colour protanopia flattens hardest. If doubled coverage is ever hard to
spot, the Colorblind setting now gives a materially better glow palette than it
used to. `highlightcheck.py` renders all of this for inspection.

## Setting up the toolchain

Nothing in this directory is needed to *run* the game — the game loads only the
baked PNGs. You need this setup only to change the model, the animations or the
bake.

The toolchain is WAM, which lives in a separate repository. Clone it anywhere
you like; it does not need to be inside this project.

```bash
git clone https://github.com/elliottdehn/wam.git ~/wam
cd ~/wam
./setup-wam.sh            # macOS / Linux
# .\Setup-WAM.ps1         # Windows (PowerShell)
```

`setup-wam.sh` needs **Python 3.9 or newer** on `PATH` and does three things:
creates a `.venv` beside the checkout, installs WAM into it as an editable
package, and proves the result runs. It finishes by printing the interpreter
path:

```
WAM is ready: /Users/you/wam/.venv/bin/python
```

If it stops with *"WAM requires Python 3.9 or newer"*, install Python first —
on macOS `xcode-select --install` is usually enough.

Everything below assumes two variables. Set them once per shell, pointing at
wherever you cloned:

```bash
WAM=~/wam
PY=$WAM/.venv/bin/python3
```

You do **not** need to set `PYTHONPATH`. WAM is installed editable into that
venv, so `$PY` already resolves `import wam` on its own. (Older notes in this
project said otherwise; it was never necessary.) Using a *different* Python —
the system one, say — will fail with `ModuleNotFoundError: No module named
'wam'`, and the fix is to use `$PY`, not to add `PYTHONPATH`.

Run every command below from **this** directory (`.../BENNYSFOOTBALL/art`), not
from the WAM checkout — the scripts here resolve `../images/players` relative to
themselves, and `gridiron.wamset` resolves its member models relative to itself.

### Before editing the model

If you are changing `gridiron.wam` rather than just re-running the bake, read
these in the WAM checkout first — they are short and they encode failures that
cost real time:

- `$WAM/SPEC.md` — the language.
- `$WAM/COMMON_MISTAKES_MUST_READ.md` — every entry is something that compiled
  cleanly and looked plausible and was still wrong.

Two traps specific to this model are already written up under **Animations**
above: keys must land on the frame sample grid, and `shift` never reaches an
animation.

## Rebuilding

Steps 1–3 are checks; skip none of them, because each one catches a class of
fault the next step would bake in permanently.

```bash
# 1. The model compiles and passes its own checks. Read EVERY line, including
#    `info:` — the compiler reports what it decided, not just what broke.
#    Expect one known warning about `pads` being hosted on `chest`; that one is
#    deliberate and explained under "Known gaps".
$PY -m wam.codex_cli compile gridiron.wam

# 2. The ball composition still grafts cleanly.
$PY -m wam.modelset gridiron.wamset

# 3. Judge the shape with shading removed — read the SMALLEST thumbnail row.
#    If it does not read as a football player there, no amount of surface
#    detail will fix it.
$PY $WAM/scripts/silhouette.py gridiron.wam --thumbs 24,32,48

# 4. Every frame of every clip stays on the field. Exits non-zero if not.
$PY groundcheck.py gridiron.wam

# 5. Bake. Pitch 30 was chosen from a contact sheet; steeper angles collapse
#    the legs, shallower ones stop reading as a top-down field.
#    Writes _base.png, _jersey.png, _glow.png and gridiron.json.
$PY bake.py gridiron.wam --pitch 30 -o ../images/players
```

**Now do the one manual step.** The bake prints a row table and writes it to
`../images/players/gridiron.json`. `PLAYER_SPRITE.anims` in
`../js/constants.js` is a hand-copy of that table, and nothing updates it for
you. If you changed the clips, frame counts or ball frames, copy the new values
across — `row`, `frames`, `loop`, `ballFrames`, plus `footFrac` — then:

```bash
# 6. Verify the JS wiring: facings, seating, sheet geometry, and that
#    PLAYER_SPRITE.anims matches the rows the bake actually wrote. This is the
#    check that catches a forgotten hand-copy. Exits non-zero on any mismatch.
node dircheck.js

# 7. Look at it the way the game will: tinted, on turf, at game size.
$PY preview.py ../images/players/gridiron --teams Red,Blue
$PY preview.py ../images/players/gridiron --anim tackle    # one clip's frames

# 8. Check the worst team pairing through the hub's own colourblind filters.
$PY preview.py ../images/players/gridiron --teams Red,Green --scales 2
$PY cbcheck.py ../images/players/gridiron_preview.png

# 9. Full-field comparison against the classic discs.
$PY fieldmock.py

# 10. The coverage glow, in both palettes and through the filters.
$PY highlightcheck.py
$PY cbcheck.py out/highlight_shipped.png
```

Steps 3 and 7–10 write images rather than pass/fail results. **Open them.** They
exist because the failures they catch — a silhouette that does not read, a ball
at the wrong scale, a cue that vanishes under a filter — are invisible to every
automated check in this directory.

`bake.py --contact` re-runs the camera-pitch comparison if the model changes
enough to want a different angle.

Renders land in `art/out/`, which is scratch and is not committed. What *is*
committed is `../images/players/*.png` and `.json` — the game loads those, so a
bake that is not committed does not ship.

**The bake is deterministic.** Re-running it with no source changes produces
byte-identical PNGs, so `git status` is a reliable check: if the sheets come
back dirty after a bake, something in the model or the bake really did change.
If they come back clean, you changed nothing that reaches the game. This whole
sequence has been run against a fresh clone of WAM and reproduces the committed
sheets exactly.

### If something goes wrong

| Symptom | Cause |
|---|---|
| `ModuleNotFoundError: No module named 'wam'` | Not using `$PY`. Use the venv interpreter; do not add `PYTHONPATH`. |
| `No such file or directory: 'gridiron.wam'` | Wrong directory. Run from `.../BENNYSFOOTBALL/art`. |
| `FileNotFoundError: '/tmp/gridiron.wam'` from a `.wamset` | A set file resolves its members relative to itself, so it cannot be copied elsewhere to experiment on. Edit it in place. |
| `dircheck.js` fails on `row` or `ballFrames` | The hand-copy in `constants.js` is stale. Re-copy from `gridiron.json`. |
| `dircheck.js` fails on sheet geometry | A layer is missing or half-written — re-run the bake. |
| Game shows discs, console warns about `file://` | Phaser fetches images over XHR, which a `file://` page cannot do. Serve over HTTP or run the hub with `npm start`. |

## Atlas layout

`gridiron_base.png`, `_jersey.png` and `_glow.png` are 8 columns (directions) x 36 rows
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
