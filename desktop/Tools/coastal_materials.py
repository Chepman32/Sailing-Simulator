"""Author the Coral Pass material graphs in the Unreal Editor."""

import math
import os
from pathlib import Path

import unreal

from coastal_layout import LAYOUT, VOLCANO_RIM, VOLCANO_X, VOLCANO_Y
from pirate_ship import ATLASES, CELL, GUTTER


ROOT = "/Game/Coastal"
ASSETS = unreal.EditorAssetLibrary
TOOLS = unreal.AssetToolsHelpers.get_asset_tools()
EDIT = unreal.MaterialEditingLibrary
PROP = unreal.MaterialProperty
OUTPUT = unreal.CustomMaterialOutputType
MAT = unreal.MaterialShadingModel
WATER_EXTINCTION_CM = (.004520, .00132, .00071)
FOAM_ALBEDO = (.80, .86, .90)
FOAM_DIFFUSE_SHARE = .25


def expression(material, cls, x=-480, y=0, **properties):
    node = EDIT.create_material_expression(material, cls, x, y)
    for name, value in properties.items():
        node.set_editor_property(name, value)
    return node


def number(material, value, y=0):
    if isinstance(value, tuple):
        return expression(material, unreal.MaterialExpressionConstant3Vector, y=y,
                          constant=unreal.LinearColor(*value, 1))
    return expression(material, unreal.MaterialExpressionConstant, y=y, r=value)


def parameter(material, name, value):
    return expression(material, unreal.MaterialExpressionScalarParameter, parameter_name=name, default_value=value)


def yacht_wetness(asset):
    return expression(asset, unreal.MaterialExpressionScalarParameter, parameter_name="SurfaceWetness",
                      use_custom_primitive_data=True, primitive_data_index=0)


def link(source, target, pin, output=""):
    if not EDIT.connect_material_expressions(source, output, target, pin):
        raise RuntimeError(f"Could not connect {source.get_name()} {output!r} to {target.get_name()} {pin!r}")


def assign(node, prop, output=""):
    if not EDIT.connect_material_property(node, output, prop):
        raise RuntimeError(f"Could not connect {node.get_name()} to {prop}")


def shader(material, code, inputs, out, y=0):
    node = expression(material, unreal.MaterialExpressionCustom, -120, y, code=code, output_type=out)
    pins = []
    for name in inputs:
        pin = unreal.CustomInput()
        pin.set_editor_property("input_name", name)
        pins.append(pin)
    node.set_editor_property("inputs", pins)
    for pin, source in inputs.items():
        if isinstance(source, tuple):
            link(source[0], node, pin, source[1])
        else:
            link(source, node, pin)
    return node


def material(name, shading=MAT.MSM_DEFAULT_LIT, blend=unreal.BlendMode.BLEND_OPAQUE, two_sided=False):
    path = f"{ROOT}/Materials/{name}"
    if ASSETS.does_asset_exist(path):
        asset = ASSETS.load_asset(path)
        # The editor can compile immediately while detaching the graph. Retire the
        # single-layer model before removing its required optical output.
        if asset.get_editor_property("shading_model") == MAT.MSM_SINGLE_LAYER_WATER:
            asset.set_editor_property("shading_model", MAT.MSM_DEFAULT_LIT)
        unreal.CoralMaterialAuthoring.reset_graph(asset)
    else:
        asset = TOOLS.create_asset(name, f"{ROOT}/Materials", unreal.Material, unreal.MaterialFactoryNew())
    asset.set_editor_property("shading_model", shading)
    asset.set_editor_property("blend_mode", blend)
    asset.set_editor_property("two_sided", two_sided)
    return asset


def save(asset):
    EDIT.recompile_material(asset)
    if not ASSETS.save_loaded_asset(asset, only_if_is_dirty=False):
        raise RuntimeError(f"Could not save {asset.get_path_name()}")
    return asset


def import_texture(directory, name, semantic):
    png = directory / f"{name}.png"
    tga = directory / f"{name}.tga"
    path = png if png.is_file() else tga if tga.is_file() else directory / f"{name}.jpg"
    target = f"{ROOT}/Textures/{name}"
    texture = ASSETS.load_asset(target) if ASSETS.does_asset_exist(target) else None
    refresh = name in os.environ.get("SAILING_REIMPORT_TEXTURES","").split(",")
    if not texture or refresh:
        task = unreal.AssetImportTask()
        task.filename = str(path)
        task.destination_path = f"{ROOT}/Textures"
        task.automated = True
        task.save = True
        task.replace_existing = refresh
        TOOLS.import_asset_tasks([task])
        texture = ASSETS.load_asset(target)
    if not texture:
        raise RuntimeError(f"Could not import {path}")
    if semantic == "normal" and texture.get_editor_property("compression_settings") != unreal.TextureCompressionSettings.TC_NORMALMAP:
        texture.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
    if semantic in ("normal", "linear") and texture.get_editor_property("srgb"):
        texture.set_editor_property("srgb", False)
    ASSETS.save_loaded_asset(texture)
    unreal.log(f"Coral Pass texture {name}: {texture.blueprint_get_size_x()} × {texture.blueprint_get_size_y()}")
    return texture


def import_textures(source):
    assets = {}
    for name in ("aerial_beach_01", "boulder_01", "coast_rocks_03", "palm_tree_bark", "rock_face", "wooden_planks"):
        data = {"color": ("diff", "color"), "normal": ("nor_dx", "normal")}
        data["roughness"] = ("arm" if name in ("coast_rocks_03", "boulder_01") else "rough", "linear")
        assets[name] = {kind: import_texture(source / name, f"{name}_{suffix}_4k", semantic)
                        for kind, (suffix, semantic) in data.items()}
    return assets


def baked_maps(source, name):
    folder = source / "model_maps"
    normal = import_texture(folder, f"{name}_normal", "normal")
    if not normal.get_editor_property("flip_green_channel"):
        normal.set_editor_property("flip_green_channel", True)
        ASSETS.save_loaded_asset(normal, only_if_is_dirty=False)
    return {"color": import_texture(folder, f"{name}_diff", "color"), "normal": normal,
            "roughness": import_texture(folder, f"{name}_arm", "linear")}


def texture_nodes(asset, textures):
    sampler = unreal.MaterialSamplerType
    types = {"color": sampler.SAMPLERTYPE_COLOR, "normal": sampler.SAMPLERTYPE_NORMAL,
             "roughness": sampler.SAMPLERTYPE_LINEAR_COLOR}
    return {kind: expression(asset, unreal.MaterialExpressionTextureSample, y=i * 175, texture=texture,
                             sampler_type=types[kind])
            for i, (kind, texture) in enumerate(textures.items())}


def submerged_specular(asset, world):
    # At a mineral/water interface the index contrast is small (1.5 vs 1.333).
    # The reflected sunlight has also crossed the water column on its way in.
    reflectance = shader(asset, """
        float depth=max(0,-P.z);
        return lerp(.50,.024*exp(-depth*.0013),smoothstep(0.,52.,depth));
        """, {"P":world}, OUTPUT.CMOT_FLOAT1)
    assign(reflectance,PROP.MP_SPECULAR)


def pbr(name, textures, arm=False, wet=False, two_sided=False, rain_on_timber=False):
    asset = material(name, two_sided=two_sided)
    nodes = texture_nodes(asset, textures)
    color = nodes["color"]
    rough, channel = nodes["roughness"], "G" if arm else "R"
    if wet:
        world = expression(asset, unreal.MaterialExpressionWorldPosition)
        submerged_specular(asset,world)
        color = shader(asset, "return Albedo * lerp(.54,1,smoothstep(-22,155,Position.z));",
                       {"Position": world, "Albedo": color}, OUTPUT.CMOT_FLOAT3)
        rough = shader(asset, "return Value * lerp(.52,1,smoothstep(-16,142,Position.z));",
                       {"Position": world, "Value": (rough, channel)}, OUTPUT.CMOT_FLOAT1, 180)
        channel = ""
    if rain_on_timber:
        film = yacht_wetness(asset)
        color = shader(asset,"return Grain*lerp(1.,.60,Film);",{"Grain":color,"Film":film},OUTPUT.CMOT_FLOAT3)
        rough = shader(asset,"return lerp(Dry,.17+.12*Dry,Film);",
                       {"Dry":(rough,channel),"Film":film},OUTPUT.CMOT_FLOAT1)
        channel = ""
    assign(color, PROP.MP_BASE_COLOR)
    assign(nodes["normal"], PROP.MP_NORMAL)
    assign(rough, PROP.MP_ROUGHNESS, channel)
    if arm:
        assign(nodes["roughness"], PROP.MP_AMBIENT_OCCLUSION, "R")
        assign(nodes["roughness"], PROP.MP_METALLIC, "B")
    return save(asset)


def pirate_finish(source, atlas):
    cols, rows, _ = ATLASES[atlas]
    masked = atlas == "Trim"
    blend = unreal.BlendMode.BLEND_MASKED if masked else unreal.BlendMode.BLEND_OPAQUE
    asset = material(f"M_Sirens{atlas}", blend=blend, two_sided=True)
    uv = expression(asset, unreal.MaterialExpressionTextureCoordinate, coordinate_index=0)
    origin = expression(asset, unreal.MaterialExpressionTextureCoordinate, coordinate_index=1)
    footprint = f"float2({(1-2*GUTTER/CELL)/cols:.9f}, {(1-2*GUTTER/CELL)/rows:.9f})"
    inset = f"float2({GUTTER/CELL/cols:.9f}, {GUTTER/CELL/rows:.9f})"
    coords = shader(asset, f"return Origin + {inset} + frac(UV)*{footprint};", {"Origin":origin, "UV":uv}, OUTPUT.CMOT_FLOAT2)
    # Differentiate before the wrap so tiled tarred rope and spars keep the correct mip across seams.
    dx = shader(asset, f"return ddx(UV)*{footprint};", {"UV":uv}, OUTPUT.CMOT_FLOAT2)
    dy = shader(asset, f"return ddy(UV)*{footprint};", {"UV":uv}, OUTPUT.CMOT_FLOAT2)
    sampler = unreal.MaterialSamplerType
    samples = {}
    for key, semantic, kind in (("Color", "color", sampler.SAMPLERTYPE_COLOR),
                                ("Normal", "normal", sampler.SAMPLERTYPE_NORMAL),
                                ("Finish", "linear", sampler.SAMPLERTYPE_LINEAR_COLOR),
                                ("Glow", "color", sampler.SAMPLERTYPE_COLOR)):
        tex = import_texture(source / "model_maps", f"T_Sirens{atlas}_{key}", semantic)
        if semantic == "normal" and not tex.get_editor_property("flip_green_channel"):
            tex.set_editor_property("flip_green_channel", True)
            ASSETS.save_loaded_asset(tex, only_if_is_dirty=False)
        node = expression(asset, unreal.MaterialExpressionTextureSample, texture=tex, sampler_type=kind,
                          mip_value_mode=unreal.TextureMipValueMode.TMVM_DERIVATIVE)
        link(coords, node, "UVs")
        link(dx, node, "DDX(UVs)")
        link(dy, node, "DDY(UVs)")
        samples[key] = node
    assign(samples["Color"], PROP.MP_BASE_COLOR)
    assign(samples["Normal"], PROP.MP_NORMAL)
    assign(samples["Finish"], PROP.MP_ROUGHNESS, "R")
    assign(samples["Finish"], PROP.MP_METALLIC, "G")
    assign(samples["Glow"], PROP.MP_EMISSIVE_COLOR)
    if masked:
        assign(samples["Color"], PROP.MP_OPACITY_MASK, "A")
    return save(asset)


CAUSTICS = """
    float3 m = Position * .01;
    float depth = max(0.0, -m.z);
    float2 p = m.xy + float2(.73,.22)*depth;
    p += .32*float2(sin(p.y*1.66 - T*.83), cos(p.x*1.73 - T*.92));
    float a = sin(p.x*6.7 + sin(p.y*4.9 + T*.96)*.91 - T*1.9);
    float b = cos(p.y*6.3 + sin(p.x*4.3 - T*.75)*.87 + T*1.47);
    float c = abs(a + b + .33*sin(dot(p,float2(4.5,-5.4)) - T*1.2));
    float focus = (1 - smoothstep(.014,.21,c)) * (.38 + .62*abs(a*b));
    return focus * smoothstep(.02,.45,depth) * exp(-depth*.25) * (1-smoothstep(2,8,depth));
"""


def caustics(asset, world):
    time = expression(asset, unreal.MaterialExpressionTime)
    return shader(asset, CAUSTICS, {"Position": world, "T": time}, OUTPUT.CMOT_FLOAT1, 650)


