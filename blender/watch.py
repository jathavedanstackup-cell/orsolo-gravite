"""Photoreal Gravité T1 for Cycles. Mirrors the WebGL model's layout, explode math and camera,
so rendered frames line up with the live scene and can be crossfaded into it.

Usage (from a shell):
  blender -b -P blender/watch.py -- test   <out.png> [progress 0..1]
  blender -b -P blender/watch.py -- seq    <out_dir> <frames> [first:last]
  blender -b -P blender/watch.py -- anchors <out.json> <frames>

Everything is modelled in "three space" (y up, watch facing +z) under an empty rotated into
Blender's z-up world, so coordinates can be copied straight from the WebGL scene.
"""
import bpy, bmesh, math, json, sys, os
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

TAU = math.tau
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
MODE = ARGS[0] if ARGS else "test"
OUT = ARGS[1] if len(ARGS) > 1 else os.path.join(os.getcwd(), "test.png")
FONT_SERIF = r"C:\Windows\Fonts\BOD_R.TTF"
FONT_ITALIC = r"C:\Windows\Fonts\BOD_I.TTF"
FONT_SANS = r"C:\Windows\Fonts\segoeui.ttf"
AP_X, AP_Y, AP_R = 0.0, -0.62, 0.42
WIDTH, HEIGHT = 1280, 800  # 16:10 like 1440x900; sized for a CPU-only render budget
FIT = max(1.0, 1.75 / (WIDTH / HEIGHT))  # same framing rule as main.js
SAMPLES = 28

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ---------- materials ----------
def lin(hex_color):
    c = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def material(name, hex_color, metallic=0.0, rough=0.5, **extra):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    values = {"Base Color": (*lin(hex_color), 1), "Metallic": metallic, "Roughness": rough, **extra}
    for key, value in values.items():
        if b.inputs.get(key) is not None:
            b.inputs[key].default_value = value
    return m


def radial_tangent(m, rotate=0.0):
    nt, b = m.node_tree, m.node_tree.nodes["Principled BSDF"]
    t = nt.nodes.new("ShaderNodeTangent")
    t.direction_type, t.axis = "RADIAL", "Z"
    nt.links.new(t.outputs["Tangent"], b.inputs["Tangent"])
    b.inputs["Anisotropic Rotation"].default_value = rotate


def bump(m, tex, strength, **settings):
    nt, b = m.node_tree, m.node_tree.nodes["Principled BSDF"]
    t = nt.nodes.new(tex)
    for key, value in settings.items():
        if key in t.inputs:
            t.inputs[key].default_value = value
        else:
            setattr(t, key, value)
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = strength
    nt.links.new(t.outputs[0] if tex != "ShaderNodeTexVoronoi" else t.outputs["Distance"], bp.inputs["Height"])
    nt.links.new(bp.outputs["Normal"], b.inputs["Normal"])


M = {
    "titanium": material("titanium", "#cfd2d8", 1, 0.3, **{"Anisotropic": 0.7}),
    "polished": material("polished", "#f2f4f7", 1, 0.05),
    "bridge": material("bridge", "#d3d7de", 1, 0.25),
    "plate": material("plate", "#b4bac3", 1, 0.32),
    "gold": material("gold", "#e6bf7a", 1, 0.18),
    "blued": material("blued", "#1a339a", 0.85, 0.2, **{"Coat Weight": 1.0, "Coat Roughness": 0.05}),
    "ruby": material("ruby", "#c0122f", 0, 0.02, **{"Transmission Weight": 1.0, "IOR": 1.76}),
    # AR-coated sapphire: low reflectivity plus a thin-film layer, so softboxes glance off instead of
    # sitting on the glass as a white slab, with the faint blue-violet bloom real crystals show.
    "sapphire": material("sapphire", "#f4f7ff", 0, 0.0, **{"Transmission Weight": 1.0, "IOR": 1.77,
                         "Specular IOR Level": 0.12, "Thin Film Thickness": 260.0, "Thin Film IOR": 1.38}),
    # Satin lacquer over a sunburst: a mirror coat would show each softbox as a hard-edged slab.
    "dial": material("dial", "#dfe4ea", 0.45, 0.24, **{"Anisotropic": 0.85, "Coat Weight": 0.5, "Coat Roughness": 0.22}),
    "ink": material("ink", "#1b2340", 0, 0.35),
    "accent": material("accent", "#2a4bb0", 0, 0.3),
    "leather": material("leather", "#0f1628", 0, 0.62, **{"Sheen Weight": 0.4}),
    "thread": material("thread", "#d9dde6", 0, 0.8),
    "slot": material("slot", "#05070c", 0, 0.6),
}
radial_tangent(M["dial"], 0.25)  # sunburst: brushing runs outward from the centre
radial_tangent(M["titanium"], 0.0)
bump(M["leather"], "ShaderNodeTexNoise", 0.25, Scale=220.0, Detail=8.0)
bump(M["bridge"], "ShaderNodeTexWave", 0.12, Scale=3.2, Distortion=0.0, bands_direction="DIAGONAL")
bump(M["plate"], "ShaderNodeTexVoronoi", 0.18, Scale=90.0)


