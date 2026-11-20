"""Contacts station: a roadside mailbox on a post, door open with a letter in it.

Run: blender --background --factory-startup --python models/mail.py -- [--preview out.png]
The box runs along Y with its door towards the map camera (-Y).
Node names used by the site: post, mailbox, door (closed, hinge at its bottom), letter (inside), flag (pivot at its hinge, raised).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from kit import box, cylinder, engrave, export, new_object, preview, prism, reset, strut  # noqa: E402

reset()
BODY, TRIM, PAPER, ACCENT, SCREEN, INK = range(6)
MATS = ["body", "trim", "paper", "accent", "screen", "ink"]

# ---------------------------------------------------------------- post
bm = bmesh.new()
cylinder(bm, (0, 0, 0.05), 0.32, 0.1, axis="Z", segs=12, mat=TRIM)          # footing
box(bm, (0, 0, 0.62), (0.14, 0.14, 1.06), BODY, bevel=0.015)
box(bm, (0, 0, 1.17), (0.5, 0.9, 0.05), TRIM, bevel=0.01)                     # shelf under the box
strut(bm, (0, 0.0, 0.85), (0, 0.32, 1.15), 0.06, BODY)                        # braces
strut(bm, (0, 0.0, 0.85), (0, -0.32, 1.15), 0.06, BODY)
new_object("post", bm, MATS)

# ---------------------------------------------------------------- mailbox
W, H, L = 0.56, 0.3, 0.95  # width, height of the straight walls, length
R = W / 2
arch = [(-R, 0), (R, 0), (R, H)]
arch += [(math.cos(a) * R, H + math.sin(a) * R) for a in (k * math.pi / 10 for k in range(1, 10))]
arch += [(-R, H)]
bm = bmesh.new()
prism(bm, arch, -L / 2, L / 2, BODY)
# Bands in the project colour around the box.
for y in (-L / 2 + 0.08, L / 2 - 0.08):
    band = [(x * 1.03, z * 1.0 + (0 if z < H else (z - H) * 0.03)) for x, z in arch]
    prism(bm, band, y - 0.025, y + 0.025, ACCENT)
# Dark mouth behind the door.
inner = [(x * 0.86, z * 0.9 + 0.02) for x, z in arch]
prism(bm, inner, -L / 2 - 0.004, -L / 2 + 0.01, SCREEN)
mailbox = new_object("mailbox", bm, MATS, location=(0, 0, 1.195))

# Envelope, lying flat just inside the mouth; the site slides it out and flies it around the box.
# Front (top, +Z): an @, a stamp and handwritten address scribbles. Back (bottom): the flap.
bm = bmesh.new()
EW, ED = 0.4, 0.28
box(bm, (0, 0, 0), (EW, ED, 0.02), PAPER)
face_up = Matrix.Rotation(-math.pi / 2, 4, "X")
engrave(bm, "@", 0.09, Matrix.Translation((-0.13, 0.065, 0.012)) @ face_up, INK)
box(bm, (0.14, 0.075, 0.013), (0.075, 0.085, 0.006), ACCENT)                # stamp
box(bm, (0.14, 0.075, 0.016), (0.045, 0.055, 0.004), PAPER)
for k, (y, x0, x1) in enumerate(((0.0, -0.16, 0.13), (-0.05, -0.16, 0.06), (-0.1, -0.16, 0.1))):
    n = 14
    pts = [Vector((x0 + (x1 - x0) * i / n, y + math.sin(i * 1.9 + k) * 0.012 + (0.006 if i % 3 == 0 else 0), 0.014))
           for i in range(n + 1)]
    for a_, b_ in zip(pts, pts[1:]):
        strut(bm, a_, b_, 0.012, INK)
for side in (-1, 1):                                                          # flap on the back
    strut(bm, (side * EW / 2 * 0.95, ED / 2 * 0.9, -0.013), (0, -0.02, -0.013), 0.012, INK)
new_object("letter", bm, MATS, parent=mailbox, location=(0.0, -L / 2 + 0.2, 0.14))

# Door: hinged along its bottom edge; exported closed, the site drops it open towards the camera.
bm = bmesh.new()
prism(bm, [(x, z) for x, z in arch], 0, 0.03, TRIM)
box(bm, (0, -0.02, H + 0.12), (0.1, 0.03, 0.04), ACCENT)                     # latch
engrave(bm, "ПОЧТА", 0.1, Matrix.Translation((0, -0.004, 0.2)), PAPER)        # outside, for the closed door
# Name painted on the inside of the door: with the door dropped open it faces up towards the
# map camera. Text faces +Y (the inside) and reads with its top towards the hinge.
engrave(bm, "ПОЧТА", 0.1, Matrix.Translation((0, 0.034, 0.42)) @ Matrix.Rotation(math.pi, 4, "X"), PAPER)
door = new_object("door", bm, MATS, parent=mailbox, location=(0, -L / 2 - 0.03, 0))

# Flag on the right side, raised: pivot at the hinge so it can drop later.
bm = bmesh.new()
box(bm, (0, 0, 0.3), (0.03, 0.05, 0.6), TRIM)
box(bm, (0, 0.17, 0.47), (0.025, 0.36, 0.26), ACCENT)
cylinder(bm, (0, 0, 0), 0.04, 0.04, axis="X", segs=8, mat=TRIM)
new_object("flag", bm, MATS, parent=mailbox, location=(R + 0.03, 0.12, H * 0.6))

export("mail")
preview({"map": (2.6, -5.5, 5.0), "front": (0.8, -4.5, 1.5), "side": (4.5, -1.5, 1.8)}, target=(0, 0, 1.0))
