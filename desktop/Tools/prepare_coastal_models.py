"""Prepare the downloaded coastal models with Blender's headless Python runtime."""

import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
from zipfile import ZipFile

import bpy
from mathutils import Matrix, Vector
import numpy as np


OUT = Path(__file__).resolve().parents[1] / "Saved" / "CoastalSources"
WORK = OUT / "CoastalModels"
DOWNLOADS = Path(os.environ.get("SAILING_DOWNLOADS", Path.home() / "Downloads"))
FOLIAGE_TEXTURES = Path(os.environ.get("SAILING_FOLIAGE_TEXTURES", DOWNLOADS))
MODELS = (
    ("CoconutPalm", "realistic_coconut_palm_tree_3d_model_free.glb", 10.1, 330_000),
    ("IslandTree02", "island_tree_02_4k.gltf.zip", 6.0, 225_000),
    ("JacarandaTree", "jacaranda_tree_4k.gltf.zip", 10.8, 390_000),
    ("OceanBuoy", "ocean_buoy.glb", None, None),
    ("GreenBuoy", "buoy.glb", None, 36_000),
    ("Fern02", "fern_02_4k.gltf.zip", .72, None),
    ("Anthurium", "anthurium_botany_01_4k.gltf.zip", .94, 18_000),
)
OPACITY_MAPS = {"Fern02": "fern_02_alpha_4k.png", "Anthurium": "anthurium_botany_01_alpha_4k.png"}
# Source coordinates at the center of the float and the mean waterline, followed by the scale to metres.
BUOY_FITS = {"OceanBuoy": ((0., 0., .075), 2.95), "GreenBuoy": ((-.07954, -2.35606, .31), .57)}


def source_model(source, directory):
    if source.suffix == ".glb":
        with source.open("rb") as stream:
            magic, version, size, length, kind = struct.unpack("<4sIII4s", stream.read(20))
            if (magic, version, size, kind) != (b"glTF", 2, source.stat().st_size, b"JSON"):
                raise ValueError(f"Invalid GLB: {source}")
            model = json.loads(stream.read(length))
            length, kind = struct.unpack("<I4s", stream.read(8))
            if kind != b"BIN\x00":
                raise ValueError(f"Missing GLB buffer: {source}")
            return source, model, stream.read(length)

    directory.mkdir(parents=True, exist_ok=True)
    with ZipFile(source) as archive:
        model_path, = (name for name in archive.namelist() if name.endswith(".gltf"))
        model = json.loads(archive.read(model_path))
        relative_root = Path(model_path).parent
        resources = [Path(model_path)] + [relative_root / data["uri"]
            for data in model["buffers"] + model["images"]]
        for relative in resources:
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError(f"Unexpected file in {source}: {relative}")
            output = directory / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(relative.as_posix()) as contents, output.open("wb") as stream:
                shutil.copyfileobj(contents, stream)
    return directory / model_path, model, None


def texture(model_path, model, binary, entry, name, size=None):
    image = model["images"][model["textures"][entry["index"]]["source"]]
    if binary is None:
        source = model_path.parent / image["uri"]
        extension, data = source.suffix, source.read_bytes()
    else:
        view = model["bufferViews"][image["bufferView"]]
        start = view.get("byteOffset", 0)
        extension = {"image/jpeg": ".jpg", "image/png": ".png"}[image["mimeType"]]
        data = binary[start:start + view["byteLength"]]
    output = WORK / "Textures" / f"{name}{extension}"
    if size:
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", "pipe:0", "-vf",
                        f"scale={size}:{size}:flags=lanczos", "-frames:v", "1", "-update", "1",
                        str(output.with_suffix(".png"))], input=data, check=True)
    else:
        output.write_bytes(data)


def materials(model_path, model, binary, name):
    result = {}
    for index, material in enumerate(model["materials"]):
        slot = material["name"].lower()
        pbr = material["pbrMetallicRoughness"]
        finish = {}
        for key, entry in (("color", pbr["baseColorTexture"]),
                           ("roughness", pbr["metallicRoughnessTexture"]),
                           ("normal", material.get("normalTexture")),
                           ("emissive", material.get("emissiveTexture") if name in BUOY_FITS else None)):
            if entry:
                finish[key] = f"T_{name}_{index}_{key}"
                size = (1024 if key == "emissive" else 2048) if name in BUOY_FITS else None
                texture(model_path, model, binary, entry, finish[key], size)
        transform = pbr["baseColorTexture"].get("extensions", {}).get("KHR_texture_transform")
        if name in OPACITY_MAPS:
            finish["opacity"] = f"T_{name}_{index}_opacity"
            shutil.copyfile(FOLIAGE_TEXTURES / OPACITY_MAPS[name], WORK / "Textures" / f"{finish['opacity']}.png")
        result[slot] = {
            "textures": finish,
            "uv": transform,
            "normal_strength": material.get("normalTexture", {}).get("scale", 1.0),
            "roughness_factor": pbr.get("roughnessFactor", 1.0),
            "leaf": "leaves" in slot or name == "CoconutPalm" or name in OPACITY_MAPS,
        }
    return result


