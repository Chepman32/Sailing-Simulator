"""Author the Coral Pass material graphs in the Unreal Editor."""

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
    path = png if png.is_file() else directory / f"{name}.jpg"
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
    if semantic == "normal":
        texture.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
        texture.set_editor_property("srgb", False)
    if semantic == "linear":
        texture.set_editor_property("srgb", False)
    ASSETS.save_loaded_asset(texture, only_if_is_dirty=False)
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
        float3 light = float3(.19,.29,.044);
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
    assign(number(asset, (0.17, 0.27, 0.045)), PROP.MP_SUBSURFACE_COLOR)
    assign(number(asset, 0.64), PROP.MP_ROUGHNESS)
    assign(number(asset, 0.69), PROP.MP_OPACITY)
    assign(wpo, PROP.MP_WORLD_POSITION_OFFSET)
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
    volcano = number(asset, (VOLCANO_X*.001, VOLCANO_Y*.001, VOLCANO_RIM*.001 - .017))
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
        float cloud = mass * pillar * Density * 19;

        float3 q = p - Summit;
        float ash = 0;
        if (dot(q.xy,q.xy) < .66 && q.z > -.015 && q.z < 1.63) {
            float z = max(q.z, 0);
            float2 plume = q.xy - float2(.11,.52) * z * z
                - float2(sin(q.z*11 - T*.43), cos(q.z*13 - T*.42)) * (.006+.041*z);
            float width = .030 + .225*pow(z,.84) + .13*smoothstep(.68,1.38,z);
            float3 scroll = q - float3(0,0,T*.012);
            float billows = Texture3DSampleLevel(Noise,NoiseSampler,frac(scroll*float3(3.9,3.9,2.8)+.37),0).r;
            float curls = Texture3DSampleLevel(Noise,NoiseSampler,frac(scroll*float3(11,11,9)+.72),0).r;
            float cauliflower = (billows-.47)*1.26 + (curls-.51)*.41;
            float edge = 1 - length(plume)/width + cauliflower;
            ash = 18.0 * smoothstep(.06,.5,edge) * smoothstep(-.015,.007,q.z) * (1-smoothstep(1.10,1.63,z));
        }
        float collar = exp(-pow((q.z+.141 + .011*sin(q.x*17))/.012,2));
        cloud += collar * smoothstep(.49,.74,shape+.11*sin(q.y*24)) * exp(-dot(q.xy,q.xy)*12) * .022;
        return float2(cloud, ash);
        """, {"Position": position, "T": time, "Noise": noise, "Coverage": coverage,
              "Density": density, "Summit": volcano}, OUTPUT.CMOT_FLOAT2)
    assign(shader(asset, "return Air.x + Air.y;", {"Air": densities}, OUTPUT.CMOT_FLOAT1), PROP.MP_SUBSURFACE_COLOR)
    assign(shader(asset, "return lerp(float3(.94,.965,.99),float3(.21,.196,.18),saturate(Air.y*4));",
                  {"Air": densities}, OUTPUT.CMOT_FLOAT3), PROP.MP_BASE_COLOR)
    emissive = shader(asset, """
        float3 d = Position * .00001 - StrikeOrigin;
        float local = exp(-dot(d*d, float3(.58,.58,1.1)));
        float3 q = Position * .00001 - Summit;
        float furnace = exp(-max(q.z,0)*59 - dot(q.xy,q.xy)*850) * (.85 + .15*sin(T*2.7));
        return float3(.30,.56,1.0) * (Air.x+Air.y) * Flash * local * 520
             + float3(4400,910,138) * furnace * saturate(Air.y*.4);
        """, {"Position": position, "StrikeOrigin": origin, "Air": densities,
              "Flash": glow, "Summit": volcano, "T": time}, OUTPUT.CMOT_FLOAT3)
    assign(emissive, PROP.MP_EMISSIVE_COLOR)
    expression(asset, unreal.MaterialExpressionVolumetricAdvancedMaterialOutput, x=-100, y=360,
               multi_scattering_approximation_octave_count=1, const_phase_g=.42,
               ground_contribution=True, ray_march_volume_shadow=False)
    EDIT.set_material_usage(asset, unreal.MaterialUsage.MATUSAGE_VOLUMETRIC_CLOUD)
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
float3 sea = s.Wave(Wave0,p,Grid.x,CrestShape) + s.Wave(Wave1,p,Grid.x,CrestShape)
           + s.Wave(Wave2,p,Grid.x,CrestShape) + s.Wave(Wave3,p,Grid.x,CrestShape)
           + s.Wave(Wave4,p,Grid.x,CrestShape) + s.Wave(Wave5,p,Grid.x,CrestShape)
           + s.Wave(Wave6,p,Grid.x,CrestShape) + s.Wave(Wave7,p,Grid.x,CrestShape);
"""


