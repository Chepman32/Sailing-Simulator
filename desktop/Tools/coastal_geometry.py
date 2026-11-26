"""Bake the Coral Pass meshes using Blender 5's headless Python runtime."""

import math
import json
from array import array
from pathlib import Path
import random
import sys
import struct
import subprocess

import numpy as np

import bpy
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coastal_layout import CAYS, SURVEY_SIZE, VOLCANO_RADIUS, reef_floor, relief, shore_scale, volcano_raster, volcano_relief
from ocean_spectrum import bake as bake_wind_waves
from breaker_foam import bake as bake_breaker_foam
from surf_transport import bake as bake_surf_transport


OUT = Path(__file__).resolve().parents[1] / "Saved" / "CoastalSources"
TAU = 2 * math.pi
GOOSENECK_Z = 3.22334
RIG_HEIGHT_SCALE = 1.23
FORESTAY_TACK = (5.67, 0, 1.59)
FORESTAY_HEAD = (1.66, 0, GOOSENECK_Z + (10.45 - GOOSENECK_Z) * RIG_HEIGHT_SCALE)
HELM_SHIFT = Vector((-.66, -.20, 0))
SKIPPER_FEET = Vector((-4.52, -1.45, 1.37))


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.context.scene.unit_settings.system = "METRIC"


def export(name, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.fbx(
        filepath=str(OUT / f"{name}.fbx"), use_selection=True, object_types={"MESH"},
        axis_forward="-Y", axis_up="Z", mesh_smooth_type="FACE", apply_unit_scale=True,
        use_mesh_modifiers=True,
    )


def material_slot(name):
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)


class Mesh:
    def __init__(self):
        self.points = []
        self.faces = []
        self.uv = []
        self.color = []
        self.slots = []

    def vertex(self, point, uv=(0, 0), color=(1, 1, 1, 1)):
        self.points.append(point)
        self.uv.append(uv)
        self.color.append(color)
        return len(self.points) - 1

    def face(self, vertices, slot=0):
        self.faces.append(vertices)
        self.slots.append(slot)

    def create(self, name, materials):
        data = bpy.data.meshes.new(name)
        data.from_pydata(self.points, [], self.faces)
        data.update()
        for material in materials:
            data.materials.append(material_slot(material))
        uv = data.uv_layers.new(name="UVMap")
        color = data.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="POINT")
        color.data.foreach_set("color", [value for rgba in self.color for value in rgba])
        data.color_attributes.active_color = color
        for poly, slot in zip(data.polygons, self.slots):
            poly.material_index = slot
            poly.use_smooth = True
            for loop in poly.loop_indices:
                uv.data[loop].uv = self.uv[data.loops[loop].vertex_index]
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        return obj


def cay_mesh(cay):
    mesh = Mesh()
    steps = 256
    angles = [TAU * i / steps for i in range(steps)]
    coast = [shore_scale(theta, cay.phase) for theta in angles]
    height, vegetation, stone = relief(cay, 0, 0)
    mesh.vertex((0, 0, height), color=(stone, vegetation, 0, 1))
    # More samples where the beach crosses the waterline.
    radii = [r / 84 for r in range(1, 85)] + [1 + 0.86 * (r / 54)**1.65 for r in range(1, 55)]
    for ring, radius in enumerate(radii):
        start = len(mesh.points)
        for i, theta in enumerate(angles):
            x = radius * coast[i] * cay.length * math.cos(theta)
            y = radius * coast[i] * cay.width * math.sin(theta)
            height, vegetation, stone = relief(cay, x, y)
            mesh.vertex((x, -y, height), (x / 4, -y / 4), (stone, vegetation, 0, 1))
        for side in range(steps):
            a = start + side
            b = start + (side + 1) % steps
            if ring == 0:
                mesh.face((0, b, a))
            else:
                mesh.face((a - steps, b, a))
                mesh.face((a - steps, b - steps, b))
    return mesh.create(cay.name, ["CoastalGround"])


def palm_mesh(variant):
    rng = random.Random(401 + variant)
    mesh = Mesh()
    height = 8.9 + variant * 0.65
    lean = 1.5 + variant * 0.48

    def center(t):
        return Vector((lean * t**1.75, 0.42 * math.sin(math.pi * t / 2) * t, height * t))

    sides = 16
    rings = 125
    for i in range(rings + 1):
        t = i / rings
        for side in range(sides + 1):
            theta = TAU * side / sides
            root = 0.22 * math.exp(-32 * t)
            bark = 0.025 * math.sin(TAU * (t * 47 + 0.15 * math.sin(theta * 3)))
            radius = 0.146 + 0.062 * (1 - t) + root + bark + 0.004 * math.cos(theta * 5)
            mesh.vertex(center(t) + Vector((math.cos(theta) * radius, math.sin(theta) * radius, 0)),
                        (side / sides, height * t / 1.3), (0.72 + 0.22 * t, 0.7, 0.48, 0))
        if i == 0:
            continue
        for side in range(sides):
            a = (i - 1) * (sides + 1) + side
            b = a + sides + 1
            mesh.face((a, a + 1, b + 1, b))

    for frond in range(18):
        rank = frond / 17
        angle = frond * 2.399963 + rng.uniform(-0.15, 0.15)
        out = Vector((math.cos(angle), math.sin(angle), 0))
        across = Vector((-out.y, out.x, 0))
        length = rng.uniform(3.65, 5.0) * (0.78 + rank * 0.2)
        arch = 0.85 + 1.5 * (1 - rank)
        droop = 1.15 * rank
        start = center(1) - Vector((0, 0, 0.52 * rank))

        def spine(t):
            return start + out * (length * t**1.16) + Vector((0, 0, arch * math.sin(math.pi * t * 0.92) - droop * t * t))

        tip_index = len(mesh.points)
        for seg in range(25):
            t = seg / 24
            pos = spine(t)
            width = 0.036 * (1 - t) + 0.004
            for side in (-1, 1):
                mesh.vertex(pos + across * side * width, (t, (side + 1) / 2), (0.62, 0.52, 0.2, t))
            if seg:
                a = tip_index + (seg - 1) * 2
                mesh.face((a, a + 1, a + 3, a + 2), 1)

        # A split blade beneath the pinnae keeps the crown readable after minification.
        for side in (-1,1):
            start_blade = len(mesh.points)
            for seg in range(33):
                t = seg/32
                w = math.sin(math.pi*t)**.75 * (.36 if seg % 4 else .12)
                mid = spine(t)
                for p in (mid,mid + side*across*w + out*w*.45 - Vector((0,0,w*.40))):
                    mesh.vertex(p,(t,(side+1)*.5),(.62,.55-.24*rank,.2,t))
                if seg:
                    j = start_blade+(seg-1)*2
                    mesh.face((j,j+1,j+3,j+2),1)

        for leaf in range(36):
            t = 0.13 + leaf * 0.024
            envelope = math.sin(math.pi * t)**0.8
            for side in (-1, 1):
                base = spine(t + rng.uniform(-0.007, 0.007))
                sweep = out * rng.uniform(0.36, 0.72) + across * side * rng.uniform(0.55, 1.15)
                tint = rng.uniform(0.68, 1.0) * (1 - rank * 0.16)
                start_index = len(mesh.points)
                for seg in range(7):
                    f = seg / 6
                    pos = base + sweep * (envelope * f) - Vector((0, 0, 0.68 * envelope * f**2.25))
                    width = (0.006 + 0.042 * math.sin(math.pi * f**0.72)) * envelope
                    for edge in (-1, 0, 1):
                        crest = 0.025 * math.sin(math.pi * f) if edge == 0 else 0
                        mesh.vertex(pos + out * edge * width + Vector((0, 0, crest)),
                                    (f, (edge + 1) / 2), (tint, 0.85 - 0.46 * rank, 0.2, t + 0.10 * f))
                    if seg:
                        a = start_index + (seg - 1) * 3
                        mesh.face((a, a + 1, a + 4, a + 3), 1)
                        mesh.face((a + 1, a + 2, a + 5, a + 4), 1)
    return mesh.create(f"CoconutPalm{variant + 1}", ["PalmBark", "PalmFronds"])