# ---------- geometry helpers (all in three space) ----------
def link(ob, parent, loc=(0, 0, 0), rot=(0, 0, 0)):
    if ob.name not in scene.collection.objects:
        scene.collection.objects.link(ob)
    ob.parent = parent
    ob.location, ob.rotation_euler = loc, rot
    return ob


def mesh_object(name, bm, mats, parent, smooth_angle=0.6):
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if e.is_manifold and e.calc_face_angle(0) > smooth_angle:
            e.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for mat in mats:
        me.materials.append(mat)
    return link(bpy.data.objects.new(name, me), parent)


def lathe(name, profile, mat, parent, seg=160):
    bm = bmesh.new()
    rings = [[bm.verts.new((r * math.cos(i / seg * TAU), r * math.sin(i / seg * TAU), z)) for i in range(seg)] for r, z in profile]
    for a, b in zip(rings, rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return mesh_object(name, bm, [mat], parent)


def circle(x, y, r, n=96):
    return [(x + r * math.cos(i / n * TAU), y + r * math.sin(i / n * TAU)) for i in range(n)]


def capsule(ax, ay, bx, by, w, n=24):
    ang = math.atan2(by - ay, bx - ax)
    pts = [(ax + w * math.cos(ang + math.pi / 2 + i / n * math.pi), ay + w * math.sin(ang + math.pi / 2 + i / n * math.pi)) for i in range(n + 1)]
    pts += [(bx + w * math.cos(ang - math.pi / 2 + i / n * math.pi), by + w * math.sin(ang - math.pi / 2 + i / n * math.pi)) for i in range(n + 1)]
    return pts


def gear(r, teeth):
    depth, step, pts = min(0.06, r * 0.12), TAU / teeth, []
    for i in range(teeth):
        a0 = i * step
        for rad, a in ((r - depth, a0), (r, a0 + step * 0.2), (r, a0 + step * 0.45), (r - depth, a0 + step * 0.65)):
            pts.append((rad * math.cos(a), rad * math.sin(a)))
    return pts


def lance(length, w, tail, n=20):
    left = [(-w * 2 * t * (1 - t) - 0.25 * w * t * t, -tail * (1 - t) ** 2 + length * 0.35 * 2 * t * (1 - t) + length * t * t) for t in (i / n for i in range(n + 1))]
    right = [(-x, y) for x, y in reversed(left)]
    return left + [(0, length + 0.05)] + right


def plate(name, loops, depth, mats, parent, bevel=0.0):
    """Filled 2D curve (outer loop + holes), extruded and bevelled, converted to mesh.
    With two materials, flat caps take the first and bevelled edges the second (anglage)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions, cu.fill_mode = "2D", "BOTH"
    cu.extrude, cu.bevel_depth, cu.bevel_resolution = depth / 2, bevel, 2
    for loop in loops:
        sp = cu.splines.new("POLY")
        sp.points.add(len(loop) - 1)
        for p, (x, y) in zip(sp.points, loop):
            p.co = (x, y, 0, 1)
        sp.use_cyclic_u, sp.use_smooth = True, True
    tmp = bpy.data.objects.new(name + "_tmp", cu)
    scene.collection.objects.link(tmp)
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(tmp)
    for mat in mats:
        me.materials.append(mat)
    if len(mats) > 1:
        for poly in me.polygons:
            poly.material_index = 0 if abs(poly.normal.z) > 0.985 else 1
    return link(bpy.data.objects.new(name, me), parent)


def prim(kind, parent, mat, loc=(0, 0, 0), rot=(0, 0, 0), **kw):
    getattr(bpy.ops.mesh, f"primitive_{kind}_add")(**kw)
    ob = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(mat)
    return link(ob, parent, loc, rot)


def text(body, font, size, loc, parent, mat, extrude=0.0015):
    cu = bpy.data.curves.new(body, "FONT")
    cu.body, cu.size, cu.extrude = body, size, extrude
    cu.font = bpy.data.fonts.load(font, check_existing=True)
    cu.align_x, cu.align_y = "CENTER", "CENTER"
    cu.materials.append(mat)
    return link(bpy.data.objects.new(body, cu), parent, loc)


def group(name, parent):
    return link(bpy.data.objects.new(name, None), parent)


def jewel(parent, x, y, z, back=False):
    g = group("jewel", parent)
    g.location, g.rotation_euler = (x, y, z), (math.pi if back else 0, 0, 0)
    lathe("ruby", [(0, 0.024), (0.016, 0.024), (0.03, 0.017), (0.046, 0.005), (0.05, -0.01), (0, -0.01)], M["ruby"], g, 12)
    prim("torus", g, M["polished"], major_radius=0.058, minor_radius=0.012, major_segments=40, minor_segments=10)
    return g


def screw(parent, x, y, z, back=False, turn=0.0):
    g = group("screw", parent)
    g.location, g.rotation_euler = (x, y, z), (math.pi if back else 0, 0, turn)
    prim("cylinder", g, M["blued"], vertices=28, radius=0.044, depth=0.026)
    prim("cube", g, M["slot"], loc=(0, 0, 0.008), scale=(0.044, 0.0065, 0.01))
    return g


# ---------- the watch ----------
space = bpy.data.objects.new("space", None)
scene.collection.objects.link(space)
space.rotation_euler = (math.pi / 2, 0, 0)  # three (x, y, z) -> blender (x, -z, y)
root = group("root", space)
root.rotation_mode = "ZYX"  # matrix Rx*Ry*Rz, same as three.js "XYZ"


def build_case(p):
    g = group("case", p)
    lathe("case_band", [(1.6, -0.3), (1.72, -0.29), (1.8, -0.18), (1.84, -0.02), (1.82, 0.14), (1.75, 0.25), (1.6, 0.28)], M["titanium"], g)
    lathe("case_inner", [(1.6, 0.28), (1.6, -0.3)], M["titanium"], g)
    for x, y in ((-0.86, 1.75), (0.86, 1.75), (-0.86, -1.75), (0.86, -1.75)):
        lug = prim("cube", g, M["titanium"], loc=(x, y, -0.08), rot=(-0.22 * math.copysign(1, y), 0, 0), scale=(0.15, 0.31, 0.15))
        mod = lug.modifiers.new("bevel", "BEVEL")
        mod.width, mod.segments = 0.08, 4
    crown = group("crown", g)
    crown.location, crown.rotation_euler = (1.98, 0, 0), (0, math.pi / 2, 0)
    knurl = prim("cylinder", crown, M["polished"], vertices=40, radius=0.23, depth=0.3)
    knurl.data.polygons.foreach_set("use_smooth", [False] * len(knurl.data.polygons))
    prim("cylinder", g, M["polished"], loc=(1.84, 0, 0), rot=(0, math.pi / 2, 0), vertices=16, radius=0.07, depth=0.2)
    for sign in (1, -1):
        build_strap(g, sign)
    return g


def catmull(points, t):
    n = len(points) - 1
    i = min(int(t * n), n - 1)
    u = t * n - i
    p0, p1, p2, p3 = points[max(i - 1, 0)], points[i], points[i + 1], points[min(i + 2, n)]
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)


def build_strap(p, sign):
    pts = [Vector(v) for v in ((0, 1.95, -0.12), (0, 2.55, -0.32), (0, 3.05, -0.95), (0, 3.3, -1.9), (0, 3.25, -3.0), (0, 2.95, -4.1))]
    n, thick, bm, rings = 90, 0.13, bmesh.new(), []
    for k in range(n + 1):
        t = k / n
        c, d = catmull(pts, t), catmull(pts, min(1, t + 1e-3)) - catmull(pts, max(0, t - 1e-3))
        nrm = Vector((0, -d.z, d.y)).normalized()
        w = (1.48 - t * 0.3) / 2
        ring = [c + Vector((sx * w, 0, 0)) + nrm * (sy * thick / 2) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        rings.append([bm.verts.new((v.x, v.y * sign, v.z)) for v in ring])
    for a, b in zip(rings, rings[1:]):
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((a[i], a[j], b[j], b[i]) if sign > 0 else (a[j], a[i], b[i], b[j]))
    bm.faces.new(rings[0] if sign < 0 else list(reversed(rings[0])))
    bm.faces.new(list(reversed(rings[-1])) if sign < 0 else rings[-1])
    strap = mesh_object("strap", bm, [M["leather"]], p, smooth_angle=0.9)
    sb = bmesh.new()
    for k in range(46):
        t = 0.04 + k / 46 * 0.9
        c, d = catmull(pts, t), catmull(pts, t + 1e-3) - catmull(pts, t - 1e-3)
        nrm = Vector((0, -d.z, d.y)).normalized()
        for sx in (-1, 1):
            centre = c + Vector((sx * ((1.48 - t * 0.3) / 2 - 0.08), 0, 0)) + nrm * (thick / 2)
            res = bmesh.ops.create_cube(sb, size=1)
            bmesh.ops.transform(sb, verts=res["verts"], matrix=__import__("mathutils").Matrix.Diagonal((0.018, 0.05, 0.02, 1)))
            bmesh.ops.translate(sb, verts=res["verts"], vec=Vector((centre.x, centre.y * sign, centre.z)))
    mesh_object("stitches", sb, [M["thread"]], p)
    return strap


def build_dial(p):
    g = group("dial", p)
    plate("dial_disc", [circle(0, 0, 1.52, 192), circle(AP_X, AP_Y, AP_R, 96)], 0.04, [M["dial"]], g)
    for h in range(12):
        if 5 <= h <= 7:
            continue
        a = h / 12 * TAU
        for off in ((-0.05, 0.05) if h == 0 else (0,)):
            r = 1.2
            x, y = math.sin(a) * r + math.cos(a) * off, math.cos(a) * r - math.sin(a) * off
            b = prim("cube", g, M["polished"], loc=(x, y, 0.035), rot=(0, 0, -a), scale=(0.02, 0.11, 0.012))
            mod = b.modifiers.new("bevel", "BEVEL")
            mod.width, mod.segments = 0.014, 1
    track = bmesh.new()
    for m in range(60):
        a = m / 60 * TAU
        length = 0.11 if m % 5 == 0 else 0.06
        res = bmesh.ops.create_cube(track, size=1)
        bmesh.ops.transform(track, verts=res["verts"], matrix=__import__("mathutils").Matrix.Diagonal((0.008 if m % 5 else 0.012, length, 0.002, 1)))
        bmesh.ops.rotate(track, verts=res["verts"], cent=(0, 0, 0), matrix=__import__("mathutils").Matrix.Rotation(-a, 3, "Z"))
        bmesh.ops.translate(track, verts=res["verts"], vec=Vector((math.sin(a) * (1.41 + length / 2 - 0.03), math.cos(a) * (1.41 + length / 2 - 0.03), 0.021)))
    mesh_object("minute_track", track, [M["ink"]], g)
    text("ORSOLO", FONT_SERIF, 0.17, (0, 0.58, 0.021), g, M["ink"])
    text("GENÈVE", FONT_SANS, 0.062, (0, 0.42, 0.021), g, M["ink"])
    text("Gravité", FONT_ITALIC, 0.1, (0, -0.07, 0.021), g, M["accent"])
    text("TOURBILLON   SWISS MADE", FONT_SANS, 0.046, (0, -1.24, 0.021), g, M["ink"])
    prim("torus", g, M["polished"], loc=(AP_X, AP_Y, 0.03), major_radius=AP_R + 0.025, minor_radius=0.022, major_segments=128, minor_segments=16)
    return g


def build_hands(p):
    g = group("hands", p)
    for name, length, w, tail, ring, z, ang in (("hour", 0.8, 0.07, 0.12, 0.06, 0.0, -(10 + 9 / 60) / 12 * TAU), ("minute", 1.26, 0.055, 0.2, 0.048, 0.035, -9 / 60 * TAU)):
        h = group(name, g)
        h.location, h.rotation_euler = (0, 0, z), (0, 0, ang)
        plate(name + "_blade", [lance(length, w, tail)], 0.012, [M["blued"]], h, bevel=0.006)
        prim("torus", h, M["blued"], loc=(0, length * 0.72, 0), major_radius=ring, minor_radius=ring * 0.24, major_segments=48, minor_segments=12)
        if name == "minute":
            prim("cylinder", h, M["blued"], loc=(0, -0.2, 0), vertices=32, radius=0.05, depth=0.014)
    prim("cylinder", g, M["polished"], loc=(0, 0, 0.04), vertices=32, radius=0.055, depth=0.08)
    return g


def build_cage(p):
    g = group("cage", p)
    g.location = (AP_X, AP_Y, 0)
    spin = group("spin", g)
    prim("torus", spin, M["polished"], major_radius=0.36, minor_radius=0.012, major_segments=128, minor_segments=12)
    for i in range(3):
        a = i / 3 * TAU + 0.5
        ex, ey = math.cos(a) * 0.35, math.sin(a) * 0.35
        mx, my = math.cos(a - 0.45) * 0.17, math.sin(a - 0.45) * 0.17
        arm = group("arm", spin)
        arm.location = (0, 0, 0.03)
        plate("arm_a", [capsule(0, 0, mx, my, 0.02)], 0.014, [M["titanium"], M["polished"]], arm, bevel=0.006)
        plate("arm_b", [capsule(mx, my, ex, ey, 0.018)], 0.014, [M["titanium"], M["polished"]], arm, bevel=0.006)
        screw(spin, ex, ey, 0.045, turn=i)
    esc = plate("escape", [gear(0.085, 15)], 0.012, [M["polished"]], spin, bevel=0.003)
    esc.location = (0.19, 0.06, -0.01)
    balance = group("balance", spin)
    balance.location = (0, 0, -0.03)
    prim("torus", balance, M["gold"], major_radius=0.25, minor_radius=0.02, major_segments=128, minor_segments=12)
    for i in range(3):
        prim("cube", balance, M["gold"], rot=(0, 0, i / 3 * math.pi), scale=(0.25, 0.009, 0.006))
    for i in range(18):
        a = i / 18 * TAU
        prim("cylinder", balance, M["gold"], loc=(math.cos(a) * 0.285, math.sin(a) * 0.285, 0), rot=(0, math.pi / 2, a), vertices=10, radius=0.011, depth=0.04)
    hs = bpy.data.curves.new("hairspring", "CURVE")
    hs.dimensions, hs.bevel_depth = "3D", 0.0035
    sp = hs.splines.new("POLY")
    sp.points.add(299)
    for k, pt in enumerate(sp.points):
        t = k / 299
        a, r = t * TAU * 7, 0.035 + t * 0.15
        pt.co = (math.cos(a) * r, math.sin(a) * r, 0.03, 1)
    hs.materials.append(M["blued"])
    link(bpy.data.objects.new("hairspring", hs), balance)
    jewel(spin, 0, 0, 0.05)
    return g, spin


def build_bridges(p):
    g = group("bridges", p)
    for k, (ax, ay, bx, by, w) in enumerate(((-1.15, 0.25, 1.05, 0.95, 0.2), (-0.95, 1.05, 0.35, -0.05, 0.17), (0.45, 1.25, 1.2, 0.35, 0.15))):
        plate("bridge", [capsule(ax, ay, bx, by, w)], 0.05, [M["bridge"], M["polished"]], g, bevel=0.03)
        jewel(g, ax, ay, -0.06, back=True)
        jewel(g, bx, by, -0.06, back=True)
        for t in (0.3, 0.7):
            screw(g, ax + (bx - ax) * t, ay + (by - ay) * t, -0.06, back=True, turn=k + t * 3)
    return g


def build_plate(p):
    return plate("mainplate", [circle(0, 0, 1.55, 192), circle(AP_X, AP_Y, AP_R + 0.02, 96)], 0.05, [M["plate"], M["polished"]], p, bevel=0.01)


def build_train(p):
    g = group("train", p)
    for r, t, x, y in ((0.5, 64, 0, 0.18), (0.3, 40, 0.86, 0.42), (0.28, 36, -0.78, 0.55), (0.18, 15, -0.45, -0.3)):
        holes = [circle(math.cos(i / 5 * TAU) * r * 0.55, math.sin(i / 5 * TAU) * r * 0.55, r * 0.26, 32) for i in range(5)] if r > 0.2 else []
        w = plate("wheel", [gear(r, t), *holes, circle(0, 0, r * 0.08, 16)], 0.03, [M["gold"]], g, bevel=0.006)
        w.location = (x, y, 0)
        prim("cylinder", g, M["polished"], loc=(x, y, 0), vertices=12, radius=0.05, depth=0.14)
    return g


def build_barrel(p):
    g = group("barrel", p)
    g.location = (0.62, 0.78, 0)
    holes = [circle(math.cos(i / 6 * TAU) * 0.29, math.sin(i / 6 * TAU) * 0.29, 0.13, 32) for i in range(6)]
    plate("barrel_wheel", [gear(0.52, 84), *holes, circle(0, 0, 0.04, 16)], 0.06, [M["gold"]], g, bevel=0.008)
    prim("cylinder", g, M["polished"], loc=(0, 0, -0.08), vertices=64, radius=0.44, depth=0.16)
    return g


def build_caseback(p):
    g = group("caseback", p)
    lathe("caseback_ring", [(1.6, -0.3), (1.66, -0.36), (1.2, -0.38), (1.12, -0.36)], M["titanium"], g)
    glass = prim("cylinder", g, M["sapphire"], loc=(0, 0, -0.37), vertices=96, radius=1.14, depth=0.02)
    # Flat-shaded: smooth normals bend across the flat faces and turn the window into a distorting lens.
    glass.data.polygons.foreach_set("use_smooth", [False] * len(glass.data.polygons))
    return g


def build_crystal(p):
    # A flat, solid sapphire with a bevelled edge. Closed geometry with consistent normals refracts cleanly;
    # an open double-skinned dome caused internal reflections that greyed out the dial.
    crystal = prim("cylinder", p, M["sapphire"], loc=(0, 0, 0.385), vertices=160, radius=1.575, depth=0.05)
    crystal.name = "crystal"
    mod = crystal.modifiers.new("bevel", "BEVEL")
    mod.width, mod.segments = 0.012, 3
    return crystal


def build_bezel(p):
    return lathe("bezel", [(1.56, 0.28), (1.8, 0.29), (1.77, 0.35), (1.66, 0.41), (1.57, 0.42)], M["polished"], p)


cage_group, cage_spin = build_cage(root)
# Same table as scene.js: object, resting z, z travel, fan [x, y], arc lift, stagger, caption index.
LAYERS = [
    (build_crystal(root), 0, 2.7, (0, 0.35), 0.6, 0.0, 0),
    (build_bezel(root), 0, 2.2, (0, 0.15), 0.45, 0.02, 0),
    (build_hands(root), 0.3, 1.8, (0.25, 0.1), 0.5, 0.05, 1),
    (build_dial(root), 0.2, 1.3, (0, 0), 0.35, 0.08, 2),
    (cage_group, 0.1, 0.85, (0.45, -0.35), 0.4, 0.11, 2),
    (build_plate(root), 0.14, 0.55, (0, -0.1), 0.3, 0.13, 3),
    (build_train(root), 0.02, -0.3, (0.3, 0.2), 0.3, 0.16, 4),
    (build_barrel(root), -0.03, -0.75, (0.55, 0.4), 0.45, 0.19, 5),
    (build_bridges(root), -0.13, -1.15, (-0.3, 0.15), 0.3, 0.22, 3),
    (build_case(root), 0, 0, (0, 0), 0, 0, 6),
    (build_caseback(root), 0, -1.8, (0, -0.2), 0.5, 0.26, 6),
]
BASE_XY = {id(l[0]): (l[0].location.x, l[0].location.y) for l in LAYERS}
ANCHOR_LAYER = [0, 2, 3, 8, 6, 7, 9]


def set_explode(amount):
    for ob, z, travel, (fx, fy), arc, delay, _ in LAYERS:
        a = min(1, max(0, (amount - delay) / 0.7))
        a = a * a * (3 - 2 * a)
        bx, by = BASE_XY[id(ob)]
        ob.location = (bx + fx * a, by + fy * a + math.sin(math.pi * a) * arc, z + travel * a)
        ob.rotation_euler = (fy * a * 0.5, -fx * a * 0.5, 0)


# ---------- camera, light, render ----------
cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
link(cam, space)
cam.data.sensor_fit = "VERTICAL"
cam.data.angle_y = math.radians(28)
cam.data.clip_start = 0.05
cam.data.dof.use_dof = True
cam.data.dof.aperture_fstop = 5.6
scene.camera = cam


STUDIO = []  # (light, base energy): the intro fades these up from darkness


def softbox(name, size, power, pos, color="#ffffff"):
    light = bpy.data.lights.new(name, "AREA")
    light.shape, light.size, light.size_y = "RECTANGLE", size[0], size[1]
    light.energy, light.color = power, lin(color)
    ob = link(bpy.data.objects.new(name, light), space, pos)
    ob.rotation_euler = (Vector((0, 0, 0)) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
    STUDIO.append((light, power))
    return ob


softbox("top", (12, 2.4), 1400, (0, 7, 5))
softbox("left", (2.2, 10), 900, (-8, 1, 4))
softbox("right", (1.6, 10), 520, (8, -1, 2), "#c8d6ff")
# Front fill lights the dial but stays out of reflections: no flat white slab across the crystal.
softbox("front", (8, 5), 300, (-2, 9, 10)).visible_glossy = False
softbox("rim", (5, 5), 700, (3, 3, -8), "#7b98f2")


def reflector(name, size, pos, strength, color="#ffffff"):
    """Emissive card seen only in reflections: the long soft highlights that make steel read as steel."""
    bpy.ops.mesh.primitive_plane_add(size=1)
    card = link(bpy.context.active_object, space, pos)
    card.scale = (size[0], size[1], 1)
    card.rotation_euler = (Vector((0, 0, 0)) - Vector(pos)).to_track_quat("Z", "Y").to_euler()
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value, em.inputs[1].default_value = (*lin(color), 1), strength
    nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs[0])
    card.data.materials.append(m)
    card.visible_camera = card.visible_diffuse = card.visible_shadow = False


reflector("card_left", (2.5, 14), (-6, 0, 3), 6.0)
reflector("card_right", (1.5, 14), (6.5, 0, 1), 3.5, "#d6e0ff")
reflector("card_top", (16, 3), (0, 6, 2), 4.0)

# A mid-grey studio for the metal to mirror. The background itself stays transparent (film_transparent),
# so the site's ink shows behind the watch.
world = bpy.data.worlds.new("world")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (*lin("#2c323d"), 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
scene.world = world

r = scene.render
r.engine, r.resolution_x, r.resolution_y, r.film_transparent = "CYCLES", WIDTH, HEIGHT, True
r.image_settings.file_format, r.image_settings.color_mode = "PNG", "RGBA"
r.use_persistent_data = True  # keep the BVH between sequence frames
c = scene.cycles
c.device, c.samples, c.use_adaptive_sampling, c.adaptive_threshold = "CPU", SAMPLES, True, 0.03
c.use_denoising = True
c.max_bounces, c.glossy_bounces, c.transmission_bounces, c.transparent_max_bounces = 8, 4, 8, 8
c.caustics_reflective = c.caustics_refractive = False
try:
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
except TypeError:
    pass

# Movement chapter keyframes from main.js, as section progress -> pose.
KEYS = [(0.0, dict(ex=0, rx=0.15, ry=-0.35, mx=1.15, cz=11)),
        (0.38, dict(ex=1, rx=0.55, ry=-1.0, mx=1.2, cz=14)),
        (0.95, dict(ex=1, rx=0.42, ry=-1.4, mx=1.2, cz=14)),
        (1.0, dict(ex=1, rx=0.42, ry=-1.4, mx=1.2, cz=14))]


def pose_at(p):
    for (p0, a), (p1, b) in zip(KEYS, KEYS[1:]):
        if p <= p1:
            t = min(1, max(0, (p - p0) / max(1e-6, p1 - p0)))
            t = t * t * (3 - 2 * t)
            return {k: a[k] + (b[k] - a[k]) * t for k in a}
    return KEYS[-1][1]


def apply(p, s=None):
    s = s or pose_at(p)
    set_explode(s["ex"])
    root.location = (s["mx"], 0, 0)
    root.rotation_euler = (s["rx"], s["ry"], 0)
    cam.location = (0, 0, s["cz"] * FIT)
    cage_spin.rotation_euler = (0, 0, -p * TAU * 0.6)
    bpy.context.view_layer.update()
    cam.data.dof.focus_distance = (cam.matrix_world.translation - root.matrix_world.translation).length


def anchors():
    out = []
    for i, li in enumerate(ANCHOR_LAYER):
        ob = LAYERS[li][0]
        local = Vector((-1.82, -0.4, 0)) if i == 6 else Vector((-0.9, 0.5, 0))
        v = world_to_camera_view(scene, cam, ob.matrix_world @ local)
        out.append([round(v.x, 4), round(1 - v.y, 4)])
    return out


# ---------- camera path after the exploded view (desktop keyframes from main.js) ----------
BACK = math.pi
BASE = dict(ex=0, rx=0, ry=0, mx=0, my=0, cz=9.5, focus=0, fx=0, fy=-0.62, fd=3.4, ox=-0.75, oy=0.05)


def S(**s):
    d = {**BASE, **s}
    d["cz"] *= FIT
    return d


MACRO = dict(focus=1, ex=0, rx=0.3, ry=BACK - 0.35, mx=1.4)
INSIDE = dict(focus=1, fx=0, fy=-0.62, fd=0.32, ox=0, oy=0, mx=0.7)
P = {
    "e_end": S(ex=1, rx=0.42, ry=-1.4, mx=1.2, cz=14),
    "tb_in": S(mx=0.7, cz=9),
    "tb_focus": S(mx=0.7, cz=9, focus=1),
    "inside_front": S(**INSIDE, ry=0),
    "inside_back": S(**INSIDE, ry=BACK, rx=0.3),
    "h0": S(**{**MACRO, "fx": 0, "fy": 0.15, "fd": 5.2, "ox": -1.5, "oy": -0.7}),
    # Bevelling shot aimed at the bridges near the centre, so no lug intrudes at the frame edge.
    "h1": S(**{**MACRO, "fx": 0.1, "fy": 0.55, "fd": 2.6, "rx": 0.35, "ry": BACK + 0.15, "ox": -0.9, "oy": -0.45}),
    "h2": S(**{**MACRO, "fx": 0, "fy": -0.62, "fd": 2.6, "rx": 0.25, "ry": BACK - 0.15, "ox": -0.95, "oy": -0.45}),
    "h3": S(**{**MACRO, "ex": 0.75, "focus": 0.3, "fx": 0, "fy": 0, "fd": 5, "rx": 0.45, "ry": BACK - 0.9, "ox": -0.9, "oy": -0.3}),
    "h4": S(**{**MACRO, "fx": 0, "fy": -0.62, "fd": 2.2, "rx": 0.1, "ry": BACK, "ox": -0.85, "oy": -0.4}),
}
# name, keyframes, frame count. Order matters: cage rotation runs continuously across segments.
SEGMENTS = [
    ("reassemble", ["e_end", "tb_in"], 12),
    ("approach", ["tb_in", "tb_focus"], 24),
    ("hold", ["tb_focus", "tb_focus"], 8),
    ("dive", ["tb_focus", "inside_front"], 10),
    ("emerge", ["inside_back", "h0"], 10),
    ("craft", ["h0", "h1", "h2", "h3", "h4"], 36),
]


def pose_on(keys, u):
    n = len(keys) - 1
    seg = min(int(u * n), n - 1)
    t = u * n - seg
    t = t * t * (3 - 2 * t)
    a, b = P[keys[seg]], P[keys[seg + 1]]
    return {k: a[k] + (b[k] - a[k]) * t for k in a}


def apply_path(s, spin):
    """Replicates placeCamera() in main.js: a wide shot and a macro shot blended by focus."""
    set_explode(s["ex"])
    root.location = (s["mx"], s["my"], 0)
    root.rotation_euler = (s["rx"], s["ry"], 0)
    cage_spin.rotation_euler = (0, 0, spin)
    bpy.context.view_layer.update()
    to_space = space.matrix_world.inverted()
    point = to_space @ (root.matrix_world @ Vector((s["fx"], s["fy"], 0.1)))
    centre = to_space @ root.matrix_world.translation
    f = min(1, max(0, s["focus"]))
    f = f * f * (3 - 2 * f)
    offset = Vector((s["ox"], s["oy"], 0))
    cam_pos = Vector((0, 0, s["cz"])).lerp(point + offset + Vector((0, 0, s["fd"])), f)
    look = Vector((0, 0, 0)).lerp(point + offset, f)
    cam.location = cam_pos
    cam.rotation_euler = (look - cam_pos).to_track_quat("-Z", "Y").to_euler()
    # Focus on what faces the lens: the dial side normally, the bridges when the watch is turned over.
    # (The framing point sits at dial depth; from behind, that would leave the movement out of focus.)
    facing_back = math.cos(s["ry"]) < 0
    subject = to_space @ (root.matrix_world @ Vector((s["fx"], s["fy"], -0.14 if facing_back else 0.1)))
    cam.data.dof.focus_distance = max(0.05, (cam_pos - centre).length * (1 - f) + (cam_pos - subject).length * f)
    cam.data.dof.aperture_fstop = 5.6 + 5.4 * f  # stop down for macros so more of the movement stays sharp


if MODE == "path":
    # path <segment|all> <out_root> [first:last]: renders into <out_root>/<segment>/fNNN.png, resumable.
    which = ARGS[2] if len(ARGS) > 2 else "all"
    offset = 0
    for name, keys, count in SEGMENTS:
        if which in ("all", name):
            folder = os.path.join(OUT, name)
            os.makedirs(folder, exist_ok=True)
            for k in range(count):
                path = os.path.join(folder, f"f{k:03d}.png")
                if os.path.exists(path):
                    continue
                apply_path(pose_on(keys, k / (count - 1)), -(offset + k) * 0.035)
                r.filepath = path
                bpy.ops.render.render(write_still=True)
        offset += count
elif MODE == "pathtest":
    # pathtest <out.png> <segment> <u> [percent]
    keys = dict((n, k) for n, k, _ in SEGMENTS)[ARGS[2]]
    apply_path(pose_on(keys, float(ARGS[3])), 0)
    r.resolution_percentage = int(ARGS[4]) if len(ARGS) > 4 else 100
    if len(ARGS) > 5:  # diagnostic: hide a layer group and everything under it, e.g. "caseback"
        for ob in scene.objects:
            node = ob
            while node is not None:
                if node.name.split(".")[0] in ARGS[5].split(","):
                    ob.hide_render = True
                    break
                node = node.parent
    r.filepath = OUT
    bpy.ops.render.render(write_still=True)
elif MODE == "test":
    apply(float(ARGS[2]) if len(ARGS) > 2 else 0.0)
    r.resolution_percentage = int(ARGS[3]) if len(ARGS) > 3 else 100  # 50 for quick look-dev
    if len(ARGS) > 4:  # diagnostic: hide named objects, e.g. "crystal,card_top"
        for name in ARGS[4].split(","):
            for ob in scene.objects:
                if ob.name.startswith(name):
                    ob.hide_render = True
    r.filepath = OUT
    bpy.ops.render.render(write_still=True)
elif MODE == "seq":
    frames = int(ARGS[2])
    first, last = (map(int, ARGS[3].split(":")) if len(ARGS) > 3 else (0, frames - 1))
    os.makedirs(OUT, exist_ok=True)
    for f in range(first, last + 1):
        path = os.path.join(OUT, f"f{f:03d}.png")
        if os.path.exists(path):
            continue  # resumable: skip frames already rendered
        apply(f / (frames - 1))
        r.filepath = path
        bpy.ops.render.render(write_still=True)
elif MODE in ("intro", "bridge"):
    # intro: the opening shot. The watch turns into its hero pose out of darkness while a strip light
    #        sweeps across case, crystal and dial. Its last frame is exactly the hero pose.
    # bridge: hero pose to the movement chapter's first pose, scrubbed by scroll (smoothstep, as in main.js).
    frames = int(ARGS[2])
    os.makedirs(OUT, exist_ok=True)
    hero = dict(ex=0, rx=0.24, ry=-0.55, mx=1.35, cz=11)
    sweep_light = bpy.data.lights.new("sweep", "AREA")
    sweep_light.shape, sweep_light.size, sweep_light.size_y = "RECTANGLE", 0.9, 12
    sweep = link(bpy.data.objects.new("sweep", sweep_light), space, (0, 1, 6))
    for f in range(frames):
        path = os.path.join(OUT, f"f{f:03d}.png")
        if os.path.exists(path):
            continue
        t = f / (frames - 1)
        e = t * t * (3 - 2 * t)
        if MODE == "intro":
            pose = dict(ex=0, rx=0.42 + (hero["rx"] - 0.42) * e, ry=-1.05 + (hero["ry"] + 1.05) * e, mx=1.35, cz=11)
            rise = min(1, t * 1.6)
            for light, base in STUDIO:
                light.energy = base * (0.06 + 0.94 * rise * rise * (3 - 2 * rise))
            sweep.location = (-10 + 20 * e, 1, 6)
            sweep.rotation_euler = (Vector((0, 0, 0)) - sweep.location).to_track_quat("-Z", "Y").to_euler()
            sweep_light.energy = 2600 * math.sin(math.pi * min(1, t * 1.15)) ** 2
        else:
            start = dict(ex=0, rx=0.15, ry=-0.35, mx=1.15, cz=11)
            sweep_light.energy = 0
            pose = {k: hero[k] + (start[k] - hero[k]) * e for k in hero}
        apply(0, pose)
        r.filepath = path
        bpy.ops.render.render(write_still=True)
elif MODE == "hero":
    # The opening pose from main.js, for the loader backdrop and the no-WebGL fallback image.
    apply(0, dict(ex=0, rx=0.24, ry=-0.55, mx=1.35, cz=11))
    r.filepath = OUT
    bpy.ops.render.render(write_still=True)
elif MODE == "anchors":
    frames = int(ARGS[2])
    data = []
    for f in range(frames):
        apply(f / (frames - 1))
        data.append(anchors())
    with open(OUT, "w") as fh:
        json.dump({"frames": frames, "aspect": WIDTH / HEIGHT, "anchors": data}, fh)