def ground(textures):
    asset = material("M_CoastalGround")
    sand = texture_nodes(asset, textures["aerial_beach_01"])
    stone = texture_nodes(asset, textures["coast_rocks_03"])
    paint = expression(asset, unreal.MaterialExpressionVertexColor)
    world = expression(asset, unreal.MaterialExpressionWorldPosition)
    submerged_specular(asset,world)
    light = caustics(asset, world)
    swash = shader(asset, WATER_MODEL + """
        float3 p = P*.01;
        if (p.z < -.65) return float4(1,0,0,0);
        if (p.z > 1.45) return 0;
        SailingWaterMath water;
        float4 coast = water.Coast(p.x,p.y);
        if (abs(coast.x)>13) return float4(1-smoothstep(-.2,.6,p.z),0,0,0);
        float t = T+water.Peel(p.x,p.y,coast.w).x;
        float d = coast.x+.44*sin(.78*p.x+.51*p.y)+.21*sin(1.37*p.y-.62*p.x);
        float front = water.SwashFront(t,Scale,coast.w);
        float last = min(front,min(water.SwashFront(t-1.15,Scale,coast.w),water.SwashFront(t-2.4,Scale,coast.w)));
        float shore = 1-smoothstep(.24,.84*sqrt(Scale)+.18,p.z);
        float film = smoothstep(-.18,.52,d-front)*shore;
        float lace = (1-smoothstep(.13,.95,abs(d-front-.22)))*shore;
        float drain = smoothstep(.35,2.6,front-last)*(1-smoothstep(.25,2.9,abs(d-front)));
        return float4(max(film,.78*shore*smoothstep(-.50,.68,d-last)),film,lace,drain*shore);
        """, {"P": world, "T": parameter(asset,"SeaTime",0), "Scale": parameter(asset,"SeaScale",1)}, OUTPUT.CMOT_FLOAT4)
    sand_uv = shader(asset,"return P.xy*.0034+float2(.032,-.017)*T;",
                     {"P":world,"T":parameter(asset,"SeaTime",0)},OUTPUT.CMOT_FLOAT2)
    bubbles = sample_texture(asset,unreal.load_asset(FOAM_TEXTURE),sand_uv)
    rain = parameter(asset,"RainWetness",0)
    base = shader(asset, """
        float3 p = Position * 0.01;
        float damp = max(Rain*.78,max(.23*(1-smoothstep(0,1.35,p.z)),Wash.x));
        float3 beach = Sand * lerp(float3(.87,.85,.74),float3(.54,.58,.54),damp);
        float bubbles = smoothstep(.22,.66,Lace);
        float white = Wash.z*(.23+.77*bubbles)+Wash.w*smoothstep(.48,.80,Lace)*.53;
        beach = lerp(beach,float3(.78,.89,.85),saturate(white));
        float mottling = 0.73 + 0.27 * sin(p.x*0.81 + sin(p.y*0.67)) * sin(p.y*0.56);
        float blade = dot(Sand,float3(.22,.68,.10));
        float3 grass = lerp(float3(.020,.078,.018),float3(.065,.182,.029), saturate(blade*2)) * mottling;
        float3 ground = lerp(lerp(beach, grass, smoothstep(.06,.88,Vegetation)), Stone * float3(1.26,1.19,1.04), Rock * .88);
        return saturate(ground * (1-.19*Rain*max(Rock,Vegetation)) * (1 + Light * 1.8));
        """, {"Position": world, "Sand": sand["color"], "Stone": stone["color"],
              "Vegetation": (paint, "G"), "Rock": (paint, "R"), "Light": light, "Wash": swash,
              "Lace":(bubbles,"R"), "Rain":rain}, OUTPUT.CMOT_FLOAT3)
    rough = shader(asset, """
        float dry = lerp(saturate(Sand*.75+.19), Stone, Rock);
        return lerp(lerp(dry,.34+.13*Sand,max(Wash.x,.78*Rain)),.13+.10*Sand,Wash.y);
        """, {"Wash": swash, "Rain":rain, "Sand": (sand["roughness"], "R"), "Stone": (stone["roughness"], "G"),
              "Rock": (paint, "R")}, OUTPUT.CMOT_FLOAT1, 240)
    normals = shader(asset, "return normalize(lerp(Sand, Stone, Rock * 0.84));",
                     {"Sand": sand["normal"], "Stone": stone["normal"], "Rock": (paint, "R")}, OUTPUT.CMOT_FLOAT3, 470)
    # Diffuse daylight reaching submerged sand is spread over the sky hemisphere.
    # Attenuate incident sunlight on its refracted path to the bed. The water
    # renderer separately attenuates light returning from the bed to the camera.
    bed_light = shader(asset, """
        float depthCm = max(0, -P.z);
        float share = (.30*smoothstep(3,55,depthCm) + .52*smoothstep(25,410,depthCm))
                    * smoothstep(4,400,dot(Sun,float3(.21,.72,.07)));
        float refractedCos = sqrt(1-(1-saturate(SunDir.z)*saturate(SunDir.z))/(1.333*1.333));
        float3 transmission = exp(-Extinction * depthCm / refractedCos);
        return float4(share * Sun * saturate(SunDir.z) * transmission / 3.14159265, 1-share);
        """, {"P":world,
              "Sun":expression(asset,unreal.MaterialExpressionSkyAtmosphereLightIlluminanceOnGround),
              "SunDir":expression(asset,unreal.MaterialExpressionSkyAtmosphereLightDirection),
              "Extinction":number(asset,WATER_EXTINCTION_CM)}, OUTPUT.CMOT_FLOAT4)
    assign(shader(asset, "return Base * Bed.a;", {"Base":base,"Bed":bed_light}, OUTPUT.CMOT_FLOAT3),
           PROP.MP_BASE_COLOR)
    assign(shader(asset, "return Base * Bed.rgb;", {"Base":base,"Bed":bed_light}, OUTPUT.CMOT_FLOAT3),
           PROP.MP_EMISSIVE_COLOR)
    assign(rough, PROP.MP_ROUGHNESS)
    assign(normals, PROP.MP_NORMAL)
    return save(asset)


def foliage():
    asset = material("M_PalmFronds", MAT.MSM_TWO_SIDED_FOLIAGE, two_sided=True)
    asset.set_editor_property("max_world_position_offset_displacement", 45)
    uv = expression(asset, unreal.MaterialExpressionTextureCoordinate)
    paint = expression(asset, unreal.MaterialExpressionVertexColor)
    world = expression(asset, unreal.MaterialExpressionWorldPosition)
    time = expression(asset, unreal.MaterialExpressionTime)
    leaf = shader(asset, """
        float rib = exp(-pow((UV.y - .5)*24, 2));
        float lines = 0.83 + .17*sin((UV.x + abs(UV.y-.5)*.26)*200);
        float3 light = float3(.079,.260,.036);
        float3 dark = float3(.014,.093,.021);
        float3 green = lerp(dark, light, Age * .76 + UV.x * .16) * Tint;
        return green * lines + float3(.059,.086,.012) * rib;
        """, {"UV": uv, "Tint": (paint, "R"), "Age": (paint, "G")}, OUTPUT.CMOT_FLOAT3)
    wpo = shader(asset, """
        float gust = sin(T*.86 + Position.x*.0012 + Position.y*.0014);
        float flex = gust*21 + sin(T*3.3 + UV.x*3.0 + Position.y*.004)*9;
        return Weight * float3(flex, .74*flex, sin(T*1.65 + UV.x*4 + Position.y*.003)*18);
        """, {"T": time, "Position": world, "Weight": (paint, "A"), "UV": uv}, OUTPUT.CMOT_FLOAT3, 220)
    assign(leaf, PROP.MP_BASE_COLOR)
    assign(number(asset, (.050,.185,.021)), PROP.MP_SUBSURFACE_COLOR)
    assign(number(asset, .22), PROP.MP_SPECULAR)
    assign(number(asset, .73), PROP.MP_ROUGHNESS)
    assign(number(asset,.83), PROP.MP_OPACITY)
    assign(wpo, PROP.MP_WORLD_POSITION_OFFSET)
    return save(asset)


def coastal_canopy():
    asset = material("M_CoastalCanopy", MAT.MSM_TWO_SIDED_FOLIAGE, two_sided=True)
    world = expression(asset, unreal.MaterialExpressionWorldPosition)
    paint = expression(asset, unreal.MaterialExpressionVertexColor)
    base = shader(asset, """
        float3 p = P * .01;
        float leaves = .5 + .25*sin(p.x*6.1+p.z*5.8+sin(p.y*4)) + .25*cos(p.y*8.3-p.z*4.1);
        float3 canopy = lerp(float3(.012,.049,.020),float3(.065,.203,.037),Tint*Lightness);
        return canopy * (.65+.44*leaves+.15*Leaf);
        """, {"P": world, "Tint": (paint,"R"), "Lightness": (paint,"G"), "Leaf": (paint,"B")}, OUTPUT.CMOT_FLOAT3)
    assign(base, PROP.MP_BASE_COLOR)
    assign(number(asset,(.032,.14,.019)), PROP.MP_SUBSURFACE_COLOR)
    assign(number(asset,.17), PROP.MP_SPECULAR)
    assign(number(asset,.78), PROP.MP_ROUGHNESS)
    return save(asset)