def volcano():
    mesh = Mesh()
    sides = 512
    def aerial_uv(x, y):
        u, v = volcano_raster(x, y)
        return (u+.5)/SURVEY_SIZE, 1-(v+.5)/SURVEY_SIZE

    mesh.vertex((0, 0, volcano_relief(0, 0)[0]), aerial_uv(0,0))
    angles = [TAU*i / sides for i in range(sides)]
    rings = [75 * (i / 49)**1.25 for i in range(1, 50)]
    rings += [75 + (VOLCANO_RADIUS * 1.35 - 75) * (i / 204) for i in range(1, 205)]
    for ring, radius in enumerate(rings):
        start = len(mesh.points)
        for theta in angles:
            x, y = radius * math.cos(theta), radius * math.sin(theta)
            height, _ = volcano_relief(x, y)
            mesh.vertex((x, -y, height), aerial_uv(x,y))
        for i in range(sides):
            a, b = start + i, start + (i + 1) % sides
            if ring == 0:
                mesh.face((0, b, a))
            else:
                mesh.face((a - sides, b - sides, b, a))
    return mesh.create("Volcano", ["VolcanicRock"])


def tube(mesh, start, end, profile, slot, sides=20):
    start, end = Vector(start), Vector(end)
    axis = (end - start).normalized()
    reference = Vector((1, 0, 0)) if abs(axis.x) < .9 else Vector((0, 1, 0))
    across = (reference - reference.dot(axis) * axis).normalized()
    around = axis.cross(across)
    base = len(mesh.points)
    length = (end - start).length
    for row, (fraction, radius) in enumerate(profile):
        for i in range(sides + 1):
            angle = TAU * i / sides
            offset = radius * (math.cos(angle) * across + math.sin(angle) * around)
            mesh.vertex(start.lerp(end, fraction) + offset, (i / sides, fraction * length / 2))
        if row:
            for i in range(sides):
                a = base + (row - 1) * (sides + 1) + i
                mesh.face((a, a + 1, a + sides + 2, a + sides + 1), slot)


def reef_shelf():
    reef = Mesh()
    cols = 141
    for j in range(89):
        y = 19+(j-44)*1.65
        for i in range(cols):
            x = 20+(i-70)*1.9
            z,stone = reef_floor(x,y)
            a = reef.vertex((x,-y,z),(x/3.2,-y/3.2),(stone,0,0,1))
            if i and j:
                reef.face((a-cols-1,a-1,a,a-cols))
    return reef.create("ReefShelf",["CoastalGround"])


def coastal_canopy():
    """Shade-bearing inner branches and leaf sprays that break up each crown's outline."""
    foliage = Mesh()
    rng = random.Random(9781)
    tube(foliage, (-.16,.23,0), (.12,-.09,4.9), [(0,.23),(.32,.17),(1,.10)], 1, 9)
    for lobe in range(16):
        a = lobe*2.39996
        spread = math.sqrt(lobe/15)*3.9
        cx,cy = math.cos(a)*spread, math.sin(a)*spread
        cz = 4.3 + 3.0*(1-lobe/16) + rng.uniform(-.45,.45)
        width,height = rng.uniform(1.65,2.75),rng.uniform(1.7,2.65)
        fork = (.12,-.09,2.7+.4*math.sin(a))
        elbow = (cx*.65,cy*.65,cz-1.1)
        tube(foliage,fork,elbow,[(0,.11),(1,.072)],1,6)
        tube(foliage,elbow,(cx,cy,cz),[(0,.075),(1,.026)],1,6)
        start = len(foliage.points)
        tint = rng.uniform(.58,1)
        for row in range(7):
            v = (row+.012)/6.024
            for col in range(12):
                theta = TAU*col/12
                z = -math.cos(math.pi*v)
                r = math.sin(math.pi*v)*width*(.78+.14*math.sin(5*theta+row*2.2)+rng.uniform(-.09,.09))
                foliage.vertex((cx+r*math.cos(theta),cy+r*math.sin(theta),cz+z*height*.84),
                               (col/12,v),(tint,.20+.58*v,0,0))
                if row:
                    j = start+row*12+col
                    n = start+row*12+(col+1)%12
                    foliage.face((j-12,n-12,n,j))
        for sprig in range(46):
            az = sprig * 2.39996 + rng.uniform(-.23,.23)
            z = rng.uniform(-.78,1)
            radial = math.sqrt(1-z*z)
            out = Vector((math.cos(az), math.sin(az), 0))
            across = Vector((-out.y, out.x, 0))
            root = Vector((cx,cy,cz+z*height*.89)) + out*(radial*width*.72)
            for side, length in ((-1,.54),(1,.60),(0,.72)):
                tip = root + out*(length+rng.uniform(0,.31)) + across*(.37*side)
                tip.z += rng.uniform(-.16,.42) + .22*z
                mid = root.lerp(tip,.52) + Vector((0,0,.09))
                wing = across*rng.uniform(.12,.21)
                color = (tint,rng.uniform(.62,1),1,1)
                corners = [foliage.vertex(p, uv, color) for p,uv in
                           ((root,(0,.5)),(mid-wing,(.54,0)),(tip,(1,.5)),(mid+wing,(.54,1)))]
                foliage.face(corners)
    return foliage.create("CoastalCanopy",["Canopy","CanopyBark"])


