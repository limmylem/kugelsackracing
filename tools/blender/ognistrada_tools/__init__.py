# Ognistrada tools: a Blender add-on for making car and part models for the game (Phase 8 Step 3;
# docs/CONTENT_PIPELINE.md, docs/MODELLING_GUIDE.md). In the 3D View's sidebar (N) › Ognistrada:
#
#  - Set up the scene: metric units, unit scale 1.0 (a model made in centimetres is the commonest mistake)
#  - What it is: a part type (spoiler, rim, bonnet…) or a car, and its name
#  - Add socket: an empty named exactly as the game wants it (socket_bumper_front…), at the 3D cursor
#  - Place at origin: moves the model so the point it attaches by is at the origin, by its type's rule
#  - Check: the same rules as the game's importer (model_rules.json, a copy of data/content/model-rules.json made
#    by npm run guide), in plain words with how to fix each — size and scale, where the origin is, transforms
#    applied, material names, the triangle budget and each level of detail's ("LOD1 has 3× too many triangles"),
#    a car's sockets ("Front bumper missing socket ...") and textures
#  - Export: checks, then writes <type>_<name>.glb with the game's export settings (glTF binary, +Y up, modifiers
#    applied; no cameras, lights, animations or armatures) into the folder chosen (the game's incoming/ folder:
#    npm run import does the rest — levels of detail, compressed textures, collision, the part file)
#
# Levels of detail are optional: objects named <name>__lod1 are the game's LOD1 of <name> (otherwise the importer
# makes them). Blender's axes: +Z up, the car's front towards -Y, its left towards +X (the exporter turns them into
# the game's +Y up, front +Z).
#
# Install: npm run blender-addon makes tools/blender/dist/ognistrada_tools.zip; Blender › Edit › Preferences ›
# Add-ons › Install from Disk. It works headless too: check_scene(context, kind, name) → findings, export_model(…).

bl_info = {
    "name": "Ognistrada tools",
    "author": "Ognistrada",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "3D View › Sidebar › Ognistrada",
    "description": "Check and export car and part models for Ognistrada: sockets, scale, origins, budgets, the game's export settings",
    "category": "Import-Export",
}

import json
import math
import os
import re

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
_rules = None


def rules():
    global _rules
    if _rules is None:
        with open(os.path.join(HERE, "model_rules.json"), encoding="utf-8") as f:
            _rules = json.load(f)
    return _rules


# Blender (x, y, z) → the game's (x, y, z): +X left stays, +Z up → +Y, -Y front → +Z
def to_game(v):
    return (v[0], v[2], -v[1])


def to_blender(g):
    return Vector((g[0], -g[2], g[1]))


LOD = re.compile(r"^(.*)__lod(\d+)$")
AXES = (("x", "wide"), ("y", "tall"), ("z", "long"))


def m(v):
    v = abs(v)
    return f"{v:.0f}" if v >= 10 else f"{v:.2f}" if v >= 1 else f"{v:.3f}".rstrip("0").rstrip(".") if v else "0"


def listed(xs):
    xs = list(xs)
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1] if xs else ""


def article(w):
    return ("an " if w[:1].lower() in "aeiou" else "a ") + w.lower()


# ---------- what's in the scene ----------

def model_objects(context, selected_only):
    objs = context.selected_objects if selected_only else context.scene.objects
    return [o for o in objs if o.visible_get() or selected_only]


def triangles_of(obj, depsgraph):
    """The object's triangles in the game's frame (modifiers applied, as the exporter writes them): [(a, b, c)]"""
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    try:
        mesh.calc_loop_triangles()
        mw = obj.matrix_world
        verts = [to_game(mw @ v.co) for v in mesh.vertices]
        return [tuple(verts[i] for i in t.vertices) for t in mesh.loop_triangles], [s.material.name if s.material else None for s in obj.material_slots]
    finally:
        ev.to_mesh_clear()


