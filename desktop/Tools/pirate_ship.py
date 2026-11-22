"""Fit Will Rodd's Siren's Light to Coral Pass and pack its original surface maps."""

import json
from pathlib import Path
import struct
from tempfile import TemporaryDirectory


# A source sheet occupies one cell. Repeating rope UVs wrap within that cell.
CELL, GUTTER = 1024, 8
ATLASES = {
    "Hull": (4, 4, ("Ship_Hull", "Foremast", "Bowsprit", "Mainmast", "Captain_Deck", "RudderKeel",
                    "Mainmast_Crossbeam", "Foremast_Crossbeam", "Part3", "Sails", "Figurehead",
                    "Part1", "Cannons", "Part2", "material")),
    "Trim": (2, 1, ("Part4", "Ship_Decal1")),
}


def bake_textures(source):
    import numpy as np
    import OpenImageIO as oiio

    raw = (source / "SirensLight.glb").read_bytes()
    size = struct.unpack_from("<I", raw, 12)[0]
    gltf = json.loads(raw[20:20 + size])
    binary = memoryview(raw)[28 + size:]
    materials = {m["name"]: m for m in gltf["materials"]}
    directory = source / "model_maps"
    directory.mkdir(exist_ok=True)

    def linear(srgb):
        return np.where(srgb <= .04045, srgb / 12.92, ((srgb + .055) / 1.055)**2.4)

    def srgb(color):
        return np.where(color <= .0031308, color * 12.92, 1.055 * np.maximum(0, color)**(1/2.4) - .055)

    def brightness(color):
        return np.sqrt(np.sum(color**2 * (.299, .587, .114), axis=2, keepdims=True))

    with TemporaryDirectory() as temp:
        def read_texture(binding):
            image_index = gltf["textures"][binding["index"]]["source"]
            view = gltf["bufferViews"][gltf["images"][image_index]["bufferView"]]
            offset = view.get("byteOffset", 0)
            path = Path(temp) / f"{image_index}.png"
            path.write_bytes(binary[offset:offset + view["byteLength"]])
            config = oiio.ImageSpec()
            config.attribute("oiio:UnassociatedAlpha", 1)
            image = oiio.ImageBuf(str(path), 0, 0, config)
            inner = CELL - 2 * GUTTER
            resized = oiio.ImageBufAlgo.resize(image, roi=oiio.ROI(0, inner, 0, inner, 0, 1, 0, image.nchannels))
            return np.pad(resized.get_pixels(oiio.UINT8), ((GUTTER,GUTTER), (GUTTER,GUTTER), (0,0)), mode="wrap")

        for atlas, (cols, rows, names) in ATLASES.items():
            sheets = {key: np.zeros((rows*CELL, cols*CELL, channels), dtype=np.uint8)
                      for key, channels in (("Color",4), ("Normal",3), ("Finish",3), ("Glow",3))}
            for index, name in enumerate(names):
                mat = materials[name]
                pbr = mat["extensions"]["KHR_materials_pbrSpecularGlossiness"]
                diffuse = read_texture(pbr["diffuseTexture"])
                gloss = read_texture(pbr["specularGlossinessTexture"])
                # The source stores specular RGB in sRGB and glossiness in linear alpha.
                # Convert to glTF's metallic/roughness workflow before packing the sheets.
                d = linear(diffuse[:,:,:3].astype(np.float32)/255)
                s = linear(gloss[:,:,:-1].astype(np.float32)/255)
                dstrength, sstrength = brightness(d), brightness(s)
                remaining = 1 - np.max(s, axis=2, keepdims=True)
                a = .04
                b = dstrength*remaining/(1-a) + sstrength - 2*a
                metal = np.where(sstrength < a, 0,
                                 np.clip((-b + np.sqrt(np.maximum(0, b*b - 4*a*(a-sstrength))))/(2*a), 0, 1))
                from_diffuse = d * remaining / ((1-a) * np.maximum(.00001, 1-metal))
                from_spec = (s - a*(1-metal)) / np.maximum(.00001, metal)
                color = np.clip(srgb(from_diffuse*(1-metal*metal) + from_spec*metal*metal), 0, 1)
                y, x = divmod(index, cols)
                tile = np.s_[y*CELL:(y+1)*CELL, x*CELL:(x+1)*CELL]
                sheets["Color"][tile][:,:,:3] = np.rint(color * 255)
                sheets["Color"][tile][:,:,3] = diffuse[:,:,3] if diffuse.shape[2] == 4 else 255
                sheets["Normal"][tile] = read_texture(mat["normalTexture"])[:,:,:3]
                sheets["Finish"][tile][:,:,0] = 255 - gloss[:,:,-1]
                sheets["Finish"][tile][:,:,1:2] = np.rint(metal * 255)
                if "emissiveTexture" in mat:
                    sheets["Glow"][tile] = read_texture(mat["emissiveTexture"])[:,:,:3]
            for key, pixels in sheets.items():
                path = directory / f"T_Sirens{atlas}_{key}.png"
                buf = oiio.ImageBuf(pixels)
                buf.specmod().attribute("oiio:UnassociatedAlpha", 1)
                if not buf.write(str(path)):
                    raise RuntimeError(f"Could not write {path}: {buf.geterror()}")


def bake():
    import math
    import bpy
    import numpy as np
    from mathutils import Matrix, Vector
    from coastal_geometry import OUT, export, freeze, from_gltf, material_slot

    objects = from_gltf("SirensLight")
    # The parent heels and pitches the complete ship for its original storm diorama.
    # Level its deck frame, turn the bow to +X, and leave the display sea behind.
    frame = (Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Rotation(-math.pi/2, 4, "X")
             @ bpy.data.objects["Ship"].matrix_world.inverted())
    hull = next(o for o in objects if o.material_slots[0].material.name == "Ship_Hull")
    keel = next(o for o in objects if o.material_slots[0].material.name == "RudderKeel")
    ends = [(frame @ hull.matrix_world @ p.co).x for p in hull.data.vertices]
    bottom = min((frame @ keel.matrix_world @ p.co).z for p in keel.data.vertices)
    scale = 40 / (max(ends) - min(ends))
    offset = (-(max(ends)+min(ends)) * scale/2, 0, -3.5-bottom*scale)
    fit = Matrix.Translation(Vector(offset)) @ Matrix.Scale(scale, 4) @ frame
    tiles = {name: (atlas, (i % cols / cols, 1 - (i // cols) / rows))
             for atlas, (cols, rows, names) in ATLASES.items() for i, name in enumerate(names)}
    parts = []
    for obj in objects:
        source = obj.material_slots[0].material.name.split(".")[0]
        if source == "Water":
            continue
        atlas, origin = tiles[source]
        part = freeze(obj, obj.name, fit)
        mesh = part.data
        # FBX flips V on import into Unreal. UV0 keeps the artist's wrapping;
        # UV1 carries the upper-left atlas corner once per vertex.
        atlas_uv = mesh.uv_layers.new(name="AtlasOrigin")
        uv = np.empty((len(mesh.loops), 2), dtype=np.float32)
        uv[:] = origin
        atlas_uv.data.foreach_set("uv", uv.ravel())
        mesh.materials.clear()
        mesh.materials.append(material_slot(f"Pirate{atlas}"))
        parts.append(part)
    export("SirensLight", parts)
    bake_textures(OUT)