def lighthouse():
    """Keep the station's masonry, ironwork, cottage and Fresnel lens at their authored scale."""
    model = OUT / "LightStation.glb"
    glb = model.read_bytes()
    json_size = struct.unpack_from("<I", glb, 12)[0]
    scene = json.loads(glb[20:20 + json_size])
    blob = memoryview(glb)[28 + json_size:]
    folder = OUT / "model_maps"
    folder.mkdir(exist_ok=True)
    for image in scene["images"]:
        view = scene["bufferViews"][image["bufferView"]]
        start = view.get("byteOffset", 0)
        assert image["mimeType"] == "image/png"
        (folder / f"station_{image['name']}.png").write_bytes(blob[start:start + view["byteLength"]])
    parts = []
    for obj in from_gltf("LightStation"):
        # The lighthouse axis is the lamp centre in the glTF, 3.6 m from the asset origin.
        parts.append(freeze(obj, obj.name, Matrix.Translation((3.6, -.6, 0))))
    export("LightStation", parts)


def dune_grass(submerged=False):
    rng = random.Random(3341 if submerged else 2307)
    patch = Mesh()
    radius = .72 if submerged else 1.12
    for _ in range(10 if submerged else 12):
        root = Vector((rng.uniform(-radius,radius), rng.uniform(-radius,radius), 0))
        for blade in range(9):
            a = 2.39996 * blade + rng.uniform(-.4,.4)
            along = Vector((math.cos(a),math.sin(a),0))
            across = Vector((-along.y,along.x,0))
            foot = root + along*rng.uniform(0,.09)
            height = rng.uniform(.28,.94) if submerged else rng.uniform(.22,.83)
            width = rng.uniform(.025,.055) if submerged else rng.uniform(.011,.030)
            flare, tint = rng.uniform(.32,.85), rng.uniform(.23,.95)
            last = None
            for t in (0.,.26,.53,.77,.94):
                center = foot + along*height*flare*t*t + Vector((0,0,height*(1.17*t-.25*t*t*t)))
                half = width*(1.-.80*t*t)*(.73+.27*math.sin(t*math.pi))
                row = [patch.vertex(center-across*half,(0,t),(tint,t,.62,t)),
                       patch.vertex(center+along*half*.45,(.5,t),(tint,t,.90,t)),
                       patch.vertex(center+across*half,(1,t),(tint,t,.59,t))]
                if last:
                    patch.face((last[0],last[1],row[1],row[0]))
                    patch.face((last[1],last[2],row[2],row[1]))
                last = row
            tip = patch.vertex(foot+along*height*flare+Vector((0,0,height*.92)),(.5,1),(tint,1,.85,1))
            patch.face((last[0],last[1],tip))
            patch.face((last[1],last[2],tip))
    name = "SeaGrass" if submerged else "DuneGrass"
    return patch.create(name, [name])


def reef_coral():
    rng = random.Random(7118)
    colony = Mesh()
    up = Vector((0,0,1))

    def branch(start, end, base_radius, tip_radius, tint, bend):
        axis = (end-start).normalized()
        side = axis.cross(Vector((1,0,0))).normalized()
        other = axis.cross(side).normalized()
        previous = None
        for i in range(6):
            t = i/5
            center = start.lerp(end,t) + side*(bend*math.sin(math.pi*t))
            radius = (base_radius*(1-t)+tip_radius*t)*(.97+.10*math.sin(14*t))
            row = []
            for k in range(8):
                angle = TAU*k/8
                offset = (side*math.cos(angle) + other*math.sin(angle))*radius
                color = (tint,.48+.48*t,.64+.28*math.sin(angle+11*t)**2,1)
                row.append(colony.vertex(center+offset, (k/8,t), color))
            if previous:
                for k in range(8):
                    j = (k+1)%8
                    colony.face((previous[k],previous[j],row[j],row[k]))
            previous = row
        colony.face(tuple(previous))

    for i in range(8):
        azimuth = i*2.39996
        base = Vector((math.sin(azimuth),math.cos(azimuth),.035))*rng.uniform(.09,.56)
        height, tint = rng.uniform(.27,.65), rng.uniform(.08,1)
        crown = base + up*height
        branch(base,crown,.064,.016,tint,rng.uniform(-.045,.045))
        for j in range(5):
            a = azimuth+j*2.39996
            away = Vector((math.cos(a),math.sin(a),0))
            start = base.lerp(crown,rng.uniform(.22,.71))
            end = start + away*rng.uniform(.16,.34) + up*rng.uniform(.16,.43)
            branch(start,end,rng.uniform(.026,.041),.011,tint,rng.uniform(-.044,.044))
            fork = start.lerp(end,.58)
            branch(fork,end+away*.08+up*.15,.022,.009,tint,.032)
    return colony.create("ReefCoral", ["ReefCoral"])