def water():
    asset = material("M_CoralWater", MAT.MSM_SINGLE_LAYER_WATER)
    asset.set_editor_property("tangent_space_normal", False)
    world = expression(asset, unreal.MaterialExpressionWorldPosition,
                       world_position_shader_offset=unreal.WorldPositionIncludedOffsets.WPT_EXCLUDE_ALL_SHADER_OFFSETS)
    uv = expression(asset, unreal.MaterialExpressionTextureCoordinate)
    time = parameter(asset, "SeaTime", 0)
    scale = parameter(asset, "SeaScale", 1)
    wave_inputs = {"Position": world, "Grid": uv, "CrestShape": parameter(asset, "CrestShape", .27)}
    for i in range(8):
        name = f"Wave{i}"
        vector = expression(asset, unreal.MaterialExpressionVectorParameter, y=i * 125,
                            parameter_name=name, default_value=unreal.LinearColor(0, 0, 0, 0))
        append = expression(asset, unreal.MaterialExpressionAppendVector, x=-240, y=i * 125)
        link(vector, append, "A")
        link(vector, append, "B", "A")
        wave_inputs[name] = append
    offset = shader(asset, WAVE_MATH + "return float3(0,0,100*sea.x);", wave_inputs, OUTPUT.CMOT_FLOAT3)
    normal = shader(asset, WAVE_MATH + """
        struct Ripples {
            float2 Capillary(float2 p, float2 d, float f, float rate, float amplitude, float footprint, float t) {
                float aa = 1 - smoothstep(.17, .64, footprint * f);
                float phase = dot(p,d)*f + rate*t + .65*sin(dot(p, float2(-d.y,d.x))*f*.28 - .49*t);
                return d * cos(phase) * (amplitude * aa);
            }
        };
        Ripples r;
        float px = max(length(ddx(p)), length(ddy(p)));
        float2 drift = p + .23*float2(sin(p.y*.62 + cos(p.x*.31) - .24*SeaTime),
                                    sin(p.x*.40 + sin(p.y*.54) - .31*SeaTime));
        float2 ripple = r.Capillary(drift,float2(.92,.39),3.1,-4.1,.087,px,SeaTime)
             + r.Capillary(drift,float2(.57,.82),5.9,-5.4,.075,px,SeaTime)
             + r.Capillary(drift,float2(-.20,.98),10.2,-6.8,.067,px,SeaTime)
             + r.Capillary(drift,float2(.96,-.28),18.1,-9.8,.052,px,SeaTime)
             + r.Capillary(drift,float2(.13,-.99),28.4,-12.4,.047,px,SeaTime)
             + r.Capillary(drift,float2(.73,.68),44.0,-16.5,.039,px,SeaTime);
        float gust = .72 + .28*sin(p.x*.37 - p.y*.43 + sin(p.y*.67 - SeaTime*.32));
        float storm = saturate((SeaScale-1)/1.3);
        float2 grid = floor(p*1.8);
        float seed = frac(sin(dot(grid,float2(12.9898,78.233)))*43758.5453);
        float2 splash = frac(p*1.8) - (.20 + .60*float2(seed,frac(seed*5.72)));
        float age = frac(SeaTime*1.72 + seed);
        float distance = length(splash);
        float ring = smoothstep(.08,.0,abs(distance-age*.40)) * cos((distance-age*.40)*93);
        float ringAA = 1 - smoothstep(.010,.084,px);
        float2 rain = splash/max(.02,distance) * ring * ringAA * (1-age) * .13 * storm;
        return normalize(float3(-sea.yz + ripple * gust * lerp(.96,1.65,storm) + rain,1));
        """, {**wave_inputs, "SeaTime": time, "SeaScale": scale}, OUTPUT.CMOT_FLOAT3, 240)

    layout = "\n".join(f"surf = max(surf, h.Cay(p,float2({c.x},{c.y}),float2({c.length},{c.width}),{c.phase},T));" for c in CAYS)
    foam = shader(asset, WAVE_MATH + """
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
        float2 q = p + float2(.7*sin(p.y*1.3),.65*sin(p.x*1.53))*sin(T*.19);
        float ribbons = abs(sin(dot(q,float2(4.1,1.1))+sin(q.y*3.4-T)) + .78*sin(q.y*5.9-.3*T));
        float cells = (1-smoothstep(.04,.38,ribbons)) * (.42+.58*sin(p.x*2.3+p.y*1.75)*.5);
        float threshold = lerp(.70,.62,saturate((SeaScale-1)*.73));
        float crest = smoothstep(threshold-.16,threshold+.10,sea.x) * smoothstep(.13,.35,length(sea.yz));
        return saturate((surf + crest * .56) * (.31+.93*cells));
        """, {**wave_inputs, "SeaScale": scale, "T": time}, OUTPUT.CMOT_FLOAT1, 600)
    base = shader(asset, "return lerp(float3(.001,.005,.009),float3(.65,.72,.71),Foam);", {"Foam": foam}, OUTPUT.CMOT_FLOAT3)
    rough = shader(asset, """
        float2 p = Position.xy * .01;
        float gust = smoothstep(-.4,.8,sin(dot(p,float2(.43,.27)) + sin(p.y*.62- T*.69)));
        return lerp(.055+.018*gust+.055*saturate(SeaScale-1),.64,Foam);
        """, {"Foam": foam, "SeaScale": scale, "Position": world, "T": time}, OUTPUT.CMOT_FLOAT1)
    opacity = shader(asset, "return lerp(.13, .93, Foam);", {"Foam": foam}, OUTPUT.CMOT_FLOAT1)
    assign(offset, PROP.MP_WORLD_POSITION_OFFSET)
    assign(normal, PROP.MP_NORMAL)
    assign(base, PROP.MP_BASE_COLOR)
    assign(rough, PROP.MP_ROUGHNESS)
    assign(opacity, PROP.MP_OPACITY)
    assign(number(asset, .255), PROP.MP_SPECULAR)
    sun = expression(asset, unreal.MaterialExpressionSkyAtmosphereLightIlluminance)
    ambient = shader(asset, """
        // A small lift from scattered skylight remains even inside the sail's shadow.
        float daylight = saturate(dot(Light,float3(.2126,.7152,.0722)) / 68000);
        return daylight * float3(30,92,130);
        """, {"Light": sun}, OUTPUT.CMOT_FLOAT3)
    assign(ambient, PROP.MP_EMISSIVE_COLOR)
    output = expression(asset, unreal.MaterialExpressionSingleLayerWaterMaterialOutput, -95, 1190)
    for pin, value in {
        "ScatteringCoefficients": (.000032,.000163,.000245),
        "AbsorptionCoefficients": (.00375,.00099,.00042),
        "PhaseG": .21, "ColorScaleBehindWater": 0.88,
    }.items():
        link(number(asset, value), output, pin)
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
        float panels = 8.2*UV.y + .74*UV.x + .16*sin(UV.x*3.1416);
        float dist = abs(frac(panels)-.5);
        float seam = 1-smoothstep(.009,.024+fwidth(panels),dist);
        float stitch = (1-smoothstep(.002,.010+fwidth(panels),abs(dist-.032)))
                       * (.38 + .62*smoothstep(-.2,.4,cos(UV.x*1500)));
        float edge = max(smoothstep(.946,.995,UV.x),1-smoothstep(.013,.055,UV.x));
        float panelTone = .94 + .06*sin(floor(panels+.5)*13.13);
        float salt = .98 + .026*sin(dot(UV,float2(48,19))+sin(UV.y*35));
        float yarn = sin(UV.x*2440)*sin(UV.y*2760)*(1-smoothstep(.002,.009,max(fwidth(UV.x),fwidth(UV.y))));
        float3 cloth = float3(.78,.741,.64) * panelTone * salt * (1-.22*seam-.12*stitch+.014*yarn);
        return lerp(cloth,float3(.54,.556,.505),edge*.71);
        """, {"UV": uv}, OUTPUT.CMOT_FLOAT3)
    assign(base, PROP.MP_BASE_COLOR)
    assign(shader(asset, "return Color * float3(.66,.62,.56);", {"Color": base}, OUTPUT.CMOT_FLOAT3), PROP.MP_SUBSURFACE_COLOR)
    assign(number(asset, .73), PROP.MP_ROUGHNESS)
    assign(number(asset, .65), PROP.MP_OPACITY)
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
        float band = smoothstep(-.23,-.19,p.z)*(1-smoothstep(-.045,-.025,p.z));
        float3 glass = float3(.82,.845,.813) * (1-.12*weather);
        float3 dry = lerp(glass,float3(.019,.047,.060),band);
        return lerp(float3(.020,.039,.040),dry,smoothstep(-.30,-.24,p.z));
        """, {"Local": local}, OUTPUT.CMOT_FLOAT3)
    assign(base, PROP.MP_BASE_COLOR)
    assign(number(asset, .32), PROP.MP_ROUGHNESS)
    return save(asset)