def gather(context, selected_only=False):
    dg = context.evaluated_depsgraph_get()
    out = {"tris": [], "lods": {}, "materials": set(), "no_material": [], "objects": [], "sockets": {}, "extras": [], "images": []}
    for o in model_objects(context, selected_only):
        if o.type == "MESH":
            tris, mats = triangles_of(o, dg)
            lv = LOD.match(o.name)
            if lv:
                out["lods"][int(lv.group(2))] = out["lods"].get(int(lv.group(2)), 0) + len(tris)
                continue
            out["tris"] += tris
            out["objects"].append(o)
            if not mats or any(x is None for x in mats):
                out["no_material"].append(o.name)
            out["materials"].update(x for x in mats if x)
            for slot in o.material_slots:
                mat = slot.material
                if mat and mat.use_nodes:
                    for n in mat.node_tree.nodes:
                        if n.type == "TEX_IMAGE" and n.image:
                            out["images"].append(n.image)
        elif o.type == "EMPTY" and o.name.startswith("socket"):
            out["sockets"][o.name] = to_game(o.matrix_world.translation)
        elif o.type in ("CAMERA", "LIGHT", "ARMATURE"):
            out["extras"].append(f"{o.name} ({o.type.lower()})")
    return out


def bounds(tris):
    if not tris:
        return None
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for t in tris:
        for v in t:
            for k in range(3):
                lo[k] = min(lo[k], v[k])
                hi[k] = max(hi[k], v[k])
    return lo, hi


# ---------- the checks (the importer's rules: tools/content/check.mjs) ----------

UNIT_GUESSES = [(100, "100× too big", "made in centimetres"), (1000, "1000× too big", "made in millimetres"), (39.37, "about 39× too big", "made in inches"),
                (10, "10× too big", "made in decimetres"), (0.01, "100× too small", "scaled down twice"), (0.1, "10× too small", "scaled down by 10")]


def unit_guess(size, ranges):
    for factor, words, cause in UNIT_GUESSES:
        if all(not ranges.get(ax) or ranges[ax][0] * 0.9 <= size[k] / factor <= ranges[ax][1] * 1.1 for k, (ax, _) in enumerate(AXES)):
            return factor, words, cause
    return None