def jib():
    mesh = Mesh()
    tack, head, clew = Vector(FORESTAY_TACK), Vector(FORESTAY_HEAD), Vector((.82, -.65, 2.12))
    steps = 36
    for row in range(steps):
        v = row / steps
        start = len(mesh.points)
        for col in range(steps + 1):
            u = col / steps
            position = tack.lerp(clew, u).lerp(head, v)
            position.y -= .91 * math.sin(math.pi*u)**.9 * (1-v)**.77 * (.47 + .53*math.sin(math.pi*v))
            position.x += .20 * math.sin(math.pi*v) * u**2
            mesh.vertex(position, (u, v))
            if row and col:
                a = start + col
                mesh.face((a - steps - 2, a - 1, a, a - steps - 1))
    tip = mesh.vertex(head, (.5, 1))
    for i in range(steps):
        mesh.face((tip - steps - 1 + i, tip, tip - steps + i))
    return mesh.create("CatamaranJib", ["Cloth"])


def soften(obj, threshold, subdivisions):
    geometry = bmesh.new()
    geometry.from_mesh(obj.data)
    bmesh.ops.remove_doubles(geometry, verts=list(geometry.verts), dist=threshold)
    geometry.to_mesh(obj.data)
    geometry.free()
    obj.data.normals_split_custom_set([(0, 0, 0)] * len(obj.data.loops))
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    if subdivisions:
        modifier = obj.modifiers.new("Curved surface", "SUBSURF")
        modifier.levels = modifier.render_levels = subdivisions


def cruising_catamaran():
    """Loft the two hulls about the buoyancy stations; all dimensions here are metres."""
    mesh = Mesh()
    gel, glass, gasket, steel, teak = range(5)
    # x, half-beam, keel and deck edge. The transoms step down to the water.
    stations = [(-5.49,.48,-.20,.38),(-5.19,.60,-.38,.40),(-5.11,.62,-.40,.67),
                (-4.86,.70,-.49,.69),(-4.77,.72,-.50,.96),(-4.48,.77,-.58,.98),
                (-4.40,.78,-.60,1.26),(-3.5,.83,-.69,1.32),(-1,.87,-.79,1.36),
                (1.1,.82,-.77,1.40),(3.1,.62,-.60,1.46),(4.55,.34,-.31,1.50),
                (5.43,.095,-.01,1.55),(5.66,.024,.18,1.57)]
    profile = [(0,0),(.44,.044),(.76,.15),(.90,.31),(.96,.50),(1,.81),(.99,.965),
               (.94,.994),(.83,1),(-.83,1),(-.94,.994),(-.99,.965),(-1,.81),
               (-.96,.50),(-.90,.31),(-.76,.15),(-.44,.044)]

    def join_rings(a, b, slot):
        for i in range(len(a)):
            j = (i+1) % len(a)
            mesh.face((a[i],a[j],b[j],b[i]), slot)

    def section(x):
        for left,right in zip(stations,stations[1:]):
            if x <= right[0]:
                t = (x-left[0])/(right[0]-left[0])
                return tuple(a+(b-a)*t for a,b in zip(left[1:],right[1:]))
        return stations[-1][1:]

    for side in (-1,1):
        prev = []
        for x,width,bottom,top in stations:
            row = [mesh.vertex((x,side*1.90+w*width,bottom+(top-bottom)*h),(x*.45,w*.5+h)) for w,h in profile]
            if prev:
                join_rings(prev,row,gel)
            else:
                mesh.face(tuple(reversed(row)),gel)
            prev = row
        mesh.face(tuple(prev),gel)
        # Teak inserts on the three swim steps and a stainless boarding ladder at port.
        for aft,fore,width,z in ((-5.44,-5.21,.40,.405),(-5.06,-4.89,.49,.701),(-4.71,-4.50,.55,.987)):
            cy = side*1.90
            tread = [mesh.vertex((x,y,z),(x/.7,y/.7)) for x,y in
                     ((aft,cy-width),(fore,cy-width),(fore,cy+width),(aft,cy+width))]
            mesh.face(tread,teak)
        if side == 1:
            for y in (1.69,2.10):
                tube(mesh,(-5.38,y,.45),(-5.55,y,-.28),[(0,.021),(1,.021)],steel,8)
            for z in (-.20,.0,.19):
                tube(mesh,(-5.49,1.69,z),(-5.49,2.10,z),[(0,.019),(1,.019)],steel,8)
        # Shallow framed portlights conform to the compound curvature of the topsides.
        for x0,length in ((-3.31,.82),(-2.0,.91),(.05,1.24),(1.81,.81)):
            rings = []
            for inset,stand in ((0,.020),(.035,.030)):
                points = []
                for j in range(24):
                    a = TAU*j/24
                    c, sn = math.cos(a), math.sin(a)
                    x = x0+math.copysign(abs(c)**.43,c)*(length/2-inset)
                    width,keel,top = section(x)
                    z = top-.43+math.copysign(abs(sn)**.58,sn)*(.132-inset)
                    depth = (z-keel)/(top-keel)
                    w = .96 + .04*(depth-.50)/.31
                    points.append(mesh.vertex((x,side*(1.90+width*w+stand),z)))
                if side > 0:
                    points.reverse()
                rings.append(points)
            join_rings(*rings,gasket)
            mesh.face(tuple(rings[-1]),glass)

    # Rounded plan of a deck or cabin, counter-clockwise from above.
    def outline(aft, fore, beam, radius):
        points = []
        for cx,cy,first in ((fore-radius,beam-radius,0),(aft+radius,beam-radius,90),
                            (aft+radius,-beam+radius,180),(fore-radius,-beam+radius,270)):
            for k in range(5):
                a = math.radians(first+k*22.5)
                points.append((cx+radius*math.cos(a),cy+radius*math.sin(a)))
        return points

    def deck(levels, cap=gel):
        previous = []
        for aft,fore,beam,radius,z,slot in levels:
            ring = [mesh.vertex((x,y,z),(x*.51,y*.51)) for x,y in outline(aft,fore,beam,radius)]
            if previous:
                join_rings(previous,ring,slot)
            else:
                mesh.face(tuple(reversed(ring)),slot)
            previous = ring
        mesh.face(tuple(previous),cap)

    deck([(-4.72,2.77,1.78,.38,1.03,gel),(-4.82,2.94,1.95,.39,1.19,gel),
          (-4.82,2.94,1.95,.39,1.27,gel),(-4.79,2.90,1.91,.38,1.30,gel)])
    deck([(-4.73,-1.75,1.58,.24,1.30,teak),(-4.73,-1.75,1.58,.24,1.326,teak)],teak)
    deck([(-2.53,2.60,1.57,.38,1.29,gel),(-2.53,2.53,1.58,.38,1.73,gel),
          (-2.49,2.45,1.56,.37,1.81,gel),(-2.46,2.40,1.55,.36,1.84,gasket),
          (-2.25,1.85,1.36,.34,2.53,glass),(-2.24,1.83,1.36,.34,2.57,gasket)])
    deck([(-3.30,1.99,1.53,.39,2.57,gel),(-3.33,2.02,1.57,.40,2.62,gel),
          (-3.29,1.98,1.54,.40,2.71,gel),(-3.13,1.87,1.42,.37,2.75,gel)])
    for side in (-1,1):
        for x in (-1.85,-.73,.55,1.64):
            tube(mesh,(x,side*1.555,1.83),(x-.15,side*1.373,2.55),[(0,.042),(1,.040)],gasket,8)
        for y in (.47,1.12):
            tube(mesh,(2.42,side*y,1.83),(1.86,side*y,2.54),[(0,.046),(1,.037)],gasket,8)
        tube(mesh,(-3.02,side*1.39,1.32),(-3.19,side*1.41,2.59),[(0,.033),(1,.033)],steel,10)
    # Laced foredeck trampoline between the crossbeam and the house.
    for i in range(32):
        y=-1.3+i*2.6/31
        tube(mesh,(2.62,y,1.33),(4.42,y,1.38),[(0,.012),(1,.012)],gasket,4)
    for i in range(22):
        x=2.63+i*1.78/21
        tube(mesh,(x,-1.33,1.36),(x,1.33,1.36),[(0,.014),(1,.014)],gasket,4)
    tube(mesh,(4.43,-2.26,1.42),(4.43,2.26,1.42),[(0,.069),(1,.069)],steel,12)
    result = mesh.create("CruisingHulls",["white_fiberglass","Glass","black","Stainless_stile","Material.002"])
    result.data.set_sharp_from_angle(angle=math.radians(38))
    return result


