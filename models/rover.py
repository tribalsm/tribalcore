"""Rover for the TRIBALCORE map -> public/assets/models/rover.glb.

Run: blender --background --factory-startup --python models/rover.py -- [--preview out.png]
Node names used by the site: rover_body, wheel_<side><n>, antenna.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
from mathutils import Matrix  # noqa: E402

from kit import box, cylinder, export, inset, new_object, preview, prism, reset  # noqa: E402

reset()

# ---------------------------------------------------------------- body
B = ["body", "trim", "glass", "lamp", "tail", "accent", "tire"]
BODY, TRIM, GLASS, LAMP, TAIL, ACCENT, TIRE = range(7)
bm = bmesh.new()

W = 0.47  # half width of the hull
# Hull: chamfered nose and tail, flat deck.
hull = [(-0.98, 0.40), (0.86, 0.40), (1.04, 0.52), (1.02, 0.66), (0.62, 0.76),
        (-0.90, 0.76), (-1.0, 0.66)]
prism(bm, hull, -W, W, BODY)

# Cabin with a raked windscreen, side and rear windows.
cabin = [(0.50, 0.76), (0.18, 1.14), (-0.40, 1.14), (-0.50, 0.76)]
for f in prism(bm, cabin, -0.40, 0.40, TRIM):
    nx, ny, nz = f.normal
    if nx > 0.5 and nz > 0.3:
        inset(bm, f, 0.05, GLASS)
    elif abs(ny) > 0.9:
        inset(bm, f, 0.06, GLASS)
    elif nx < -0.9:
        inset(bm, f, 0.08, GLASS)

# Roof light bar with four amber lamps.
box(bm, (0.02, 0, 1.19), (0.16, 0.74, 0.08), TRIM, bevel=0.015)
for y in (-0.27, -0.09, 0.09, 0.27):
    box(bm, (0.105, y, 1.19), (0.02, 0.13, 0.05), LAMP)

# Bull bar on the nose, headlights, tail lights, side stripe.
box(bm, (1.09, 0, 0.47), (0.08, 0.86, 0.09), TRIM, bevel=0.015)
for y in (-0.28, 0.28):
    box(bm, (1.10, y, 0.57), (0.05, 0.08, 0.14), TRIM)
    box(bm, (1.035, y, 0.62), (0.04, 0.18, 0.07), LAMP)
    box(bm, (-0.995, y * 1.1, 0.62), (0.03, 0.14, 0.06), TAIL)
for s in (-1, 1):
    box(bm, (-0.05, s * (W + 0.006), 0.69), (1.5, 0.012, 0.035), ACCENT)

# Cargo deck behind the cabin: equipment crate and a spare wheel.
box(bm, (-0.72, -0.16, 0.86), (0.34, 0.42, 0.2), TRIM, bevel=0.02)
cylinder(bm, (-1.06, 0.0, 0.62), 0.2, 0.1, axis="X", segs=14, mat=TIRE)
cylinder(bm, (-1.11, 0.0, 0.62), 0.09, 0.02, axis="X", segs=10, mat=BODY)

# Side skirts with rocker arms that carry the six wheels.
for s in (-1, 1):
    box(bm, (-0.05, s * (W + 0.04), 0.42), (1.7, 0.08, 0.08), TRIM)
    for x in (0.64, 0.0, -0.64):
        box(bm, (x, s * (W + 0.04), 0.35), (0.07, 0.07, 0.16), TRIM)

new_object("rover_body", bm, B)

# ---------------------------------------------------------------- wheels
WHEEL_R, WHEEL_W = 0.27, 0.22
for side, s in (("L", 1), ("R", -1)):
    for i, x in enumerate((0.64, 0.0, -0.64)):
        bm = bmesh.new()
        cylinder(bm, (0, 0, 0), WHEEL_R, WHEEL_W, segs=16, mat=0)
        # Tread blocks so the wheel reads as rolling.
        for k in range(8):
            a = k * math.tau / 8 + math.tau / 32
            cube = box(bm, (0, 0, 0), (0.04, WHEEL_W * 0.9, 0.08), 0)
            bmesh.ops.translate(bm, vec=(WHEEL_R + 0.01, 0, 0), verts=cube)
            bmesh.ops.rotate(bm, verts=cube, cent=(0, 0, 0), matrix=Matrix.Rotation(-a, 3, "Y"))
        cylinder(bm, (0, s * (WHEEL_W / 2 + 0.01), 0), 0.13, 0.03, segs=10, mat=1)
        cylinder(bm, (0, s * (WHEEL_W / 2 + 0.03), 0), 0.05, 0.03, segs=6, mat=2)
        new_object(f"wheel_{side}{i}", bm, ["tire", "body", "accent"], location=(x, s * (W + 0.17), WHEEL_R))

# ---------------------------------------------------------------- antenna
bm = bmesh.new()
cylinder(bm, (0, 0, 0.22), 0.025, 0.44, axis="Z", segs=6, mat=0)
# Small dish tilted forward, open side up.
dish = cylinder(bm, (0, 0, 0), 0.2, 0.08, axis="Z", segs=12, mat=0, radius2=0.06)
bmesh.ops.rotate(bm, verts=dish, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi, 3, "X"))
bmesh.ops.rotate(bm, verts=dish, cent=(0, 0, 0), matrix=Matrix.Rotation(-0.5, 3, "Y"))
bmesh.ops.translate(bm, vec=(0.02, 0, 0.46), verts=dish)
cylinder(bm, (0.1, 0, 0.62), 0.012, 0.22, axis="Z", segs=4, mat=0)
box(bm, (0.1, 0, 0.74), (0.05, 0.05, 0.05), 1)
new_object("antenna", bm, ["trim", "lamp"], location=(-0.72, 0.24, 0.76))

export("rover")
preview({"map": (2.6, -5.2, 6.2), "side": (0.6, -5.5, 1.3), "front": (5.0, -2.4, 2.4)})