def closest(name, names):
    def d(a, b):
        prev = list(range(len(b) + 1))
        for i, ca in enumerate(a, 1):
            cur = [i]
            for j, cb in enumerate(b, 1):
                cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
            prev = cur
        return prev[-1]
    best = min(names, key=lambda n: d(name.lower(), n.lower()), default=None)
    return best if best and d(name.lower(), best.lower()) <= max(2, len(best) // 6) else None


SIDES = {"FL": "left", "FR": "right", "RL": "left", "RR": "right"}


def socket_label(name):
    """A socket in words, by the part type that goes there: socket_bumper_front → "Front bumper", socket_fender_FL →
    "Left front wing", socket_seat_driver → "Seat (driver)" (tools/content/check.mjs socketLabel says the same)"""
    R = rules()
    slot = name[len("socket_"):] if name.startswith("socket_") else name
    parts = slot.split("_")
    tries = [slot, "_".join(SIDES.get(w, w) for w in parts)] + ["_".join(parts[:i]) for i in range(len(parts) - 1, 0, -1)]
    for i, k in enumerate(tries):
        t = R["types"].get(k) or next((t for t in R["types"].values() if t["slot"] == k), None)
        if t:
            label = re.sub(r" \(.*\)$", "", t["label"])
            rest = parts[len(k.split("_")):] if i >= 2 else []
            return label + (f" ({' '.join(rest)})" if rest else "")
    corner = {"FL": "left front", "FR": "right front", "RL": "left rear", "RR": "right rear"}.get(parts[-1])
    words = f"{corner} {' '.join(parts[:-1])}" if corner else " ".join(parts)
    return words[:1].upper() + words[1:]


def allowed_material(name):
    M = rules()["materials"]
    return name in M["names"] or any(re.search(p, name) for p in M["patterns"]) or (M.get("finishes") and name in rules().get("finishNames", []))


def check_scene(context, kind, name="", selected_only=False, new_car=False):
    """The checks, as the game's importer runs them: [{level: pass|warn|fail, check, text, fix}]"""
    R = rules()
    out = []

    def add(level, check, text, fix=None):
        out.append({"level": level, "check": check, "text": text, "fix": fix})

    is_car = kind == "car"
    t = None if is_car else R["types"].get(kind)
    if not is_car and not t:
        add("fail", "type", f'"{kind}" isn\'t a part type the game knows.', "Choose one in the Ognistrada panel.")
        return out
    us = context.scene.unit_settings
    if us.system != "METRIC" or abs(us.scale_length - 1) > 1e-6:
        add("fail", "units", f"The scene's units are {us.system.lower()} with a unit scale of {us.scale_length:g}: the game works in metres.", "Press Set up the scene (Scene properties › Units: Metric, Unit Scale 1.0), then make the model its real size.")
    g = gather(context, selected_only)
    if g["extras"]:
        add("fail", "extras", f"{listed(g['extras'])}: a game model is only meshes and (for a car) its sockets.", "Delete them, or select only the model and tick Selected only.")
    if not g["tris"]:
        add("fail", "contents", "There's nothing to export: no meshes" + (" selected." if selected_only else "."), "Model it, or select it.")
        return out
    for o in g["objects"]:
        s, r = o.scale, o.rotation_euler
        if any(abs(v - 1) > 1e-4 for v in s) or any(abs(v) > 1e-4 for v in r):
            add("warn", "transforms", f"{o.name}'s rotation and scale aren't applied (scale {s[0]:.3g}/{s[1]:.3g}/{s[2]:.3g}).", "Select it, Ctrl+A › All Transforms.")
    # triangles, and each level of detail's share
    n = len(g["tris"])
    budget = R["car"]["triangles"] if is_car else t["triangles"]
    what = "a car body" if is_car else article(t["label"])
    if n > budget * 2:
        add("fail", "triangles", f"{n:,} triangles: far over the budget for {what} ({budget:,}).", "Simplify it (a Decimate modifier, or delete hidden faces).")
    elif n > budget:
        add("warn", "triangles", f"{n:,} triangles: over the budget for {what} ({budget:,}).", "Simplify it if you can.")
    else:
        add("pass", "triangles", f"{n:,} triangles (budget {budget:,}).")
    L = R.get("lods")
    for level, k in sorted(g["lods"].items()):
        spec = L["levels"][level - 1] if L and level <= len(L["levels"]) else None
        if not spec:
            add("warn", "lods", f"There's an LOD{level}, but the game only uses LOD1–LOD{len(L['levels']) if L else 0}.", f"Delete the objects named …__lod{level}.")
            continue
        b = max(1, round(budget * spec["ratio"]))
        fix = f"Simplify the objects named …__lod{level} (a Decimate modifier, ratio about {min(1, b / k):.2f}), or delete them and the importer makes LOD{level} itself."
        if k >= n:
            add("fail", "lods", f"LOD{level} has {k:,} triangles: no fewer than the model itself ({n:,}).", fix)
        elif k > b * 2:
            add("fail", "lods", f"LOD{level} has {round(k / b)}× too many triangles: {k:,}, where its budget is {b:,} ({round(spec['ratio'] * 100)}% of {budget:,}).", fix)
        elif k > b:
            add("warn", "lods", f"LOD{level} has {k:,} triangles: over its budget of {b:,}.", fix)
        else:
            add("pass", "lods", f"LOD{level}: {k:,} triangles (budget {b:,}).")
    # materials
    bad = sorted(x for x in g["materials"] if not allowed_material(x))
    if g["no_material"]:
        add("fail", "materials", f"{listed(g['no_material'])} {'has' if len(g['no_material']) == 1 else 'have'} faces with no material.", "Give every face a material: paint, car_atlas or a finish.")
    if bad:
        quoted = listed(['"' + b + '"' for b in bad])
        add("fail", "materials", ("Materials %s aren't names" if len(bad) > 1 else "Material %s isn't a name") % quoted + " the game knows, so it can't be painted or finished.",
            f"Rename to one of: {', '.join(R['materials']['names'])}, light_…, or a finish ({', '.join(R.get('finishNames', [])[:8])}…).")
    elif not g["no_material"]:
        add("pass", "materials", f"Materials: {', '.join(sorted(g['materials']))}.")
    # textures
    for img in {i.name: i for i in g["images"]}.values():
        w, h = img.size
        if max(w, h) > R["textureMaxSize"]:
            add("warn", "textures", f"{img.name} is {w}×{h}: bigger than {R['textureMaxSize']}×{R['textureMaxSize']}.", "The importer shrinks it; or save it smaller.")
        if w & (w - 1) or h & (h - 1):
            add("warn", "textures", f"{img.name} is {w}×{h}: a texture's sides should be powers of two.", "Resize it to 256, 512 or 1024.")
    lo, hi = bounds(g["tris"])
    size = [hi[k] - lo[k] for k in range(3)]
    if is_car:
        car_checks(R, g, lo, hi, size, add, new_car)
    else:
        part_checks(R, t, kind, lo, hi, size, add)
    if name and not re.match(r"^[a-z0-9_]+$", name):
        add("fail", "name", f'"{name}" can\'t be its name: only small letters, digits and _.', "Rename it, e.g. ducktail or 5spoke.")
    return out


def part_checks(R, t, kind, lo, hi, size, add):
    out_axes = [(k, ax, word) for k, (ax, word) in enumerate(AXES) if t["size"].get(ax) and not (t["size"][ax][0] <= size[k] <= t["size"][ax][1])]
    if not out_axes:
        add("pass", "size", f"Size {m(size[0])} × {m(size[1])} × {m(size[2])} m is right for {article(t['label'])}.")
    else:
        guess = unit_guess(size, t["size"])
        have = listed([m(size[k]) + " m " + w for k, _, w in out_axes])
        should = listed(["%g–%g m %s" % (t["size"][ax][0], t["size"][ax][1], w) for _, ax, w in out_axes])
        add("fail", "size", f"It's {have}; {article(t['label'])} is {should}." + (f" Everything is {guess[1]}, so it was probably {guess[2]}." if guess else ""),
            "Press Set up the scene, then scale it to its real size and apply the scale (Ctrl+A › Scale)." if guess else "Model it at its real size in metres.")
    tol = t.get("originTolerance", R["originTolerance"])
    off = []
    for k, (ax, word) in enumerate(AXES):
        rule = t["origin"].get(ax, "within")
        c = (lo[k] + hi[k]) / 2
        d = c if rule == "centre" else lo[k] if rule == "min" else hi[k] if rule == "max" else (lo[k] if lo[k] - tol > 0 else hi[k] if hi[k] + tol < 0 else 0) if rule == "within" else 0
        if abs(d) > tol:
            part = {"centre": "its middle", "min": {"x": "its right-hand edge", "y": "its bottom", "z": "its back"}[ax], "max": {"x": "its left-hand edge", "y": "its top", "z": "its front"}[ax], "within": "the whole model"}[rule]
            side = {"x": "left of" if d > 0 else "right of", "y": "above" if d > 0 else "below", "z": "in front of" if d > 0 else "behind"}[ax]
            off.append(f"{part} is {m(d)} m {side} the origin")
    if off:
        add("fail", "origin", f"The origin (where it attaches) should be at {t['attach']}, but {listed(off)}.", "Press Place at origin (it moves the model so that point is at 0, 0, 0).")
    else:
        add("pass", "origin", f"The origin is at {t['attach']}.")


def car_checks(R, g, lo, hi, size, add, new_car):
    C = R["car"]
    names = set(g["sockets"])
    known = set(C["requiredSockets"]) | set(C["expectedSockets"])
    for n in sorted(names - known):
        c = closest(n, sorted(known))
        if c:
            add("fail", "sockets", f'"{n}" isn\'t a socket name the game knows: it\'s probably {c}.', f"Rename the empty to exactly {c}.")
    typos = {closest(n, sorted(known)) for n in names - known}
    missing = [n for n in C["requiredSockets"] if n not in names and n not in typos]
    if missing:
        add("fail", "sockets", f"It has no {listed(missing)}: every car needs these to put its wheels on.", "Add socket › each wheel, at the wheel's centre with the car on the ground.")
    for n in C["expectedSockets"]:
        if n not in names and n not in typos:
            add("fail" if new_car else "warn", "sockets", f'{socket_label(n)} missing socket "{n}"' + (": a new car needs it." if new_car else ": its parts go where car.json says instead."), f"Add socket › {n}, at the point the part attaches.")
    if not missing:
        add("pass", "sockets", f"All {len(C['requiredSockets'])} wheel sockets are there.")
    # which way it faces
    dims = {"length": size[2], "width": size[0], "height": size[1]}
    if size[1] > size[2] and size[1] > size[0]:
        add("fail", "axes", f"It's taller ({m(size[1])} m) than it is long: it's standing on its end.", "Turn it so its wheels are on the ground (+Z up) and its front faces -Y.")
    elif size[0] > size[2]:
        add("fail", "axes", f"It's wider ({m(size[0])} m) than it is long ({m(size[2])} m): it's facing sideways.", "Turn it 90° about Z so its front faces -Y (Front view, numpad 1, looks at its front).")
    else:
        fl, rl = g["sockets"].get("socket_wheel_FL"), g["sockets"].get("socket_wheel_RL")
        if fl and rl and fl[2] < rl[2]:
            add("fail", "axes", "The front wheels are behind the rear ones: the car faces +Y in Blender.", "Turn it 180° about Z so its front faces -Y, and apply the rotation.")
        else:
            add("pass", "axes", "Faces the right way.")
    wrong = [(k, v) for k, v in dims.items() if not (C["size"][k][0] <= v <= C["size"][k][1])]
    if wrong:
        words = {"length": "long", "width": "wide", "height": "tall"}
        add("fail", "size", "It's " + listed(["%s m %s (a car is %g–%g m)" % (m(v), words[k], C["size"][k][0], C["size"][k][1]) for k, v in wrong]) + ".", "Press Set up the scene, and model it at its real size.")
    else:
        add("pass", "size", f"{m(dims['length'])} m long, {m(dims['width'])} m wide, {m(dims['height'])} m tall.")
    if abs(lo[1]) > C.get("groundTolerance", 0.05):
        add("warn", "ground", f"Its lowest point is {m(lo[1])} m {'above' if lo[1] > 0 else 'below'} the ground (z = 0).", "Stand it on the ground: the bottoms of the tyres at z = 0.")
    if C.get("paintMaterial", "paint") not in g["materials"]:
        add("fail", "paint", f'No material is called "{C.get("paintMaterial", "paint")}", so the car can\'t be painted.', "Name the body's painted faces' material paint.")


def verdict(findings):
    return "fail" if any(f["level"] == "fail" for f in findings) else "warn" if any(f["level"] == "warn" for f in findings) else "pass"


# ---------- doing things ----------

def place_at_origin(context, kind, selected_only=True):
    """Moves the model so the point it attaches by (its type's origin rule) is at 0, 0, 0 → the move (game frame)"""
    t = rules()["types"].get(kind)
    g = gather(context, selected_only)
    if not t or not g["tris"]:
        return None
    lo, hi = bounds(g["tris"])
    move = []
    for k, (ax, _) in enumerate(AXES):
        rule = t["origin"].get(ax, "within")
        move.append(-(lo[k] + hi[k]) / 2 if rule == "centre" else -lo[k] if rule == "min" else -hi[k] if rule == "max" else (-lo[k] if lo[k] > 0 else -hi[k] if hi[k] < 0 else 0))
    delta = to_blender(move)
    for o in (context.selected_objects if selected_only else context.scene.objects):
        if o.parent is None:
            o.location += delta
    return move


def setup_scene(context):
    us = context.scene.unit_settings
    us.system = "METRIC"
    us.scale_length = 1.0
    us.length_unit = "METERS"


def add_socket(context, name):
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = "PLAIN_AXES"
    o.empty_display_size = 0.12
    o.location = context.scene.cursor.location.copy()
    context.collection.objects.link(o)
    return o


def export_model(context, kind, name, folder, selected_only=False, force=False, new_car=False):
    """Checks, then exports <kind>_<name>.glb (a car: car_<name>.glb) with the game's settings → (path | None, findings)"""
    findings = check_scene(context, kind, name, selected_only, new_car)
    if verdict(findings) == "fail" and not force:
        return None, findings
    base = f"car_{name}" if kind == "car" else (name if name.startswith(kind + "_") else f"{kind}_{name}")
    path = os.path.join(bpy.path.abspath(folder or "//"), base + ".glb")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    want = dict(filepath=path, export_format="GLB", use_selection=selected_only, export_yup=True, export_apply=True, export_cameras=False, export_lights=False,
                export_animations=False, export_skins=False, export_morph=False, export_normals=True, export_texcoords=True, export_extras=False)
    have = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in have})
    return path, findings