def mainsail():
    mesh = Mesh()
    rows, cols = 50, 36
    height = 7.66*RIG_HEIGHT_SCALE
    for row in range(rows+1):
        v = row/rows
        chord = 6.95*(1-v)**.79 + .14
        for col in range(cols+1):
            u = col/cols
            draft = chord*.134*math.sin(math.pi*u**.78) + .37*u*math.sin(math.pi*v)
            tension = .024*math.sin(24*v+u*2.3)*u*math.sin(math.pi*v)
            vertex = mesh.vertex((-.09-chord*u, draft+tension, .13+v*height+.20*u*(1-v)),(u,v))
            if row and col:
                mesh.face((vertex-cols-2,vertex-1,vertex,vertex-cols-1))
    return mesh.create("Mainsail",["Cloth"])


def yacht():
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(OUT / "Yacht.glb"))
    objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    # Blender's glTF import has the bow along +Y. Unreal import mirrors Y.
    # Keep hull centers at the existing ±1.9 m buoyancy stations.
    transform = Matrix(((0, 0.311, 0, -0.57), (-0.267, 0, 0, 0),
                        (0, 0, 0.309, 0.98), (0, 0, 0, 1)))
    pivot = transform @ Vector((0.0, 7.15, 7.26))
    rig = {"Object_17"}
    mast_and_stays = {"Object_13", "Object_72", "Object_74", "Object_76", "Object_78"}
    helm = {f"Object_{i}" for i in (35, 37, 39, 41, 43, 45, 47, 49, 52, 54, 58, 60, 62, 64, 66, 68, 70)}
    hull = [cruising_catamaran()]
    sails = [mainsail()]
    for obj in objects:
        # Keep the source mast, boom, standing rigging and cockpit hardware.
        if obj.name in {"Object_4","Object_6","Object_7","Object_8","Object_9","Object_11","Object_21",
                        "Object_23","Object_27","Object_29","Object_31","Object_56"}:
            continue
        local_to_boat = transform @ obj.matrix_world
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        obj.data = obj.data.copy()
        if obj.name in rig:
            local_to_boat = Matrix.Rotation(math.radians(15.3), 4, "Z") @ Matrix.Translation(-pivot) @ local_to_boat
            sails.append(obj)
        else:
            hull.append(obj)
        obj.data.transform(local_to_boat)
        if obj.name in rig:
            obj.data.transform(Matrix.Diagonal((1, 1, RIG_HEIGHT_SCALE, 1)))
        elif obj.name in mast_and_stays:
            for v in obj.data.vertices:
                v.co.z += max(0, v.co.z - GOOSENECK_Z) * (RIG_HEIGHT_SCALE - 1)
        elif obj.name in helm:
            obj.data.transform(Matrix.Translation(HELM_SHIFT))

    lines = Mesh()
    tube(lines, FORESTAY_TACK, FORESTAY_HEAD, [(0, .017), (1, .017)], 0, 9)
    for side in (-1, 1):
        deck = [(-4.44, 2.56*side, 1.25), (-2.73, 2.59*side, 1.34), (-.68, 2.61*side, 1.37),
                (1.46, 2.54*side, 1.42), (3.21, 2.36*side, 1.46), (4.59, 1.95*side, 1.58)]
        for position in deck:
            p = Vector(position)
            tube(lines, p, p + Vector((0, 0, .63)), [(0, .025), (1, .019)], 0, 9)
        for first, second in zip(deck, deck[1:]):
            for z, radius in ((.28, .009), (.61, .012)):
                rise = Vector((0, 0, z))
                tube(lines, Vector(first) + rise, Vector(second) + rise, [(0, radius), (1, radius)], 0, 8)
    for side in (-1,1):
        chainplate = Vector((-.54,2.58*side,1.40))
        spreader = Vector((1.65,1.22*side,6.55))
        cap = Vector((1.65,0,FORESTAY_HEAD[2]-.08))
        tube(lines,chainplate,spreader,[(0,.017),(1,.017)],0,8)
        tube(lines,spreader,cap,[(0,.014),(1,.014)],0,8)
        tube(lines,(-4.1,2.13*side,1.45),cap,[(0,.015),(1,.014)],0,8)
        tube(lines,(1.65,0,6.55),spreader,[(0,.049),(1,.028)],0,10)
    hull.append(lines.create("Stanchions", ["stainless_stile"]))
    export("Catamaran", hull)
    export("CatamaranRig", sails)
    export("CatamaranJib", [jib()])
    print(f"Catamaran rig pivot at {tuple(round(v * 100, 3) for v in pivot)} cm")


