"""Debugych station: the Debugych mascot inspects his bug with a magnifier on a test bench.

Run: blender --background --factory-startup --python models/debugych.py -- [--preview out.png] [--source DIR]

The characters come from the Debugych project's own companion models
(apps/web/public/companion in debugych-publish-clean): debugych_interaction.glb
(pose "inspect_with_magnifier") and debugych_bug_final.glb (pose "scared").
Each is frozen in one frame, its textures are sampled into vertex colours,
and the mesh is reduced so the station stays small for the map.
Node names used by the site: bench, debugych, bug. Material "figure" uses vertex colours.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import numpy as np  # noqa: E402

from kit import ARGS, export, material, pedestal, preview, reset  # noqa: E402

SOURCE = ARGS[ARGS.index("--source") + 1] if "--source" in ARGS else os.path.expanduser(
    "~/Documents/Codex/2026-10-28/debugych-publish-clean/apps/web/public/companion")

scene = reset()
TOP = pedestal("ДЕБАГЫЧ")  # figures stand on the pedestal top


# ---------------------------------------------------------------- characters
def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def base_colour_sampler(mat):
    """Returns f(uv array) -> linear RGB for the base colour of a glTF-imported material."""
    base, image = np.array([0.6, 0.6, 0.6]), None
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if mat and mat.use_nodes else None
    if bsdf:
        socket = bsdf.inputs["Base Color"]
        base = np.array(socket.default_value[:3])
        stack = [link.from_node for link in socket.links]
        while stack:
            node = stack.pop()
            if node.type == "TEX_IMAGE" and node.image:
                image = node.image
                break
            stack.extend(link.from_node for i in node.inputs for link in i.links)
    if image is None:
        return lambda uv: np.tile(base, (len(uv), 1))
    w, h = image.size
    px = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[:, :, :3]
    if image.colorspace_settings.name.lower().startswith("srgb"):
        px = srgb_to_linear(px)

    def sample(uv):
        x = np.clip((uv[:, 0] % 1.0) * w, 0, w - 1).astype(int)
        y = np.clip((uv[:, 1] % 1.0) * h, 0, h - 1).astype(int)
        return px[y, x]
    return sample


def freeze(path, action_name, frame, skip_materials=()):
    """Import a rigged GLB, pose it at one frame; return (verts, faces, vertex colours) in world space."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for arm in (o for o in new if o.type == "ARMATURE"):
        ad = arm.animation_data or arm.animation_data_create()
        for track in ad.nla_tracks:
            track.mute = True
        action = bpy.data.actions[action_name]
        ad.action = action
        if hasattr(ad, "action_slot") and getattr(action, "slots", None):
            ad.action_slot = action.slots[0]
    scene.frame_set(frame)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    verts, faces, colours, offset = [], [], [], 0
    for obj in new:
        if obj.type != "MESH" or not obj.data.materials:  # skips the helper icosphere
            continue
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), depsgraph=depsgraph)
        mesh.transform(obj.matrix_world)
        n, nl = len(mesh.vertices), len(mesh.loops)
        co = np.empty(n * 3)
        mesh.vertices.foreach_get("co", co)
        loop_uv = np.zeros(nl * 2)
        if mesh.uv_layers.active:
            mesh.uv_layers.active.data.foreach_get("uv", loop_uv)
        loop_uv = loop_uv.reshape(-1, 2)
        loop_vert = np.empty(nl, dtype=int)
        mesh.loops.foreach_get("vertex_index", loop_vert)
        loop_col = np.zeros((nl, 3))
        for slot, mat in enumerate(mesh.materials):
            polys = [p for p in mesh.polygons if p.material_index == slot]
            if not polys:
                continue
            loops = np.array([li for p in polys for li in p.loop_indices])
            loop_col[loops] = base_colour_sampler(mat)(loop_uv[loops])
            if not (mat and mat.name in skip_materials):
                faces.extend([offset + v for v in p.vertices] for p in polys)
        acc, cnt = np.zeros((n, 3)), np.zeros(n)
        np.add.at(acc, loop_vert, loop_col)
        np.add.at(cnt, loop_vert, 1)
        verts.append(co.reshape(n, 3))
        colours.append(acc / np.maximum(cnt, 1)[:, None])
        offset += n
        bpy.data.meshes.remove(mesh)
    for obj in new:
        bpy.data.objects.remove(obj, do_unlink=True)
    return np.vstack(verts), faces, np.vstack(colours)


def figure(name, data, height, location, yaw, faces_target):
    verts, faces, colours = data
    used = sorted({v for f in faces for v in f})  # drop vertices of skipped materials
    remap = np.full(len(verts), -1)
    remap[used] = np.arange(len(used))
    verts, colours = verts[used], colours[used]
    faces = [[int(remap[v]) for v in f] for f in faces]
    lo, hi = verts.min(0), verts.max(0)
    verts = (verts - [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]]) * (height / (hi[2] - lo[2]))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts.tolist(), [], faces)
    mesh.update()
    attr = mesh.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", np.hstack([np.clip(colours, 0, 1), np.ones((len(colours), 1))]).ravel())
    mesh.color_attributes.active_color = attr
    mesh.materials.append(material("figure"))
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (0, 0, yaw)
    obj.modifiers.new("reduce", "DECIMATE").ratio = min(1.0, faces_target / max(1, len(faces)))
    print(name, "faces", len(faces), "->", faces_target)
    return obj


hero = freeze(os.path.join(SOURCE, "debugych_interaction.glb"), "inspect_with_magnifier", 42)
bug = freeze(os.path.join(SOURCE, "debugych_bug_final.glb"), "scared", 18, skip_materials=("Defeated_Red_X",))
figure("debugych", hero, 2.2, (-0.3, 0.2, TOP), 0.55, 5500)
figure("bug", bug, 0.55, (0.45, -0.35, TOP), 0.74, 2800)

export("debugych", export_vertex_color="ACTIVE")
preview({"map": (3.0, -7.0, 6.5), "front": (0.6, -5.0, 1.8), "side": (5.0, -2.0, 2.0)},
        target=(0, 0, 1.0), color_type="VERTEX")
