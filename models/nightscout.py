"""NightScout station: a scout watchtower with a searchlight and a video screen.

Run: blender --background --factory-startup --python models/nightscout.py -- [--preview out.png]
Node names used by the site: tower, screen, searchlight.
The screen faces -Y (towards the map camera); the scan line is drawn by scene3d.js.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
from mathutils import Euler  # noqa: E402

from kit import box, cylinder, export, new_object, preview, prism, reset, strut  # noqa: E402

reset()
BODY, TRIM, ACCENT, SCREEN, PAPER, LAMP = range(6)
MATS = ["body", "trim", "accent", "screen", "paper", "lamp"]

# ---------------------------------------------------------------- tower
bm = bmesh.new()
box(bm, (0, 0, 0.08), (1.3, 1.3, 0.16), BODY, bevel=0.03)
BASE, TOP, Z0, Z1 = 0.5, 0.3, 0.16, 2.3


def half(z):
    """Half width of the tapering tower at height z."""
    return BASE + (TOP - BASE) * (z - Z0) / (Z1 - Z0)


corners = [(1, 1), (1, -1), (-1, -1), (-1, 1)]
for sx, sy in corners:
    strut(bm, (sx * BASE, sy * BASE, Z0), (sx * TOP, sy * TOP, Z1), 0.09, TRIM)
    # Footings.
    box(bm, (sx * BASE, sy * BASE, Z0 + 0.04), (0.18, 0.18, 0.08), TRIM)
levels = [Z0 + 0.05, 1.23, Z1 - 0.02]
for i in range(4):
    (ax, ay), (bx, by) = corners[i], corners[(i + 1) % 4]
    for lo, hi in zip(levels, levels[1:]):
        hl, hh = half(lo), half(hi)
        strut(bm, (ax * hl, ay * hl, lo), (bx * hh, by * hh, hi), 0.045, TRIM)
        strut(bm, (bx * hl, by * hl, lo), (ax * hh, ay * hh, hi), 0.045, TRIM)
    hm = half(1.23)
    strut(bm, (ax * hm, ay * hm, 1.23), (bx * hm, by * hm, 1.23), 0.05, TRIM)

# Platform with a railing.
box(bm, (0, 0, Z1 + 0.04), (0.92, 0.92, 0.08), BODY, bevel=0.012)
R, RZ = 0.44, Z1 + 0.3
for sx, sy in corners:
    strut(bm, (sx * R, sy * R, Z1 + 0.08), (sx * R, sy * R, RZ), 0.035, TRIM)
for i in range(4):
    (ax, ay), (bx, by) = corners[i], corners[(i + 1) % 4]
    strut(bm, (ax * R, ay * R, RZ), (bx * R, by * R, RZ), 0.03, TRIM)

# Ladder up the +X face, following the taper.
for y in (-0.13, 0.13):
    strut(bm, (BASE + 0.07, y, Z0), (TOP + 0.07, y, Z1 + 0.1), 0.03, TRIM)
for k in range(1, 9):
    z = Z0 + k * (Z1 - Z0) / 9
    x = half(z) + 0.07
    strut(bm, (x, -0.13, z), (x, 0.13, z), 0.02, TRIM)

new_object("tower", bm, MATS)

# ---------------------------------------------------------------- screen
# A video screen on the back of the platform: play badge and a list of found channels.
bm = bmesh.new()
FW, FH = 1.5, 0.92
box(bm, (0, 0, 0), (FW, 0.1, FH), TRIM, bevel=0.025)
box(bm, (0, -0.055, 0), (FW - 0.14, 0.02, FH - 0.14), SCREEN)
F = -0.07  # front surface of the panel
box(bm, (-0.36, F, 0.04), (0.42, 0.02, 0.3), ACCENT, bevel=0.03)
prism(bm, [(-0.43, -0.07), (-0.43, 0.15), (-0.27, 0.04)], F - 0.02, F - 0.012, SCREEN)
for i, z in enumerate((0.22, 0.06, -0.10, -0.26)):
    box(bm, (0.04, F, z), (0.06, 0.02, 0.06), ACCENT if i == 1 else PAPER)
    box(bm, (0.36, F, z), (0.5 if i % 2 == 0 else 0.38, 0.02, 0.045), PAPER)
box(bm, (-0.36, F, -0.26), (0.42, 0.02, 0.045), PAPER)
# Feet that stand the screen on the platform.
for x in (-0.36, 0.36):
    strut(bm, (x, 0, -FH / 2 - 0.14), (x, 0, -FH / 2), 0.06, TRIM)
new_object("screen", bm, MATS, location=(0, 0.3, Z1 + 0.08 + 0.14 + FH / 2))

# ---------------------------------------------------------------- searchlight
# Points along its local +X; the node is turned towards the front-right.
bm = bmesh.new()
cylinder(bm, (0, 0, 0.04), 0.1, 0.08, axis="Z", segs=8, mat=TRIM)
for y in (-0.15, 0.15):
    strut(bm, (0, y, 0.06), (0, y, 0.26), 0.04, TRIM)
cylinder(bm, (0, 0, 0.26), 0.14, 0.3, axis="X", segs=12, mat=BODY, radius2=0.12)
cylinder(bm, (0.16, 0, 0.26), 0.13, 0.02, axis="X", segs=12, mat=LAMP)
# Near the platform centre so the drum and yoke stay inside the railing when turned.
light = new_object("searchlight", bm, MATS, location=(0.02, -0.1, Z1 + 0.08))
light.rotation_euler = Euler((0, 0, -0.9))
light.rotation_euler.rotate_axis("Y", 0.25)

export("nightscout")
preview({"map": (3.0, -7.5, 7.5), "front": (0.8, -6.5, 2.4), "side": (6.5, -1.5, 3.0)}, target=(0, 0, 1.6))