def painted_masonry(name, tint, textures):
    asset = material(name)
    tex = texture_nodes(asset, textures)
    world = expression(asset, unreal.MaterialExpressionWorldPosition)
    color = shader(asset, """
        float3 p = Position*.01;
        float flow = sin(p.x*7.7 + p.y*5.4 + sin(p.z*.21)) * cos(p.x*3.0-p.y*6.1);
        float weather = lerp(.83,1.12,smoothstep(-.57,.71,flow));
        float salt = .78 + .22*smoothstep(.4,2.1,p.z);
        return Tint * lerp(.58,1.12,saturate(dot(Stone,float3(.48,.50,.50)))) * weather * salt;
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
    vertex = expression(asset, unreal.MaterialExpressionVertexColor)
    world = expression(asset, unreal.MaterialExpressionWorldPosition)
    time = expression(asset, unreal.MaterialExpressionTime)
    base = shader(asset, """
        float3 p = Position*.01;
        float details = .58 + .22*sin(p.x*.64+sin(p.y*1.1)) * cos(p.y*.791) + .19*sin(dot(p.xy,float2(1.9,-1.4)));
        float mineral = lerp(.31,.79,saturate(dot(Stone,float3(.34,.42,.39))));
        float3 basalt = float3(.080,.062,.054) * (.56+mineral) * (.72+.44*details);
        float3 scrub = lerp(float3(.029,.063,.016),float3(.122,.165,.054),smoothstep(.24,.77,details));
        return lerp(lerp(basalt,scrub,Green),float3(.075,.024,.012),saturate(Lava*2));
        """, {"Position": world, "Stone": tex["color"], "Green": (vertex, "G"), "Lava": (vertex, "B")}, OUTPUT.CMOT_FLOAT3)
    emission = shader(asset, """
        float3 p = Position*.01;
        float flow = .58+.24*sin(p.x*.41+p.y*.33+T*2.1)+.18*sin(p.z*1.11 + p.x*.6 + T*3.8);
        float radiance = pow(saturate(Lava),1.65) * flow;
        return lerp(float3(5900,450,17),float3(9600,2500,270),smoothstep(.27,.96,Lava)) * radiance;
        """, {"Position": world, "Lava": (vertex, "B"), "T": time}, OUTPUT.CMOT_FLOAT3)
    assign(base, PROP.MP_BASE_COLOR)
    assign(emission, PROP.MP_EMISSIVE_COLOR)
    assign(tex["normal"], PROP.MP_NORMAL)
    assign(tex["roughness"], PROP.MP_ROUGHNESS, "R")
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
        return saturate(Tint * countershade * (1+Focus*3.2));
        """, {"Tint": number(asset, tint), "Focus": illumination, "UV": uv}, OUTPUT.CMOT_FLOAT3)
    bend = shader(asset, """
        float stroke = sin(T*7.65 + Phase - UV.x*4.0);
        return float3(0,0,stroke * 36 * pow(saturate(UV.x),2.6));
        """, {"UV": uv, "T": time, "Phase": phase}, OUTPUT.CMOT_FLOAT3)
    asset.set_editor_property("max_world_position_offset_displacement", 39)
    assign(base, PROP.MP_BASE_COLOR)
    assign(bend, PROP.MP_WORLD_POSITION_OFFSET)
    assign(number(asset, roughness), PROP.MP_ROUGHNESS)
    return save(asset)


