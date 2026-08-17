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

# 3. Bake. Pitch 30 was chosen from a contact sheet; steeper angles collapse
#    the legs, shallower ones stop reading as a top-down field.
$PY bake.py gridiron.wam --pitch 30 --anim run --frames 8 --size 64 \
    -o ../images/players

# 4. Look at it the way the game will: tinted, on turf, at game size.
$PY preview.py ../images/players/gridiron_run --teams Red,Blue

# 5. Check the worst team pairing through the hub's own colourblind filters.
$PY preview.py ../images/players/gridiron_run --teams Red,Green --scales 2
$PY cbcheck.py ../images/players/gridiron_run_preview.png

# 6. Full-field comparison against the classic discs.
$PY fieldmock.py

# 7. Verify the JS direction mapping and sprite seating still hold.
node dircheck.js
```

`bake.py --contact` re-runs the camera-pitch comparison if the model changes
enough to want a different angle.

## Atlas layout

`gridiron_run_base.png` and `_jersey.png` are 8 columns (directions) x 8 rows
(run-cycle frames) of 64px cells, so Phaser's frame index is
`frame * 8 + direction`. `gridiron_run.json` carries `footFrac`, measured off
the alpha at bake time — `makePlayer()` uses it to seat the sprite on the
existing shadow ellipse rather than having the offset hand-tuned.

Direction 0 faces screen-down and they run anticlockwise from there; the game
maps a heading to a column in `spriteDirIndex()`. `dircheck.js` asserts that
mapping against the turnaround, so a re-bake with a different `--dirs` will
fail loudly rather than silently render players running sideways.

## Known gaps

- Only a **run** cycle exists. Throwing, catching, kicking, being tackled and
  celebrating all currently reuse it; the model has the rig for them.
- `gridiron.wam` compiles with one warning — the pads are hosted on `chest`
  while their loft origin sits nearer `upperarm.r`. That is deliberate: pads
  are a rigid shell on the torso, and taking the warning's advice would skin
  them to one arm.