# ---------- the panel ----------

def kind_items(self, context):
    items = [("car", "Car", "A whole car: body, sockets and its stock parts under them")]
    for k, t in rules()["types"].items():
        items.append((k, t["label"], f"{t['label']}: {t['attach']}"))
    return items


def socket_items(self, context):
    C = rules()["car"]
    return [(n, f"{socket_label(n)} ({n})", n) for n in C["requiredSockets"] + C["expectedSockets"]]


class OgnSettings(bpy.types.PropertyGroup):
    kind: bpy.props.EnumProperty(name="What it is", items=kind_items)
    name: bpy.props.StringProperty(name="Name", description="Small letters, digits and _ (ducktail, 5spoke, roadster)", default="")
    folder: bpy.props.StringProperty(name="Export to", subtype="DIR_PATH", default="//", description="The game's incoming/ folder")
    selected_only: bpy.props.BoolProperty(name="Selected only", default=False)
    new_car: bpy.props.BoolProperty(name="New car", default=True, description="A car the game doesn't have yet: every part socket is needed")
    results: bpy.props.StringProperty(default="[]")


def report_findings(op, findings):
    v = verdict(findings)
    fails = [f for f in findings if f["level"] == "fail"]
    warns = [f for f in findings if f["level"] == "warn"]
    for f in fails + warns:
        op.report({"ERROR" if f["level"] == "fail" else "WARNING"}, f["text"] + (f"  How to fix: {f['fix']}" if f.get("fix") else ""))
    op.report({"INFO"}, f"{v.upper()}: {len(fails)} problem(s), {len(warns)} warning(s)")


