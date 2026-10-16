# The Blender add-on, headless (tests/unit/blender.test.mjs runs this with Blender's Python): models made in code,
# checked as the add-on checks them, and exported with the game's settings for the test to check with the game's own
# importer. Prints one line: RESULT {json}.
#
#   <blender python> tests/blender/addon_test.py <add-on's parent folder> <output folder>
#   (or: blender --background --factory-startup --python tests/blender/addon_test.py -- <add-on's parent> <out>)

import json
import os
import sys

import bpy

addon_parent, out_dir = sys.argv[-2], sys.argv[-1]
sys.path.insert(0, addon_parent)
import ognistrada_tools as T  # noqa: E402

T.register()
ctx = bpy.context
results = {}


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def material(name):
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)


def box(name, size, centre, mat="paint", grid=1):
    """A box in the game's frame (size: x wide, y tall, z long; centre), as Blender objects are: Z up, front -Y.
    grid: each face split grid × grid (for a mesh with many triangles)"""
    verts, faces = [], []
    sx, sy, sz = (s / 2 for s in size)
    cx, cy, cz = centre

    def g2b(x, y, z):
        return (x, -z, y)

    def face(origin, du, dv):
        base = len(verts)
        for i in range(grid + 1):
            for j in range(grid + 1):
                verts.append(g2b(*[origin[k] + du[k] * i / grid + dv[k] * j / grid for k in range(3)]))
        for i in range(grid):
            for j in range(grid):
                a = base + i * (grid + 1) + j
                faces.append((a, a + grid + 1, a + grid + 2, a + 1))

    x0, x1, y0, y1, z0, z1 = cx - sx, cx + sx, cy - sy, cy + sy, cz - sz, cz + sz
    face((x0, y0, z0), (2 * sx, 0, 0), (0, 0, 2 * sz))
    face((x0, y1, z0), (0, 0, 2 * sz), (2 * sx, 0, 0))
    face((x0, y0, z0), (0, 2 * sy, 0), (2 * sx, 0, 0))
    face((x0, y0, z1), (2 * sx, 0, 0), (0, 2 * sy, 0))
    face((x0, y0, z0), (0, 0, 2 * sz), (0, 2 * sy, 0))
    face((x1, y0, z0), (0, 2 * sy, 0), (0, 0, 2 * sz))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    me.materials.append(material(mat))
    o = bpy.data.objects.new(name, me)
    ctx.scene.collection.objects.link(o)
    return o


def summary(findings):
    return {"verdict": T.verdict(findings), "fails": [f["text"] for f in findings if f["level"] == "fail"], "warns": [f["text"] for f in findings if f["level"] == "warn"]}


T.setup_scene(ctx)

# 1. a good spoiler: 1.2 m wide, 6 cm tall, 30 cm long, its bottom at the origin
clear()
box("spoiler_test", (1.2, 0.06, 0.3), (0, 0.03, 0))
results["good"] = summary(T.check_scene(ctx, "spoiler", "test"))
path, _ = T.export_model(ctx, "spoiler", "addon_test", out_dir)
results["exported"] = path

# 2. made in centimetres
clear()
box("spoiler_cm", (120, 6, 30), (0, 3, 0))
results["centimetres"] = summary(T.check_scene(ctx, "spoiler", "cm"))
results["refused"] = T.export_model(ctx, "spoiler", "cm", out_dir)[0] is None

# 3. its origin left a metre below it, then placed
clear()
box("spoiler_high", (1.2, 0.06, 0.3), (0, 1.03, 0))
results["origin"] = summary(T.check_scene(ctx, "spoiler", "high"))
T.place_at_origin(ctx, "spoiler", selected_only=False)
results["placed"] = summary(T.check_scene(ctx, "spoiler", "high"))

# 4. a level of detail of its own with far too many triangles; then one within its budget, exported with it
# (the model: 2,700 triangles; its LOD1's budget is 35% of the spoiler's 2,000: 700)
clear()
box("wing", (1.2, 0.06, 0.3), (0, 0.03, 0), grid=15)
box("wing__lod1", (1.2, 0.06, 0.3), (0, 0.03, 0), grid=13)
results["lod_heavy"] = summary(T.check_scene(ctx, "spoiler", "lod"))
bpy.data.objects.remove(bpy.data.objects["wing__lod1"], do_unlink=True)
box("wing__lod1", (1.2, 0.06, 0.3), (0, 0.03, 0), grid=4)
results["lod_ok"] = summary(T.check_scene(ctx, "spoiler", "lod"))
results["exported_lod"] = T.export_model(ctx, "spoiler", "addon_lod", out_dir)[0]

# 5. a material the game doesn't know
clear()
box("spoiler_mat", (1.2, 0.06, 0.3), (0, 0.03, 0), mat="Material.001")
results["material"] = summary(T.check_scene(ctx, "spoiler", "mat"))

# 6. a new car without its front bumper's socket
clear()
box("body", (1.8, 1.3, 4.3), (0, 0.75, 0))
for n, at in {"socket_wheel_FL": (0.78, 0.32, 1.35), "socket_wheel_FR": (-0.78, 0.32, 1.35), "socket_wheel_RL": (0.78, 0.32, -1.3), "socket_wheel_RR": (-0.78, 0.32, -1.3)}.items():
    ctx.scene.cursor.location = T.to_blender(at)
    T.add_socket(ctx, n)
results["car"] = summary(T.check_scene(ctx, "car", "addon_car", new_car=True))
for n in T.rules()["car"]["expectedSockets"]:
    if n != "socket_bumper_front":
        ctx.scene.cursor.location = (0, 0, 0.5)
        T.add_socket(ctx, n)
results["car_one_missing"] = summary(T.check_scene(ctx, "car", "addon_car", new_car=True))
results["car_typo"] = None
bpy.data.objects["socket_spoiler"].name = "socket_spoilr"
results["car_typo"] = summary(T.check_scene(ctx, "car", "addon_car", new_car=True))

# 7. a kit piece: a wing's end plate (its inner face at x 0, the element's middle at y 0, z 0), exported as a kit piece;
# then one in the palette texture (a kit piece can't be)
clear()
box("plate", (0.006, 0.2, 0.44), (0.003, 0.03, -0.02), mat="carbon")
results["kit"] = summary(T.check_scene(ctx, "kit:spoiler:endplate", "fin"))
results["kit_kinds"] = [k for k, _, _ in T.kind_items(None, ctx) if k.startswith("kit:")]
results["kit_exported"] = T.export_model(ctx, "kit:spoiler:endplate", "addon_fin", out_dir)[0]
clear()
box("plate_atlas", (0.006, 0.2, 0.44), (0.003, 0.03, -0.02), mat="car_atlas")
results["kit_atlas"] = summary(T.check_scene(ctx, "kit:spoiler:endplate", "atlas"))
clear()
box("plate_off", (0.006, 0.2, 0.44), (0.25, 0.03, -0.02), mat="carbon")
results["kit_origin"] = summary(T.check_scene(ctx, "kit:spoiler:endplate", "off"))
T.place_at_origin(ctx, "kit:spoiler:endplate", selected_only=False)
results["kit_placed"] = summary(T.check_scene(ctx, "kit:spoiler:endplate", "off"))

print("RESULT " + json.dumps(results))
