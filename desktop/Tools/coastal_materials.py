"""Author the Coral Pass material graphs in the Unreal Editor."""

import os
from pathlib import Path

import unreal

from coastal_layout import CAYS, VOLCANO_RIM, VOLCANO_X, VOLCANO_Y


ROOT = "/Game/Coastal"
ASSETS = unreal.EditorAssetLibrary
TOOLS = unreal.AssetToolsHelpers.get_asset_tools()
EDIT = unreal.MaterialEditingLibrary
PROP = unreal.MaterialProperty
OUTPUT = unreal.CustomMaterialOutputType
MAT = unreal.MaterialShadingModel


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
    if not texture:
        task = unreal.AssetImportTask()
        task.filename = str(path)
        task.destination_path = f"{ROOT}/Textures"
        task.automated = True
        task.save = True
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


def pbr(name, textures, arm=False, wet=False):
    asset = material(name)
    nodes = texture_nodes(asset, textures)
    color = nodes["color"]
    rough, channel = nodes["roughness"], "G" if arm else "R"
    if wet:
        world = expression(asset, unreal.MaterialExpressionWorldPosition)
        color = shader(asset, "return Albedo * lerp(.54,1,smoothstep(-22,155,Position.z));",
                       {"Position": world, "Albedo": color}, OUTPUT.CMOT_FLOAT3)
        rough = shader(asset, "return Value * lerp(.52,1,smoothstep(-16,142,Position.z));",
                       {"Position": world, "Value": (rough, channel)}, OUTPUT.CMOT_FLOAT1, 180)
        channel = ""
    assign(color, PROP.MP_BASE_COLOR)
    assign(nodes["normal"], PROP.MP_NORMAL)
    assign(rough, PROP.MP_ROUGHNESS, channel)
    if arm:
        assign(nodes["roughness"], PROP.MP_AMBIENT_OCCLUSION, "R")
        assign(nodes["roughness"], PROP.MP_METALLIC, "B")
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
    light = caustics(asset, world)
    base = shader(asset, """
        float3 p = Position * 0.01;
        float damp = 1 - smoothstep(0.4, 1.85, p.z);
        float3 beach = Sand * lerp(float3(1.12, 1.11, 0.99), float3(0.72, 0.72, 0.64), damp);
        float mottling = 0.73 + 0.27 * sin(p.x*0.81 + sin(p.y*0.67)) * sin(p.y*0.56);
        float3 grass = float3(0.047, 0.084, 0.021) * mottling + Sand * 0.095;
        float3 ground = lerp(lerp(beach, grass, Vegetation * .96), Stone * float3(1.26,1.19,1.04), Rock * .88);
        return saturate(ground * (1 + Light * 1.8));
        """, {"Position": world, "Sand": sand["color"], "Stone": stone["color"],
              "Vegetation": (paint, "G"), "Rock": (paint, "R"), "Light": light}, OUTPUT.CMOT_FLOAT3)
    rough = shader(asset, """
        return lerp(saturate(Sand * 0.75 + 0.19), Stone, Rock) * lerp(0.64, 1, smoothstep(32, 180, Position.z));
        """, {"Position": world, "Sand": (sand["roughness"], "R"), "Stone": (stone["roughness"], "G"),
              "Rock": (paint, "R")}, OUTPUT.CMOT_FLOAT1, 240)
    normals = shader(asset, "return normalize(lerp(Sand, Stone, Rock * 0.84));",
                     {"Sand": sand["normal"], "Stone": stone["normal"], "Rock": (paint, "R")}, OUTPUT.CMOT_FLOAT3, 470)
    assign(base, PROP.MP_BASE_COLOR)
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
        float3 light = float3(.12,.22,.039);
        float3 dark = float3(.036,.103,.013);
        float3 green = lerp(dark, light, Age * .76 + UV.x * .16) * Tint;
        return green * lines + float3(.10,.074,.020) * rib;
        """, {"UV": uv, "Tint": (paint, "R"), "Age": (paint, "G")}, OUTPUT.CMOT_FLOAT3)
    wpo = shader(asset, """
        float gust = sin(T*.86 + Position.x*.0012 + Position.y*.0014);
        float flex = gust*21 + sin(T*3.3 + UV.x*3.0 + Position.y*.004)*9;
        return Weight * float3(flex, .74*flex, sin(T*1.65 + UV.x*4 + Position.y*.003)*18);
        """, {"T": time, "Position": world, "Weight": (paint, "A"), "UV": uv}, OUTPUT.CMOT_FLOAT3, 220)
    assign(leaf, PROP.MP_BASE_COLOR)
    assign(number(asset, (.066,.117,.025)), PROP.MP_SUBSURFACE_COLOR)
    assign(number(asset, 0.64), PROP.MP_ROUGHNESS)
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
        float3 canopy = lerp(float3(.016,.037,.013),float3(.095,.15,.039),Tint*Lightness);
        return canopy * (.67+.42*leaves);
        """, {"P": world, "Tint": (paint,"R"), "Lightness": (paint,"G")}, OUTPUT.CMOT_FLOAT3)
    assign(base, PROP.MP_BASE_COLOR)
    assign(number(asset,(.044,.066,.016)), PROP.MP_SUBSURFACE_COLOR)
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
        float2 drift = float2(T * .008, T * .004);
        float2 weather = p.xy * .175 + float2(.53, .82) + drift * .175;
        float wide = sin(weather.x*2.2 + sin(weather.y*1.2))*cos(weather.y*1.38 - weather.x*.22);
        float broken = sin(weather.x*4.13 - weather.y*1.39)*sin(weather.y*3.2 + weather.x*.54);
        float local = .52 + wide*.22 + broken*.14;
        float shape = Texture3DSampleLevel(Noise,NoiseSampler,frac(float3((p.xy+drift)*.19,p.z*.29)+.31),0).r;
        float erosion = Texture3DSampleLevel(Noise,NoiseSampler,frac(p*.57+float3(.13,.63,.22)),0).g;
        float2 bankUV = (p.xy - float2(6.1,-1.8)) / float2(4.1,3.7);
        float bank = exp(-dot(bankUV,bankUV)) * lerp(.11,.32,smoothstep(-.1,.12,Coverage));
        float h = saturate((p.z - 1.02) / 2.6);
        float pillar = smoothstep(0,.09,h) * (1-smoothstep(.32+local*.23,.73+local*.13,h));
        float mass = smoothstep(.26,.68,local + Coverage*.82 + (shape-.42)*.83 - erosion*.13 + bank);
        return mass * pillar * Density * .8;
        """, {"Position": position, "T": time, "Noise": noise, "Coverage": coverage,
              "Density": density}, OUTPUT.CMOT_FLOAT1)
    assign(densities, PROP.MP_SUBSURFACE_COLOR)
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


WAVE_MATH = """
struct Surface {
    float3 Wave(float4 mode, float2 p, float cell, float sharpness) {
        float waveNumber = length(mode.xy);
        float wavelength = 6.2831853 / max(0.01, waveNumber);
        float a = mode.z * (1 - smoothstep(wavelength*.19, wavelength*.50, cell));
        float phase = dot(mode.xy, p) + mode.w;
        float c = cos(phase);
        return float3(a*(c+sharpness*(c*c-.5)), -a*sin(phase)*(1+2*sharpness*c)*mode.xy);
    }
};
Surface s;
float2 p = Position.xy * .01;
float3 sea = s.Wave(Wave0,p,Footprint.x,CrestShape) + s.Wave(Wave1,p,Footprint.x,CrestShape)
           + s.Wave(Wave2,p,Footprint.x,CrestShape) + s.Wave(Wave3,p,Footprint.x,CrestShape)
           + s.Wave(Wave4,p,Footprint.x,CrestShape) + s.Wave(Wave5,p,Footprint.x,CrestShape)
           + s.Wave(Wave6,p,Footprint.x,CrestShape) + s.Wave(Wave7,p,Footprint.x,CrestShape);