class OGN_OT_setup(bpy.types.Operator):
    bl_idname = "ognistrada.setup_scene"
    bl_label = "Set up the scene"
    bl_description = "Metric units, unit scale 1.0: the game works in metres"

    def execute(self, context):
        setup_scene(context)
        self.report({"INFO"}, "Units: metric, unit scale 1.0")
        return {"FINISHED"}


class OGN_OT_socket(bpy.types.Operator):
    bl_idname = "ognistrada.add_socket"
    bl_label = "Add socket"
    bl_description = "An empty named exactly as the game wants it, at the 3D cursor"
    bl_property = "socket"
    socket: bpy.props.EnumProperty(name="Socket", items=socket_items)

    def invoke(self, context, event):
        context.window_manager.invoke_search_popup(self)
        return {"RUNNING_MODAL"}

    def execute(self, context):
        add_socket(context, self.socket)
        return {"FINISHED"}


class OGN_OT_place(bpy.types.Operator):
    bl_idname = "ognistrada.place_at_origin"
    bl_label = "Place at origin"
    bl_description = "Move the model so the point it attaches by is at 0, 0, 0"

    def execute(self, context):
        s = context.scene.ognistrada
        if s.kind == "car":
            self.report({"WARNING"}, "A car stands on the ground at the origin: nothing to place")
            return {"CANCELLED"}
        move = place_at_origin(context, s.kind, s.selected_only)
        self.report({"INFO"}, "Nothing to move" if move is None else f"Moved {', '.join(f'{v:+.3f}' for v in move)} m")
        return {"FINISHED"}


