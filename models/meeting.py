"""Meeting to Spec statuette: a meeting recording on cassette turns into a spec sheet.

Run: blender --background --factory-startup --python models/meeting.py -- [--preview out.png]
A tape ribbon in the project colour runs from the cassette into the sheet, where
matching marks stand for links back to fragments of the recording.
Node names used by the site: bench, cassette, reel_L, reel_R, tape, spec, highlight (row step 0.085).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from kit import box, cylinder, engrave, export, new_object, pedestal, preview, prism, reset, strut  # noqa: E402

reset()
TOP = pedestal("MEETING TO SPEC", plate_width=0.86, text_size=0.075)
BODY, TRIM, PAPER, ACCENT, SCREEN, INK = range(6)
MATS = ["body", "trim", "paper", "accent", "screen", "ink"]

# ---------------------------------------------------------------- cassette
# Stands upright facing the camera (-Y); local origin at the centre of the shell.
CW, CD, CH = 0.96, 0.12, 0.6
F = -CD / 2  # front face
bm = bmesh.new()
box(bm, (0, 0, 0), (CW, CD, CH), TRIM, bevel=0.03)
box(bm, (0, F - 0.005, 0.15), (CW - 0.14, 0.012, 0.2), PAPER)            # label
box(bm, (0, F - 0.012, 0.215), (CW - 0.14, 0.01, 0.045), ACCENT)         # label stripe
for i, z in enumerate((0.15, 0.1)):
    box(bm, (-0.08 + i * 0.04, F - 0.012, z), (0.5 - i * 0.16, 0.01, 0.018), INK)  # handwriting
box(bm, (0, F - 0.004, -0.04), (0.5, 0.012, 0.16), SCREEN)              # reel window
prism(bm, [(-0.28, -CH / 2), (0.28, -CH / 2), (0.22, -0.2), (-0.22, -0.2)], F - 0.02, F, BODY)  # head guard
for x in (-0.1, 0.1):
    cylinder(bm, (x, F - 0.02, -0.25), 0.025, 0.01, axis="Y", segs=8, mat=SCREEN)
for x in (-CW / 2 + 0.06, CW / 2 - 0.06):
    for z in (-CH / 2 + 0.06, CH / 2 - 0.06):
        cylinder(bm, (x, F - 0.004, z), 0.018, 0.012, axis="Y", segs=6, mat=BODY)  # screws
cassette = new_object("cassette", bm, MATS, location=(-0.42, 0.22, TOP + 0.06 + CH / 2))
cassette.rotation_euler = (0, 0, 0.22)

# Reels: separate nodes so they can spin later.
for name, x in (("reel_L", -0.17), ("reel_R", 0.17)):
    bm = bmesh.new()
    cylinder(bm, (0, 0, 0), 0.075, 0.02, axis="Y", segs=16, mat=ACCENT)
    cylinder(bm, (0, -0.012, 0), 0.03, 0.01, axis="Y", segs=6, mat=PAPER)
    for k in range(6):
        a = k * math.tau / 6
        box(bm, (math.cos(a) * 0.05, -0.012, math.sin(a) * 0.05), (0.018, 0.008, 0.018), INK)
    new_object(name, bm, MATS, parent=cassette, location=(x, F - 0.016, -0.04))

# Little cradle the cassette stands in.
bm = bmesh.new()
box(bm, (0, 0, 0.025), (0.8, 0.26, 0.05), BODY, bevel=0.012)
for y in (-0.1, 0.1):
    box(bm, (0, y, 0.07), (0.8, 0.03, 0.06), BODY)
cradle = new_object("cradle", bm, MATS, location=(-0.42, 0.22, TOP))
cradle.rotation_euler = (0, 0, 0.22)

# ---------------------------------------------------------------- spec sheet on an easel
# Local origin at the bottom edge of the sheet; the sheet leans back by LEAN.
SW, SH, LEAN = 0.7, 0.9, 0.28
bm = bmesh.new()
sheet = Matrix.Rotation(-LEAN, 4, "X")  # lean back (top towards +Y)


def on_sheet(x, z, depth=0.0):
    """A point on the sheet face (x across, z up the sheet), lifted towards the viewer."""
    return sheet @ Vector((x, -depth, z))


box(bm, on_sheet(0, SH / 2), (SW, 0.02, SH), PAPER, rotate=sheet.to_3x3())
# Folded corner (top right): a small triangle lying on the sheet.
corner = [on_sheet(SW / 2 - 0.11, SH, d) for d in (0.012, 0.018)]
tip = [on_sheet(SW / 2, SH - 0.11, d) for d in (0.012, 0.018)]
mid_c = [on_sheet(SW / 2 - 0.11, SH - 0.11, d) for d in (0.012, 0.018)]
back = [bm.verts.new(p[0]) for p in (corner, tip, mid_c)]
front = [bm.verts.new(p[1]) for p in (corner, tip, mid_c)]
for f in [bm.faces.new(back), bm.faces.new(front[::-1])] + [
        bm.faces.new((back[i], back[(i + 1) % 3], front[(i + 1) % 3], front[i])) for i in range(3)]:
    f.material_index = BODY
# Title.
engrave(bm, "ТЗ", 0.13, Matrix.Translation(on_sheet(-SW / 2 + 0.06, SH - 0.1, 0.012)) @ sheet, INK, align="LEFT")
# Text lines; the ones with a mark in the project colour link back to the recording.
rows = [(0.42, True), (0.3, False), (0.36, True), (0.24, False), (0.4, False), (0.3, True)]
for i, (length, linked) in enumerate(rows):
    z = SH - 0.26 - i * 0.085
    centre = on_sheet(-SW / 2 + 0.06 + length / 2, z, 0.012)
    box(bm, centre, (length, 0.006, 0.025), INK, rotate=sheet.to_3x3())
    if linked:
        box(bm, on_sheet(SW / 2 - 0.09, z, 0.014), (0.07, 0.008, 0.045), ACCENT, rotate=sheet.to_3x3())
# Easel: ledge in front, two legs behind.
box(bm, (0, -0.03, 0.02), (SW + 0.08, 0.08, 0.04), TRIM, bevel=0.01)
top_back = on_sheet(0, SH * 0.8, -0.02)
for x in (-0.2, 0.2):
    strut(bm, (x, 0.32, 0.0), (x, top_back.y, top_back.z), 0.035, TRIM)
spec = new_object("spec", bm, MATS, location=(0.48, 0.12, TOP))
spec.rotation_euler = (0, 0, -0.3)

# Reading marker: a bar over the first text line; the site steps it down the lines
# along its own local up axis (the sheet's slope).
bm = bmesh.new()
box(bm, (0, 0, 0), (SW - 0.06, 0.006, 0.07), ACCENT)
marker = new_object("highlight", bm, MATS, parent=spec, location=on_sheet(0, SH - 0.26, 0.022))
marker.rotation_euler = (-LEAN, 0, 0)

# ---------------------------------------------------------------- tape
# A ribbon in the project colour from the cassette into the bottom of the sheet.
bm = bmesh.new()
start = Vector((-0.12, 0.08, TOP + 0.13))
mid = Vector((0.02, -0.62, TOP + 0.02))
end = Vector((0.2, 0.0, TOP + 0.1))
pts = []
for k in range(13):
    t = k / 12
    pts.append((1 - t) ** 2 * start + 2 * (1 - t) * t * mid + t ** 2 * end)
for a, b in zip(pts, pts[1:]):
    strut(bm, a, b, 0.06, ACCENT)
new_object("tape", bm, MATS)

export("meeting")
preview({"map": (3.0, -7.0, 6.5), "front": (0.4, -5.0, 1.4), "side": (5.0, -2.5, 2.0)}, target=(0, 0, 0.7))
