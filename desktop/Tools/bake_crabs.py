"""Prepare the project's two authored GLBs for the native instanced crab populations."""
import json
import math
import struct
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coastal_geometry import OUT, clear_scene, export, material_slot


def bake(kind):
    clear_scene()
    name = f"Crab{kind.title()}"
    source = OUT.parents[2] / "public" / "models" / f"crab-{kind}.glb"
    raw = source.read_bytes()
    size = struct.unpack_from("<I", raw, 12)[0]
    gltf = json.loads(raw[20:20+size])
    binary = memoryview(raw)[28+size:]
    texture = gltf["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    def extract(index, suffix):
        tex = gltf["textures"][index]
        image = tex.get("extensions", {}).get("EXT_texture_webp", tex)["source"]
        view = gltf["bufferViews"][gltf["images"][image]["bufferView"]]
        start = view.get("byteOffset", 0)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", "pipe:0", "-frames:v", "1",
                        str(OUT/f"T_{name}{suffix}.png")], input=binary[start:start+view["byteLength"]], check=True)
    extract(texture, "Color")
    if "normalTexture" in gltf["materials"][0]:
        extract(gltf["materials"][0]["normalTexture"]["index"], "Normal")
    bpy.ops.import_scene.gltf(filepath=str(source))
    parts = [ob for ob in bpy.context.selected_objects if ob.type == "MESH"]
    # GLB +Z becomes -Y in Blender. Put the head on +X and the legs across Y.
    turn = Matrix.Rotation(math.pi/2 if kind == "red" else 0., 4, "Z")
    corners = [turn @ ob.matrix_world @ Vector(p) for ob in parts for p in ob.bound_box]
    low = Vector([min(p[i] for p in corners) for i in range(3)])
    high = Vector([max(p[i] for p in corners) for i in range(3)])
    center = (low+high)*.5
    center.z = low.z
    fit = Matrix.Scale(1/(high.y-low.y), 4) @ Matrix.Translation(-center) @ turn
    for ob in parts:
        data = ob.data.copy()
        ob.data = data
        data.transform(fit @ ob.matrix_world)
        ob.parent = None
        ob.matrix_world = Matrix.Identity(4)
        colors = data.color_attributes.new(name="Finish", type="FLOAT_COLOR", domain="CORNER")
        for poly in data.polygons:
            mat = data.materials[poly.material_index]
            flat = (.024,.022,.015,0) if "eye" in mat.name.lower() else (.27,.17,.08,0)
            value = flat if any(t in mat.name.lower() for t in ("eye", "antenna")) else (1,1,1,1)
            for loop in poly.loop_indices:
                colors.data[loop].color = value
            poly.material_index = 0
        data.color_attributes.active_color = colors
        data.materials.clear()
        data.materials.append(material_slot(name))
    export(name, parts)


for species in ("red", "blue"):
    bake(species)