class OGN_OT_check(bpy.types.Operator):
    bl_idname = "ognistrada.check"
    bl_label = "Check"
    bl_description = "Check it against the game's rules"

    def execute(self, context):
        s = context.scene.ognistrada
        findings = check_scene(context, s.kind, s.name, s.selected_only, s.new_car)
        s.results = json.dumps(findings)
        report_findings(self, findings)
        return {"FINISHED"}


class OGN_OT_export(bpy.types.Operator):
    bl_idname = "ognistrada.export"
    bl_label = "Export for the game"
    bl_description = "Check, then export <type>_<name>.glb with the game's settings"

    def execute(self, context):
        s = context.scene.ognistrada
        if not s.name:
            self.report({"ERROR"}, "Give it a name first")
            return {"CANCELLED"}
        path, findings = export_model(context, s.kind, s.name, s.folder, s.selected_only, new_car=s.new_car)
        s.results = json.dumps(findings)
        report_findings(self, findings)
        if not path:
            self.report({"ERROR"}, "Not exported: fix the problems first")
            return {"CANCELLED"}
        self.report({"INFO"}, f"Exported {path}: now run npm run import")
        return {"FINISHED"}


class OGN_PT_panel(bpy.types.Panel):
    bl_label = "Ognistrada"
    bl_idname = "OGN_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Ognistrada"

    def draw(self, context):
        s = context.scene.ognistrada
        col = self.layout.column()
        col.operator("ognistrada.setup_scene", icon="SCENE_DATA")
        col.prop(s, "kind")
        col.prop(s, "name")
        if s.kind == "car":
            col.prop(s, "new_car")
            col.operator("ognistrada.add_socket", icon="EMPTY_AXIS")
        else:
            col.operator("ognistrada.place_at_origin", icon="PIVOT_CURSOR")
        col.prop(s, "selected_only")
        col.operator("ognistrada.check", icon="CHECKMARK")
        col.prop(s, "folder")
        col.operator("ognistrada.export", icon="EXPORT")
        try:
            findings = json.loads(s.results)
        except ValueError:
            findings = []
        if findings:
            box = self.layout.box()
            box.label(text=f"{verdict(findings).upper()}", icon={"pass": "CHECKMARK", "warn": "ERROR", "fail": "CANCEL"}[verdict(findings)])
            for f in [f for f in findings if f["level"] != "pass"][:12]:
                box.label(text=f["text"][:120], icon="CANCEL" if f["level"] == "fail" else "ERROR")


CLASSES = (OgnSettings, OGN_OT_setup, OGN_OT_socket, OGN_OT_place, OGN_OT_check, OGN_OT_export, OGN_PT_panel)


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)
    bpy.types.Scene.ognistrada = bpy.props.PointerProperty(type=OgnSettings)


def unregister():
    del bpy.types.Scene.ognistrada
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)