def tropical_clouds():
    asset = material("M_CoralCloudVolume", blend=unreal.BlendMode.BLEND_ADDITIVE)
    asset.set_editor_property("material_domain", unreal.MaterialDomain.MD_VOLUME)
    position = expression(asset, unreal.MaterialExpressionWorldPosition)
    time = expression(asset, unreal.MaterialExpressionTime)
    shape = unreal.load_object(None, "/Engine/EngineSky/VolumetricClouds/VT_PerlinWorley_Balanced.VT_PerlinWorley_Balanced")
    if not isinstance(shape, unreal.VolumeTexture):
        raise RuntimeError("Could not load Unreal's Perlin–Worley volume texture")
    noise = expression(asset, unreal.MaterialExpressionTextureObject, texture=shape,
                       sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
    coverage = parameter(asset, "Cloud_GlobalCoverage", -.48)
    density = parameter(asset, "Cloud_GlobalDensity", 0)
    glow = parameter(asset, "CloudFlash", 0)
    origin = expression(asset, unreal.MaterialExpressionVectorParameter, parameter_name="StrikeOriginKm",
                        default_value=unreal.LinearColor(0, 0, 1.1, 0))
    densities = shader(asset, """
        float3 p = Position * .00001;
        float rangeKm=length(p.xy-Eye.xy*.00001);
        if (rangeKm>=28 || p.z<.88 || p.z>3.85) return 0;
        float2 drift = float2(.00052,.00995)*T;
        float2 weather = p.xy * .175 + float2(.53, .82) + drift * .175;
        float wide = sin(weather.x*2.2 + sin(weather.y*1.2))*cos(weather.y*1.38 - weather.x*.22);
        float broken = sin(weather.x*4.13 - weather.y*1.39)*sin(weather.y*3.2 + weather.x*.54);
        float local = .52 + wide*.22 + broken*.14;
        float shape = Texture3DSampleLevel(Noise,NoiseSampler,frac(float3((p.xy+drift)*.19,p.z*.29)+.31),0).r;
        float erosion = Texture3DSampleLevel(Noise,NoiseSampler,frac(p*.57+float3(.13,.63,.22)),0).g;
        float2 bankUV = (p.xy - float2(6.1,-1.8)) / float2(4.1,3.7);
        float bank = exp(-dot(bankUV,bankUV)) * lerp(.11,.32,smoothstep(-.1,.12,Coverage));
        // The ragged underside rises between rain cells. Across a long grazing
        // ray the high-resolution local volume dissolves into the distant sky.
        float tuft=Texture3DSampleLevel(Noise,NoiseSampler,frac(float3((p.xy+drift)*1.05,p.z*.81)),0).r;
        float bottom = 1.01 + .47*(1-local) + .39*erosion + .27*(1-shape)-.17*tuft;
        float h = (p.z - bottom) / 2.25;
        float pillar = smoothstep(-.025,.112,h) * (1-smoothstep(.34+local*.25,.80+local*.12,h));
        float mass = smoothstep(.39,.78,local + Coverage*.46 + (shape-.42)*1.27 - erosion*.23 + bank + (tuft-.5)*.18);
        float distant=1-smoothstep(9,28,rangeKm);
        return mass*pillar*Density*.13*distant;
        """, {"Position": position, "T": time, "Noise": noise, "Coverage": coverage,
              "Density": density,"Eye":expression(asset,unreal.MaterialExpressionCameraPositionWS)}, OUTPUT.CMOT_FLOAT1)
    assign(densities, PROP.MP_SUBSURFACE_COLOR)
    # Rain cloud bases receive little sky through the layer overhead. Gaps
    # and thinner billows still reflect a bright sky into the wave faces.
    occlusion = shader(asset,"return 1-.79*smoothstep(.00015,.0024,D)*smoothstep(.006,.028,R);",
                       {"D":densities,"R":density},OUTPUT.CMOT_FLOAT1)
    assign(occlusion, PROP.MP_AMBIENT_OCCLUSION)
    assign(number(asset, (.94,.965,.99)), PROP.MP_BASE_COLOR)
    emissive = shader(asset, """
        float3 d = Position * .00001 - StrikeOrigin;
        return float3(.30,.56,1.0) * Air * Flash * exp(-dot(d*d, float3(.58,.58,1.1))) * 520;
        """, {"Position": position, "StrikeOrigin": origin, "Air": densities, "Flash": glow}, OUTPUT.CMOT_FLOAT3)
    assign(emissive, PROP.MP_EMISSIVE_COLOR)
    expression(asset, unreal.MaterialExpressionVolumetricAdvancedMaterialOutput, x=-100, y=360,
               multi_scattering_approximation_octave_count=1, const_phase_g=.42,
               ground_contribution=True, ray_march_volume_shadow=False)
    EDIT.set_material_usage(asset, unreal.MaterialUsage.MATUSAGE_VOLUMETRIC_CLOUD)
    return save(asset)


def eruption_column():
    # Integrate only the occupied vent volume. A global cloud march can cross the entire
    # base of this plume in a single step when viewed along the horizon from the yacht.
    asset = material("M_EruptionColumn", MAT.MSM_UNLIT, unreal.BlendMode.BLEND_TRANSLUCENT)
    shape = unreal.load_asset("/Engine/EngineSky/VolumetricClouds/VT_PerlinWorley_Balanced")
    volume = expression(asset, unreal.MaterialExpressionTextureObject, texture=shape,
                        sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
    inputs = {
        "Noise": volume, "P": expression(asset, unreal.MaterialExpressionWorldPosition),
        "Eye": expression(asset, unreal.MaterialExpressionCameraPositionWS),
        "Center": expression(asset, unreal.MaterialExpressionObjectPositionWS),
        "Extent": expression(asset, unreal.MaterialExpressionObjectBounds),
        "BackgroundZ": expression(asset, unreal.MaterialExpressionSceneDepth),
        "SurfaceZ": expression(asset, unreal.MaterialExpressionPixelDepth),
        "Sun": expression(asset, unreal.MaterialExpressionSkyAtmosphereLightDirection),
        "Light": expression(asset, unreal.MaterialExpressionSkyAtmosphereLightIlluminance),
        "Summit": number(asset, (VOLCANO_X,VOLCANO_Y,VOLCANO_RIM-10)),
        "T": expression(asset, unreal.MaterialExpressionTime),
    }
    result = shader(asset, """
        struct Plume {
            float Density(float3 p, float t, Texture3D tex, SamplerState smp) {
                float z = max(0,p.z);
                float h = saturate(z/600);
                float2 axis = float2(.12,.24)*z*h + float2(6*sin(z*.022-t*.12),4*sin(z*.035-t*.15));
                float width = 22 + .23*z + 16*smoothstep(70,165,z) + (4 + .026*z)*sin(z*.046-t*.16);
                float2 across = p.xy-axis;
                if (p.z < -10 || p.z > 615 || dot(across,across) > 2.7*width*width) return 0;
                float3 q = float3(across,p.z-t*2.3);
                float3 warp = Texture3DSampleLevel(tex,smp,q*.0037+.34,0).rgb-.5;
                float3 rolls = Texture3DSampleLevel(tex,smp,q*.0096+warp*.65,0).rgb;
                float wisps = Texture3DSampleLevel(tex,smp,q*.030+warp*.36+.71,0).r;
                float tip = 1-smoothstep(490,605,z);
                // Buoyant billows roll up the outer edge of the ash column.
                float layer = (z-t*2.3)/55;
                float shell = .82-length(across)/width;
                [unroll] for(int j=-1;j<=1;j++) {
                    float id = floor(layer)+j;
                    float a = id*2.39996;
                    float2 rollCenter = width*.48*float2(cos(a),sin(a));
                    float3 local = float3((across-rollCenter)/(.69*width),(layer-id-.5)*55/(33+width*.12));
                    shell = max(shell,1-length(local));
                }
                float edge = shell + (rolls.r-.50)*1.27 + (wisps-.5)*.33;
                return .063*smoothstep(-.075,.40,edge)*(.47+.65*rolls.g)*tip*smoothstep(-10,2,p.z);
            }
        };
        Plume ash;
        float3 ray = normalize(P-Eye);
        float3 exitFace = (Center-P + sign(ray)*Extent)*.01;
        float3 exitDistance = exitFace / (ray+float3(.000001,.000001,.000001));
        float travel = min(exitDistance.x,min(exitDistance.y,exitDistance.z));
        travel = min(travel,(BackgroundZ-SurfaceZ)*length(P-Eye)/max(SurfaceZ,1)*.01);
        if (travel <= 0) return 0;
        int steps = clamp((int)ceil(travel/5),12,72);
        float stepLength = travel/steps;
        float3 relative = P*.01-Summit + ray*stepLength*.5;
        float transmittance = 1;
        float3 radiance = 0;
        float3 skyFill = float3(.25,.35,.49) + Light*float3(.0025,.0036,.0050);
        [loop] for(int i=0;i<steps && transmittance>.012;i++) {
            float d = ash.Density(relative,T,Noise,NoiseSampler);
            if(d>.0001) {
                float d1 = ash.Density(relative+Sun*16,T,Noise,NoiseSampler);
                float d2 = ash.Density(relative+Sun*46,T,Noise,NoiseSampler);
                float d3 = ash.Density(relative+Sun*94,T,Noise,NoiseSampler);
                float lighting = exp(-(d1*23+d2*36+d3*49));
                float3 lit = skyFill + Light*float3(.040,.036,.031)*lighting;
                float hot = exp(-max(0,relative.z)*.049-dot(relative.xy,relative.xy)*.0018);
                lit += float3(6800,1160,98)*hot;
                float scatter = 1-exp(-stepLength*d);
                radiance += transmittance*scatter*lit;
                transmittance *= 1-scatter;
            }
            relative += ray*stepLength;
        }
        return float4(radiance/max(.001,1-transmittance),1-transmittance);
        """, inputs, OUTPUT.CMOT_FLOAT4)
    assign(shader(asset, "return V.rgb;", {"V": result}, OUTPUT.CMOT_FLOAT3), PROP.MP_EMISSIVE_COLOR)
    assign(shader(asset, "return V.a;", {"V": result}, OUTPUT.CMOT_FLOAT1), PROP.MP_OPACITY)
    return save(asset)


# Cook the exact shoreline, breaker and hull-wave functions used by the native sampler.
WATER_MODEL = (LAYOUT.parent / "SailingWaterMath.inl").read_text().replace(
    '#include "CoralPassLayout.inl"', LAYOUT.read_text()).replace("Real4", "float4").replace("Real ", "float ")
WAVE_MATH = WATER_MODEL + """
struct Surface {
    float4 Wave(float2 mode, float2 k, float waveNumber, float omega, float previousAmplitude,
                float2 p, float cell, float sharpness, float2 history) {
        float wavelength = 6.2831853 / waveNumber;
        float a = lerp(mode.x, previousAmplitude, history.y) * (1 - smoothstep(wavelength*.25, wavelength*.50, cell));
        if (a==0) return 0;
        float phase = dot(k,p) + mode.y + omega*history.x;
        float s,c;
        sincos(phase,s,c);
        // The last channel is the convergence of the wave's horizontal orbital displacement.
        return float4(a*(c+sharpness*(c*c-.5)), -a*s*(1+2*sharpness*c)*k, a*waveNumber*c);
    }
};
Surface s;
SailingWaterMath water;
float2 p = Position.xy * .01;
"""
LONG_WIND_COUNT = 6
WIND_WAVE_COUNT = 14
# Only amplitude and phase change as the yacht sails. Cook the constant wave
# vectors directly from the native sampler for the surface and its depth pass.
WAVE_VECTORS = unreal.CoralMaterialAuthoring.get_sea_wave_vectors()
WAVE_COUNT = len(WAVE_VECTORS)


def wave_terms(indices):
    terms = []
    for i in indices:
        k = WAVE_VECTORS[i]
        length = math.hypot(k.x,k.y)
        omega = math.sqrt(9.81*length)
        terms.append(f"s.Wave(Wave{i}.zw,float2({k.x:.10g},{k.y:.10g}),{length:.10g},{omega:.10g},"
                     f"PrevAmp{i//4}.{'xyzw'[i%4]},p,Footprint.x,CrestShape,History)")
    return " + ".join(terms)


LONG_WAVES = f"""
float4 sea = {wave_terms(range(LONG_WIND_COUNT))};
float4 storm = {wave_terms(range(WIND_WAVE_COUNT, WAVE_COUNT))};
""" + """
float foam = 0;
if (Coast.x <= -8) sea = 0;
else {
    if (Coast.x < 38) {
        float4 peel = water.Peel(p.x,p.y,Coast.w);
        float index=water.ProfileIndex(Coast.x);
        int2 texel=int2((int)index,2*(int)Coast.w);
        float4 roller = water.Roller(Coast.x,T+peel.x,SeaScale,Coast.w,
            Profile.Load(int3(texel,0)),Profile.Load(int3(texel+int2(1,0),0)),
            Profile.Load(int3(texel+int2(0,1),0)),Profile.Load(int3(texel+int2(1,1),0)),frac(index));
        float swell = water.Swell(Coast.x);
        float lod = 1-smoothstep(2.5,6.0,Footprint.x);
        sea.yz = sea.yz*swell + Coast.yz*(roller.y*lod+sea.x*water.SwellSlope(Coast.x)) + peel.yz*roller.z*lod;
        sea.x = sea.x*swell + roller.x*lod;
        sea.w *= swell;
        foam = roller.w;
    }
    sea += storm*water.StormSwell(Coast.x);
    sea.yz += Coast.yz*(storm.x*water.StormSwellSlope(Coast.x));
}
"""

SHORT_WAVES = f"float4 chop = {wave_terms(range(LONG_WIND_COUNT, WIND_WAVE_COUNT))};\n" + """
if (Coast.x <= -8) chop = 0;
else if (Coast.x < 38) {
    float swell = water.Swell(Coast.x);
    chop.yz = chop.yz*swell + Coast.yz*(chop.x*water.SwellSlope(Coast.x));
    chop.xw *= swell;
}
"""

CONTACT_MATH = WATER_MODEL + """
SailingWaterMath water;
float2 p = Position.xy*.01;
float3 sea = 0;
float foam = 0;
float2 dir = WakePose.zw, right = float2(-dir.y,dir.x);
float2 relative = p-WakePose.xy;
float a = -dot(relative,dir), b = dot(relative,right);
if (WakeSpeed>.35 && a>-10 && a<53 && abs(b)<23) {
    float h = water.HullWave(a,b,WakeSpeed,WakeBias);
    float lod = 1-smoothstep(.7,2.5,Footprint.x);
    const float e = .04;
    float da = (water.HullWave(a+e,b,WakeSpeed,WakeBias)-water.HullWave(a-e,b,WakeSpeed,WakeBias))/(2*e);
    float db = (water.HullWave(a,b+e,WakeSpeed,WakeBias)-water.HullWave(a,b-e,WakeSpeed,WakeBias))/(2*e);
    sea.x += h*lod;
    sea.yz += (-dir*da+right*db)*lod;
    foam = max(foam, smoothstep(.12,.30,h)*.68);
}
float4 rings = water.Impact(p.x-Ring0.x,p.y-Ring0.y,T-Ring0.z,Ring0.w)
             + water.Impact(p.x-Ring1.x,p.y-Ring1.y,T-Ring1.z,Ring1.w)
             + water.Impact(p.x-Ring2.x,p.y-Ring2.y,T-Ring2.z,Ring2.w)
             + water.Impact(p.x-Ring3.x,p.y-Ring3.y,T-Ring3.z,Ring3.w);
sea += rings.xyz*(1-smoothstep(.6,1.9,Footprint.x));
foam = max(foam,smoothstep(.08,.22,rings.x)*.48);
"""


def previous_frame(asset, now, previous):
    switch = expression(asset,unreal.MaterialExpressionPreviousFrameSwitch)
    for pin, value in (("Current Frame",now),("Previous Frame",previous)):
        node, output = value if isinstance(value,tuple) else (value,"")
        link(node,switch,pin,output)
    return switch


def interpolate_water(asset, node, output=""):
    interpolator = expression(asset,unreal.MaterialExpressionVertexInterpolator)
    link(node,interpolator,"",output)
    return interpolator


def water_fields(asset, world, grid, pixel, time, scale):
    previous = expression(asset,unreal.MaterialExpressionVectorParameter,parameter_name="SeaHistory",
                          default_value=unreal.LinearColor(0,1,0,1))
    backward = expression(asset,unreal.MaterialExpressionAppendVector)
    link(previous,backward,"A","B")
    link(previous,backward,"B","A")
    present = expression(asset,unreal.MaterialExpressionConstant2Vector,r=0,g=0)
    history = previous_frame(asset,present,backward)
    time = previous_frame(asset,time,(previous,"R"))
    scale = previous_frame(asset,scale,(previous,"G"))
    step = expression(asset,unreal.MaterialExpressionVectorParameter,parameter_name="GridStep",
                      default_value=unreal.LinearColor(0,0,0,0))
    shift = previous_frame(asset,number(asset,(0,0,0)),step)
    world = shader(asset,"return World+Step;",{"World":world,"Step":shift},OUTPUT.CMOT_FLOAT3)
    waves = {"Position": world, "CrestShape": parameter(asset,"CrestShape",.27), "T": time, "SeaScale": scale,
             "History":history}
    waves["Profile"] = expression(asset,unreal.MaterialExpressionTextureObjectParameter,
        parameter_name="SurfProfile",texture=unreal.load_asset("/Engine/EngineResources/Black"),
        sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
    contacts = {"Position": world, "T": time, "WakeSpeed": parameter(asset,"WakeSpeed",0),
                "WakeBias": parameter(asset,"WakeBias",0), "Footprint": grid}
    spectrum = [f"Wave{i}" for i in range(WAVE_COUNT)] + [f"PrevAmp{i}" for i in range((WAVE_COUNT+3)//4)]
    marks = [f"Mark{i}" for i in range(8)]
    axes = [f"Axes{i}" for i in range(4)]
    biases = [f"MarkBias{i}" for i in range(2)]
    for i, name in enumerate(spectrum + ["WakePose"] + [f"Ring{i}" for i in range(4)] + marks + axes + biases):
        vector = expression(asset, unreal.MaterialExpressionVectorParameter, y=i*125,
                            parameter_name=name, default_value=unreal.LinearColor(0,0,0,0))
        full = expression(asset, unreal.MaterialExpressionAppendVector, x=-240, y=i*125)
        link(vector,full,"A")
        link(vector,full,"B","A")
        (waves if name in spectrum else contacts)[name] = full
    coast_enabled = parameter(asset,"CoralCoast",0)
    coast_code = """
        if (Enabled<.5) return float4(1000,0,0,0);
        SailingWaterMath w;
        return w.Coast(P.x*.01,P.y*.01);
        """
    coast = shader(asset,WATER_MODEL+coast_code,{"P":world,"Enabled":coast_enabled},OUTPUT.CMOT_FLOAT4)
    vertex_inputs = {**waves,"Footprint":grid,"Coast":coast}

    # Packet position, direction and speed are fixed when the sterns pass. The
    # expression runs on vertices, including when the fragment shader reads it.
    packets = []
    for i in range(len(marks)):
        direction = f"Axes{i//2}." + ("xy" if i%2 == 0 else "zw")
        packets.append(f"""
        {{
            float4 mark = Mark{i};
            float2 direction = {direction}, beam = float2(-direction.y,direction.x);
            float2 d = p-mark.xy;
            float4 h = water.ShedWake(dot(d,direction),dot(d,beam),T-mark.z,mark.w,MarkBias{i//4}.{"xyzw"[i%4]});
            trail += float3(h.x,direction*h.y+beam*h.z);
        }}""")
    local = shader(asset, CONTACT_MATH + "float3 trail = 0;\n" + "".join(packets) + """
        sea += trail*(1-smoothstep(.85,3.2,Footprint.x));
        return float4(sea,max(foam,.36*smoothstep(.12,.30,trail.x)));
        """, contacts, OUTPUT.CMOT_FLOAT4)
    # The displacement and the interpolator share the long-wave and shore-breaker result.
    long_vertex = shader(asset,WAVE_MATH+LONG_WAVES+"Height=sea.x; return float4(sea.w,sea.yz,foam);",
                         vertex_inputs,OUTPUT.CMOT_FLOAT4)
    height_pin = unreal.CustomOutput()
    height_pin.set_editor_property("output_name","Height")
    height_pin.set_editor_property("output_type",OUTPUT.CMOT_FLOAT1)
    long_vertex.set_editor_property("additional_outputs",[height_pin])
    short_height = shader(asset,WAVE_MATH+SHORT_WAVES+"return chop.x;",vertex_inputs,OUTPUT.CMOT_FLOAT1)
    offset = shader(asset, "return float3(Step.xy,100*(LongHeight+ShortHeight+Local.x));",
                    {"LongHeight":(long_vertex,"Height"),"ShortHeight":short_height,"Local":local,"Step":shift},OUTPUT.CMOT_FLOAT3)
    # Sub-metre vertices already resolve the surveyed shore profile. Farther
    # out, recompute it on coarse triangles that may cross an island's coast.
    pixel_coast = shader(asset,WATER_MODEL+"""
        [branch] if (Grid.x<1.4 || (Grid.x<8 && Shore.x>500)) return Shore;
        """+coast_code,{"P":world,"Enabled":coast_enabled,"Grid":grid,"Shore":interpolate_water(asset,coast)},
        OUTPUT.CMOT_FLOAT4)
    # The shortest of the long modes is 10.6 m. Resolve its curvature per pixel
    # as the mesh coarsens; the eight short waves always use the pixel footprint.
    surface = shader(asset,WAVE_MATH+SHORT_WAVES+"""
        float restore = smoothstep(.72,1.35,max(Grid.x,Footprint.x));
        float4 band = Resolved;
        [branch] if (restore>0) {
        """+LONG_WAVES+"""
            band = lerp(band,float4(sea.w,sea.yz,foam),restore);
        }
        return float4(band.x+chop.w,band.yz+chop.yz+Local.yz,max(band.w,Local.w));
        """,{**waves,"Coast":pixel_coast,"Footprint":pixel,"Grid":grid,"Resolved":interpolate_water(asset,long_vertex,"return"),
             "Local":interpolate_water(asset,local)},OUTPUT.CMOT_FLOAT4)
    return surface, pixel_coast, offset


def sample_texture(asset, texture, coordinates, *, normal=False, linear=False):
    if not texture:
        raise RuntimeError("Missing a Coral Pass water texture")
    sampler = unreal.MaterialSamplerType
    node = expression(asset, unreal.MaterialExpressionTextureSample, texture=texture,
                      sampler_type=sampler.SAMPLERTYPE_NORMAL if normal else
                      sampler.SAMPLERTYPE_LINEAR_COLOR if linear else sampler.SAMPLERTYPE_COLOR)
    link(coordinates, node, "")
    return node


FOAM_TEXTURE = "/Water/Textures/Foam/T_WaterFlow_03_Foam_Tiled"


def wave_volume(source, name):
    path = f"{ROOT}/Textures/VT_{name}"
    if ASSETS.does_asset_exist(path):
        volume = ASSETS.load_asset(path)
        if f"VT_{name}" not in os.environ.get("SAILING_REIMPORT_TEXTURES","").split(","):
            return volume
    else:
        volume = TOOLS.create_asset(f"VT_{name}",f"{ROOT}/Textures",unreal.VolumeTexture,unreal.VolumeTextureFactory())
    if not unreal.CoralMaterialAuthoring.import_wave_volume(volume,str(source/f"{name}.bgra"),128,128):
        raise RuntimeError(f"Could not import the Fourier wave sequence for {name}")
    ASSETS.save_loaded_asset(volume,only_if_is_dirty=False)
    return volume


def water(source):
    asset = material("M_CoralWater")
    asset.set_editor_property("tangent_space_normal", False)
    asset.set_editor_property("has_pixel_animation", True)
    world = expression(asset, unreal.MaterialExpressionWorldPosition,
                       world_position_shader_offset=unreal.WorldPositionIncludedOffsets.WPT_EXCLUDE_ALL_SHADER_OFFSETS)
    grid = expression(asset, unreal.MaterialExpressionTextureCoordinate)
    time = parameter(asset, "SeaTime", 0)
    scale = parameter(asset, "SeaScale", 1)
    rainfall = parameter(asset, "RainIntensity", 0)
    # Cull sub-grid displacement in the vertex stage. Sub-grid slopes still reflect light
    # until the wavelength falls below a pixel, including beyond the last displaced ring.
    pixel = shader(asset, "return max(length(ddx(P.xy)),length(ddy(P.xy)))*.005;",
                   {"P": world}, OUTPUT.CMOT_FLOAT1)
    sea, coast, offset = water_fields(asset,world,grid,pixel,time,scale)
    drift = shader(asset, """
        float2 p = Position.xy*.01;
        return p+.82*Sea.yz+.36*float2(sin(.065*p.y+.047*p.x-.17*T),cos(.078*p.x-.031*p.y-.13*T));
        """, {"Position":world, "Sea":sea, "T":time}, OUTPUT.CMOT_FLOAT2)
    volumes = {name:expression(asset,unreal.MaterialExpressionTextureObject,texture=wave_volume(source,name),
                               sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
               for name in ("WindChop","Capillary")}
    detail = shader(asset, """
        struct WindField {
            // A grazing pixel spans a long strip across the waves. Isotropic 3D
            // mips also average several phases in time, erasing the cross-strip
            // detail. Integrate the long axis explicitly at the current phase.
            float4 Sample(Texture3D field, SamplerState state, float2 uv, float phase) {
                float2 dx=ddx(uv), dy=ddy(uv);
                float2 major=dot(dx,dx)>dot(dy,dy) ? dx : dy;
                float span=max(1e-6,length(major));
                float minor=abs(dx.x*dy.y-dx.y*dy.x)/span;
                float3 q=float3(uv,phase);
                // A pixel smaller than one texel is already filtered by the
                // texture unit. Save the extra taps for grazing footprints.
                [branch] if (span*128<=1 || span<1.5*minor)
                    return Texture3DSampleLevel(field,state,q,max(0,log2(span*128)));
                float lod=max(0,log2(128*max(minor,span*.25)));
                float3 d=float3(major*.125,0);
                return .25*(Texture3DSampleLevel(field,state,q-3*d,lod)+Texture3DSampleLevel(field,state,q-d,lod)
                           +Texture3DSampleLevel(field,state,q+d,lod)+Texture3DSampleLevel(field,state,q+3*d,lod));
            }
        };
        WindField field;
        float2 wind=float2(-.052336,-.998630), across=float2(-wind.y,wind.x);
        float2 q=float2(dot(P,wind),dot(P,across));
        float4 chop=field.Sample(WindChop,WindChopSampler,q/16,T/8+.5/128);
        float4 fine=field.Sample(Capillary,CapillarySampler,q/2.8,T/4.55+.5/128);
        float2 oblique=float2(.573576,.819152), beam=float2(-oblique.y,oblique.x);
        float2 qr=float2(dot(q,oblique),dot(q,beam));
        float4 crossing=Texture3DSample(WindChop,WindChopSampler,float3(qr/10.4+.27,T/6.45+.41));
        float2 lateral=(crossing.rg*2-1)*.76;
        float2 crossDir=float2(.8660254,.5), crossBeam=float2(-crossDir.y,crossDir.x);
        float2 crossed=float2(dot(q,crossDir),dot(q,crossBeam));
        float4 small=Texture3DSample(Capillary,CapillarySampler,float3(crossed/1.4+.37,T/3.22+.29));
        float2 a=(chop.rg*2-1)*.76, b=(fine.rg*2-1)*.43;
        float2 c=(small.rg*2-1)*.43;
        float gale=smoothstep(2.4,4.5,Scale);
        float patch=.5+.5*sin(.105*q.y+sin(.073*q.x-.23*T))*cos(.057*q.x-.12*T);
        float gust=lerp(.54,1.25,smoothstep(.10,.87,patch));
        float energy=gust*pow(min(Scale,1.94),.34)*(1+.18*gale);
        float variance=1.28*max(0,chop.b*.76*.76-dot(a,a))+.72*max(0,fine.b*.43*.43-dot(b,b))
                      +.27*max(0,small.b*.43*.43-dot(c,c));
        // The crest's upwind face steepens as the short gravity wave passes;
        // its opposing direction and the secondary train interrupt long glints.
        float2 slope=(1.13*a*(1+.52*(fine.a-.5))+.85*b+.52*(crossDir*c.x+crossBeam*c.y)
                      +.62*(oblique*lateral.x+beam*lateral.y))*energy;
        variance+=.3844*max(0,crossing.b*.76*.76-dot(lateral,lateral));
        return float4(wind*slope.x+across*slope.y,variance*energy*energy,.83*chop.a+.17*crossing.a);
        """, {**volumes,"P":drift,"T":time,"Scale":scale},OUTPUT.CMOT_FLOAT4)
    lace_uv = shader(asset, """
        float gale = smoothstep(2.4,4.5,Scale);
        float2 flow = lerp(float2(.48,.22),float2(-.10,-1.75),gale)*T;
        if (Coast.x<38 && Coast.x>-8) {
            float2 onshore = -Coast.yz/max(.1,length(Coast.yz));
            float t = T+.020*P.x-.013*P.y+.86*sin(.042*P.x+.025*P.y+Coast.w)+.42*sin(.019*P.x-.062*P.y-1.7*Coast.w);
            float phase = Coast.x*.34+t*1.16+Coast.w;
            flow = float2(.10,-.055)*T + onshore*(1.4*sin(phase)-.48*cos(phase*.51))
                 + float2(-onshore.y,onshore.x)*.35*cos(phase*.73);
        }
        return (P-flow)*.114;
        """, {"P":drift,"T":time,"Coast":coast,"Scale":scale}, OUTPUT.CMOT_FLOAT2)
    foam_texture = import_texture(source,"T_BreakerFoam","linear")
    lace = sample_texture(asset,foam_texture,lace_uv,linear=True)
    windrows = shader(asset, """
        float2 wind=float2(-.052336,-.998630), across=float2(-wind.y,wind.x);
        float along=dot(P,wind)-1.35*T, side=dot(P,across);
        // Stretch old foam along the wind. Vary its direction and spacing over each wave group.
        float bend=1.7*sin(.053*along+.067*side)+.65*sin(.12*along-.095*side+.23*sin(.09*side));
        return float2(along*.075+(side+bend)*.018,(side+bend)*.15);
        """, {"P":drift,"T":time},OUTPUT.CMOT_FLOAT2)
    streaks = sample_texture(asset,unreal.load_asset(FOAM_TEXTURE),windrows)
    froth_uv = shader(asset, """
        float2 p = P - float2(-.12,-1.52)*T;
        return .29*float2(dot(p,float2(.8,.6)),dot(p,float2(-.6,.8)));
        """, {"P":drift,"T":time}, OUTPUT.CMOT_FLOAT2)
    froth_detail = sample_texture(asset,foam_texture,froth_uv,linear=True)
    # At a low camera angle a horizontal projection smears foam across the
    # front of a breaker. Sample its actual displaced height on that face.
    surface_position = expression(asset,unreal.MaterialExpressionWorldPosition)
    face_uv = shader(asset, """
        float alongRidge=dot(Position.xy*.01,float2(.99863,-.052336));
        return float2(alongRidge*.37+.035*T,Position.z*.0041-.18*T);
        """,{"Position":surface_position,"T":time},OUTPUT.CMOT_FLOAT2)
    face_froth = sample_texture(asset,foam_texture,face_uv,linear=True)
    foam_flow = expression(asset,unreal.MaterialExpressionTextureObject,texture=unreal.load_asset(FOAM_TEXTURE))
    pores = shader(asset, """
        // At the scale of a hand-sized foam patch, light and dark pockets
        // coexist even on a fully white crest. Remove the map's broad bias
        // before reconstructing coverage so it also works in a dark trough.
        [branch] if (Scale<=2.4) return .65;
        float3 p=Position*.01;
        float2 uv=float2(dot(p.xy,float2(.82,.57)),dot(p.xy,float2(-.57,.82))+.34*p.z)*.35;
        uv+=float2(.027,-.061)*T;
        float2 dx=ddx(uv),dy=ddy(uv);
        float footprint=max(length(dx),length(dy));
        [branch] if (footprint>=.039) return .65;
        float foam=Texture2DSampleGrad(Map,MapSampler,uv,dx,dy).r;
        float neighbourhood=Texture2DSampleGrad(Map,MapSampler,uv,dx*6,dy*6).r;
        float resolved=1-smoothstep(.010,.039,footprint);
        return lerp(.65,smoothstep(.21,.66,foam+2.2*(foam-neighbourhood)),resolved);
        """,{"Position":surface_position,"Map":foam_flow,"T":time,"Scale":scale},OUTPUT.CMOT_FLOAT1)
    field_view = expression(asset,unreal.MaterialExpressionVectorParameter,parameter_name="WakeFieldView",
                            default_value=unreal.LinearColor(0,0,0,0))
    field_inputs = {"P":world,"Flow":drift,"View":field_view,"Blend":(field_view,"A")}
    for channel in ("A","B"):
        field_inputs[channel] = expression(asset,unreal.MaterialExpressionTextureObjectParameter,
            parameter_name=f"WakeField{channel}",texture=unreal.load_asset("/Engine/EngineResources/Black"),
            sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
    history = shader(asset, """
        float2 p = P.xy*.01, box = abs((p-View.xy)*View.z);
        if (View.z<=0 || max(box.x,box.y)>=.5) return 0;
        // Surface orbits bend the bubble lanes. The stored chart remains fixed
        // in the emission frame, including after a turn or throttle change.
        float2 uv = lerp(p,Flow,.68)*View.z;
        float3 field = lerp(Texture2DSampleLevel(A,ASampler,uv,0).rgb,
                            Texture2DSampleLevel(B,BSampler,uv,0).rgb,Blend);
        // Older bubbles disperse in patches along their original course.
        float eddy = .5+.5*sin(dot(p,float2(.53,-.24))+.8*sin(dot(p,float2(.13,.40))));
        float dilute = 1-smoothstep(.16,.78,max(field.r,max(field.g,field.b)));
        field *= 1-.28*dilute*eddy;
        return field*(1-smoothstep(.45,.5,max(box.x,box.y)));
        """,field_inputs,OUTPUT.CMOT_FLOAT3)
    foam = shader(asset, """
        float gale = smoothstep(2.4,4.5,SeaScale);
        float face = -dot(Sea.yz,float2(-.052336,-.998630));
        float3 bubbles=lerp(Fine,FaceFroth,.83*smoothstep(.17,.65,abs(face)));
        float compression = Sea.x;
        float surviving = smoothstep(.34,.74,Detail.w);
        float froth = smoothstep(.25,.72,Streak.r+.14*(bubbles.r-.5));
        float front = compression+.57*face+.46*(Lace.g-.5)+.24*(bubbles.g-.5);
        float breaker = smoothstep(lerp(.43,.18,gale),lerp(.73,.58,gale),front);
        // A spilling lip fills into an opaque sheet. Its thinner edge reveals
        // individual holes, with a raft of connected filaments behind the lip.
        float raft = smoothstep(.14,.84,.76*Lace.r+.48*bubbles.r);
        float cover = smoothstep(.55,.90,breaker+.46*(Lace.g-.5)+.22*(bubbles.g-.5));
        // The newly broken lip contains milky sheets with sharply bounded
        // holes. As the water drains, only the rims of the holes stay white.
        float airPocket=smoothstep(.39,.64,.55*Lace.g+.45*bubbles.b);
        float dense = saturate(.05+.54*raft+.42*airPocket*(.3+.7*bubbles.b));
        float cap = breaker*lerp(.45*raft,lerp(raft,dense,cover)*(.09+1.16*froth),gale);
        // Long breakers throw the lip. Bubbles in the short wind waves travel
        // on under it, leaving rafts in the trough after compression subsides.
        float back = smoothstep(-.23,.38,compression-.65*face+.25*(Lace.g-.5));
        float afterwash = gale*surviving*(.30+.70*back)*froth*(.28+.72*max(bubbles.b,raft));
        float localFoam = saturate(Sea.w)*lerp(.83*raft,dense,smoothstep(.42,.95,Sea.w));
        // Most bubbles rise through the wake in patches. The broad turquoise
        // plume belongs to the water column; only fresh clusters whiten its surface.
        float raftEdge = smoothstep(.47,.73,Lace.g+.19*(Fine.g-.5));
        float stern = .32*smoothstep(.30,1.,Trail.r)*raft;
        float bow = .47*smoothstep(.37,.96,Trail.g)*max(raft,.42*Fine.b);
        float propeller = .72*smoothstep(.31,1.,Trail.b)*dense;
        float wake = (.14+.86*raftEdge)*max(stern,max(bow,propeller));
        float coverage=max(max(localFoam,wake),1-(1-cap)*(1-afterwash));
        float films=lerp(1.,.06+1.43*Pores,gale);
        // Old rafts increasingly consist of disconnected films in the trough.
        float residue=.23*gale*surviving*Pores*Pores*(.23+.77*raft);
        return saturate(coverage*films+(1-coverage)*residue);
        """, {"Sea":sea,"Detail":detail,"Trail":history,"Lace":lace,"Streak":streaks,
              "Fine":froth_detail,"FaceFroth":face_froth,"Pores":pores,"SeaScale":scale},OUTPUT.CMOT_FLOAT1,600)
    normal = shader(asset, """
        float slick=saturate(Trail.r*.7+Trail.b*.4+Sea.w*.44);
        // Thick foam damps the capillary waves that reflect a sharp sky highlight.
        float2 slopes=Detail.xy*(1-.70*max(slick,Foam));
        if (Rain>0 && Pixel<.05) {
            // Short dispersing wave packets from independent impacts, in metres.
            // A ring fits inside its cell throughout its lifetime.
            float2 grid=P*3.2, tile=floor(grid);
            float seed=frac(dot(frac(tile*float2(.1031,.0973)),float2(19.19,41.73)));
            float clock=T*(1.35+.75*seed)+seed;
            float cycle=floor(clock);
            float2 center=.35+.30*frac(float2(seed*19.7+.618*cycle,seed*41.3+.382*cycle));
            float2 dp=frac(grid)-center;
            float r=length(dp), age=frac(clock), wave=r-.34*age;
            float envelope=exp(-wave*wave*950)*(1-age)*smoothstep(0,.12,age);
            slopes+=dp/max(.025,r)*cos(wave*82)*envelope*.23*Rain*(1-Foam)*(1-smoothstep(.004,.045,Pixel));
        }
        return normalize(float3(-Sea.yz-slopes,1));
        """,{"Sea":sea,"Detail":detail,"Trail":history,"Foam":foam,"P":drift,"Rain":rainfall,"Pixel":pixel,"T":time},OUTPUT.CMOT_FLOAT3)
    opacity = shader(asset, "return lerp(.085,.98,Foam);", {"Foam": foam}, OUTPUT.CMOT_FLOAT1)
    base = shader(asset, """
        float air = max(Air.w,max(Trail.r+Trail.g,Trail.b));
        float3 face = lerp(float3(.002,.009,.012),float3(.046,.186,.168),saturate(air)*.85);
        // Single Layer Water multiplies this diffuse colour by coverage. Apply
        // the foam fraction once so the fine strands survive at the edges.
        return lerp(face,FoamColor,saturate(Foam/Opacity));
        """, {"Foam":foam,"Opacity":opacity,"Air":sea,"Trail":history,
              "FoamColor": number(asset, tuple(x * (1-FOAM_DIFFUSE_SHARE) for x in FOAM_ALBEDO))},OUTPUT.CMOT_FLOAT3)
    rough = shader(asset, """
        // Slopes lost to minification become a wider specular lobe on the horizon.
        float distanceFilter=smoothstep(.045,1.8,Pixel);
        float base=.048+.022*distanceFilter+.044*Rain;
        // UE's GGX alpha is perceptual roughness squared. Add unresolved
        // slope variance before converting the lobe width back to roughness.
        float rough=pow(pow(base,4)+.105*max(0,Detail.z),.25);
        rough+=smoothstep(2.4,4.5,Scale)*.022;
        return lerp(rough,.72,Foam);
        """, {"Foam":foam,"Detail":detail,"Pixel":pixel,"Scale":scale,"Rain":rainfall}, OUTPUT.CMOT_FLOAT1)
    assign(offset, PROP.MP_WORLD_POSITION_OFFSET)
    assign(normal, PROP.MP_NORMAL)
    assign(base, PROP.MP_BASE_COLOR)
    assign(rough, PROP.MP_ROUGHNESS)
    assign(opacity, PROP.MP_OPACITY)
    assign(number(asset, .255), PROP.MP_SPECULAR)
    # Integrate the diffuse part of the water column separately. Projecting a
    # sharp surface shadow through all forty metres made a sail look like a fin.
    # Keep the total extinction so the visibility of hulls and reef stays depth dependent.
    scattering = (.000012, .000089, .000168)
    diffuse_fraction = .94
    direct = tuple(s * (1 - diffuse_fraction) for s in scattering)
    absorption = tuple(e - d for e, d in zip(WATER_EXTINCTION_CM, direct))
    diffuse_albedo = tuple(diffuse_fraction * s / e for s, e in zip(scattering, WATER_EXTINCTION_CM))
    # Bubbles and suspended sediment shorten the visible path below gale crests.
    # Apply the same extinction to the separate diffuse and refraction paths.
    turbidity = shader(asset, """
        float gale=smoothstep(1.5,4.2,Scale);
        return (1+.8*gale+1.2*gale*smoothstep(-.3,.7,Sea.x));
        """,{"Scale":scale,"Sea":sea},OUTPUT.CMOT_FLOAT1)
    ground_light = unreal.MaterialExpressionSkyAtmosphereLightIlluminanceOnGround
    fill = shader(asset, """
        float pathCm = max(0, Bed - Surface);
        float3 volume = DiffuseAlbedo * (1 - exp(-Extinction * Turbidity * pathCm));
        float viewCos = saturate(dot(N, ViewDir));
        float transmission = .98 * (1 - pow(1 - viewCos, 5)) * (1 - Opacity);
        float3 incident = Sun*saturate(SunDir.z) + Moon*saturate(MoonDir.z);
        float3 diffuseVolume = incident * (1.0 / (4 * 3.14159265)) * volume * transmission;
        // Entrained bubbles return green-blue light beneath the white skin of
        // the wake. This blooms through its thin edges and dies with the trail.
        float aerated = saturate(.65*Trail.r+.55*Trail.g+.85*Trail.b);
        diffuseVolume += incident * float3(.0007,.018,.021)*aerated*transmission;
        // Light traversing a thin, aerated crest escapes on its shaded face.
        float lip = smoothstep(.16,.58,Sea.x)*smoothstep(.04,.45,length(Sea.yz));
        float through = .12+.88*pow(saturate(dot(-ViewDir,SunDir)),3);
        diffuseVolume += Sun*float3(.0009,.0046,.0040)*lip*through*transmission*smoothstep(2.4,4.5,Scale);
        float3 diffuseFoam = (Sun * saturate(SunDir.z) + Moon * saturate(MoonDir.z)) / 3.14159265;
        return diffuseVolume + diffuseFoam * FoamReflectance * Foam;
        """, {"Sun": expression(asset, ground_light), "Moon": expression(asset, ground_light, light_index=1),
              "SunDir": expression(asset, unreal.MaterialExpressionSkyAtmosphereLightDirection),
              "MoonDir": expression(asset, unreal.MaterialExpressionSkyAtmosphereLightDirection, light_index=1),
              "FoamReflectance":number(asset,tuple(x * FOAM_DIFFUSE_SHARE for x in FOAM_ALBEDO)), "Foam":foam,
              "DiffuseAlbedo": number(asset, diffuse_albedo), "Extinction": number(asset, WATER_EXTINCTION_CM),"Turbidity":turbidity,
              "Bed": expression(asset, unreal.MaterialExpressionSceneDepthWithoutWater),
              "Surface": expression(asset, unreal.MaterialExpressionPixelDepth), "Opacity": opacity,
              "N": normal, "ViewDir": expression(asset, unreal.MaterialExpressionCameraVectorWS),
              "Sea":sea,"Scale":scale,"Trail":history}, OUTPUT.CMOT_FLOAT3)
    output = expression(asset, unreal.MaterialExpressionSingleLayerWaterMaterialOutput, -95, 1190)
    for pin, value in {
        "ScatteringCoefficients": direct,
        "AbsorptionCoefficients": absorption,
        "PhaseG": .21, "ColorScaleBehindWater": 0.88,
    }.items():
        coefficient=number(asset,value)
        if pin in ("AbsorptionCoefficients","ScatteringCoefficients"):
            coefficient=shader(asset,"return K*Turbidity;",{"K":coefficient,"Turbidity":turbidity},OUTPUT.CMOT_FLOAT3)
        link(coefficient, output, pin)
    # The single-layer model compiles only once all four optical inputs exist.
    asset.set_editor_property("shading_model", MAT.MSM_SINGLE_LAYER_WATER)
    assign(fill, PROP.MP_EMISSIVE_COLOR)
    return save(asset)


def transparent_effect(name, alpha_code, luminosity, blend=unreal.BlendMode.BLEND_TRANSLUCENT):
    asset = material(name, MAT.MSM_UNLIT, blend, two_sided=True)
    uv = expression(asset, unreal.MaterialExpressionTextureCoordinate)
    color = expression(asset, unreal.MaterialExpressionVertexColor)
    fade = parameter(asset, "Flash", 1) if name == "M_Lightning" else number(asset, 1.)
    eye = expression(asset, unreal.MaterialExpressionEyeAdaptation)
    inputs = {"UV": uv, "Strength": (color, "A"), "Flash": fade, "Eye": eye}
    if name == "M_SquallRain":
        inputs["Contact"] = expression(asset,unreal.MaterialExpressionDepthFade,fade_distance_default=32.)
        inputs["Sun"] = expression(asset,unreal.MaterialExpressionSkyAtmosphereLightIlluminanceOnGround)
    assign(shader(asset, alpha_code, inputs, OUTPUT.CMOT_FLOAT1), PROP.MP_OPACITY)
    assign(shader(asset, luminosity, inputs, OUTPUT.CMOT_FLOAT3, 250), PROP.MP_EMISSIVE_COLOR)
    return save(asset)


def storm_spindrift(source):
    asset = material("M_StormSpindrift", MAT.MSM_UNLIT, unreal.BlendMode.BLEND_TRANSLUCENT, two_sided=True)
    uv = expression(asset,unreal.MaterialExpressionTextureCoordinate)
    color = expression(asset,unreal.MaterialExpressionVertexColor)
    atlas_uv = shader(asset, """
        float variant=min(3,floor(Seed*4));
        float2 p=UV;
        if (frac(Seed*13.7)>.5) p.x=1-p.x;
        // Shear the fan as lighter drops are swept away from its foot.
        p.x+=.09*(Age-.35)*(1-p.y);
        return .5*(clamp(p,.002,.998)+float2(fmod(variant,2),floor(variant*.5)));
        """,{"UV":uv,"Seed":(color,"G"),"Age":(color,"B")},OUTPUT.CMOT_FLOAT2)
    plume = sample_texture(asset,import_texture(source,"T_BreakerSpray","linear"),atlas_uv,linear=True)
    depth = expression(asset,unreal.MaterialExpressionDepthFade,fade_distance_default=28.)
    eye_depth = expression(asset,unreal.MaterialExpressionPixelDepth)
    opacity = shader(asset, """
        float mist=.28*Plume.g+.12*Plume.b;
        float sheet=.53*Plume.r+.34*Plume.b;
        float detached=1-smoothstep(.53,.91,UV.y)*smoothstep(.12,.52,Age);
        float carried=(1-smoothstep(.002,.048,Sheet))*smoothstep(.07,.36,Age);
        // As the cloud expands the same mass of water covers a larger area.
        // Near the eye the line of sight crosses only a fraction of its depth.
        float airborne=.37*Veil/(1+1.85*Age)*smoothstep(45,320,EyeDepth);
        return Contact*Strength*lerp(detached*lerp(mist,sheet,Sheet),airborne,carried);
        """,{"Plume":plume,"Veil":(plume,"A"),"Strength":(color,"A"),"Sheet":(color,"R"),"Contact":depth,
              "UV":uv,"Age":(color,"B"),"EyeDepth":eye_depth},OUTPUT.CMOT_FLOAT1)
    assign(opacity,PROP.MP_OPACITY)
    light = unreal.MaterialExpressionSkyAtmosphereLightIlluminanceOnGround
    assign(shader(asset,"return (Sun+Moon)*float3(.117,.134,.153);",
                  {"Sun":expression(asset,light),"Moon":expression(asset,light,light_index=1)},OUTPUT.CMOT_FLOAT3),
           PROP.MP_EMISSIVE_COLOR)
    return save(asset)


def distant_sky(source):
    asset = material("M_TradeWindSky", MAT.MSM_UNLIT, two_sided=True)
    asset.set_editor_property("is_sky", True)
    direction = expression(asset, unreal.MaterialExpressionCameraVectorWS)
    atmosphere = expression(asset, unreal.MaterialExpressionSkyAtmosphereViewLuminance)
    time = expression(asset, unreal.MaterialExpressionTime)
    weights = expression(asset, unreal.MaterialExpressionVectorParameter, parameter_name="TimeOfDayWeights",
                         default_value=unreal.LinearColor(0, 1, 0, 0))
    inputs = {"EyeVector": direction, "Air": atmosphere, "Weights": weights, "T": time}
    gain = import_texture(source/"skies","T_DaylightGain","linear")
    inputs["DayGain"] = expression(asset,unreal.MaterialExpressionTextureObject,texture=gain,
                                   sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
    for role, name in (("Day", "kloofendal_48d_partly_cloudy_puresky"),
                       ("Evening", "qwantani_sunset_puresky"), ("Storm", "wasteland_clouds_puresky")):
        image = import_texture(source / "skies", name, "color")
        if image.get_editor_property("max_texture_size") != 8192:
            image.set_editor_property("max_texture_size",8192)
            ASSETS.save_loaded_asset(image)
        inputs[role] = expression(asset, unreal.MaterialExpressionTextureObject, texture=image)
    sky = shader(asset, """
        float3 gaze = normalize(-EyeVector);
        float u = atan2(gaze.y,gaze.x) * .15915494 + T*.000011;
        float latitude = asin(clamp(gaze.z,-1,1))*.63661977;
        float v = .5 - sign(latitude)*pow(abs(latitude),.72)*.5;
        float3 photograph = Texture2DSample(Day,DaySampler,float2(frac(u+.55),v)).rgb;
        float saturation = (max(max(photograph.r,photograph.g),photograph.b)-min(min(photograph.r,photograph.g),photograph.b));
        float3 day = photograph * lerp(float3(.75,.93,1.02),float3(.53,.81,1.1),smoothstep(.10,.48,saturation));
        float logGain=Texture2DSample(DayGain,DayGainSampler,float2(frac(u+.55),v)).r*3-1;
        day*=exp2(logGain);
        float3 evening = Texture2DSample(Evening,EveningSampler,float2(frac(u+.16),v)).rgb;
        float3 storm = Texture2DSample(Storm,StormSampler,float2(frac(u+.55),v)).rgb;
        float gray = dot(storm,float3(.2126,.7152,.0722));
        storm = lerp(storm,gray.xxx,.81) * float3(.86,.96,1.10);
        float total = dot(Weights,float3(1,1,1));
        float3 mix = Weights/max(total,.001);
        // Interpolate sky illuminance in stops; otherwise a little remaining
        // blue daylight overpowers the whole storm panorama during a downpour.
        float3 panorama = (day*mix.r + evening*mix.g + storm*mix.b)*exp2(dot(mix,log2(float3(6180,2100,340))));
        float nearHorizon = smoothstep(-.029,.038,gaze.z);
        return lerp(Air,panorama,nearHorizon*dot(Weights,float3(.96,.91,.99)));
        """, inputs, OUTPUT.CMOT_FLOAT3)
    assign(sky, PROP.MP_EMISSIVE_COLOR)
    return save(asset)


def simple(name, color, roughness, *, metal=0.0, two_sided=False, emissive=None):
    asset = material(name, two_sided=two_sided)
    assign(number(asset, color), PROP.MP_BASE_COLOR)
    assign(number(asset, roughness, 150), PROP.MP_ROUGHNESS)
    assign(number(asset, metal, 300), PROP.MP_METALLIC)
    if emissive:
        assign(number(asset, emissive, 450), PROP.MP_EMISSIVE_COLOR)
    return save(asset)


def canvas():
    asset = material("M_CoralSailcloth", MAT.MSM_TWO_SIDED_FOLIAGE, two_sided=True)
    uv = expression(asset, unreal.MaterialExpressionTextureCoordinate)
    wet = yacht_wetness(asset)
    base = shader(asset, """
        float u = UV.x, v = 1-UV.y; // FBX V runs from the head of the sail to the foot.
        float panel = 10.0*v+.27*u*(1-v)+.12*sin(u*3.14159);
        float aa = min(.13,fwidth(panel));
        float seamDistance = abs(frac(panel+.5)-.5);
        float seam = 1-smoothstep(.010,.024+aa,seamDistance);
        float doubler = 1-smoothstep(.018,.050+aa,abs(seamDistance-.06));
        float batten = (1-smoothstep(.015,.070+aa,seamDistance))*smoothstep(.55,.99,u);
        float patches = max(saturate(1-length(float2(u*.94,v*5.5))),
                        max(saturate(1-length(float2((1-u)*1.4,v*4.5))),smoothstep(.84,.995,v)));
        float edge = max(1-smoothstep(.012,.031+fwidth(u),u),smoothstep(.974,.993,u));
        float translucency = 1-.11*floor(patches*4)/4-.10*doubler-.22*seam-.13*batten;
        float fan = atan2(v*1.29,max(.001,(1-u)*(1-v)));
        float wrinkle = sin(fan*43+v*2.5)*exp(-v*3.7)*.045;
        float gores = fan*4.7;
        float radial = 1-smoothstep(.016,.046+min(.12,fwidth(gores)),abs(frac(gores+.5)-.5));
        radial *= 1-smoothstep(.35,1.18,length(float2((1-u)*(1-v),v)));
        float age = .93+.07*cos(fan*17+v*13)*sin(v*25+u*5);
        float3 canvas = float3(.57,.57,.54)*(.95+.047*sin(floor(panel)*29.72)+wrinkle)
                        *translucency*(1-.17*radial)*age*(1-.19*Wet);
        return lerp(canvas,float3(.21,.25,.24),edge*.78);
        """, {"UV": uv,"Wet":wet}, OUTPUT.CMOT_FLOAT3)
    assign(base, PROP.MP_BASE_COLOR)
    assign(shader(asset,"return Color*float3(.66,.59,.45);",{"Color":base},OUTPUT.CMOT_FLOAT3),PROP.MP_SUBSURFACE_COLOR)
    cloth_normal = shader(asset, """
        float v = 1-UV.y;
        float fan = atan2(v*1.29,max(.001,(1-UV.x)*(1-v)));
        float folds = .11*cos(fan*43+v*2.5)*exp(-v*2.7);
        float p = 10.0*v+.27*UV.x*(1-v)+.12*sin(UV.x*3.14159);
        return normalize(float3(folds,.051*sin(6.283*p)+folds*.58,1));
        """, {"UV":uv}, OUTPUT.CMOT_FLOAT3)
    assign(cloth_normal, PROP.MP_NORMAL)
    assign(shader(asset,"return lerp(.79,.48,Wet);",{"Wet":wet},OUTPUT.CMOT_FLOAT1),PROP.MP_ROUGHNESS)
    assign(number(asset,.58),PROP.MP_OPACITY)
    time = expression(asset, unreal.MaterialExpressionTime)
    flutter = shader(asset, """
        float free = sin(saturate(UV.y)*3.1415926) * smoothstep(.16,1,UV.x);
        return float3(1.2,1.1,.26) * free * sin(T*5.1-UV.y*15.8+UV.x*11);
        """, {"UV": uv, "T": time}, OUTPUT.CMOT_FLOAT3)
    # Object-pivot subtraction keeps this displacement in world space even
    # while the boom turns and the sail changes tack. Only the mainsail receives reefing.
    pos = expression(asset,unreal.MaterialExpressionWorldPosition,
                     world_position_shader_offset=unreal.WorldPositionIncludedOffsets.WPT_EXCLUDE_ALL_SHADER_OFFSETS)
    local_origin = expression(asset,unreal.MaterialExpressionTransformPosition,
                              transform_source_type=unreal.MaterialPositionTransformSource.TRANSFORMPOSSOURCE_LOCAL,
                              transform_type=unreal.MaterialPositionTransformSource.TRANSFORMPOSSOURCE_WORLD)
    link(number(asset,(0.,0.,0.)),local_origin,"")
    reef = expression(asset,unreal.MaterialExpressionScalarParameter,parameter_name="ReefSpanReduction",
                      use_custom_primitive_data=True,primitive_data_index=1)
    offset = shader(asset,"return (Pivot-P)*Reef + Flutter*(1-Reef);",
                    {"Pivot":local_origin,"P":pos,"Reef":reef,"Flutter":flutter},OUTPUT.CMOT_FLOAT3)
    asset.set_editor_property("max_world_position_offset_displacement", 0)
    assign(offset, PROP.MP_WORLD_POSITION_OFFSET)
    return save(asset)


def gelcoat():
    asset = material("M_SaltwaterGelcoat", MAT.MSM_CLEAR_COAT)
    world = expression(asset, unreal.MaterialExpressionWorldPosition)
    space = unreal.MaterialPositionTransformSource
    local = expression(asset, unreal.MaterialExpressionTransformPosition,
                       transform_source_type=space.TRANSFORMPOSSOURCE_WORLD, transform_type=space.TRANSFORMPOSSOURCE_LOCAL)
    link(world, local, "")
    base = shader(asset, """
        float3 p = Local*.01;
        float weather = smoothstep(.28,.79,.5+.17*sin(p.x*19+p.y*2)+.21*sin(p.x*7.2+p.y*33))
                        * exp(-abs(p.z-.08)*2.1);
        float band = smoothstep(.062,.080,p.z)*(1-smoothstep(.135,.15,p.z));
        float3 glass = float3(.82,.845,.813) * (1-.12*weather);
        float3 dry = lerp(glass,float3(.019,.047,.060),band);
        return lerp(float3(.020,.039,.040),dry,smoothstep(-.30,-.24,p.z));
        """, {"Local": local}, OUTPUT.CMOT_FLOAT3)
    assign(base, PROP.MP_BASE_COLOR)
    wet = yacht_wetness(asset)
    vertex_normal = expression(asset,unreal.MaterialExpressionVertexInterpolator)
    link(expression(asset,unreal.MaterialExpressionVertexNormalWS),vertex_normal,"")
    finish = shader(asset, """
        // Non-skid grain on the upward-facing deck. Integrate the fine
        // diamond pattern to its mean beyond the resolution of a pixel.
        float2 q=float2(P.x+P.y,P.x-P.y)*.82;
        float2 ridge=cos(q*6.28318)*(1-smoothstep(.12,.5,fwidth(q)));
        float deck=smoothstep(.73,.96,N.z)*smoothstep(27,45,P.z);
        float grip=deck*(.5+.25*(ridge.x+ridge.y));
        float dry=lerp(.22,.40+.16*grip,deck);
        return float3(lerp(dry,.15+.12*grip,Wet),lerp(.63,.26,deck)*(1-Wet)+Wet,
                      lerp(.115+.18*deck,.065+.05*grip,Wet));
        """, {"P":local,"N":vertex_normal,"Wet":wet},OUTPUT.CMOT_FLOAT3)
    unreal.CoralMaterialAuthoring.set_coat_finish(asset,finish)
    return save(asset)


def painted_masonry(name, tint, textures):
    asset = material(name)
    tex = texture_nodes(asset, textures)
    world = expression(asset, unreal.MaterialExpressionWorldPosition)
    color = shader(asset, """
        float3 p = Position*.01;
        float flow = sin(p.x*7.7 + p.y*5.4 + sin(p.z*.21)) * cos(p.x*3.0-p.y*6.1);
        float weather = lerp(.76,1.09,smoothstep(-.57,.71,flow));
        float salt = .78 + .22*smoothstep(.4,2.1,p.z);
        float grain = dot(Stone,float3(.26,.52,.22));
        float chips = smoothstep(.31,.56,grain+flow*.066)*.46;
        return lerp(Tint,float3(.43,.38,.31),chips)*(.57+.64*sqrt(saturate(grain)))*weather*salt;
        """, {"Position": world, "Tint": number(asset, tint), "Stone": tex["color"]}, OUTPUT.CMOT_FLOAT3)
    assign(color, PROP.MP_BASE_COLOR)
    assign(tex["normal"], PROP.MP_NORMAL)
    assign(tex["roughness"], PROP.MP_ROUGHNESS, "R")
    return save(asset)


def lantern_glass():
    asset = material("M_LanternGlass", blend=unreal.BlendMode.BLEND_TRANSLUCENT, two_sided=True)
    asset.set_editor_property("translucency_lighting_mode", unreal.TranslucencyLightingMode.TLM_SURFACE)
    assign(number(asset, (.37,.52,.52)), PROP.MP_BASE_COLOR)
    assign(number(asset, .15), PROP.MP_ROUGHNESS)
    assign(number(asset, .29), PROP.MP_OPACITY)
    return save(asset)


def station_finish(source, part):
    asset = material(f"M_Station{part.title()}", two_sided=True)
    prefix = f"station_{part}"
    folder = source / "model_maps"
    layers = {"color": import_texture(folder, f"{prefix}_color", "color"),
              "normal": import_texture(folder, f"{prefix}_normal", "normal")}
    if not layers["normal"].get_editor_property("flip_green_channel"):
        layers["normal"].set_editor_property("flip_green_channel", True)
        ASSETS.save_loaded_asset(layers["normal"])
    if part not in ("render", "trim"):
        layers["roughness"] = import_texture(folder, f"{prefix}_orm", "linear")
    nodes = texture_nodes(asset, layers)
    tint = expression(asset, unreal.MaterialExpressionVertexColor)
    assign(shader(asset, "return Albedo*Tint.rgb;", {"Albedo": nodes["color"], "Tint": tint},
                  OUTPUT.CMOT_FLOAT3), PROP.MP_BASE_COLOR)
    assign(nodes["normal"], PROP.MP_NORMAL)
    if "roughness" in nodes:
        for prop, channel in ((PROP.MP_AMBIENT_OCCLUSION, "R"), (PROP.MP_ROUGHNESS, "G"), (PROP.MP_METALLIC, "B")):
            assign(nodes["roughness"], prop, channel)
    else:
        assign(number(asset, .90 if part == "render" else .50), PROP.MP_ROUGHNESS)
    return save(asset)


def fresnel_lens():
    asset = material("M_StationLens", blend=unreal.BlendMode.BLEND_TRANSLUCENT, two_sided=True)
    fresnel = expression(asset, unreal.MaterialExpressionFresnel)
    assign(number(asset,(.49,.58,.48)), PROP.MP_BASE_COLOR)
    assign(number(asset,.08), PROP.MP_ROUGHNESS)
    assign(shader(asset, "return .19+.53*Rim;", {"Rim": fresnel}, OUTPUT.CMOT_FLOAT1), PROP.MP_OPACITY)
    glow = shader(asset, "return float3(96,62,26)*(.16+.84*Rim);", {"Rim": fresnel}, OUTPUT.CMOT_FLOAT3)
    assign(glow, PROP.MP_EMISSIVE_COLOR)
    return save(asset)


def volcano_surface(textures):
    asset = material("M_VolcanicRock")
    tex = texture_nodes(asset, textures)
    world = expression(asset, unreal.MaterialExpressionWorldPosition)
    time = expression(asset, unreal.MaterialExpressionTime)
    local = shader(asset,"return (P-Origin)*.01;",{"P":world,"Origin":expression(
                   asset,unreal.MaterialExpressionActorPositionWS)},OUTPUT.CMOT_FLOAT3)
    uv = expression(asset, unreal.MaterialExpressionTextureCoordinate)
    aerial = sample_texture(asset, import_texture(Path(__file__).with_name("data"),"T_StHelens_Ortho","color"), uv)
    detail = shader(asset,"return UV*94;",{"UV":uv},OUTPUT.CMOT_FLOAT2)
    for node in tex.values():
        link(detail,node,"")
    masks = shader(asset, """
        struct Terrain {
            float Corner(int2 cell) {
                uint h = ((uint)cell.x*1597334677u) ^ ((uint)cell.y*3812015801u);
                h = (h^(h>>16))*2246822519u;
                return (h^(h>>13))*(1.0/2147483648.0)-1;
            }
            float Noise(float2 p) {
                int2 i = (int2)floor(p);
                float2 f = smoothstep(0,1,frac(p));
                return lerp(lerp(Corner(i),Corner(i+int2(1,0)),f.x),
                            lerp(Corner(i+int2(0,1)),Corner(i+1),f.x),f.y);
            }
            float Channel(float r, float bearing, float direction, float end) {
                float an = bearing-(direction+.14*sin(r*.021+direction)+.03*sin(r*.087));
                float d = abs(atan2(sin(an),cos(an)))*r;
                return saturate(1-d/(1.6+1.24*(1+sin(r*.065))))*saturate((end-r)/45);
            }
        };
        Terrain field;
        float r = length(P.xy), bearing = atan2(P.y,P.x);
        float lava = max(1-smoothstep(12,18,r),field.Channel(r,bearing,2.48,355));
        lava = max(lava,max(field.Channel(r,bearing,3.75,210),field.Channel(r,bearing,1.37,118)));
        float green = saturate((115-P.z+47*field.Noise(P.xy*.013))/45)*saturate((P.z-1.9)/6);
        return float2(green,lava);
        """, {"P":local},OUTPUT.CMOT_FLOAT2)
    green = shader(asset,"return Masks.x;",{"Masks":masks},OUTPUT.CMOT_FLOAT1)
    lava = shader(asset,"return Masks.y;",{"Masks":masks},OUTPUT.CMOT_FLOAT1)
    base = shader(asset, """
        float luma = dot(Ortho,float3(.2126,.7152,.0722));
        float detail = dot(Stone,float3(.38,.41,.21));
        float3 basalt = (.010+min(Ortho,.49)*.28)*float3(.98,.87,.82);
        float3 weathered = lerp(float3(.009,.061,.016),float3(.066,.195,.026),saturate(luma*2.8));
        float ledge = smoothstep(.22,.71,1-saturate(N.z));
        float3 surface = lerp(basalt,weathered,Green*(1-.87*ledge)*.91);
        return lerp(surface*(.72+1.32*detail),float3(.052,.023,.013),saturate(Lava));
        """, {"Ortho": aerial, "Stone": tex["color"], "Green": green, "Lava": lava,
              "N": expression(asset,unreal.MaterialExpressionPixelNormalWS)}, OUTPUT.CMOT_FLOAT3)
    emission = shader(asset, """
        float3 p = Position*.01;
        float flow = .58+.24*sin(p.x*.41+p.y*.33+T*2.1)+.18*sin(p.z*1.11 + p.x*.6 + T*3.8);
        float radiance = pow(saturate(Lava),1.65) * flow;
        float skyFill = dot(Light,float3(.21,.72,.07))*.018;
        return lerp(float3(5800,440,17),float3(9900,2500,270),smoothstep(.27,.96,Lava))*radiance
             + Base*skyFill*float3(.78,.90,1.12);
        """, {"Position": world, "Lava": lava, "T": time, "Base":base,
              "Light":expression(asset,unreal.MaterialExpressionSkyAtmosphereLightIlluminance)}, OUTPUT.CMOT_FLOAT3)
    assign(base, PROP.MP_BASE_COLOR)
    assign(emission, PROP.MP_EMISSIVE_COLOR)
    assign(tex["normal"], PROP.MP_NORMAL)
    assign(tex["roughness"], PROP.MP_ROUGHNESS, "R")
    assign(number(asset,.24), PROP.MP_SPECULAR)
    return save(asset)


def marine_finish(name, source, key, length):
    asset = material(name, two_sided=True)
    paint = expression(asset, unreal.MaterialExpressionVertexColor)
    finish = expression(asset, unreal.MaterialExpressionTextureCoordinate,coordinate_index=1)
    world = expression(asset, unreal.MaterialExpressionWorldPosition)
    space = unreal.MaterialPositionTransformSource
    local = expression(asset, unreal.MaterialExpressionTransformPosition,
                       transform_source_type=space.TRANSFORMPOSSOURCE_WORLD, transform_type=space.TRANSFORMPOSSOURCE_LOCAL)
    link(world, local, "")
    hull_uv = shader(asset, """
        float u = clamp(.5+P.x/LengthCm,.001,.999);
        float v = saturate((680-P.z)/1100);
        return P.y>=0 ? float2(u,v*.499) : float2(1-u,.5+v*.499);
        """, {"P":local,"LengthCm":number(asset,length*100)}, OUTPUT.CMOT_FLOAT2)
    paint_map = import_texture(source/"model_maps",f"{key}_hull_paint","color")
    # These narrow atlases occupy about 5.3 MB each in BC1. Keep the full
    # lettering available immediately when coming alongside at either anchorage.
    paint_map.set_editor_property("never_stream", True)
    ASSETS.save_loaded_asset(paint_map)
    livery = sample_texture(asset,paint_map,hull_uv)
    base = shader(asset, """
        float3 p = P*.01;
        float seams = abs(frac(p.x/8.4 + .5*floor(p.z/2.1))-.5)*8.4;
        float weld = (1-smoothstep(.005,.028,seams))*(1-smoothstep(.008,.065,fwidth(p.x)));
        float wash = exp(-abs(p.z-.10)*1.16)*(.44+.23*sin(p.x*.73)+.16*sin(p.x*2.8+p.z));
        float plates = (1-smoothstep(.24,.67,abs(N.z))) * (1-smoothstep(3.7,5.5,p.z));
        float coat = Shell*(1-smoothstep(5.05,6.15,p.z))*(1-smoothstep(.65,.92,abs(N.z)));
        float3 pigment = clamp(Paint,.007,float3(.53,.55,.54));
        // The original ship colours identify the deck coatings. In tropical
        // daylight use the reflectance of painted non-skid steel.
        float greenDeck=smoothstep(.055,.20,Paint.g-max(Paint.r,Paint.b));
        float redDeck=smoothstep(.13,.36,Paint.r-max(Paint.g,Paint.b));
        pigment=lerp(pigment,float3(.027,.122,.085),greenDeck);
        pigment=lerp(pigment,float3(.24,.052,.039),redDeck);
        pigment=lerp(pigment,Markings,coat);
        float curved=Gas*smoothstep(4.5,6.2,p.z)*smoothstep(-56,-49,p.x)*(1-smoothstep(63,69,p.x))
                    *smoothstep(.035,.18,N.z)*(1-smoothstep(.975,1,N.z));
        float angle=atan2(N.y,N.x)*4.4563;
        float lat=asin(clamp(N.z,-.999,.999))*4.0;
        float seam=min(abs(frac(angle+.5)-.5)/max(.009,fwidth(angle)),
                       abs(frac(lat+.5)-.5)/max(.008,fwidth(lat)));
        float joint=(1-smoothstep(.35,1.25,seam))*max(0,1-fwidth(lat)*3);
        float brushed=.5+.5*sin(angle*1.347+lat*3.15);
        pigment=lerp(pigment,float3(.43,.49,.50)*(.94+.06*brushed-.30*joint),curved);
        return lerp(pigment, pigment*(1-.13*weld-.21*wash)+float3(.018,.020,.012)*wash,plates);
        """, {"P":local, "Paint":paint, "Shell":(paint,"A"), "Markings":livery,"Gas":number(asset,float(key=="gas")),
              "N":expression(asset,unreal.MaterialExpressionPixelNormalWS)}, OUTPUT.CMOT_FLOAT3)
    assign(base, PROP.MP_BASE_COLOR)
    assign(shader(asset, "return clamp(UV.x,.28,.83);", {"UV":finish}, OUTPUT.CMOT_FLOAT1), PROP.MP_ROUGHNESS)
    assign(shader(asset, "return .32*saturate(UV.y);", {"UV":finish}, OUTPUT.CMOT_FLOAT1), PROP.MP_METALLIC)
    return save(asset)


def reef_shark_skin(source):
    asset = material("M_ReefShark")
    folder = source / "model_maps"
    color = import_texture(folder, "reefshark_diff", "color")
    normal = import_texture(folder, "reefshark_normal", "normal")
    normal.set_editor_property("flip_green_channel", True)
    ASSETS.save_loaded_asset(normal)
    tex = texture_nodes(asset, {"color":color, "normal":normal})
    space = unreal.MaterialPositionTransformSource
    relative = expression(asset,unreal.MaterialExpressionTransformPosition,
                          transform_source_type=space.TRANSFORMPOSSOURCE_WORLD,transform_type=space.TRANSFORMPOSSOURCE_LOCAL)
    link(expression(asset,unreal.MaterialExpressionWorldPosition),relative,"")
    shade = shader(asset, """
        float flank = (1-smoothstep(-94,-49,P.z)) * (1-smoothstep(.04,.62,N.z));
        float belly = (1-smoothstep(-126,-97,P.z)) * (1-smoothstep(-.64,-.14,N.z));
        float3 pigment = lerp(float3(.19,.27,.29),float3(.34,.45,.46),flank);
        return Skin*lerp(pigment,float3(.70,.75,.72),belly);
        """, {"Skin":tex["color"], "N":expression(asset,unreal.MaterialExpressionPixelNormalWS),"P":relative}, OUTPUT.CMOT_FLOAT3)
    assign(shade, PROP.MP_BASE_COLOR)
    assign(tex["normal"], PROP.MP_NORMAL)
    assign(number(asset,.52), PROP.MP_ROUGHNESS)
    assign(number(asset,.24), PROP.MP_SPECULAR)
    phase = expression(asset, unreal.MaterialExpressionScalarParameter, parameter_name="SwimPhase",
                       use_custom_primitive_data=True, primitive_data_index=0)
    side = expression(asset, unreal.MaterialExpressionVectorParameter, parameter_name="SwimRight",
                      use_custom_primitive_data=True, primitive_data_index=1)
    stroke = expression(asset, unreal.MaterialExpressionTextureCoordinate, coordinate_index=1)
    bend = shader(asset, "return Right * 100 * dot(UV*2-1,float2(cos(Phase),sin(Phase)));",
                  {"UV":stroke, "Phase":phase, "Right":side}, OUTPUT.CMOT_FLOAT3)
    assign(bend, PROP.MP_WORLD_POSITION_OFFSET)
    asset.set_editor_property("max_world_position_offset_displacement", 75)
    return save(asset)


def entry_bubble(name):
    asset = material(name, MAT.MSM_UNLIT, unreal.BlendMode.BLEND_TRANSLUCENT)
    uv = expression(asset,unreal.MaterialExpressionTextureCoordinate)
    offset = shader(asset, """
        float2 p=UV*2-1;
        float r2=saturate(dot(p,p));
        // A water-to-air interface bends rays away from the normal. Scale the
        // displacement by the bubble's actual on-screen diameter.
        float2 diameter=1/max(fwidth(UV),.0001)/Viewport;
        return p*min(diameter,.10)*(.07+.17*r2)*sqrt(1-r2);
        """, {"UV":uv,"Viewport":expression(asset,unreal.MaterialExpressionViewSize)}, OUTPUT.CMOT_FLOAT2)
    background = expression(asset,unreal.MaterialExpressionSceneColor,
                            input_mode=unreal.MaterialSceneAttributeInputMode.OFFSET_FRACTION)
    link(offset,background,"")
    optics = shader(asset, """
        float2 p=UV*2-1;
        float r=length(p), aa=clamp(fwidth(r),.017,.30);
        float mask=1-smoothstep(.98-aa,.98+aa,r);
        float3 n=float3(p,sqrt(saturate(1-r*r)));
        float fresnel=.022+.978*pow(1-n.z,3);
        float lower=smoothstep(-.7,.72,p.y);
        float outer=exp(-pow((r-.88)/max(.080,aa),2));
        float inner=exp(-pow((r-.73)/max(.070,aa),2));
        float upperArc=.5+.5*dot(normalize(p+float2(.0001,0)),normalize(float2(-.54,-.84)));
        float glint=exp(-dot((p-float2(-.33,-.52))*float2(6,10),(p-float2(-.33,-.52))*float2(6,10)));
        float second=exp(-dot((p-float2(.41,.51))*float2(10,15),(p-float2(.41,.51))*float2(10,15)));
        float day=max(1-smoothstep(.008,.12,Eye),smoothstep(5,1100,dot(Sun,float3(.21,.72,.07))));
        day=lerp(.16,1,day);
        float3 reflection=(float3(.025,.085,.11)+float3(.90,1.10,1.16)*upperArc)*day/max(Eye,.00001);
        float3 rgb=lerp(Behind,reflection,saturate(.035+fresnel+.78*outer));
        rgb*=1-.51*inner*(.34+.66*lower);
        rgb+=float3(.89,.98,1)*(2.25*glint+.74*second+.60*inner*upperArc)*day/max(Eye,.00001);
        return float4(rgb,mask*smoothstep(8,20,DepthCm));
        """, {"UV":uv,"Behind":background,"Eye":expression(asset,unreal.MaterialExpressionEyeAdaptation),
              "Sun":expression(asset,unreal.MaterialExpressionSkyAtmosphereLightIlluminance),
              "DepthCm":expression(asset,unreal.MaterialExpressionPixelDepth)}, OUTPUT.CMOT_FLOAT4)
    assign(optics, PROP.MP_EMISSIVE_COLOR)
    assign(shader(asset,"return Optical.a;",{"Optical":optics},OUTPUT.CMOT_FLOAT1), PROP.MP_OPACITY)
    EDIT.set_material_usage(asset,unreal.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES)
    return save(asset)


def blue_whale_skin(source):
    asset = material("M_BlueWhale")
    nodes = texture_nodes(asset, baked_maps(source, "bluewhale"))
    assign(nodes["color"], PROP.MP_BASE_COLOR)
    assign(nodes["normal"], PROP.MP_NORMAL)
    assign(nodes["roughness"], PROP.MP_ROUGHNESS, "G")
    uv = expression(asset, unreal.MaterialExpressionTextureCoordinate, coordinate_index=1)
    time = expression(asset, unreal.MaterialExpressionTime)
    assign(shader(asset, "return float3(0,0,95*pow(saturate(UV.x),3)*sin(T*1.75-UV.x*3));",
                  {"UV": uv, "T": time}, OUTPUT.CMOT_FLOAT3), PROP.MP_WORLD_POSITION_OFFSET)
    asset.set_editor_property("max_world_position_offset_displacement", 100)
    return save(asset)


def dolphin_skin(name, source, tint=None):
    asset = material(name)
    uv = expression(asset, unreal.MaterialExpressionTextureCoordinate)
    time = expression(asset, unreal.MaterialExpressionTime)
    phase = expression(asset, unreal.MaterialExpressionScalarParameter, parameter_name="SwimPhase",
                       use_custom_primitive_data=True, primitive_data_index=0)
    if tint is None:
        folder = source / "model_maps"
        skin = texture_nodes(asset, {"color": import_texture(folder, "dolphin_skin_4k", "color"),
                                    "roughness": import_texture(folder, "dolphin_rough_4k", "linear")})
        world = expression(asset, unreal.MaterialExpressionWorldPosition)
        space = unreal.MaterialPositionTransformSource
        local = expression(asset,unreal.MaterialExpressionTransformPosition,
                           transform_source_type=space.TRANSFORMPOSSOURCE_WORLD, transform_type=space.TRANSFORMPOSSOURCE_LOCAL)
        link(world, local, "")
        normal = expression(asset,unreal.MaterialExpressionPixelNormalWS)
        pigment = shader(asset, """
            // The flippers meet the pale belly but carry the dorsal pigment on top.
            float fin = max(smoothstep(19.,39.,abs(P.y)),1.-smoothstep(-110.,-88.,P.x));
            float dorsal = smoothstep(-.28,.72,N.z);
            float3 cape = Skin*lerp(float3(.78,.81,.86),float3(.42,.49,.57),dorsal);
            return lerp(cape,min(cape,float3(.024,.034,.046)),dorsal*fin);
            """, {"Skin":skin["color"], "P":local, "N":normal}, OUTPUT.CMOT_FLOAT3)
        assign(pigment, PROP.MP_BASE_COLOR)
        # The opaque water pass shadows submerged geometry. Restore the diffuse
        # irradiance filtered by depth; scale it by the skin's actual reflectance.
        fill = shader(asset, """
            float depth = max(0., -P.z);
            float hemi = .30 + .70*saturate(.5+.5*N.z);
            float3 transmission = exp(-Extinction*depth);
            return Albedo * Sun * transmission * hemi * (.14+.085*Focus)
                   * (1.-smoothstep(-18.,24.,P.z));
            """, {"Albedo": pigment, "Sun": expression(asset,unreal.MaterialExpressionSkyAtmosphereLightIlluminanceOnGround),
                  "P": world, "Focus": caustics(asset,world), "Extinction":number(asset,WATER_EXTINCTION_CM),
                  "N": normal}, OUTPUT.CMOT_FLOAT3)
        assign(fill, PROP.MP_EMISSIVE_COLOR)
        assign(skin["roughness"], PROP.MP_ROUGHNESS, "R")
    else:
        assign(number(asset, tint), PROP.MP_BASE_COLOR)
        assign(number(asset, .30), PROP.MP_ROUGHNESS)
    assign(number(asset, .27), PROP.MP_SPECULAR)
    bend = shader(asset, """
        float stroke = sin(T*7.65 + Phase - UV.x*4.0);
        return float3(0,0,stroke * 36 * pow(saturate(UV.x),2.6));
        """, {"UV": uv, "T": time, "Phase": phase}, OUTPUT.CMOT_FLOAT3)
    asset.set_editor_property("max_world_position_offset_displacement", 39)
    assign(bend, PROP.MP_WORLD_POSITION_OFFSET)
    return save(asset)


def wake_foam():
    asset = material("M_CoralWakeFoam", MAT.MSM_UNLIT, unreal.BlendMode.BLEND_TRANSLUCENT, two_sided=True)
    uv = expression(asset, unreal.MaterialExpressionTextureCoordinate)
    color = expression(asset, unreal.MaterialExpressionVertexColor)
    eye = expression(asset, unreal.MaterialExpressionEyeAdaptation)
    sun = expression(asset, unreal.MaterialExpressionSkyAtmosphereLightIlluminance)
    world = expression(asset, unreal.MaterialExpressionWorldPosition)
    time = expression(asset, unreal.MaterialExpressionTime)
    uv_world = shader(asset, """
        float2 p = P.xy*.01;
        return (p + float2(sin(p.y*.72-T*.4),cos(p.x*.86-T*.35))*.32 - T*float2(.12,.08))*.16;
        """, {"P": world, "T": time}, OUTPUT.CMOT_FLOAT2)
    uv_trail = shader(asset, "return float2(UV.x*.65 + .04*sin(UV.y*.36),UV.y*.066);",
                      {"UV": uv}, OUTPUT.CMOT_FLOAT2)
    turbulent = sample_texture(asset, unreal.load_asset(FOAM_TEXTURE), uv_world)
    streaks = sample_texture(asset, unreal.load_asset(FOAM_TEXTURE), uv_trail)
    foam = shader(asset, """
        float edge = abs(UV.x*2-1);
        float agitation = .64*Swirl+.36*Streak;
        float fringe = 1-smoothstep(.36+.35*Swirl,.73+.27*Streak,edge);
        float bubbles = smoothstep(.21+.22*Age,.76,agitation);
        float white = smoothstep(.28+.24*Age,.72,agitation + .13*(1-Age));
        float fade = saturate(Strength*fringe);
        float3 tint = lerp(float3(.055,.48,.45),float3(.98,1,.96),white);
        return float4(tint,fade*saturate(.18+.90*bubbles+.13*Prop));
        """, {"UV": uv, "Age": (color, "R"), "Prop": (color, "G"), "Strength": (color, "A"),
              "Swirl": (turbulent,"R"), "Streak": (streaks,"R")}, OUTPUT.CMOT_FLOAT4)
    emission = shader(asset, """
        float sunlight = smoothstep(0,22000,max(Light.r,max(Light.g,Light.b)));
        return Surface.rgb * lerp(.10,1.18,sunlight) / max(Eye,.00001);
        """, {"Surface": foam, "Light": sun, "Eye": eye}, OUTPUT.CMOT_FLOAT3)
    assign(emission, PROP.MP_EMISSIVE_COLOR)
    assign(shader(asset, "return Surface.a;", {"Surface": foam}, OUTPUT.CMOT_FLOAT1), PROP.MP_OPACITY)
    return save(asset)


def create_materials(source):
    pbr_maps = None

    def maps():
        nonlocal pbr_maps
        if pbr_maps is None:
            pbr_maps = import_textures(source)
        return pbr_maps

    builders = {
        "tanker": ("M_ProductTanker", lambda name: marine_finish(name,source,"product",176)),
        "lng": ("M_GasCarrier", lambda name: marine_finish(name,source,"gas",184)),
        "blue_whale": ("M_BlueWhale", lambda _: blue_whale_skin(source)),
        "reef_shark": ("M_ReefShark", lambda _: reef_shark_skin(source)),
        "entry_bubble": ("M_EntryBubble", entry_bubble),
        "station_lens": ("M_StationLens", lambda _: fresnel_lens()),
        "ground": ("M_CoastalGround", lambda _: ground(maps())),
        "water": ("M_CoralWater", lambda _: water(source)),
        "spindrift": ("M_StormSpindrift", lambda _: storm_spindrift(source)),
        "leaves": ("M_PalmFronds", lambda _: foliage()),
        "canopy": ("M_CoastalCanopy", lambda _: coastal_canopy()),
        "cloud": ("M_CoralCloudVolume", lambda _: tropical_clouds()),
        "ash": ("M_EruptionColumn", lambda _: eruption_column()),
        "distant_sky": ("M_TradeWindSky", lambda _: distant_sky(source)),
        "bark": ("M_PalmBark", lambda name: pbr(name, maps()["palm_tree_bark"])),
        "rock": ("M_TidalRock", lambda name: pbr(name, maps()["coast_rocks_03"], arm=True, wet=True)),
        "boulder": ("M_Boulder", lambda name: pbr(name, maps()["boulder_01"], arm=True, wet=True)),
        "volcano": ("M_VolcanicRock", lambda _: volcano_surface(maps()["rock_face"])),
        "plaster": ("M_LighthouseStone", lambda name: painted_masonry(name, (.81,.78,.70), maps()["rock_face"])),
        "paint": ("M_LighthouseRed", lambda name: painted_masonry(name, (.62,.087,.047), maps()["rock_face"])),
        "concrete": ("M_QuayConcrete", lambda name: painted_masonry(name, (.32,.31,.25), maps()["rock_face"])),
        "lantern": ("M_LanternGlass", lambda _: lantern_glass()),
        "beacon": ("M_LighthouseBeacon", lambda name: simple(name, (.61,.33,.10), .29, emissive=(7700, 3450, 690))),
        "wood": ("M_CoastalTimber", lambda name: pbr(name, maps()["wooden_planks"], rain_on_timber=True)),
        "gelcoat": ("M_SaltwaterGelcoat", lambda _: gelcoat()),
        "glass": ("M_SmokedGlazing", lambda name: simple(name, (.023,.057,.069), .092, metal=.44)),
        "steel": ("M_MarineSteel", lambda name: simple(name, (.39,.46,.47), .20, metal=.84)),
        "rubber": ("M_MarineRubber", lambda name: simple(name, (.015,.022,.023), .74)),
        "sail": ("M_CoralSailcloth", lambda _: canvas()),
        "shirt": ("M_DeckShirt", lambda name: simple(name,(.56,.63,.62),.85,two_sided=True)),
        "red": ("M_MarkerRed", lambda name: simple(name, (.44,.018,.008), .47, metal=.12)),
        "green": ("M_MarkerGreen", lambda name: simple(name, (.006,.19,.095), .47, metal=.12)),
        "warm": ("M_PierLamp", lambda name: simple(name, (.76,.38,.16), .24, emissive=(7,2.8,.54))),
        "foam": ("M_CoralWakeFoam", lambda _: wake_foam()),
        "dolphin_body": ("M_DolphinSkin", lambda name: dolphin_skin(name, source)),
        "dolphin_white": ("M_DolphinBelly", lambda name: dolphin_skin(name, source)),
        "dolphin_material": ("M_DolphinEye", lambda name: dolphin_skin(name, source, (.004,.006,.008))),
        "dolphin_mouth": ("M_DolphinMouth", lambda name: dolphin_skin(name, source, (.024,.013,.016))),
        "rain": ("M_SquallRain", lambda name: transparent_effect(name, """
            float x=2*UV.x-1;
            return Contact*Strength*exp(-3*x*x)*sin(UV.y*3.14159)*lerp(.48,.81,1-UV.y);
            """, "return .038*Sun + float3(.21,.25,.28) / max(Eye, .00001);")),
        "lightning": ("M_Lightning", lambda name: transparent_effect(name, """
            float x = abs(UV.x*2-1); return Strength*Flash*(exp(-x*x*25)*.24 + exp(-x*x*136)*.76);
            """, "return float3(12000,31000,75000);", unreal.BlendMode.BLEND_ADDITIVE)),
    }
    builders["skipper"] = ("M_Skipper", lambda name: pbr(name,baked_maps(source,"skipper"),arm=True))
    for atlas in ATLASES:
        builders["pirate" + atlas.lower()] = (f"M_Sirens{atlas}", lambda _, atlas=atlas: pirate_finish(source, atlas))
    for part in ("granite", "iron", "render", "rock", "slate", "trim", "wood", "brass"):
        builders[f"station_{part}"] = (f"M_Station{part.title()}", lambda _, part=part: station_finish(source, part))
    refresh = set(os.environ.get("SAILING_REBUILD_MATERIALS", "").split(","))
    result = {}
    for role, (name, build) in builders.items():
        path = f"{ROOT}/Materials/{name}"
        result[role] = build(name) if role in refresh or not ASSETS.does_asset_exist(path) else ASSETS.load_asset(path)
    nanite = unreal.MaterialUsage.MATUSAGE_NANITE
    instances = unreal.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES
    for role in ("ground", "leaves", "bark", "canopy", "rock", "boulder", "volcano"):
        asset = result[role]
        required = (nanite, instances) if role in ("leaves", "bark", "canopy") else (nanite,)
        missing = [usage for usage in required if not EDIT.has_material_usage(asset, usage)]
        if missing:
            for usage in missing:
                EDIT.set_material_usage(asset, usage)
            save(asset)
    return result