def from_gltf(name):
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(OUT / f"{name}.glb"))
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.material_slots]


def save_maps(material, target):
    principled = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    normal = principled.inputs["Normal"].links[0].from_node
    packed = principled.inputs["Roughness"].links[0].from_node
    images = {
        "diff": principled.inputs["Base Color"].links[0].from_node.image,
        "normal": normal.inputs["Color"].links[0].from_node.image,
        "arm": packed.inputs[0].links[0].from_node.image,
    }
    folder = OUT / "model_maps"
    folder.mkdir(exist_ok=True)
    for role, image in images.items():
        width, height = image.size
        pixels = array("f", [0]) * (4 * width * height)
        image.pixels.foreach_get(pixels)
        # Saving the imported image directly copies its packed WebP stream.
        copy = bpy.data.images.new(f"{target}_{role}", width, height, alpha=True)
        copy.colorspace_settings.name = image.colorspace_settings.name
        copy.pixels.foreach_set(pixels)
        copy.file_format = "PNG"
        copy.save(filepath=str(folder / f"{target}_{role}.png"), save_copy=True)
        bpy.data.images.remove(copy)


def freeze(obj, name, transform):
    graph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(graph), preserve_all_data_layers=True, depsgraph=graph)
    mesh.transform(transform @ obj.matrix_world)
    baked = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(baked)
    return baked


def repair_ship_plating(mesh):
    # RM02's shell is open along one broadside above the waterline. Transfer only
    # outer plates whose opposite panel is absent, retaining their paint UVs.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.normal_update()
    original = BVHTree.FromBMesh(bm)
    uv = bm.loops.layers.uv.active
    bm.faces.ensure_lookup_table()
    # Sample the two intact paint strips at the same station. The author laid
    # them out in opposite longitudinal directions and on different atlas rows.
    def paint_origin(side):
        hit, _, index, _ = original.ray_cast(Vector((35,24*side,.2)), Vector((0,-side,0)), 48)
        triangle = bm.faces[index].loops
        return barycentric_transform(hit, *[l.vert.co for l in triangle], *[l[uv].uv.to_3d() for l in triangle])

    paint = {-1: paint_origin(-1), 1: paint_origin(1)}
    mirrored = {}
    for face in list(bm.faces):
        center = face.calc_center_median()
        side = 1 if center.y > 0 else -1
        if abs(center.y) < 2 or center.z > 5.5 or face.normal.y * side < .18:
            continue

        def outside_y(point, direction):
            origin = Vector((point.x, 24 * direction, point.z))
            hit = original.ray_cast(origin, Vector((0, -direction, 0)), 48)[0]
            return direction * hit.y if hit is not None else -24

        if outside_y(center, side) > abs(center.y) + .28:
            continue
        probes = [center] + [center.lerp(v.co, .84) for v in face.verts]
        if all(outside_y(p, -side) >= abs(p.y) - .55 for p in probes):
            continue
        loops = list(reversed(face.loops))
        for loop in loops:
            v = loop.vert
            if v not in mirrored:
                # A small inset lets the new plate lap the edge of the intact hull.
                mirrored[v] = bm.verts.new((v.co.x, -v.co.y * .986, v.co.z))
        patch = bm.faces.new([mirrored[loop.vert] for loop in loops])
        patch.material_index = face.material_index
        patch.smooth = face.smooth
        strip = abs(sum(l[uv].uv.y for l in loops)/len(loops) - paint[side].y) < .050
        for new, old in zip(patch.loops, loops):
            u, v = old[uv].uv
            new[uv].uv = (paint[-side].x + paint[side].x - u, v+paint[-side].y-paint[side].y) if strip else (u,v)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def merchant_ship():
    parts = []
    for obj in from_gltf("ContainerShip"):
        name = obj.material_slots[0].material.name
        save_maps(obj.material_slots[0].material, f"ship_{name.lower()}")
        fit = Matrix.Scale(146 / 91.253, 4) @ Matrix.Translation(Vector((-12.336, 0, -4.3)))
        part = freeze(obj, name, fit)
        if name.lower() == "hull":
            repair_ship_plating(part.data)
        parts.append(part)
    export("ContainerShip", parts)


