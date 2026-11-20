"""Shared Blender helpers for the TRIBALCORE map models.

Axes: Blender +X is forward (three.js +X), +Z is up, and -Y faces the map camera
(three.js +Z). Materials are placeholders: scene3d.js swaps them by name for its
own flat-shaded materials and draws white edges, so only names and faces matter.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW = ARGS[ARGS.index("--preview") + 1] if "--preview" in ARGS else None

# Preview colours only; "accent" is the project's own colour on the site.
COLORS = {
    "body": (0.16, 0.24, 0.43),
    "trim": (0.11, 0.16, 0.30),
    "tire": (0.03, 0.04, 0.08),
    "screen": (0.03, 0.05, 0.12),
    "glass": (0.30, 0.55, 0.85),
    "paper": (0.79, 0.83, 0.93),
    "lamp": (1.0, 0.71, 0.28),
    "tail": (1.0, 0.42, 0.42),
    "accent": (1.0, 0.71, 0.28),
    "ink": (0.03, 0.05, 0.12),  # engraved lettering
    "figure": (0.8, 0.8, 0.8),  # vertex-coloured characters
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def material(name):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*COLORS[name], 1)
    return m


def new_object(name, bm, mats, parent=None, location=(0, 0, 0)):
    """Turn a bmesh into an object. Face material_index points into mats."""
    mesh = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    for m in mats:
        mesh.materials.append(material(m))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    return obj


def _faces_of(verts):
    return list({f for v in verts for f in v.link_faces})


def prism(bm, profile, y0, y1, mat=0):
    """Extrude an (x, z) side profile across the width y0..y1."""
    a = [bm.verts.new((x, y0, z)) for x, z in profile]
    b = [bm.verts.new((x, y1, z)) for x, z in profile]
    n = len(profile)
    faces = [bm.faces.new(a[::-1]), bm.faces.new(b)]
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    for f in faces:
        f.material_index = mat
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return faces


def box(bm, center, size, mat=0, bevel=0.0, rotate=None):
    verts = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    bmesh.ops.scale(bm, vec=size, verts=verts)
    if rotate:
        bmesh.ops.rotate(bm, verts=verts, cent=(0, 0, 0), matrix=rotate)
    bmesh.ops.translate(bm, vec=center, verts=verts)
    for f in _faces_of(verts):
        f.material_index = mat
    if bevel:
        edges = list({e for v in verts for e in v.link_edges})
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=1, affect="EDGES", profile=0.5)
    return verts


def cylinder(bm, center, radius, depth, axis="Y", segs=16, mat=0, radius2=None):
    verts = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=radius,
                                  radius2=radius if radius2 is None else radius2, depth=depth)["verts"]
    if axis == "Y":
        bmesh.ops.rotate(bm, verts=verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
    elif axis == "X":
        bmesh.ops.rotate(bm, verts=verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"))
    bmesh.ops.translate(bm, vec=center, verts=verts)
    for f in _faces_of(verts):
        f.material_index = mat
    return verts


def strut(bm, p0, p1, width, mat=0, segs=4):
    """A thin beam between two points."""
    p0, p1 = Vector(p0), Vector(p1)
    axis = p1 - p0
    verts = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=width / 2,
                                  radius2=width / 2, depth=axis.length)["verts"]
    if segs == 4:
        bmesh.ops.rotate(bm, verts=verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 4, 3, "Z"))
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix()
    bmesh.ops.rotate(bm, verts=verts, cent=(0, 0, 0), matrix=rot)
    bmesh.ops.translate(bm, vec=(p0 + p1) / 2, verts=verts)
    for f in _faces_of(verts):
        f.material_index = mat
    return verts


def inset(bm, face, thickness, mat, depth=-0.012):
    bmesh.ops.inset_individual(bm, faces=[face], thickness=thickness, depth=depth)
    face.material_index = mat


def export(name, **options):
    out = os.path.join(ROOT, "public", "assets", "models", f"{name}.glb")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    settings = dict(
        filepath=out, export_format="GLB", export_normals=False, export_texcoords=False,
        export_materials="EXPORT", export_apply=True, export_yup=True, export_animations=False,
        export_cameras=False, export_lights=False, export_skins=False, export_morph=False,
    )
    settings.update(options)
    bpy.ops.export_scene.gltf(**settings)
    print("exported", out, os.path.getsize(out), "bytes")


def preview(views, target=(0, 0, 0.6), lens=50, color_type="MATERIAL"):
    """Workbench renders from the given camera positions: {tag: (x, y, z)}."""
    if not PREVIEW:
        return
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = color_type
    sh.show_object_outline = True
    sh.show_cavity = True
    sh.cavity_type = "WORLD"
    scene.world = bpy.data.worlds.new("w")
    scene.world.color = (0.03, 0.05, 0.11)
    scene.render.resolution_x, scene.render.resolution_y = 1400, 700
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = lens
    scene.collection.objects.link(cam)
    scene.camera = cam
    gbm = bmesh.new()
    bmesh.ops.create_grid(gbm, x_segments=1, y_segments=1, size=8)
    ground = bpy.data.meshes.new("ground")
    gbm.to_mesh(ground)
    gm = bpy.data.materials.new("ground")
    gm.diffuse_color = (0.08, 0.13, 0.28, 1)
    ground.materials.append(gm)
    scene.collection.objects.link(bpy.data.objects.new("ground", ground))
    base, ext = os.path.splitext(PREVIEW)
    for tag, loc in views.items():
        cam.location = loc
        cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = f"{base}-{tag}{ext}"
        bpy.ops.render.render(write_still=True)
        print("preview", scene.render.filepath)


PEDESTAL_TOP = 0.41  # where figures stand


def engrave(bm, label, size, matrix, mat, extrude=0.006, align="CENTER"):
    """Add text as a mesh. It reads along +X and faces -Y before `matrix` is applied.
    Blender's bundled font has Cyrillic."""
    curve = bpy.data.curves.new("text", "FONT")
    curve.body = label
    curve.size = size
    curve.align_x = align
    curve.align_y = "CENTER"
    curve.extrude = extrude
    obj = bpy.data.objects.new("text", curve)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.update()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(obj)
    mesh.transform(Matrix(matrix) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    before = len(bm.faces)
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    for f in bm.faces[before:]:
        f.material_index = mat
    bpy.data.meshes.remove(mesh)


def pedestal(label, plate_width=0.7, text_size=0.1):
    """Collectible-figure base shared by the project statuettes: dark foot, a band in the
    project colour (material "accent"), a tapered drum, a cap and a nameplate facing the camera.
    Creates the object "bench"; returns the height of its top."""
    body, trim, paper, accent, screen, ink = range(6)
    bm = bmesh.new()
    seg = 32
    cylinder(bm, (0, 0, 0.04), 1.12, 0.08, axis="Z", segs=seg, mat=trim)
    cylinder(bm, (0, 0, 0.095), 1.06, 0.03, axis="Z", segs=seg, mat=accent)
    cylinder(bm, (0, 0, 0.235), 1.02, 0.25, axis="Z", segs=seg, mat=body, radius2=0.94)
    cylinder(bm, (0, 0, 0.38), 0.97, 0.04, axis="Z", segs=seg, mat=trim)
    cylinder(bm, (0, 0, 0.405), 0.9, 0.01, axis="Z", segs=seg, mat=screen)

    taper = math.atan2(1.02 - 0.94, 0.25)
    tilt = Matrix.Rotation(-taper, 3, "X")  # leans back with the drum
    plate_at = Matrix.Translation((0, -0.985, 0.235))
    box(bm, (0, -0.985, 0.235), (plate_width, 0.02, 0.15), paper, bevel=0.01, rotate=tilt)

    # Engraved name, standing slightly proud of the plate.
    engrave(bm, label, text_size, plate_at @ tilt.to_4x4() @ Matrix.Translation((0, -0.017, 0)), ink)
    new_object("bench", bm, ["body", "trim", "paper", "accent", "screen", "ink"])
    return PEDESTAL_TOP