"""


def sample_texture(asset, texture, coordinates, *, normal=False):
    if not texture:
        raise RuntimeError("Missing a Coral Pass water texture")
    sampler = unreal.MaterialSamplerType
    node = expression(asset, unreal.MaterialExpressionTextureSample, texture=texture,
                      sampler_type=sampler.SAMPLERTYPE_NORMAL if normal else sampler.SAMPLERTYPE_COLOR)
    link(coordinates, node, "")
    return node


FOAM_TEXTURE = "/Water/Textures/Foam/T_WaterFlow_03_Foam_Tiled"


def water(source):
    asset = material("M_CoralWater")
    asset.set_editor_property("tangent_space_normal", False)
    world = expression(asset, unreal.MaterialExpressionWorldPosition,
                       world_position_shader_offset=unreal.WorldPositionIncludedOffsets.WPT_EXCLUDE_ALL_SHADER_OFFSETS)
    grid = expression(asset, unreal.MaterialExpressionTextureCoordinate)
    time = parameter(asset, "SeaTime", 0)
    scale = parameter(asset, "SeaScale", 1)
    wave_inputs = {"Position": world, "CrestShape": parameter(asset, "CrestShape", .27)}
    for i in range(8):
        name = f"Wave{i}"
        vector = expression(asset, unreal.MaterialExpressionVectorParameter, y=i * 125,
                            parameter_name=name, default_value=unreal.LinearColor(0, 0, 0, 0))
        append = expression(asset, unreal.MaterialExpressionAppendVector, x=-240, y=i * 125)
        link(vector, append, "A")
        link(vector, append, "B", "A")
        wave_inputs[name] = append
    offset = shader(asset, WAVE_MATH + "return float3(0,0,100*sea.x);",
                    {**wave_inputs, "Footprint": grid}, OUTPUT.CMOT_FLOAT3)

    # Cull sub-grid displacement in the vertex stage. Sub-grid slopes still reflect light
    # until the wavelength falls below a pixel, including beyond the last displaced ring.
    pixel = shader(asset, "return max(length(ddx(P.xy)),length(ddy(P.xy)))*.005;",
                   {"P": world}, OUTPUT.CMOT_FLOAT1)
    sea = shader(asset, WAVE_MATH + "return sea;", {**wave_inputs, "Footprint": pixel}, OUTPUT.CMOT_FLOAT3)
    drift = shader(asset, """
        float2 p = Position.xy * .01;
        return p + float2(sin(dot(p,float2(.23,.12))-.22*T),cos(dot(p,float2(.10,-.29))-.19*T))*.44;
        """, {"Position": world, "T": time}, OUTPUT.CMOT_FLOAT2)
    samples = []
    chop = unreal.load_asset("/Water/Textures/Normals/T_Water_TilingNormal_Waves_02")
    ripple = import_texture(source,"T_SeaCapillaries_N","normal")
    for texture,angle,size,velocity in ((chop,.55,14.3,1.42),(chop,-.72,4.71,.77),
                                        (ripple,.41,9.6,.75),(ripple,-.83,3.4,.32)):
        uv = shader(asset, f"""
            float2 d = float2(cos({angle}),sin({angle}));
            float2 q = float2(dot(P,d),dot(P,float2(-d.y,d.x)));
            return (q - T*float2({velocity},.12)) / {size};
            """, {"P": drift, "T": time}, OUTPUT.CMOT_FLOAT2)
        sampled = sample_texture(asset,texture,uv,normal=True)
        samples.append(shader(asset, f"""
            float2 d = float2(cos({angle}),sin({angle}));
            return (d*N.x + float2(-d.y,d.x)*N.y) / max(.55,N.z);
            """, {"N": sampled}, OUTPUT.CMOT_FLOAT2))
    normal = shader(asset, """
        float gust = .84+.16*sin(dot(P,float2(.32,-.18))+sin(P.y*.61-T*.29));
        float2 slopes = (Fetch*.42 + Chop*.32 + Catspaws*.60 + Ripples*.34) * gust * sqrt(SeaScale);
        float storm = saturate((SeaScale-1)*.74);
        float2 tile = floor(P*1.8);
        float seed = frac(sin(dot(tile,float2(12.9898,78.233)))*43758.5453);
        float2 drop = frac(P*1.8)-(.20+.60*float2(seed,frac(seed*5.72)));
        float age = frac(T*1.72+seed), radius = length(drop), ring = radius-age*.40;
        slopes += drop/max(.02,radius) * (1-smoothstep(.015,.08,abs(ring))) * cos(ring*86)
                * (1-age)*.13*storm*(1-smoothstep(.012,.09,Pixel));
        return normalize(float3(-Sea.yz+slopes,1));
        """, {"Sea": sea, "Fetch": samples[0], "Chop": samples[1], "Catspaws": samples[2], "Ripples": samples[3], "SeaScale": scale,
              "P": drift, "T": time, "Pixel": pixel}, OUTPUT.CMOT_FLOAT3)
    lace_uv = shader(asset, "return (P-T*float2(.48,.22))*.085;", {"P": drift, "T": time}, OUTPUT.CMOT_FLOAT2)
    lace = sample_texture(asset, unreal.load_asset(FOAM_TEXTURE), lace_uv)

    layout = "\n".join(f"surf = max(surf, h.Cay(p,float2({c.x},{c.y}),float2({c.length},{c.width}),{c.phase},T));" for c in CAYS)
    foam = shader(asset, """
        float2 p = Position.xy*.01;
        struct Shoal {
            float Cay(float2 p, float2 center, float2 radii, float phase, float t) {
                float2 q = (p-center)/radii;
                if (max(abs(q.x), abs(q.y)) > 1.36) return 0;
                float r = length(q);
                float a = atan2(q.y,q.x);
                float shore = 1 + .129*sin(3*a+phase)+.070*cos(5*a-phase)+.038*sin(8*a+2*phase)+.021*cos(13*a-3*phase);
                float d = (r-shore)*length((p-center)/max(r,.1));
                float breaker = .5 + .5*cos(d*(.77 + .07*sin(a*7)) + t*1.42 + .59*sin(a*29));
                return saturate(1 - abs(d-1.5)*.43)*.50 + smoothstep(.76,.98,breaker)*exp(-max(d,0)*.13)*smoothstep(-1,1.5,d)*.66;
            }
        };
        Shoal h;
        float surf = 0;
        """ + layout + """
        // Breaking depends on a short steep face riding on the longer swell.
        float foamyFace = -dot(Sea.yz,float2(-.71,.70)) + .29*Chop.y;
        float breaking = smoothstep(.37,.76, Sea.x/max(.6,SeaScale)*.52 + foamyFace);
        float web = smoothstep(.32,.79,Lace);
        return saturate(surf*web + smoothstep(.17,.90,breaking)*web*web*(.41+.49*saturate(SeaScale-1)));
        """, {"Position": world, "Sea": sea, "Chop": samples[0], "Lace": (lace,"R"),
              "SeaScale": scale, "T": time}, OUTPUT.CMOT_FLOAT1, 600)
    base = shader(asset, "return lerp(float3(.002,.009,.012),float3(.80,.86,.84),Foam);",
                  {"Foam": foam}, OUTPUT.CMOT_FLOAT3)
    rough = shader(asset, """
        // Slopes lost to minification become a wider specular lobe on the horizon.
        return lerp(.085+.065*smoothstep(.05,2.4,Pixel)+.035*saturate(SeaScale-1),.65,Foam);
        """, {"Foam": foam, "SeaScale": scale, "Pixel": pixel}, OUTPUT.CMOT_FLOAT1)
    opacity = shader(asset, "return lerp(.085,.98,Foam);", {"Foam": foam}, OUTPUT.CMOT_FLOAT1)
    assign(offset, PROP.MP_WORLD_POSITION_OFFSET)
    assign(normal, PROP.MP_NORMAL)
    assign(base, PROP.MP_BASE_COLOR)
    assign(rough, PROP.MP_ROUGHNESS)
    assign(opacity, PROP.MP_OPACITY)
    assign(number(asset, .255), PROP.MP_SPECULAR)
    sun = expression(asset, unreal.MaterialExpressionSkyAtmosphereLightIlluminance)
    fill = shader(asset, """
        // Diffuse hemispherical inscattering persists under the sail's direct shadow.
        float sky = saturate(dot(Light,float3(.21,.72,.07))/72000);
        return sky*float3(13,72,107)*(1-Foam);
        """, {"Light":sun,"Foam":foam}, OUTPUT.CMOT_FLOAT3)
    assign(fill, PROP.MP_EMISSIVE_COLOR)
    output = expression(asset, unreal.MaterialExpressionSingleLayerWaterMaterialOutput, -95, 1190)
    for pin, value in {
        "ScatteringCoefficients": (.000016,.000087,.000137),
        "AbsorptionCoefficients": (.0041,.00102,.00072),
        "PhaseG": .21, "ColorScaleBehindWater": 0.88,
    }.items():
        link(number(asset, value), output, pin)
    # The single-layer model compiles only once all four optical inputs exist.
    asset.set_editor_property("shading_model", MAT.MSM_SINGLE_LAYER_WATER)
    return save(asset)


def transparent_effect(name, alpha_code, luminosity, blend=unreal.BlendMode.BLEND_TRANSLUCENT):
    asset = material(name, MAT.MSM_UNLIT, blend, two_sided=True)
    uv = expression(asset, unreal.MaterialExpressionTextureCoordinate)
    color = expression(asset, unreal.MaterialExpressionVertexColor)
    fade = parameter(asset, "Flash", 1) if name == "M_Lightning" else number(asset, 1.)
    eye = expression(asset, unreal.MaterialExpressionEyeAdaptation)
    inputs = {"UV": uv, "Strength": (color, "A"), "Flash": fade, "Eye": eye}
    assign(shader(asset, alpha_code, inputs, OUTPUT.CMOT_FLOAT1), PROP.MP_OPACITY)
    assign(shader(asset, luminosity, inputs, OUTPUT.CMOT_FLOAT3, 250), PROP.MP_EMISSIVE_COLOR)
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
    for role, name in (("Day", "kloofendal_48d_partly_cloudy_puresky"),
                       ("Evening", "qwantani_sunset_puresky"), ("Storm", "wasteland_clouds_puresky")):
        image = import_texture(source / "skies", name, "color")
        image.set_editor_property("max_texture_size", 8192)
        ASSETS.save_loaded_asset(image, only_if_is_dirty=False)
        inputs[role] = expression(asset, unreal.MaterialExpressionTextureObject, texture=image)
    sky = shader(asset, """
        float3 gaze = normalize(-EyeVector);
        float u = atan2(gaze.y,gaze.x) * .15915494 + T*.000011;
        float latitude = asin(clamp(gaze.z,-1,1))*.63661977;
        float v = .5 - sign(latitude)*pow(abs(latitude),.72)*.5;
        float3 photograph = Texture2DSample(Day,DaySampler,float2(frac(u+.55),v)).rgb;
        float saturation = (max(max(photograph.r,photograph.g),photograph.b)-min(min(photograph.r,photograph.g),photograph.b));
        float3 day = photograph * lerp(float3(.75,.93,1.02),float3(.53,.81,1.1),smoothstep(.10,.48,saturation)) * 6180;
        float3 evening = Texture2DSample(Evening,EveningSampler,float2(frac(u+.16),v)).rgb * 2100;
        float3 storm = Texture2DSample(Storm,StormSampler,float2(frac(u+.55),v)).rgb;
        float gray = dot(storm,float3(.2126,.7152,.0722));
        storm = lerp(storm,gray.xxx,.73) * float3(290,330,385);
        float total = dot(Weights,float3(1,1,1));
        float3 panorama = (day*Weights.r + evening*Weights.g + storm*Weights.b)/max(total,.001);
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
        float3 canvas = float3(.57,.57,.52)*(.89+.12*sin(floor(panel)*29.72)+wrinkle)
                        *translucency*(1-.29*radial)*age;
        return lerp(canvas,float3(.21,.25,.24),edge*.78);
        """, {"UV": uv}, OUTPUT.CMOT_FLOAT3)
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
    assign(number(asset,.79),PROP.MP_ROUGHNESS)
    assign(number(asset,.58),PROP.MP_OPACITY)
    time = expression(asset, unreal.MaterialExpressionTime)
    flutter = shader(asset, """
        float free = sin(saturate(UV.y)*3.1415926) * smoothstep(.16,1,UV.x);
        return float3(1.2,1.1,.26) * free * sin(T*5.1-UV.y*15.8+UV.x*11);
        """, {"UV": uv, "T": time}, OUTPUT.CMOT_FLOAT3)
    asset.set_editor_property("max_world_position_offset_displacement", 4)
    assign(flutter, PROP.MP_WORLD_POSITION_OFFSET)
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
    assign(shader(asset, "return lerp(.17,.34,smoothstep(-8,38,P.z));",
                  {"P":local}, OUTPUT.CMOT_FLOAT1), PROP.MP_ROUGHNESS)
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
        float3 weathered = lerp(float3(.018,.043,.016),float3(.094,.135,.038),saturate(luma*2.8));
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


def dolphin_skin(name, tint, roughness):
    asset = material(name)
    world = expression(asset, unreal.MaterialExpressionWorldPosition)
    uv = expression(asset, unreal.MaterialExpressionTextureCoordinate)
    time = expression(asset, unreal.MaterialExpressionTime)
    phase = expression(asset, unreal.MaterialExpressionScalarParameter, parameter_name="SwimPhase",
                       use_custom_primitive_data=True, primitive_data_index=0)
    illumination = caustics(asset, world)
    base = shader(asset, """
        float countershade = lerp(.58,1.2,smoothstep(.32,.75,UV.y));
        return saturate(Tint * countershade * (1+Focus*5.5));
        """, {"Tint": number(asset, tint), "Focus": illumination, "UV": uv}, OUTPUT.CMOT_FLOAT3)
    bend = shader(asset, """
        float stroke = sin(T*7.65 + Phase - UV.x*4.0);
        return float3(0,0,stroke * 36 * pow(saturate(UV.x),2.6));
        """, {"UV": uv, "T": time, "Phase": phase}, OUTPUT.CMOT_FLOAT3)
    asset.set_editor_property("max_world_position_offset_displacement", 39)
    assign(base, PROP.MP_BASE_COLOR)
    assign(bend, PROP.MP_WORLD_POSITION_OFFSET)
    downwelling = shader(asset, """
        // Diffuse skylight and refracted sunlight reach the skin below the water shadow.
        float sky = dot(Light,float3(.21,.72,.07));
        float dorsal = .38+.62*saturate(N.z*.7+.3);
        return Tint*sky*dorsal*(.026+.115*Focus)*float3(.74,.97,1.06);
        """, {"Tint":number(asset,tint), "Focus":illumination,
              "N":expression(asset,unreal.MaterialExpressionPixelNormalWS),
              "Light":expression(asset,unreal.MaterialExpressionSkyAtmosphereLightIlluminance)}, OUTPUT.CMOT_FLOAT3)
    assign(downwelling, PROP.MP_EMISSIVE_COLOR)
    assign(number(asset, roughness), PROP.MP_ROUGHNESS)
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
        "ground": ("M_CoastalGround", lambda _: ground(maps())),
        "water": ("M_CoralWater", lambda _: water(source)),
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
        "wood": ("M_CoastalTimber", lambda name: pbr(name, maps()["wooden_planks"])),
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
        "dolphin_body": ("M_DolphinSkin", lambda name: dolphin_skin(name, (.145,.18,.19), .26)),
        "dolphin_white": ("M_DolphinBelly", lambda name: dolphin_skin(name, (.29,.32,.32), .27)),
        "dolphin_material": ("M_DolphinEye", lambda name: dolphin_skin(name, (.005,.007,.009), .15)),
        "dolphin_mouth": ("M_DolphinMouth", lambda name: dolphin_skin(name, (.021,.027,.030), .38)),
        "rain": ("M_SquallRain", lambda name: transparent_effect(name, """
            return Strength * pow(saturate(1-abs(UV.x*2-1)),1.8) * sin(UV.y*3.14159) * .36;
            """, "return float3(.35,.45,.52) / max(Eye, .00001);")),
        "lightning": ("M_Lightning", lambda name: transparent_effect(name, """
            float x = abs(UV.x*2-1); return Strength*Flash*(exp(-x*x*25)*.24 + exp(-x*x*136)*.76);
            """, "return float3(12000,31000,75000);", unreal.BlendMode.BLEND_ADDITIVE)),
    }
    for piece in ("ship_bridge", "ship_hull", "ship_containers", "skipper"):
        builders[piece] = (f"M_{piece.title().replace('_', '')}",
                           lambda name, piece=piece: pbr(name, baked_maps(source, piece), arm=True))
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