def ship_at_anchor(name, length, turn):
    objects = from_gltf(name)
    bounds = np.array([obj.matrix_world @ Vector(p) for obj in objects for p in obj.bound_box])
    center = (bounds.min(0) + bounds.max(0)) * .5
    fit = (Matrix.Scale(length / np.ptp(bounds[:, 1]), 4) @ Matrix.Rotation(turn, 4, "Z")
           @ Matrix.Translation(Vector((-center[0], -center[1], 0))))
    parts = []
    shell = {"Object_5","Object_6","Object_7","Object_10"} if name=="ProductTanker" else {"Object_5","Object_6"}
    # Both originals use solid PBR finishes. Store them on face corners so the
    # engine can draw pipes, railings, winches, glazing and plating together.
    for obj in objects:
        part = freeze(obj, obj.name, fit)
        mesh = part.data
        finishes = []
        for mat in mesh.materials:
            bsdf = next(node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
            color = bsdf.inputs["Base Color"].default_value[:3]
            rough = bsdf.inputs["Roughness"].default_value
            metal = bsdf.inputs["Metallic"].default_value
            finishes.append((color, rough, metal))
        rgba = np.ones((len(mesh.loops), 4), dtype=np.float32)
        rgba[:,3] = float(obj.name.split(".")[0] in shell)
        surface = np.empty((len(mesh.loops), 2), dtype=np.float32)
        planar = np.empty_like(surface)
        co = np.empty((len(mesh.vertices),3),dtype=np.float32)
        mesh.vertices.foreach_get("co",co.ravel())
        corners = np.empty(len(mesh.loops),dtype=np.int32)
        mesh.loops.foreach_get("vertex_index",corners)
        for poly in mesh.polygons:
            color, rough, metal = finishes[poly.material_index]
            selection = slice(poly.loop_start, poly.loop_start + poly.loop_total)
            rgba[selection, :3] = color
            surface[selection] = (rough, 1-metal)
            nx,ny,nz = map(abs,poly.normal)
            axes = (0,1) if nz>max(nx,ny) else (0,2) if ny>nx else (1,2)
            planar[selection] = co[corners[selection]][:,axes] * .16
        for layer in list(mesh.uv_layers):
            mesh.uv_layers.remove(layer)
        mesh.uv_layers.new(name="Steel").data.foreach_set("uv",planar.ravel())
        mesh.uv_layers.new(name="Finish").data.foreach_set("uv",surface.ravel())
        layer = mesh.color_attributes.new(name="Paint", type="FLOAT_COLOR", domain="CORNER")
        layer.data.foreach_set("color", rgba.ravel())
        mesh.color_attributes.active_color = layer
        mesh.materials.clear()
        mesh.materials.append(material_slot("MarineFinish"))
        parts.append(part)
    export(name, parts)


def reef_shark():
    repo = OUT.parents[2]
    subprocess.run(["yarn", "node", str(repo/"desktop/Tools/unpack_mesh.mjs"),
                    str(repo/"public/models/shark-animated.glb"), str(OUT/"ReefShark.glb")], check=True, cwd=repo)
    obj, = from_gltf("ReefShark")
    arm = obj.parent
    action = arm.animation_data.action
    if not action or action.name.split(".")[0] != "swimming":
        raise ValueError("Expected the active authored swimming clip")
    graph = bpy.context.evaluated_depsgraph_get()
    frames = []
    for i in range(24):
        frame = float(action.frame_range[1]) * i / 24
        bpy.context.scene.frame_set(int(frame), subframe=frame % 1)
        posed = obj.evaluated_get(graph).data
        co = np.empty((len(posed.vertices), 3), dtype=np.float32)
        posed.vertices.foreach_get("co", co.ravel())
        basis = np.array(obj.matrix_world)
        frames.append(co @ basis[:3,:3].T + basis[:3,3])
    frames = np.array(frames)
    mean = frames.mean(axis=0)
    dorsal = mean[:,2].argmax()
    scale = 4.35 / np.ptp(mean[:,1])
    # Anchor the mesh at the actual dorsal tip. Keep the lateral component of
    # the authored stroke, sampled once offline, in the second UV channel.
    local = (mean - mean[dorsal]) * scale
    bpy.context.scene.frame_set(0)
    part = freeze(obj, "ReefShark", Matrix.Rotation(math.pi/2, 4, "Z"))
    mesh = part.data
    mesh.vertices.foreach_set("co", np.column_stack((-local[:,1],local[:,0],local[:,2])).astype("f").ravel())
    delta = (frames[:,:,0] - frames[:,dorsal:dorsal+1,0] - (mean[:,0]-mean[dorsal,0])) * scale
    phase = np.arange(24) * TAU / 24
    # Unreal flips Blender's Y and texture V on import. Values fit +/- one metre.
    stroke = np.stack((.5 - np.cos(phase) @ delta / 24, .5 + np.sin(phase) @ delta / 24), axis=1)
    indices = np.empty(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", indices)
    mesh.uv_layers.new(name="SwimStroke").data.foreach_set("uv", stroke[indices].astype("f").ravel())
    mesh.update()
    export("ReefShark", [part])
    shark_maps()


def shark_maps():
    # Texture indices and image indices are different glTF tables. Resolve the
    # material's actual semantic bindings, including the WebP source extension.
    packed = (OUT / "ReefShark.glb").read_bytes()
    length = struct.unpack_from("<I",packed,12)[0]
    scene = json.loads(packed[20:20+length])
    binary = memoryview(packed)[28+length:]
    skin = scene["materials"][0]
    diffuse = skin["extensions"]["KHR_materials_pbrSpecularGlossiness"]["diffuseTexture"]
    folder = OUT / "model_maps"
    folder.mkdir(exist_ok=True)
    for role, binding in (("diff",diffuse), ("normal",skin["normalTexture"])):
        tex = scene["textures"][binding["index"]]
        index = tex["extensions"]["EXT_texture_webp"]["source"] if "EXT_texture_webp" in tex.get("extensions",{}) else tex["source"]
        view = scene["bufferViews"][scene["images"][index]["bufferView"]]
        start = view.get("byteOffset",0)
        image = folder / f"reefshark_{role}.webp"
        image.write_bytes(binary[start:start+view["byteLength"]])
        subprocess.run(["/usr/bin/sips","-s","format","png",str(image),"--out",str(image.with_suffix(".png"))],check=True)


def blue_whale():
    repo = OUT.parents[2]
    subprocess.run(["yarn", "node", "desktop/Tools/unpack_mesh.mjs", "public/models/blue-whale-rigged-pbr-v2.glb",
                    str(OUT / "BlueWhale.glb")], cwd=repo, check=True)
    source = from_gltf("BlueWhale")
    for arm in (o for o in bpy.context.scene.objects if o.type == "ARMATURE"):
        arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    parts = [freeze(obj, obj.name, Matrix.Rotation(math.pi/2, 4, "Z")) for obj in source]
    points = [v.co for part in parts for v in part.data.vertices]
    front, tail = max(v.x for v in points), min(v.x for v in points)
    top = max(v.z for v in points)
    center = Vector(((front + tail)/2, 0, top))
    for part in parts:
        mesh = part.data
        mesh.transform(Matrix.Scale(18/(front-tail),4) @ Matrix.Translation(-center))
        stroke = mesh.uv_layers.new(name="TailStroke")
        for loop in mesh.loops:
            stroke.data[loop.index].uv = (.5-mesh.vertices[loop.vertex_index].co.x/18, .5)
    save_maps(parts[-1].data.materials[0], "bluewhale")
    export("BlueWhale", parts)


def dolphin():
    source = from_gltf("Dolphin")
    # The imported neutral pose is straight. The bind pose curls the tail up and
    # separates the skinned head from the model's unskinned eyes.
    bpy.context.view_layer.update()
    fit = Matrix.Scale(2.72 / 471.574, 4) @ Matrix.Translation(Vector((9.521, 13.323, 0)))
    parts = []
    for obj in source:
        baked = freeze(obj, obj.name, fit)
        soften(baked, .0008, 0)
        for source_uv in list(baked.data.uv_layers):
            baked.data.uv_layers.remove(source_uv)
        uv = baked.data.uv_layers.new(name="SwimCoordinates")
        baked.data.uv_layers.active = uv
        uv.active_render = True
        for loop in baked.data.loops:
            point = baked.data.vertices[loop.vertex_index].co
            uv.data[loop.index].uv = (min(1, max(0, (1.28 - point.x) / 2.72)), .5 + point.z / 2)
        for slot in baked.material_slots:
            slot.material = material_slot(f"Dolphin_{slot.material.name}")
        parts.append(baked)
    export("Dolphin", parts)


def aim_bone(bone, end):
    head = bone.head.copy()
    swing = (bone.tail - head).rotation_difference(end - head).to_matrix().to_4x4()
    matrix = swing @ bone.matrix
    matrix.translation = head
    bone.matrix = matrix
    bpy.context.view_layer.update()


def skipper():
    figure, = from_gltf("Skipper")
    armature = figure.find_armature()
    armature.animation_data_clear()
    bones = armature.pose.bones
    for bone in bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    world = armature.matrix_world
    forward = world @ bones["headfront"].head - world @ bones["Head"].head
    feet = world @ ((bones["LeftFoot"].head + bones["RightFoot"].head) * .5)
    feet.z = min((figure.matrix_world @ Vector(v)).z for v in figure.bound_box)
    fit = (Matrix.Translation(SKIPPER_FEET)
           @ Matrix.Rotation(-math.atan2(forward.y, forward.x), 4, "Z")
           @ Matrix.Translation(-feet))
    to_arm = (fit @ world).inverted()
    for side, y in (("Left", -.99), ("Right", -1.50)):
        arm, fore, hand = (bones[side + name] for name in ("Arm", "ForeArm", "Hand"))
        target = to_arm @ (Vector((-3.20, y, 2.05)) + HELM_SHIFT)
        shoulder = arm.head.copy()
        upper, lower = (fore.head - shoulder).length, (hand.head - fore.head).length
        direction = (target - shoulder).normalized()
        distance = min((target - shoulder).length, (upper + lower) * .985)
        pole = to_arm.to_3x3() @ Vector((0, .18 if side == "Left" else -.18, -1))
        bend = (pole - direction * pole.dot(direction)).normalized()
        along = (distance**2 + upper**2 - lower**2) / (2 * distance)
        elbow = shoulder + direction * along + bend * math.sqrt(max(0, upper**2 - along**2))
        aim_bone(arm, elbow)
        aim_bone(fore, shoulder + direction * distance)
    save_maps(figure.material_slots[0].material, "skipper")
    body = freeze(figure, "Skipper", fit)
    # Cut the shirt in the neutral pose so its short sleeves stop on the upper arms,
    # then lift the same faces off the already posed body.
    rest = fit @ figure.matrix_world
    covered = []
    for vertex in figure.data.vertices:
        p = rest @ vertex.co - SKIPPER_FEET
        neck = math.hypot((p.x+.015)*1.08,p.y)
        neckline = 1.52 - .075*max(0,1-neck/.17)
        covered.append(.91 < p.z < neckline and abs(p.y) < .405)
    shirt = Mesh()
    moved = {}
    body.data.materials.clear()
    body.data.materials.append(material_slot("SkipperSkin"))
    body.data.materials.append(material_slot("DeckShirt"))
    for face in body.data.polygons:
        if not all(covered[i] for i in face.vertices):
            continue
        face.material_index = 1
        indices = []
        for i in face.vertices:
            if i not in moved:
                v = body.data.vertices[i]
                pos = v.co + v.normal * (.013+.007*math.cos(v.co.y*29))
                moved[i] = shirt.vertex(pos,(pos.y*2,pos.z*2))
            indices.append(moved[i])
        shirt.face(indices)
    top = shirt.create("DeckShirt",["DeckShirt"])
    hem = top.modifiers.new("Sleeves and hem","SOLIDIFY")
    hem.thickness = .006
    export("Skipper", [body,top])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bake_wind_waves()
    bake_breaker_foam(OUT)
    bake_surf_transport(OUT)
    clear_scene()
    for cay in CAYS:
        export(cay.name, [cay_mesh(cay)])
    for variant in range(3):
        palm = palm_mesh(variant)
        export(palm.name, [palm])
    export("CoastalCanopy", [coastal_canopy()])
    export("DuneGrass", [dune_grass()])
    export("SeaGrass", [dune_grass(submerged=True)])
    export("ReefCoral", [reef_coral()])
    export("ReefShelf", [reef_shelf()])
    export("Volcano", [volcano()])
    lighthouse()

    for source, target in (("coast_rocks_03", "CoastRocks"), ("boulder_01", "Boulder")):
        clear_scene()
        bpy.ops.import_scene.gltf(filepath=str(OUT / source / f"{source}_4k.gltf"))
        rocks = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
        high = max(rocks, key=lambda obj: len(obj.data.polygons))
        export(target, [high])
        print(f"{target} has {len(high.data.polygons):,} triangles at LOD 0")
    yacht()
    ship_at_anchor("ProductTanker", 176, -math.pi/2)
    ship_at_anchor("GasCarrier", 184, math.pi/2)
    from pirate_ship import bake as bake_pirate_ship
    bake_pirate_ship()
    subprocess.run(["/usr/bin/python3", str(Path(__file__).with_name("ship_paint.py"))],check=True)
    reef_shark()
    dolphin()
    subprocess.run(["/usr/bin/python3", str(Path(__file__).with_name("cetacean_skin.py"))], check=True)
    blue_whale()
    skipper()


if __name__ == "__main__":
    main()
