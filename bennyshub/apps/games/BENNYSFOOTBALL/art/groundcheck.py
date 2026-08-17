"""Report how far a model's lowest point sits off the ground, frame by frame.

WAM's own `lowest(anim)` check is one-sided: it catches geometry sinking
through the floor and says nothing about geometry floating above it. A root
`shift`/`pitch` pivots the whole body about the pelvis, so a large fall angle
lifts the feet clear of the ground while every model check still passes -- the
first tackle clip authored here levitated by 0.28 and compiled clean.

That matters doubly for sprites: the game seats each frame on a fixed shadow
ellipse, so a frame that floats in the model floats on the field too.

  python3 groundcheck.py gridiron.wam --anims run:8,throw:8,catch:6,tackle:6
"""
import argparse
import sys

import numpy as np

import bake


def clearances(src, anim, frames, ground=False, rest_y=0.0):
    """Lowest vertex y for each sampled frame, as the bake will emit it."""
    poses = bake.posed_frames(src, anim, frames)
    if ground:
        poses = bake.ground_frames(poses, rest_y)
    return [float(V[:, 1].min()) for V in poses]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    # name:frames[:float-limit]. A gait legitimately leaves the ground -- a run
    # has a flight phase where neither foot is down -- so `run` carries a looser
    # limit than a fall, which must never levitate at all.
    ap.add_argument("--anims",
                    default="run:8:0.09,throw:8,catch:6,tackle:6:ground")
    ap.add_argument("--float-limit", type=float, default=0.045,
                    help="default limit on how far the lowest point may rise "
                         "before it reads as levitating (model-height fraction)")
    ap.add_argument("--sink-limit", type=float, default=-0.03)
    a = ap.parse_args()

    src = bake.load(a.model)
    rest_y = float(src.V[:, 1].min())
    bad = 0
    for spec in a.anims.split(","):
        parts = spec.split(":")
        name = parts[0]
        n = int(parts[1]) if len(parts) > 1 and parts[1] else 8
        ground = "ground" in parts[2:]
        nums = [p for p in parts[2:] if p != "ground"]
        limit = float(nums[0]) if nums else a.float_limit
        vals = clearances(src, name, n, ground, rest_y)
        hi, lo = max(vals), min(vals)
        flag = ""
        if hi > limit:
            flag, bad = "  <-- FLOATS (limit %.3f)" % limit, bad + 1
        elif lo < a.sink_limit:
            flag, bad = "  <-- SINKS", bad + 1
        print("%-8s ground %+.4f .. %+.4f   [%s]%s"
              % (name, lo, hi,
                 " ".join("%+.3f" % v for v in vals), flag))

    print("\n%s" % ("%d animation(s) leave the ground" % bad if bad
                    else "every frame stays planted"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