def coordinates(obj):
    points = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
    obj.data.vertices.foreach_get("co", points)
    transform = np.asarray(obj.matrix_world, dtype=np.float32)
    return points.reshape(-1, 3) @ transform[:3, :3].T + transform[:3, 3]


def prepare_mesh(name, model_path, height, triangle_budget):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.ops.import_scene.gltf(filepath=str(model_path))
    objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not objects:
        raise RuntimeError(f"No mesh in {model_path}")

    source_tris = sum(len(o.data.polygons) for o in objects)
    if name in BUOY_FITS:
        pivot, scale = BUOY_FITS[name]
        fit = Matrix.Scale(scale, 4) @ Matrix.Translation(-Vector(pivot))
        for obj in objects:
            if name == "GreenBuoy":
                # The lens is the short cylinder at the center of the upper railing.
                points = coordinates(obj)
                radius = np.linalg.norm(points[:, :2] - pivot[:2], axis=1)
                lens = (radius < .115) & (points[:, 2] > 5.02) & (points[:, 2] < 5.37)
                glow = obj.data.color_attributes.new(name="Lens", type="FLOAT_COLOR", domain="POINT")
                colors = np.ones((len(points), 4), dtype=np.float32)
                colors[:, 3] = lens
                glow.data.foreach_set("color", colors.ravel())
                obj.data.color_attributes.active_color = glow
            obj.matrix_world = fit @ obj.matrix_world
    elif height is not None:
        points = np.concatenate([coordinates(o) for o in objects])
        bottom, top = np.min(points[:, 2]), np.max(points[:, 2])
        base = points[points[:, 2] <= bottom + .025 * (top - bottom)]
        anchor = Vector((*np.median(base[:, :2], axis=0), bottom))
        fit = Matrix.Scale(height / (top - bottom), 4) @ Matrix.Translation(-anchor)
        for obj in objects:
            obj.matrix_world = fit @ obj.matrix_world

    if triangle_budget is not None and source_tris > triangle_budget:
        for obj in objects:
            bpy.context.view_layer.objects.active = obj
            modifier = obj.modifiers.new("Game mesh", "DECIMATE")
            modifier.ratio = triangle_budget / source_tris
            modifier.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=modifier.name)

    if height is not None:
        for obj in objects:
            # Per-vertex flexibility stays anchored at the trunk base in every instance.
            fraction = np.clip((coordinates(obj)[:, 2] / height - .12) / .88, 0, 1)
            flex = obj.data.color_attributes.new(name="CoastalFlex", type="FLOAT_COLOR", domain="POINT")
            colors = np.ones((len(fraction), 4), dtype=np.float32)
            colors[:, 3] = fraction * fraction
            flex.data.foreach_set("color", colors.ravel())
            obj.data.color_attributes.active_color = flex

    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.fbx(filepath=str(OUT / f"{name}.fbx"), use_selection=True, object_types={"MESH"},
                            axis_forward="-Y", axis_up="Z", mesh_smooth_type="FACE", apply_unit_scale=True)
    print(f"Coastal model {name}: {sum(len(o.data.polygons) for o in objects):,} of {source_tris:,} source triangles", flush=True)


def prepare_forest_floor():
    name = "forest_leaves_04"
    folder = OUT / name
    folder.mkdir(parents=True, exist_ok=True)
    with ZipFile(DOWNLOADS / f"{name}_4k.blend.zip") as archive:
        for role, extension in (("diff", "jpg"), ("rough", "jpg"), ("nor_gl", "exr")):
            filename = f"{name}_{role}_4k.{extension}"
            with archive.open(f"textures/{filename}") as data, (folder / filename).open("wb") as target:
                shutil.copyfileobj(data, target)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(folder / f"{name}_nor_gl_4k.exr"),
                    "-frames:v", "1", "-pix_fmt", "rgb24", str(folder / f"{name}_nor_gl_4k.png")], check=True)


def main():
    selected = set(sys.argv[sys.argv.index("--") + 1:]) if "--" in sys.argv else set()
    if unknown := selected - {name for name, *_ in MODELS} - {"forest_leaves_04"}:
        raise ValueError(f"Unknown coastal source: {', '.join(sorted(unknown))}")
    (WORK / "Textures").mkdir(parents=True, exist_ok=True)
    manifest = WORK / "materials.json"
    definitions = json.loads(manifest.read_text()) if selected and manifest.is_file() else {}
    for name, filename, height, triangle_budget in MODELS:
        if selected and name not in selected:
            continue
        model_path, model, binary = source_model(DOWNLOADS / filename, WORK / name)
        definitions[name] = materials(model_path, model, binary, name)
        prepare_mesh(name, model_path, height, triangle_budget)
    if not selected or "forest_leaves_04" in selected:
        prepare_forest_floor()
    manifest.write_text(json.dumps(definitions, indent=2))


if __name__ == "__main__":
    main()