def wake_foam():
    asset = material("M_CoralWakeFoam", MAT.MSM_UNLIT, unreal.BlendMode.BLEND_TRANSLUCENT, two_sided=True)
    uv = expression(asset, unreal.MaterialExpressionTextureCoordinate)
    color = expression(asset, unreal.MaterialExpressionVertexColor)
    eye = expression(asset, unreal.MaterialExpressionEyeAdaptation)
    sun = expression(asset, unreal.MaterialExpressionSkyAtmosphereLightIlluminance)
    foam = shader(asset, """
        struct Froth {
            float Cells(float2 p) {
                float2 tile = floor(p);
                float2 uv = frac(p);
                float first = 2, second = 2;
                [unroll] for (int y=-1; y<=1; ++y) {
                    [unroll] for (int x=-1; x<=1; ++x) {
                        float2 shift = float2(x,y);
                        float2 v = tile + shift;
                        float2 seed = frac(sin(float2(dot(v,float2(127.1,311.7)),dot(v,float2(269.5,183.3))))*43758.5453);
                        float2 q = shift + .15 + .7*seed - uv;
                        float d = dot(q,q);
                        second = min(second,max(first,d));
                        first = min(first,d);
                    }
                }
                return sqrt(second)-sqrt(first);
            }
        };
        Froth f;
        float edge = abs(UV.x*2-1);
        float noise = sin(UV.y*3.8 + cos(UV.y*1.37)*1.6);
        float2 p = float2((UV.x + .066*noise)*6.3,UV.y*2.65+sin(UV.x*12));
        float thread = 1-smoothstep(.012,.14,f.Cells(p));
        float lace = 1-smoothstep(.02,.18,f.Cells(p*2.08 + float2(.4,1.7)));
        float broken = .51 + .49*sin(UV.y*1.37 + sin(UV.x*11)*2.1);
        float core = 1-smoothstep(.43+.14*noise,.91+.085*noise,edge);
        float head = (1-Age)*(1-smoothstep(.09,.61,edge));
        float white = saturate((thread*.75 + lace*.35 + head*.54) * (.66+.34*broken));
        float opacity = pow(Strength,.83) * core * saturate(.16 + white*.98) * lerp(1,.72,Prop);
        float3 tint = lerp(float3(.085,.39,.415),float3(.87,.96,1.0),white);
        return float4(tint, opacity);
        """, {"UV": uv, "Age": (color, "R"), "Prop": (color, "G"), "Strength": (color, "A")}, OUTPUT.CMOT_FLOAT4)
    emission = shader(asset, """
        float sunlight = smoothstep(0,22000,max(Light.r,max(Light.g,Light.b)));
        return Surface.rgb * lerp(.11,.78,sunlight) / max(Eye,.00001);
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
        "water": ("M_CoralWater", lambda _: water()),
        "leaves": ("M_PalmFronds", lambda _: foliage()),
        "cloud": ("M_CoralCloudVolume", lambda _: tropical_clouds()),
        "distant_sky": ("M_TradeWindSky", lambda _: distant_sky(source)),
        "bark": ("M_PalmBark", lambda name: pbr(name, maps()["palm_tree_bark"])),
        "rock": ("M_TidalRock", lambda name: pbr(name, maps()["coast_rocks_03"], arm=True, wet=True)),
        "boulder": ("M_Boulder", lambda name: pbr(name, maps()["boulder_01"], arm=True, wet=True)),
        "volcano": ("M_VolcanicRock", lambda _: volcano_surface(maps()["rock_face"])),
        "plaster": ("M_LighthouseStone", lambda name: painted_masonry(name, (.81,.78,.70), maps()["rock_face"])),
        "paint": ("M_LighthouseRed", lambda name: painted_masonry(name, (.62,.087,.047), maps()["rock_face"])),
        "concrete": ("M_QuayConcrete", lambda name: painted_masonry(name, (.32,.31,.25), maps()["rock_face"])),
        "lantern": ("M_LanternGlass", lambda _: lantern_glass()),
        "beacon": ("M_LighthouseBeacon", lambda name: simple(name, (.61,.33,.10), .29, emissive=(3700, 1920, 640))),
        "wood": ("M_CoastalTimber", lambda name: pbr(name, maps()["wooden_planks"])),
        "gelcoat": ("M_SaltwaterGelcoat", lambda _: gelcoat()),
        "glass": ("M_SmokedGlazing", lambda name: simple(name, (.023,.057,.069), .092, metal=.44)),
        "steel": ("M_MarineSteel", lambda name: simple(name, (.39,.46,.47), .20, metal=.84)),
        "rubber": ("M_MarineRubber", lambda name: simple(name, (.015,.022,.023), .74)),
        "sail": ("M_CoralSailcloth", lambda _: canvas()),
        "red": ("M_MarkerRed", lambda name: simple(name, (.44,.018,.008), .47, metal=.12)),
        "green": ("M_MarkerGreen", lambda name: simple(name, (.006,.19,.095), .47, metal=.12)),
        "warm": ("M_PierLamp", lambda name: simple(name, (.76,.38,.16), .24, emissive=(7,2.8,.54))),
        "foam": ("M_CoralWakeFoam", lambda _: wake_foam()),
        "dolphin_body": ("M_DolphinSkin", lambda name: dolphin_skin(name, (.075,.104,.12), .23)),
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
    result = {}
    for role, (name, build) in builders.items():
        path = f"{ROOT}/Materials/{name}"
        result[role] = ASSETS.load_asset(path) if ASSETS.does_asset_exist(path) else build(name)
    nanite = unreal.MaterialUsage.MATUSAGE_NANITE
    instances = unreal.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES
    for role in ("ground", "leaves", "bark", "rock", "boulder", "volcano"):
        asset = result[role]
        required = (nanite, instances) if role in ("leaves", "bark") else (nanite,)
        missing = [usage for usage in required if not EDIT.has_material_usage(asset, usage)]
        if missing:
            for usage in missing:
                EDIT.set_material_usage(asset, usage)
            save(asset)
    return result
