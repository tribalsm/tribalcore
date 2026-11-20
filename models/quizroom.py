"""QuizRoom station: a quiz-show stage with three player podiums and a live scoreboard.

Run: blender --background --factory-startup --python models/quizroom.py -- [--preview out.png]
The board shows the room code players join with and the results table.
Node names used by the site: stage, podium_1..3, buzzer_1..3, board.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
from mathutils import Matrix  # noqa: E402

from kit import box, cylinder, engrave, export, new_object, preview, reset, strut  # noqa: E402

reset()
BODY, TRIM, PAPER, ACCENT, SCREEN, INK = range(6)
MATS = ["body", "trim", "paper", "accent", "screen", "ink"]
STAGE = 0.16  # stage top

# ---------------------------------------------------------------- stage
bm = bmesh.new()
box(bm, (0, 0.05, STAGE / 2), (2.5, 1.5, STAGE), BODY, bevel=0.03)
box(bm, (0, -0.76, 0.05), (1.2, 0.2, 0.1), TRIM, bevel=0.015)            # front step
box(bm, (0, -0.705, STAGE - 0.03), (2.4, 0.012, 0.025), ACCENT)          # light strip
new_object("stage", bm, MATS)

# ---------------------------------------------------------------- podiums
# Fan out a little so each faces the front-centre.
for i, (x, yaw) in enumerate(((-0.78, 0.25), (0.0, 0.0), (0.78, -0.25)), start=1):
    bm = bmesh.new()
    H = 0.62 if i != 2 else 0.68
    box(bm, (0, 0, H / 2), (0.5, 0.38, H), TRIM, bevel=0.02)
    box(bm, (0, -0.2, H * 0.55), (0.4, 0.02, H * 0.6), SCREEN)            # front panel
    box(bm, (0, -0.205, H * 0.82), (0.4, 0.012, 0.03), ACCENT)            # panel top light
    engrave(bm, str(i), 0.22, Matrix.Translation((0, -0.215, H * 0.5)), PAPER)
    box(bm, (0, 0, H + 0.015), (0.54, 0.42, 0.03), BODY)                  # top
    podium = new_object(f"podium_{i}", bm, MATS, location=(x, -0.25, STAGE))
    podium.rotation_euler = (0, 0, yaw)
    # Buzzer: base ring and a dome; the middle player has just pressed it.
    bm = bmesh.new()
    cylinder(bm, (0, 0, 0.025), 0.13, 0.05, axis="Z", segs=16, mat=2)
    dome = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.1)["verts"]
    for v in dome:
        v.co.z = max(v.co.z, 0) * 0.8
    bmesh.ops.translate(bm, vec=(0, 0, 0.05), verts=dome)
    for f in {f for v in dome for f in v.link_faces}:
        f.material_index = 0 if i == 2 else 1  # pressed one in the project colour
    bmesh.ops.remove_doubles(bm, verts=dome, dist=0.0005)
    new_object(f"buzzer_{i}", bm, ["accent", "paper", "trim"], parent=podium, location=(0, 0.02, H + 0.03))

# ---------------------------------------------------------------- scoreboard
bm = bmesh.new()
BW, BH, BZ = 2.2, 1.0, 1.55  # board width, height, centre height
for x in (-0.85, 0.85):
    strut(bm, (x, 0.08, 0), (x, 0.08, BZ - BH / 2), 0.07, TRIM, segs=6)
box(bm, (0, 0, BZ), (BW, 0.1, BH), TRIM, bevel=0.03)
box(bm, (0, -0.055, BZ), (BW - 0.12, 0.012, BH - 0.12), SCREEN)
F = -0.065
engrave(bm, "QUIZROOM", 0.17, Matrix.Translation((0, F, BZ + 0.3)), ACCENT)
# Room code players join with.
box(bm, (-0.55, F, BZ - 0.12), (0.8, 0.012, 0.36), INK)
engrave(bm, "КОД", 0.08, Matrix.Translation((-0.55, F - 0.006, BZ - 0.01)), PAPER)
engrave(bm, "4821", 0.17, Matrix.Translation((-0.55, F - 0.006, BZ - 0.17)), PAPER)
# Results table: three bars, the leader in the project colour.
for k, (h, mat) in enumerate(((0.36, ACCENT), (0.26, PAPER), (0.16, PAPER))):
    x = 0.22 + k * 0.26
    base = BZ - 0.32
    box(bm, (x, F, base + h / 2), (0.18, 0.012, h), mat)
    engrave(bm, str(k + 1), 0.07, Matrix.Translation((x, F - 0.006, base - 0.06)), PAPER)
board = new_object("board", bm, MATS, location=(0, 0.55, STAGE))

export("quizroom")
preview({"map": (3.5, -7.5, 7.0), "front": (0.3, -6.0, 1.6), "side": (6.0, -3.0, 2.5)}, target=(0, 0, 0.9))
