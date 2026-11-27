"""Author the Coral Pass material graphs in the Unreal Editor."""

import json
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
WATER_EXTINCTION_CM = (.00384, .00103, .00068)
FOAM_ALBEDO = (.80, .86, .90)
FOAM_DIFFUSE_SHARE = .25
FOAM_GRAIN_SCALE = 24.


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
    if semantic == "height" and texture.get_editor_property("compression_settings") != unreal.TextureCompressionSettings.TC_GRAYSCALE:
        texture.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_GRAYSCALE)
    if semantic in ("normal", "linear", "height") and texture.get_editor_property("srgb"):
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
             "roughness": sampler.SAMPLERTYPE_LINEAR_COLOR, "opacity": sampler.SAMPLERTYPE_LINEAR_GRAYSCALE}
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


def pbr(name, textures, arm=False, wet=False, two_sided=False, rain_on_timber=False, skin=False):
    asset = material(name, MAT.MSM_SUBSURFACE_PROFILE if skin else MAT.MSM_DEFAULT_LIT, two_sided=two_sided)
    nodes = texture_nodes(asset, textures)
    color = nodes["color"]
    rough, channel = nodes["roughness"], "G" if arm else "R"
    if wet:
        world = expression(asset, unreal.MaterialExpressionWorldPosition)
        submerged_specular(asset,world)
        wet_line = shader(asset, ROCK_MODEL + """
            float3 p=P*.01;
            [branch] if (p.z<-.90 || p.z>1.6) return p.z<0 ? 1 : 0;
            SailingWaterMath w;
            float4 coast=w.Coast(p.x,p.y);
            [branch] if (coast.x<=-8 || coast.x>=38) return 1-smoothstep(-.24,.48,p.z);
            TidalRocks rocks;
            float4 bend, flow=rocks.Read(RockFlow,p.xy,coast.w,bend);
            float2 unused;
            float4 wash=rocks.Wash(RockWash,RockWashSampler,w.RockTile(p.x,p.y,coast.w),T,unused,false);
            float index=w.ProfileIndex(coast.x);
            int2 i=int2((int)index,2*(int)coast.w);
            float4 a=Profile.Load(int3(i,0)), b=Profile.Load(int3(i+int2(1,0),0));
            float4 da=Profile.Load(int3(i+int2(0,1),0)), db=Profile.Load(int3(i+1,0));
            float clock=T+w.Peel(p.x,p.y,coast.w).x+flow.x;
            float level=w.Roller(coast.x,clock,Scale,coast.w,a,b,da,db,frac(index)).x
                       +.84*sqrt(min(Scale,2.5))*w.BoreWindow(coast.x).x*wash.x;
            float behind=w.Roller(coast.x,clock-.82,Scale,coast.w,a,b,da,db,frac(index)).x;
            float wet=smoothstep(-.065,.025,level-p.z);
            float draining=smoothstep(-.08,.06,behind-p.z)*(.53+.18*wash.a);
            return max(wet,draining);
            """,{"P":world,"T":parameter(asset,"SeaTime",0),"Scale":parameter(asset,"SeaScale",1),
                 "RockFlow":survey_texture(asset,"RockFlow"),"RockWash":survey_texture(asset,"RockWash"),
                 "Profile":survey_texture(asset,"SurfProfile")},OUTPUT.CMOT_FLOAT1)
        color = shader(asset,"return Albedo*lerp(1.,.54,Wet);",{"Albedo":color,"Wet":wet_line},OUTPUT.CMOT_FLOAT3)
        rough = shader(asset,"return lerp(Value,.16+.20*Value,Wet);",
                       {"Value":(rough,channel),"Wet":wet_line},OUTPUT.CMOT_FLOAT1,180)
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
        if not skin:
            assign(nodes["roughness"], PROP.MP_METALLIC, "B")
    if skin:
        assign(number(asset, .78), PROP.MP_OPACITY)
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
    float3 ray = refract(-SunDir,float3(0,0,1),1./1.333);
    float2 p = m.xy - ray.xy*(depth/max(.22,-ray.z));
    p += .32*float2(sin(p.y*1.66 - T*.83), cos(p.x*1.73 - T*.92));
    float a = sin(p.x*6.7 + sin(p.y*4.9 + T*.96)*.91 - T*1.9);
    float b = cos(p.y*6.3 + sin(p.x*4.3 - T*.75)*.87 + T*1.47);
    float c = abs(a + b + .33*sin(dot(p,float2(4.5,-5.4)) - T*1.2));
    float focus = (1 - smoothstep(.014,.21,c)) * (.38 + .62*abs(a*b));
    return focus * smoothstep(.02,.45,depth) * exp(-depth*.25) * (1-smoothstep(2,8,depth))
                 * smoothstep(.02,.22,SunDir.z);
"""


def caustics(asset, world):
    time = expression(asset, unreal.MaterialExpressionTime)
    sun = expression(asset, unreal.MaterialExpressionSkyAtmosphereLightDirection)
    return shader(asset, CAUSTICS, {"Position": world, "T": time, "SunDir": sun}, OUTPUT.CMOT_FLOAT1, 650)


def underwater_optics(name):
    asset = material(name, MAT.MSM_UNLIT)
    asset.set_editor_property("material_domain", unreal.MaterialDomain.MD_POST_PROCESS)
    asset.set_editor_property("blendable_location", unreal.BlendableLocation.BL_SCENE_COLOR_BEFORE_BLOOM)
    scene = expression(asset, unreal.MaterialExpressionSceneTexture,
                       scene_texture_id=unreal.SceneTextureId.PPI_POST_PROCESS_INPUT0)
    depth = expression(asset, unreal.MaterialExpressionSceneTexture,
                       scene_texture_id=unreal.SceneTextureId.PPI_SCENE_DEPTH)
    color = shader(asset, """
        float3 ray = -normalize(ViewRay);
        float meters = min(110., DepthCm.r*.01/max(.15,dot(ray,ResolvedView.ViewForward)));
        // On an upward ray only the segment below the interface scatters light.
        if (ray.z > .014) meters = min(meters,(EyeDepth+.18)/ray.z);
        float murk = lerp(1.,1.9,Weather) * (1+.24*smoothstep(4.,21.,EyeDepth));
        float3 transmission = exp(-meters*murk*float3(.255,.092,.053));
        float3 waterLight = Lighting * exp(-EyeDepth*.057) * float3(.077,.257,.418);
        float3 fromSun = refract(-SunDir,float3(0,0,1),1./1.333);
        float sunUp = smoothstep(.013,.21,SunDir.z);
        float phase = .72+.28*pow(saturate(dot(ray,-fromSun)),5)*sunUp;
        float3 scene = Image.rgb;
        float shafts = 0.;
        [branch] if (Detail > .5)
        {
            // Suspended material softens the far field without blurring close
            // objects like the swimmer's bubbles or the rock beside the camera.
            float diffusion = smoothstep(5.,32.,meters*murk);
            [branch] if (diffusion > .02)
            {
                float2 uv = GetDefaultSceneTextureUV(Parameters,PPI_PostProcessInput0);
                float2 tap = PixelSize*(.65+1.55*diffusion);
                float3 soft = SceneTextureLookup(Parameters,uv+tap*float2(.82,.57),PPI_PostProcessInput0,true).rgb
                            + SceneTextureLookup(Parameters,uv-tap*float2(.82,.57),PPI_PostProcessInput0,true).rgb
                            + SceneTextureLookup(Parameters,uv+tap*float2(-.57,.82),PPI_PostProcessInput0,true).rgb
                            + SceneTextureLookup(Parameters,uv-tap*float2(-.57,.82),PPI_PostProcessInput0,true).rgb;
                scene = lerp(scene,.25*soft,.44*diffusion);
            }
            // Project each sample in the water column back along the refracted
            // light direction. As the surface moves, the illuminated columns bend.
            float reach = min(meters,26.);
            [branch] if (sunUp > .01 && reach > .45)
            {
                int samples = Detail > 1.5 ? 14 : 8;
                [loop] for (int i=0; i<samples; ++i)
                {
                    float along = reach*(i+.5)/samples;
                    float z = max(0.,EyeDepth-along*ray.z);
                    float2 p = Eye.xy*.01 + along*ray.xy - fromSun.xy*z/max(.2,-fromSun.z);
                    p += .22*float2(sin(p.y*.8-T*.77),cos(p.x*.9-T*.62));
                    // Broad groups of converging surface facets cast distinct
                    // moving shafts, with darker channels between them.
                    float group = .5+.5*cos(.31*p.x+.14*p.y+.46*sin(.3*p.y)-T*.26);
                    float cells = abs(sin(dot(p,float2(.74,.46))+T*.79)
                                + .83*cos(dot(p,float2(-.63,.86))-T*.53));
                    float focus = (1.-smoothstep(.08,.48,cells))*smoothstep(.16,.88,group);
                    shafts += focus*exp(-.094*z-.064*along);
                }
                shafts *= (.78+2.4*pow(saturate(dot(ray,-fromSun)),4))*sunUp
                          * (1.-exp(-reach*.13))*(1.-.6*Weather)/samples;
            }
        }
        float3 volume = waterLight*phase*(1.-transmission);
        volume += Lighting * float3(.070,.224,.245) * shafts;
        return lerp(Image.rgb,scene*transmission + volume,smoothstep(.025,.36,EyeDepth));
        """, {"Image": (scene, "Color"), "PixelSize": (scene,"InvSize"), "DepthCm": (depth,"Color"),
              "ViewRay": expression(asset,unreal.MaterialExpressionCameraVectorWS),
              "Eye": expression(asset,unreal.MaterialExpressionCameraPositionWS),
              "T": expression(asset,unreal.MaterialExpressionTime),
              "EyeDepth": parameter(asset,"EyeDepth",0), "Weather": parameter(asset,"Turbidity",0),
              "Detail": parameter(asset,"VolumeDetail",1), "Lighting": parameter(asset,"WaterLight",2500),
              "SunDir": expression(asset,unreal.MaterialExpressionSkyAtmosphereLightDirection)}, OUTPUT.CMOT_FLOAT3)
    assign(color, PROP.MP_EMISSIVE_COLOR)
    return save(asset)


def forest_floor_maps(source):
    name = "forest_leaves_04"
    folder = source / name
    normal = import_texture(folder, f"{name}_nor_gl_4k", "normal")
    normal.set_editor_property("flip_green_channel", True)
    ASSETS.save_loaded_asset(normal)
    return {"color": import_texture(folder, f"{name}_diff_4k", "color"), "normal": normal,
            "roughness": import_texture(folder, f"{name}_rough_4k", "linear")}


def ground(textures, litter_maps):
    asset = material("M_CoastalGround", MAT.MSM_CLEAR_COAT)
    sand = texture_nodes(asset, textures["aerial_beach_01"])
    stone = texture_nodes(asset, textures["rock_face"])
    litter = texture_nodes(asset, litter_maps)
    paint = expression(asset, unreal.MaterialExpressionVertexColor)
    world = expression(asset, unreal.MaterialExpressionWorldPosition)
    # The islands' tidal flats are sand. Rock outcrops use scanned geometry
    # with their own materials. Coarse terrain colours must not bleed those
    # upland and deep-bed pigments onto the flooded sand.
    substrate = shader(asset, """
        float flat=smoothstep(-420.,-140.,P.z)*(1.-smoothstep(52.,145.,P.z));
        return 1.-flat;
        """, {"P":world}, OUTPUT.CMOT_FLOAT1)
    rock_weight = shader(asset,"return Paint*Substrate;",{"Paint":(paint,"R"),"Substrate":substrate},OUTPUT.CMOT_FLOAT1)
    grass_weight = shader(asset,"return Paint*Substrate;",{"Paint":(paint,"G"),"Substrate":substrate},OUTPUT.CMOT_FLOAT1)
    stone_uv = shader(asset, """
        float2 p = P.xy*.01 + P.z*.0017*float2(.7,-.54);
        return p*.32+.16*float2(cos(p.y*.59),sin(p.x*.47));
        """, {"P":world}, OUTPUT.CMOT_FLOAT2)
    for node in stone.values():
        link(stone_uv,node,"UVs")
    litter_uv = shader(asset, "return P.xy / 150.;", {"P": world}, OUTPUT.CMOT_FLOAT2)
    for node in litter.values():
        link(litter_uv, node, "UVs")
    forest = shader(asset, """
        float patch = .85+.15*sin(P.x*.0026+sin(P.y*.006))*cos(P.y*.0021);
        return patch*smoothstep(.16,.63,Grass)*smoothstep(150.,330.,P.z)*(1.-.93*Rock);
        """, {"P": world, "Grass": (paint, "G"), "Rock": (paint, "R")}, OUTPUT.CMOT_FLOAT1)
    submerged_specular(asset,world)
    light = caustics(asset, world)
    swash = shader(asset, ROCK_MODEL + """
        float3 p = P*.01;
        if (p.z < -.65) return float4(1,0,0,0);
        if (p.z > 1.45) return 0;
        SailingWaterMath water;
        float4 coast = water.Coast(p.x,p.y);
        if (abs(coast.x)>13) return float4(1-smoothstep(-.2,.6,p.z),0,0,0);
        TidalRocks rocks;
        float4 bend;
        float t = T+water.Peel(p.x,p.y,coast.w).x+rocks.Read(RockFlow,p.xy,coast.w,bend).x;
        float4 tip = water.SwashTip(t,Scale,coast.w);
        float last = water.SwashTip(t-tip.z,Scale,coast.w).x;
        float shore = 1-smoothstep(.23,.78*sqrt(Scale)+.16,p.z);
        float d = coast.x-tip.x;
        float wash = smoothstep(-.06,.26,d)*shore;
        float passed = smoothstep(.13,2.1,tip.x-last);
        float seep = exp(-.20*tip.z)*smoothstep(-.16,.47,coast.x-last)*shore;
        // The thin film drains through channels in the sand. The high-water
        // mark stays damp while individual fingers still reflect the sky.
        float2 offshore = normalize(coast.yz+float2(.00001,0));
        float2 grain = p.xy + .14*float2(sin(p.y*2.2),cos(p.x*2.5));
        float channel = .5+.5*sin(dot(grain,float2(-offshore.y,offshore.x))*5.3+sin(p.x*.61));
        float film = max(wash*.72, seep*passed*(1-smoothstep(.15,2.1+1.7*channel,-d)));
        // Focus the transmitted light on the bed. At the thin leading edge the
        // optical path vanishes, so the dry grains keep their diffuse colour.
        float path=wash*saturate((.14*wash-p.z)/.14);
        float2 ray=p.xy + path*.13*float2(sin(p.y*5.1+t*1.7),cos(p.x*4.2-t*1.6));
        float lenses=sin(ray.x*10.3+sin(ray.y*8.6-t*.7)+t*.88)
                   +cos(ray.y*13.2+.83*sin(ray.x*6.7+t*.91)-t*1.33);
        float focus=path*(1.-smoothstep(.01,.17,abs(lenses)))*(.35+.65*channel);
        return float4(max(wash,.91*seep),film,0,focus);
        """, {"P": world, "T": parameter(asset,"SeaTime",0), "Scale": parameter(asset,"SeaScale",1),
              "RockFlow":survey_texture(asset,"RockFlow")}, OUTPUT.CMOT_FLOAT4)
    rain = parameter(asset,"RainWetness",0)
    base = shader(asset, """
        float3 p = Position * 0.01;
        float damp = max(Rain*.78,max(.23*(1-smoothstep(0,1.35,p.z)),Wash.x));
        float3 grains=lerp(Sand,float3(.46,.38,.26),.15*(1-smoothstep(.1,1.,p.z)));
        float3 beach = grains * lerp(float3(.87,.85,.74),float3(.59,.49,.36),damp);
        beach *= 1.+.12*Wash.w;
        float mottling = 0.73 + 0.27 * sin(p.x*0.81 + sin(p.y*0.67)) * sin(p.y*0.56);
        float blade = dot(Sand,float3(.22,.68,.10));
        float3 grass = lerp(float3(.020,.078,.018),float3(.065,.182,.029), saturate(blade*2)) * mottling;
        float3 ground = lerp(lerp(beach, grass, smoothstep(.06,.88,Vegetation)), Stone * float3(1.26,1.19,1.04), Rock * .88);
        float3 humus = Litter * float3(.69,.76,.62) * (1-.31*Rain);
        return saturate(lerp(ground * (1-.19*Rain*max(Rock,Vegetation)), humus, Forest) * (1 + Light * .66));
        """, {"Position": world, "Sand": sand["color"], "Stone": stone["color"],
              "Vegetation": grass_weight, "Rock": rock_weight, "Light": light, "Wash": swash,
              "Rain":rain, "Forest":forest, "Litter":litter["color"]}, OUTPUT.CMOT_FLOAT3)
    rough = shader(asset, """
        float dry = lerp(saturate(Sand*.75+.19), Stone, Rock);
        float substrate=lerp(lerp(dry,.31+.15*Sand,max(Wash.x,.78*Rain)),.23+.10*Sand,Wash.y);
        return lerp(substrate,lerp(clamp(Litter,.48,.90),.28,Rain*.85),Forest);
        """, {"Wash": swash, "Rain":rain, "Sand": (sand["roughness"], "R"), "Stone": (stone["roughness"], "R"),
              "Rock": rock_weight, "Forest": forest, "Litter": (litter["roughness"], "R")}, OUTPUT.CMOT_FLOAT1, 240)
    normals = shader(asset, """
        float3 mineral=lerp(Sand,Stone,Rock*.84);
        mineral.xy*=lerp(.52-.45*Wash.y,1.,Rock);
        return normalize(lerp(mineral,Litter,Forest));
        """,
                     {"Sand": sand["normal"], "Stone": stone["normal"], "Rock": rock_weight,
                      "Litter": litter["normal"], "Forest": forest, "Wash": swash}, OUTPUT.CMOT_FLOAT3, 470)
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
    # A drained patch retains a dark, rough substrate after the smooth surface
    # film has broken. Only the sheet still present carries the sky reflection.
    finish = shader(asset,"return float3(lerp(R,.34,Wash.y),.34*Wash.y,.15+.12*(1-Wash.y));",
                    {"R":rough,"Wash":swash},OUTPUT.CMOT_FLOAT3)
    unreal.CoralMaterialAuthoring.set_coat_finish(asset,finish)
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


def coastal_weather_collection():
    name = "MPC_CoastalWeather"
    path = f"{ROOT}/Materials/{name}"
    collection = ASSETS.load_asset(path) if ASSETS.does_asset_exist(path) else TOOLS.create_asset(
        name, f"{ROOT}/Materials", unreal.MaterialParameterCollection, unreal.MaterialParameterCollectionFactoryNew())
    vectors = list(collection.get_editor_property("vector_parameters"))
    names = {str(p.get_editor_property("parameter_name")) for p in vectors}
    for name, value in {"WindAndRain": (5.,3.,0.,1.), "Walker": (0.,0.,0.,0.)}.items():
        if name not in names:
            vector = unreal.CollectionVectorParameter()
            vector.set_editor_property("parameter_name",name)
            vector.set_editor_property("default_value",unreal.LinearColor(*value))
            vectors.append(vector)
    if len(vectors) != len(names):
        collection.set_editor_property("vector_parameters",vectors)
        ASSETS.save_loaded_asset(collection)
    return collection


def shore_blades(name, submerged):
    asset = material(name, MAT.MSM_TWO_SIDED_FOLIAGE, two_sided=True)
    world = expression(asset, unreal.MaterialExpressionWorldPosition,
                       world_position_shader_offset=unreal.WorldPositionIncludedOffsets.WPT_EXCLUDE_ALL_SHADER_OFFSETS)
    leaf = expression(asset, unreal.MaterialExpressionVertexColor)
    uv = expression(asset, unreal.MaterialExpressionTextureCoordinate)
    collection = coastal_weather_collection()
    wind = expression(asset, unreal.MaterialExpressionCollectionParameter, collection=collection, parameter_name="WindAndRain")
    time = expression(asset, unreal.MaterialExpressionTime)
    base = shader(asset, """
        float rib = exp(-pow(11.*(UV.x-.50),2));
        float fibers = .5+.5*sin(PerBlade*35.8+UV.x*35.+.8*sin(UV.y*68.));
        float2 p = P.xy*.01;
        float dry = smoothstep(.27,.74,PerBlade)*smoothstep(.53,1.,UV.y);
        float3 leaf = lerp(float3(.023,.072,.014),float3(.095,.159,.028),PerBlade);
        leaf = lerp(leaf,float3(.237,.207,.079),dry*.8);
        if (Sea > .5) leaf = lerp(float3(.009,.037,.024),float3(.055,.157,.047),PerBlade);
        float mix = .71+.16*sin(dot(p,float2(.55,-.69)))+.11*fibers+.16*rib;
        return leaf*mix*(.80+.27*UV.y)*(1.-.23*Wind.z);
        """, {"P":world,"UV":uv,"PerBlade":(leaf,"R"),"Wind":wind,"Sea":number(asset,float(submerged))}, OUTPUT.CMOT_FLOAT3)
    move = shader(asset, """
        float2 m = P.xy*.01;
        float weight = Tip*Tip;
        float2 gust = Wind.xy*(.49+.24*sin(dot(m,float2(.41,-.32))-T*2.1)
                               +.14*cos(dot(m,float2(.8,.55))-T*3.4));
        float2 water = float2(10*sin(m.x*.29+m.y*.33-T*1.7),6.8*cos(m.x*.30-m.y*.25+T*1.4));
        float2 offset = lerp(gust,water,Sea);
        float2 fromWalker = m-Walker.xy;
        float near = (1.-smoothstep(.27,.85,length(fromWalker)))*Walker.w*(1.-Sea);
        near *= 1.-smoothstep(.50,1.,abs(P.z*.01-Walker.z));
        offset += 28.*near*fromWalker/max(.20,length(fromWalker));
        return weight*float3(offset,-length(offset)*(.16+.22*near));
        """, {"P":world,"Tip":(leaf,"A"),"Wind":wind,"T":time,"Sea":number(asset,float(submerged)),
              "Walker":expression(asset,unreal.MaterialExpressionCollectionParameter,
                                  collection=collection,parameter_name="Walker")}, OUTPUT.CMOT_FLOAT3)
    assign(base, PROP.MP_BASE_COLOR)
    assign(shader(asset,"return Base*.58;",{"Base":base},OUTPUT.CMOT_FLOAT3),PROP.MP_SUBSURFACE_COLOR)
    assign(move,PROP.MP_WORLD_POSITION_OFFSET)
    assign(shader(asset,"return lerp(.71,.46,Wind.z);",{"Wind":wind},OUTPUT.CMOT_FLOAT1),PROP.MP_ROUGHNESS)
    assign(number(asset,.22),PROP.MP_SPECULAR)
    asset.set_editor_property("max_world_position_offset_displacement", 52)
    return save(asset)


def reef_coral_skin(name):
    asset = material(name)
    paint = expression(asset, unreal.MaterialExpressionVertexColor)
    world = expression(asset, unreal.MaterialExpressionWorldPosition)
    focus = caustics(asset,world)
    pigment = shader(asset, """
        float3 p = P*.63;
        float pits = abs(sin(p.x+sin(p.z*.96)) + cos(p.y+cos(p.z*1.12)) + .34*sin(p.x-p.y));
        float encrust = smoothstep(.32,.75,.5+.22*sin(dot(P,float3(.059,-.062,.026)))+.20*cos(P.z*.09));
        float3 warm = lerp(float3(.232,.074,.036),float3(.43,.29,.155),Tone);
        float3 purple = lerp(float3(.18,.073,.135),float3(.34,.152,.243),Tone);
        float3 body = lerp(purple,warm,smoothstep(.18,.74,Tone));
        float3 tips = lerp(body, float3(.54,.43,.295),smoothstep(.72,.99,Tip)*.78);
        return lerp(tips,float3(.099,.124,.071),.28*encrust)*Grain*(.62+.38*smoothstep(.06,.47,pits));
        """, {"P":world,"Tone":(paint,"R"),"Tip":(paint,"G"),"Grain":(paint,"B")},OUTPUT.CMOT_FLOAT3)
    assign(shader(asset,"return .56*Pigment;",
                  {"Pigment":pigment},OUTPUT.CMOT_FLOAT3),PROP.MP_BASE_COLOR)
    filtered_sun = shader(asset, """
        float3 light = Sun*exp(-Extinction*max(0.,-P.z)/.74);
        return Pigment*light*(.054+.21*Caustic);
        """,{"Sun":expression(asset,unreal.MaterialExpressionSkyAtmosphereLightIlluminanceOnGround),
            "Pigment":pigment,"P":world,"Extinction":number(asset,WATER_EXTINCTION_CM),"Caustic":focus},OUTPUT.CMOT_FLOAT3)
    assign(filtered_sun,PROP.MP_EMISSIVE_COLOR)
    assign(number(asset,.64),PROP.MP_ROUGHNESS)
    assign(number(asset,.18),PROP.MP_SPECULAR)
    return save(asset)


def channel_beacon_material():
    name = "M_ChannelBuoyBeacon"
    path = f"{ROOT}/Materials/{name}"
    if ASSETS.does_asset_exist(path):
        return ASSETS.load_asset(path)
    asset = material(name)
    uv = expression(asset, unreal.MaterialExpressionTextureCoordinate)
    green = expression(asset, unreal.MaterialExpressionScalarParameter, parameter_name="GreenLight",
                       use_custom_primitive_data=True, primitive_data_index=0)
    phase = expression(asset, unreal.MaterialExpressionScalarParameter, parameter_name="SignalPhase",
                       use_custom_primitive_data=True, primitive_data_index=1)
    tint = shader(asset, "return lerp(float3(.95,.024,.006),float3(.025,.77,.16),Green);",
                  {"Green": green}, OUTPUT.CMOT_FLOAT3)
    lens = shader(asset, """
        float seals=1.-smoothstep(.23,.29,abs(UV.y-.5));
        return seals*(.85+.15*cos(UV.y*115.));
        """, {"UV": uv}, OUTPUT.CMOT_FLOAT1)
    assign(shader(asset, "return lerp(float3(.020,.024,.025),.18*Color,Lens);",
                  {"Color": tint, "Lens": lens}, OUTPUT.CMOT_FLOAT3), PROP.MP_BASE_COLOR)
    assign(shader(asset, "return lerp(.46,.21,Lens);", {"Lens": lens}, OUTPUT.CMOT_FLOAT1), PROP.MP_ROUGHNESS)
    assign(shader(asset, """
        float night=1.-smoothstep(-.12,.035,Sun.z);
        float pulse=1.-smoothstep(.12,.19,frac((T+Phase)/4.));
        return Color*Lens*night*pulse*6.;
        """, {"Color": tint, "Lens": lens, "Phase": phase,
              "Sun": expression(asset, unreal.MaterialExpressionSkyAtmosphereLightDirection),
              "T": expression(asset, unreal.MaterialExpressionTime)}, OUTPUT.CMOT_FLOAT3), PROP.MP_EMISSIVE_COLOR)
    return save(asset)


def downloaded_coastal_materials(source):
    folder = source / "CoastalModels"
    collection = coastal_weather_collection()
    definitions = json.loads((folder / "materials.json").read_text())
    refresh = set(os.environ.get("SAILING_REFRESH_COASTAL_MATERIALS", "").split(","))
    result = {}
    for model, slots in definitions.items():
        result[model] = {}
        buoy = model == "LateralSeaMarker"
        usages = [unreal.MaterialUsage.MATUSAGE_NANITE]
        if not buoy:
            usages.append(unreal.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES)
        for index, (slot, finish) in enumerate(slots.items()):
            name = f"M_{model}_{index}"
            path = f"{ROOT}/Materials/{name}"
            if ASSETS.does_asset_exist(path) and not ({"1", model} & refresh):
                asset = ASSETS.load_asset(path)
                missing = [usage for usage in usages if not EDIT.has_material_usage(asset, usage)]
                if missing:
                    for usage in missing:
                        EDIT.set_material_usage(asset, usage)
                    save(asset)
                result[model][slot] = asset
                continue
            textures = {kind: import_texture(folder / "Textures", texture,
                        {"roughness": "linear", "opacity": "height"}.get(kind, kind)) for kind, texture in finish["textures"].items()}
            if "normal" in textures:
                normal = textures["normal"]
                normal.set_editor_property("flip_green_channel", True)
                ASSETS.save_loaded_asset(normal)
            leaf = finish["leaf"]
            masked = "opacity" in textures
            blend = unreal.BlendMode.BLEND_MASKED if masked else unreal.BlendMode.BLEND_OPAQUE
            asset = material(name, MAT.MSM_TWO_SIDED_FOLIAGE if leaf else MAT.MSM_DEFAULT_LIT, blend, two_sided=True)
            nodes = texture_nodes(asset, textures)
            if masked:
                asset.set_editor_property("opacity_mask_clip_value", .48)
                assign(nodes["opacity"], PROP.MP_OPACITY_MASK, "R")
            if finish["uv"]:
                offset = finish["uv"].get("offset", [0., 0.])
                scale = finish["uv"].get("scale", [1., 1.])
                uv = expression(asset, unreal.MaterialExpressionTextureCoordinate)
                mapped = shader(asset, f"return UV * float2({scale[0]},{scale[1]}) + float2({offset[0]},{offset[1]});",
                                {"UV": uv}, OUTPUT.CMOT_FLOAT2)
                for node in nodes.values():
                    link(mapped, node, "UVs")
            world = expression(asset, unreal.MaterialExpressionWorldPosition)
            weather = expression(asset, unreal.MaterialExpressionCollectionParameter,
                                 collection=collection, parameter_name="WindAndRain")
            film = shader(asset, "return Weather.z;", {"Weather": weather}, OUTPUT.CMOT_FLOAT1)
            base = nodes["color"]
            rough = nodes["roughness"]
            if "normal" in nodes:
                normal = nodes["normal"]
                if finish["normal_strength"] < 1.:
                    normal = shader(asset, "return normalize(float3(N.xy*Strength,N.z));",
                                    {"N": normal, "Strength": number(asset, finish["normal_strength"])}, OUTPUT.CMOT_FLOAT3)
                assign(normal, PROP.MP_NORMAL)

            if buoy:
                green = expression(asset, unreal.MaterialExpressionScalarParameter, parameter_name="GreenPaint",
                                   use_custom_primitive_data=True, primitive_data_index=0)
                base = shader(asset, """
                    float mask=smoothstep(.025,.15,C.r-C.g)*smoothstep(.09,.25,C.r);
                    float3 paint=C.r*float3(.12,.70,.29)+C.g*.22;
                    return lerp(C, paint, Green*mask)*lerp(.68,1.,smoothstep(-30.,30.,P.z));
                    """, {"C": base, "Green": green, "P": world}, OUTPUT.CMOT_FLOAT3)
                gloss = shader(asset, """
                    float wet=max(Film,1.-smoothstep(-18.,43.,P.z));
                    return lerp(clamp(R,.16,.94),.20,.56*wet);
                    """, {"R": (rough, "G"), "Film": film, "P": world}, OUTPUT.CMOT_FLOAT1)
                assign(rough, PROP.MP_METALLIC, "B")
            else:
                variance = expression(asset, unreal.MaterialExpressionPerInstanceRandom)
                if model == "CoconutPalm":
                    base = shader(asset, """
                        float leaf=smoothstep(.003,.035,C.g-max(C.r,C.b)*.9);
                        float gray=dot(C,float3(.22,.68,.10));
                        float3 foliage=lerp(gray*float3(.80,1.,.85),C,.72)*float3(.72,.78,.83);
                        return lerp(C,foliage,leaf);
                        """, {"C": base}, OUTPUT.CMOT_FLOAT3)
                base = shader(asset, "return Color*lerp(.94,1.06,Seed)*lerp(1.,.79,Film);",
                              {"Color": base, "Seed": variance, "Film": film}, OUTPUT.CMOT_FLOAT3)
                gloss = shader(asset, "return lerp(clamp(R*Factor,.34,.94),.24,.48*Film);",
                               {"R": (rough, "G"), "Factor": number(asset, finish["roughness_factor"]),
                                "Film": film}, OUTPUT.CMOT_FLOAT1)
                paint = expression(asset, unreal.MaterialExpressionVertexColor)
                motion = shader(asset, """
                    float speed=length(Wind.xy);
                    float2 heading=Wind.xy/max(.1,speed);
                    float amplitude=saturate(speed/20.);
                    float phase=dot(P.xy,float2(.0021,.0017));
                    float gust=.65+.35*sin(Time*.92-phase)+.18*sin(Time*2.07+phase*.6);
                    float flutter=sin(Time*3.8+phase*1.4+P.z*.013);
                    float falloff=1.-smoothstep(.68*Range,Range,distance(P,Eye));
                    return float3(heading*amplitude*(13.+22.*gust),flutter*6.*amplitude)*Flex*falloff*Bend;
                    """, {"Wind": weather, "P": world, "Flex": (paint, "A"),
                          "Eye": expression(asset, unreal.MaterialExpressionCameraPositionWS),
                          "Time": expression(asset, unreal.MaterialExpressionTime), "Range": number(asset, 3800 if masked else 8000),
                          "Bend": number(asset, .24 if masked else 1.)}, OUTPUT.CMOT_FLOAT3)
                asset.set_editor_property("max_world_position_offset_displacement", 12. if masked else 48.)
                assign(motion, PROP.MP_WORLD_POSITION_OFFSET)
                if leaf:
                    glow = shader(asset, """
                        float chlorophyll=smoothstep(.004,.045,C.g-max(C.r,C.b)*.86);
                        return C*(.46*chlorophyll)*float3(.77,1.16,.64);
                        """, {"C": base}, OUTPUT.CMOT_FLOAT3)
                    assign(glow, PROP.MP_SUBSURFACE_COLOR)
                    assign(number(asset, .86), PROP.MP_OPACITY)
            assign(base, PROP.MP_BASE_COLOR)
            assign(gloss, PROP.MP_ROUGHNESS)
            if model != "CoconutPalm":
                assign(rough, PROP.MP_AMBIENT_OCCLUSION, "R")
            for usage in usages:
                EDIT.set_material_usage(asset, usage)
            result[model][slot] = save(asset)
    return result


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
    '#include "CoralPassLayout.inl"', LAYOUT.read_text()).replace('#include "CoralSurfTiles.inl"',
    (LAYOUT.parent/"CoralSurfTiles.inl").read_text()).replace("Real4", "float4").replace("Real ", "float ").replace("UInt", "uint")
ROCK_MODEL = WATER_MODEL + """
struct TidalRocks {
    // The staggered-grid bake is 8 surveyed tiles across and 64 phases down.
    float4 Wash(Texture2D atlas, SamplerState samp, float4 grid, float clock, out float2 slope, bool normals) {
        slope=0;
        [branch] if (grid.z==0) return 0;
        float phase=frac(clock*(1.16/12.56637061436))*64;
        float2 cell=float2(grid.x+128*floor(grid.y/128),fmod(grid.y,128));
        const float2 invSize=float2(1./1024.,1./8192.);
        float2 uv=(cell+.5)*invSize;
        float2 uv0=uv+float2(0,floor(phase)/64), uv1=uv+float2(0,fmod(floor(phase)+1,64)/64);
        float4 a=Texture2DSampleLevel(atlas,samp,uv0,0), b=Texture2DSampleLevel(atlas,samp,uv1,0);
        float4 wash=lerp(a,b,frac(phase));
        if (normals) {
            // Bilinear interpolation within the four texels, just as in the CPU sampler.
            int2 i=int2(floor(cell)), j=i+int2(0,128*(int)floor(phase));
            int2 k=i+int2(0,128*((1+(int)floor(phase))%64));
            float4 h0=float4(atlas.Load(int3(j,0)).r,atlas.Load(int3(j+int2(1,0),0)).r,
                             atlas.Load(int3(j+int2(0,1),0)).r,atlas.Load(int3(j+1,0)).r);
            float4 h1=float4(atlas.Load(int3(k,0)).r,atlas.Load(int3(k+int2(1,0),0)).r,
                             atlas.Load(int3(k+int2(0,1),0)).r,atlas.Load(int3(k+1,0)).r);
            float4 h=lerp(h0,h1,frac(phase));
            slope=grid.z*(255./128.)*float2(lerp(h.y-h.x,h.w-h.z,frac(cell.y)),lerp(h.z-h.x,h.w-h.y,frac(cell.x)));
        }
        return float4((wash.rgb*255.-128.)/float3(128,48,48),wash.a);
    }
    float4 Read(Texture2D atlas, float2 p, float row, out float4 slope) {
        SailingWaterMath w;
        float4 grid = w.RockTile(p.x,p.y,row);
        slope=0;
        [branch] if (grid.z==0) return 0;
        int2 i=int2(grid.xy);
        float2 f=frac(grid.xy);
        float4 a=atlas.Load(int3(i,0)), b=atlas.Load(int3(i+int2(1,0),0));
        float4 c=atlas.Load(int3(i+int2(0,1),0)), d=atlas.Load(int3(i+1,0));
        slope=grid.z*float4(lerp(b.x-a.x,d.x-c.x,f.y),lerp(c.x-a.x,d.x-b.x,f.x),
                            lerp(b.w-a.w,d.w-c.w,f.y),lerp(c.w-a.w,d.w-b.w,f.x));
        return lerp(lerp(a,b,f.x),lerp(c,d,f.x),f.y);
    }
};
"""

def survey_texture(asset, name):
    return expression(asset,unreal.MaterialExpressionTextureObjectParameter,parameter_name=name,
        texture=unreal.load_asset("/Engine/EngineResources/Black"),sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)

WAVE_MATH = ROCK_MODEL + """
struct Surface {
    float4 Wave(float2 mode, float2 k, float waveNumber, float omega, float previousAmplitude,
                float2 p, float cell, float2 history) {
        float wavelength = 6.2831853 / waveNumber;
        float amplitude = lerp(mode.x, previousAmplitude, history.y);
        float sharpness = waveNumber * amplitude;
        float a = amplitude * (1 - smoothstep(wavelength*.25, wavelength*.50, cell));
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
                     f"PrevAmp{i//4}.{'xyzw'[i%4]},p,Footprint.x,History)")
    return " + ".join(terms)


LONG_WAVES = f"""
float4 sea = {wave_terms(range(LONG_WIND_COUNT))};
float4 storm = 0;
[branch] if (SeaScale>1.6) storm = {wave_terms(range(WIND_WAVE_COUNT, WAVE_COUNT))};
""" + """
float foam = 0;
if (Coast.x <= -8) sea = 0;
else {
    if (Coast.x < 38) {
        float4 peel = water.Peel(p.x,p.y,Coast.w);
        TidalRocks rocks;
        float4 bend;
        float4 flow=rocks.Read(RockFlow,p,Coast.w,bend);
        peel.xyz+=float3(flow.x,bend.xy);
        float index=water.ProfileIndex(Coast.x);
        int2 texel=int2((int)index,2*(int)Coast.w);
        float4 lo=Profile.Load(int3(texel,0)), hi=Profile.Load(int3(texel+int2(1,0),0));
        float4 dlo=Profile.Load(int3(texel+int2(0,1),0)), dhi=Profile.Load(int3(texel+int2(1,1),0));
        float4 roller=water.Roller(Coast.x,T+peel.x,SeaScale,Coast.w,lo,hi,dlo,dhi,frac(index));
        float2 flankSlope=0;
        [branch] if (flow.w>.035) {
            float4 travel=water.Curve(lo.x,hi.x,dlo.x,dhi.x,frac(index));
            float4 bore=water.RockBore(flow.w,T+peel.x+travel.x/water.BreakerFrequency(),SeaScale,Coast.w);
            float4 gate=water.BoreWindow(Coast.x);
            roller.xyz+=gate.x*float3(bore.x,bore.z*travel.y/water.BreakerFrequency(),bore.z);
            roller.y+=gate.y*bore.x;
            flankSlope=gate.x*bend.zw*bore.y;
        }
        float2 washSlope;
        float4 wash=rocks.Wash(RockWash,RockWashSampler,water.RockTile(p.x,p.y,Coast.w),T,washSlope,true);
        float4 window=water.BoreWindow(Coast.x);
        float washSize=.84*sqrt(min(SeaScale,2.5));
        roller.x+=washSize*window.x*wash.x;
        roller.y+=washSize*window.y*wash.x;
        flankSlope+=washSize*window.x*washSlope;
        float swell = water.Swell(Coast.x);
        float lod = 1-smoothstep(2.5,6.0,Footprint.x);
        sea.yz = sea.yz*swell + Coast.yz*(roller.y*lod+sea.x*water.SwellSlope(Coast.x)) + (peel.yz*roller.z+flankSlope)*lod;
        sea.x = sea.x*swell + roller.x*lod;
        sea.w *= swell;
        foam = roller.w;
    }
    float3 transfer=water.StormTransfer(p.x,p.y,Coast,SeaScale).xyz;
    sea += storm*transfer.x;
    sea.yz += transfer.yz*storm.x;
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
    float4 h = water.HullWave(a,b,WakeSpeed,WakeBias);
    float lod = 1-smoothstep(.7,2.5,Footprint.x);
    sea.x += h.x*lod;
    sea.yz += (-dir*h.y+right*h.z)*lod;
    // A free gravity wave changes the reflecting normal without entraining air.
}
float4 rings = water.Impact(p.x-Ring0.x,p.y-Ring0.y,T-Ring0.z,Ring0.w)
             + water.Impact(p.x-Ring1.x,p.y-Ring1.y,T-Ring1.z,Ring1.w)
             + water.Impact(p.x-Ring2.x,p.y-Ring2.y,T-Ring2.z,Ring2.w)
             + water.Impact(p.x-Ring3.x,p.y-Ring3.y,T-Ring3.z,Ring3.w);
sea += rings.xyz*(1-smoothstep(.6,1.9,Footprint.x));
foam = max(foam,smoothstep(.08,.22,rings.x)*.48);
float4 whaleRings=water.WhaleRing(p.x-NearWhalePrint.x,p.y-NearWhalePrint.y,T-NearWhalePrint.z,NearWhalePrint.w)
                + water.WhaleRing(p.x-FarWhalePrint.x,p.y-FarWhalePrint.y,T-FarWhalePrint.z,FarWhalePrint.w);
sea += whaleRings.xyz*(1-smoothstep(1.6,5.,Footprint.x));
"""


TRAFFIC_WATER = WATER_MODEL + """
struct Tracks {
    float4 Sample(Texture2D chart, int row, float4 box, float2 p, float time) {
        [branch] if (any(p<box.xy) || any(p>box.zw) || box.z<=box.x) return 0;
        float2 size=chart.Load(int3(0,row,0)).rg;
        float4 m=chart.Load(int3(1,row,0)), axis=chart.Load(int3(2,row,0));
        float2 group=m.xy+.40*axis.xy*m.a*(time-m.z);
        float best=1e28, aft=0, lateral=0, speed=0, envelope=0, foam=0;
        float2 direction=0;
        [loop] for (int j=1; j<8; ++j) {
            float4 older=chart.Load(int3(1+2*j,row,0)), nextAxis=chart.Load(int3(2+2*j,row,0));
            if (nextAxis.a<=0) break;
            float2 g=older.xy+.40*nextAxis.xy*older.a*(time-older.z);
            float2 segment=g-group, offset=p-group;
            float u=saturate(dot(offset,segment)/max(.001,dot(segment,segment)));
            float2 near=offset-u*segment;
            float distance2=dot(near,near);
            if (distance2<best) {
                best=distance2;
                direction=lerp(axis.xy,nextAxis.xy,u);
                direction*=rsqrt(max(.001,dot(direction,direction)));
                float2 delta=p-lerp(m.xy,older.xy,u);
                float along=dot(delta,direction), age=time-lerp(m.z,older.z,u);
                speed=lerp(m.a,older.a,u);
                aft=speed*age-along;
                lateral=dot(delta,float2(-direction.y,direction.x));
                float span=max(2.,.42*size.x+1.3*speed);
                envelope=1.-smoothstep(.22*span,span,max(.4*speed*age-along,along-.4*speed*age-.92*size.x));
            }
            // Bubbles are carried by the slower water left behind the stern.
            // Project onto the actual emission path, independently of wave group velocity.
            float2 route=older.xy-m.xy, fromStern=p-m.xy;
            float v=saturate(dot(fromStern,route)/max(.001,dot(route,route)));
            float seconds=max(0,time-lerp(m.z,older.z,v));
            float width=.16*size.y+sqrt(seconds)*(.16+.032*size.y);
            float r=length(fromStern-v*route)/max(.24,width);
            foam=max(foam,lerp(axis.z,nextAxis.z,v)*(1-smoothstep(.18,1.,r))
                       *exp(-seconds/(1.3+.14*size.y)));
            m=older; axis=nextAxis; group=g;
        }
        SailingWaterMath w;
        float3 h=w.Kelvin(aft,lateral,speed,size.x,size.y).xyz*envelope;
        return float4(h.x,-direction*h.y+float2(-direction.y,direction.x)*h.z,foam);
    }
};
Tracks tracks;
float2 p=Position.xy*.01;
float4 sum=tracks.Sample(Map,0,B0,p,T)+tracks.Sample(Map,1,B1,p,T)+tracks.Sample(Map,2,B2,p,T);
[branch] if (all(p>=B3.xy) && all(p<=B3.zw)) {
    [loop] for (int row=3; row<11; ++row)
        sum+=tracks.Sample(Map,row,Map.Load(int3(17,row,0)),p,T);
}
return sum;
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
    waves = {"Position": world, "T": time, "SeaScale": scale,
             "History":history}
    waves["Profile"] = survey_texture(asset,"SurfProfile")
    waves["RockFlow"] = survey_texture(asset,"RockFlow")
    waves["RockWash"] = survey_texture(asset,"RockWash")
    contacts = {"Position": world, "T": time, "WakeSpeed": parameter(asset,"WakeSpeed",0),
                "WakeBias": parameter(asset,"WakeBias",0), "Footprint": grid}
    spectrum = [f"Wave{i}" for i in range(WAVE_COUNT)] + [f"PrevAmp{i}" for i in range((WAVE_COUNT+3)//4)]
    marks = [f"Mark{i}" for i in range(8)]
    axes = [f"Axes{i}" for i in range(4)]
    biases = [f"MarkBias{i}" for i in range(2)]
    for i, name in enumerate(spectrum + ["WakePose", "NearWhalePrint", "FarWhalePrint"] + [f"Ring{i}" for i in range(4)] + marks + axes + biases):
        vector = expression(asset, unreal.MaterialExpressionVectorParameter, y=i*125,
                            parameter_name=name, default_value=unreal.LinearColor(0,0,0,0))
        full = expression(asset, unreal.MaterialExpressionAppendVector, x=-240, y=i*125)
        link(vector,full,"A")
        link(vector,full,"B","A")
        (waves if name in spectrum else contacts)[name] = full
    coast_enabled = parameter(asset,"CoralCoast",0)
    coast_code = """
        if (Enabled<.5) return float4(1000,0,0,-1);
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
        return float4(sea,foam);
        """, contacts, OUTPUT.CMOT_FLOAT4)
    # The displacement and the interpolator share the long-wave and shore-breaker result.
    long_vertex = shader(asset,WAVE_MATH+LONG_WAVES+"Height=sea.x; return float4(sea.w,sea.yz,foam);",
                         vertex_inputs,OUTPUT.CMOT_FLOAT4)
    height_pin = unreal.CustomOutput()
    height_pin.set_editor_property("output_name","Height")
    height_pin.set_editor_property("output_type",OUTPUT.CMOT_FLOAT1)
    long_vertex.set_editor_property("additional_outputs",[height_pin])
    short_vertex = shader(asset,WAVE_MATH+SHORT_WAVES+"return chop;",vertex_inputs,OUTPUT.CMOT_FLOAT4)
    tracks = {"Position":world, "T":time, "Map":survey_texture(asset,"TrainTracks")}
    for i in range(4):
        box = expression(asset,unreal.MaterialExpressionVectorParameter,parameter_name=f"TrainBox{i}",
                         default_value=unreal.LinearColor(1,1,-1,-1))
        bounds = expression(asset,unreal.MaterialExpressionAppendVector)
        link(box,bounds,"A")
        link(box,bounds,"B","A")
        tracks[f"B{i}"] = bounds
    fleet = shader(asset,TRAFFIC_WATER,tracks,OUTPUT.CMOT_FLOAT4)
    offset = shader(asset, "return float3(Step.xy,100*(LongHeight+ShortHeight.x+Local.x+Fleet.x));",
                    {"LongHeight":(long_vertex,"Height"),"ShortHeight":short_vertex,"Fleet":fleet,"Local":local,"Step":shift},OUTPUT.CMOT_FLOAT3)
    # Sub-metre vertices already resolve the surveyed shore profile. Farther
    # out, recompute it on coarse triangles that may cross an island's coast.
    pixel_coast = shader(asset,WATER_MODEL+"""
        [branch] if (Grid.x<1.4 || Shore.x>100.+4.*Grid.x) return Shore;
        """+coast_code,{"P":world,"Enabled":coast_enabled,"Grid":grid,"Shore":interpolate_water(asset,coast)},
        OUTPUT.CMOT_FLOAT4)
    # A breaking crest advances with phase speed. Its detached surface film
    # rides the much slower horizontal particle orbit. Invert the first-order
    # displacement to sample the film in its undisturbed material coordinates.
    def orbit_terms(indices):
        terms = []
        for i in indices:
            k = WAVE_VECTORS[i]
            length = math.hypot(k.x, k.y)
            terms.append(f"Wave{i}.z * sin(dot(p,float2({k.x:.10g},{k.y:.10g}))+Wave{i}.w)"
                         f" * float2({k.x/length:.10g},{k.y/length:.10g})"
                         f" * (1-smoothstep({math.pi/(2*length):.10g},{math.pi/length:.10g},Grid.x))")
        return " + ".join(terms)

    long_modes = list(range(LONG_WIND_COUNT)) + list(range(WIND_WAVE_COUNT,WAVE_COUNT))
    # Reconstruct the wind-sea compression at the birth of a foam patch.
    # The lip moves on while the surface bubbles travel with their orbit and
    # the wind drift. Two past phases give white water a footprint behind it.
    past = []
    for i in range(WIND_WAVE_COUNT, WAVE_COUNT):
        k = WAVE_VECTORS[i]
        length = math.hypot(k.x,k.y)
        if 2*math.pi/length > 60:
            continue
        # Trace back a surface film drifting downwind at 1.35 m/s.
        frequency = math.sqrt(9.81*length) - 1.35*(-.052336*k.x-.99863*k.y)
        weights = [frequency*t for t in (.75,2.1)]
        past.append(f"""
            {{
                float phase=dot(p,float2({k.x:.10g},{k.y:.10g}))+Wave{i}.w;
                float s,c; sincos(phase,s,c);
                history+=Wave{i}.z*{length:.10g}*(c*float2({math.cos(weights[0]):.10g},{math.cos(weights[1]):.10g})
                                            -s*float2({math.sin(weights[0]):.10g},{math.sin(weights[1]):.10g}));
            }}""")
    orbital = shader(asset,WATER_MODEL + f"""
        if (Coast.x<=-8) return 0;
        SailingWaterMath water;
        float2 p=Position.xy*.01;
        float swell=water.StormTransfer(p.x,p.y,Coast,SeaScale).x;
        float2 orbit=({orbit_terms(range(LONG_WIND_COUNT))}) * water.Swell(Coast.x);
        float2 history=0;
        [branch] if (SeaScale>1.6) {{
            orbit+=({orbit_terms(range(WIND_WAVE_COUNT,WAVE_COUNT))}) * swell;
            {''.join(past)}
        }}
        float2 wash=smoothstep(.11,.29,history*swell);
        return float3(orbit,max(.72*wash.x,.40*wash.y)*(1-smoothstep(.8,3.8,Grid.x)));
        """,{"Position":world,"Grid":grid,"Coast":coast,"SeaScale":scale,
             **{f"Wave{i}":waves[f"Wave{i}"] for i in long_modes}}, OUTPUT.CMOT_FLOAT3)
    # The local displacement is already consumed in the vertex stage. Its x
    # slot can carry foam into the pixel stage. This keeps the mesh within
    # eight UV channels, including in Metal's lightmap-density permutation.
    local_film = interpolate_water(asset,shader(asset,"return float4(Motion.z,Local.yz, Fleet.a);",
        {"Motion":orbital,"Local":local,"Fleet":fleet},OUTPUT.CMOT_FLOAT4))
    resolved=interpolate_water(asset,shader(asset,"return Water+float4(Chop.w,Chop.yz,Gust.w)+float4(0,Fleet.yz,0);",
        {"Water":long_vertex,"Chop":short_vertex,"Gust":local,"Fleet":fleet},OUTPUT.CMOT_FLOAT4))
    orbit_xy = interpolate_water(asset,shader(asset,"return Motion.xy;",{"Motion":orbital},OUTPUT.CMOT_FLOAT2))
    film = shader(asset,"return float3(Orbit,Local.x);",{"Orbit":orbit_xy,"Local":local_film},OUTPUT.CMOT_FLOAT3)
    # Reuse the surface already solved for displacement in the fine foreground mesh.
    # Only coarse triangles need the short crests and gravity waves restored per pixel.
    distant_fleet=shader(asset, "if (Cell.x<.80) return float4(0,0,0,Local.a);\n"+TRAFFIC_WATER,
                         {**tracks,"Cell":grid,"Local":local_film},OUTPUT.CMOT_FLOAT4)
    surface = shader(asset,WAVE_MATH+"""
        float restore=smoothstep(.65,1.30,Grid.x);
        if (restore<=0) return Resolved+float4(0,Local.yz,0);
        """+SHORT_WAVES+LONG_WAVES+"""
        float4 fine=float4(sea.w+chop.w,sea.yz+chop.yz+Fleet.yz,foam);
        return lerp(Resolved,fine,restore)+float4(0,Local.yz,0);
        """,{**waves,"Coast":pixel_coast,"Footprint":pixel,"Grid":grid,"Resolved":resolved,"Local":local_film,"Fleet":distant_fleet},OUTPUT.CMOT_FLOAT4)
    return surface, pixel_coast, offset, film, distant_fleet, {name:contacts[name] for name in ("NearWhalePrint","FarWhalePrint")}


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
    asset = material("M_CoralWater", two_sided=True)
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
    sea, coast, offset, orbit, fleet, whale_prints = water_fields(asset,world,grid,pixel,time,scale)
    view = expression(asset, unreal.MaterialExpressionCameraVectorWS)
    side = expression(asset, unreal.MaterialExpressionTwoSidedSign)
    depth = shader(asset, """
        // From below, water lies between the camera and the surface.
        float path = Side < 0 ? Surface : max(0.,Bed-Surface);
        return float2(path,path*.01*max(.08,abs(View.z)));
        """, {"Bed": expression(asset, unreal.MaterialExpressionSceneDepthWithoutWater),
               "Surface": expression(asset, unreal.MaterialExpressionPixelDepth), "View": view, "Side": side}, OUTPUT.CMOT_FLOAT2)
    shore = shader(asset, ROCK_MODEL+"""
        Backwash=0; Front=40;
        if (Coast.x>=38 || Coast.x<=-8) return 0;
        SailingWaterMath water;
        TidalRocks rocks;
        float2 p=P.xy*.01;
        float4 bend;
        float4 rock=rocks.Read(RockFlow,p,Coast.w,bend);
        float t = T+water.Peel(p.x,p.y,Coast.w).x+rock.x;
        float index=water.ProfileIndex(Coast.x);
        int2 i=int2((int)index,2*(int)Coast.w);
        float travel=lerp(Profile.Load(int3(i,0)).x,Profile.Load(int3(i+int2(1,0),0)).x,frac(index));
        float local=t+travel/water.BreakerFrequency();
        float2 offshore = Coast.yz/max(.1,length(Coast.yz));
        float2 tangent = float2(-offshore.y,offshore.x);
        // Rock walls turn both strokes along the scanned contour. Foam trapped
        // in a pocket releases later than the exposed water on either flank.
        float4 tip=water.SwashTip(t,Scale,Coast.w);
        float4 lag=water.SwashTip(max(t,local)-.62*saturate(rock.w),Scale,Coast.w);
        Front=Coast.x-tip.x;
        float2 current=offshore+rock.yz;
        current*=min(1.,1.8/max(.01,length(current)));
        float across = (lag.x-1.25)*.60;
        float2 unused;
        float4 tile=water.RockTile(p.x,p.y,Coast.w);
        float4 wash=rocks.Wash(RockWash,RockWashSampler,tile,T,unused,false);
        float along = .24*sin(.27*t+.07*p.x-.03*p.y);
        Backwash.z = travel/6.2831853;
        Backwash.w = (water.BreakerFrequency()*t+Coast.w)/6.2831853;
        Backwash.x=wash.a;
        float2 inTile=float2(tile.x,fmod(tile.y,128.));
        float2 margin=min(inTile,127.-inTile);
        Backwash.y=tile.z>0 ? smoothstep(1.,8.,min(margin.x,margin.y))*smoothstep(.025,.70,rock.w) : 0.;
        float weight = smoothstep(-8.,-5.,Coast.x)*(1-smoothstep(7.,35.,Coast.x));
        return float4(current*across+tangent*along+1.12*wash.yz,weight,tip.y);
        """, {"P": world, "Coast": coast, "T": time, "Scale": scale,
              "Profile":survey_texture(asset,"SurfProfile"),"RockFlow":survey_texture(asset,"RockFlow"),"RockWash":survey_texture(asset,"RockWash")}, OUTPUT.CMOT_FLOAT4)
    drain_pin=unreal.CustomOutput()
    drain_pin.set_editor_property("output_name","Backwash")
    drain_pin.set_editor_property("output_type",OUTPUT.CMOT_FLOAT4)
    front_pin=unreal.CustomOutput()
    front_pin.set_editor_property("output_name","Front")
    front_pin.set_editor_property("output_type",OUTPUT.CMOT_FLOAT1)
    shore.set_editor_property("additional_outputs",[drain_pin,front_pin])
    drift = shader(asset, """
        float2 p = Position.xy*.01;
        return p+Orbit.xy+.36*float2(sin(.065*p.y+.047*p.x-.17*T),cos(.078*p.x-.031*p.y-.13*T));
        """, {"Position":world, "Orbit":orbit, "T":time}, OUTPUT.CMOT_FLOAT2)
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
        // Sub-metre waves flatten between gusts in fair weather.
        float energy=gust*pow(min(Scale,1.94),.34)*lerp(.66,1.18,smoothstep(1.,3.9,Scale));
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
        float2 drift = lerp(float2(.48,.22),float2(-.10,-1.75),gale)*T;
        float2 p = P - lerp(drift,Shore.xy,Shore.z);
        float2 eddy = float2(sin(.46*p.y-.37*T),cos(.40*p.x+.28*T));
        return (p+.55*Shore.z*eddy)*.114;
        """, {"P":drift,"T":time,"Shore":shore,"Scale":scale}, OUTPUT.CMOT_FLOAT2)
    foam_texture = import_texture(source,"T_BreakerFoam","linear")
    grain = number(asset,FOAM_GRAIN_SCALE)
    # Keep broad coverage on the breaker, then resolve the individual films at bubble scale.
    density = sample_texture(asset,foam_texture,lace_uv,linear=True)
    film_uv = shader(asset,"return UV*Grain;",{"UV":lace_uv,"Grain":grain},OUTPUT.CMOT_FLOAT2)
    lace = sample_texture(asset,foam_texture,film_uv,linear=True)
    # Roll and stretch the foam at decimetre scale while the whole raft travels
    # with the wash. Two crossing eddies shear the same material coordinates.
    strand_uv = shader(asset, """
        float2 p = UV*8.77;
        p += .23*float2(sin(2.3*p.y+.62*T+sin(p.x*1.6)),cos(2.8*p.x-.51*T));
        p += .065*float2(cos(6.3*p.y-.70*T),sin(7.2*p.x+.65*T));
        return float2(.28*p.x+.13*p.y,-.08*p.x+.17*p.y);
        """,{"UV":lace_uv,"T":time},OUTPUT.CMOT_FLOAT2)
    strands = sample_texture(asset,foam_texture,strand_uv,linear=True)
    windrows = shader(asset, """
        float2 wind=float2(-.052336,-.998630), across=float2(-wind.y,wind.x);
        float along=dot(P,wind)-1.35*T, side=dot(P,across);
        // Stretch old foam along the wind. Vary its direction and spacing over each wave group.
        float bend=1.7*sin(.053*along+.067*side)+.65*sin(.12*along-.095*side+.23*sin(.09*side));
        return Grain*float2(along*.075+(side+bend)*.018,(side+bend)*.15);
        """, {"P":drift,"T":time,"Grain":grain},OUTPUT.CMOT_FLOAT2)
    streaks = sample_texture(asset,unreal.load_asset(FOAM_TEXTURE),windrows)
    froth_uv = shader(asset, """
        float2 p = P - float2(-.12,-1.52)*T;
        return (.29*Grain)*float2(dot(p,float2(.8,.6)),dot(p,float2(-.6,.8)));
        """, {"P":drift,"T":time,"Grain":grain}, OUTPUT.CMOT_FLOAT2)
    froth_detail = sample_texture(asset,foam_texture,froth_uv,linear=True)
    # At a low camera angle a horizontal projection smears foam across the
    # front of a breaker. Sample its actual displaced height on that face.
    surface_position = expression(asset,unreal.MaterialExpressionWorldPosition)
    face_uv = shader(asset, """
        float alongRidge=dot(Position.xy*.01,float2(.99863,-.052336));
        return Grain*float2(alongRidge*.37+.035*T,Position.z*.0041-.18*T);
        """,{"Position":surface_position,"T":time,"Grain":grain},OUTPUT.CMOT_FLOAT2)
    face_froth = sample_texture(asset,foam_texture,face_uv,linear=True)
    foam_flow = expression(asset,unreal.MaterialExpressionTextureObject,texture=unreal.load_asset(FOAM_TEXTURE))
    pores = shader(asset, """
        // At the scale of a hand-sized foam patch, light and dark pockets
        // coexist even on a fully white crest. Remove the map's broad bias
        // before reconstructing coverage so it also works in a dark trough.
        [branch] if (Scale<=2.4 && Shore.z<.05) return .65;
        float3 p=Position*.01;
        float2 uv=float2(dot(p.xy,float2(.82,.57)),dot(p.xy,float2(-.57,.82))+.34*p.z)*.35;
        uv=Grain*(uv+float2(.027,-.061)*T);
        float2 dx=ddx(uv),dy=ddy(uv);
        float footprint=max(length(dx),length(dy));
        [branch] if (footprint>=.039) return .65;
        float foam=Texture2DSampleGrad(Map,MapSampler,uv,dx,dy).r;
        float neighbourhood=Texture2DSampleGrad(Map,MapSampler,uv,dx*6,dy*6).r;
        float resolved=1-smoothstep(.010,.039,footprint);
        return lerp(.65,smoothstep(.21,.66,foam+2.2*(foam-neighbourhood)),resolved);
        """,{"Position":surface_position,"Map":foam_flow,"T":time,"Scale":scale,"Grain":grain,"Shore":shore},OUTPUT.CMOT_FLOAT1)
    field_view = expression(asset,unreal.MaterialExpressionVectorParameter,parameter_name="WakeFieldView",
                            default_value=unreal.LinearColor(0,0,0,0))
    field_inputs = {"P":world,"Flow":drift,"View":field_view,"Blend":(field_view,"A"),"Fleet":fleet}
    for channel in ("A","B"):
        field_inputs[channel] = expression(asset,unreal.MaterialExpressionTextureObjectParameter,
            parameter_name=f"WakeField{channel}",texture=unreal.load_asset("/Engine/EngineResources/Black"),
            sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
    history = shader(asset, """
        float2 p = P.xy*.01, box = abs((p-View.xy)*View.z);
        float4 other=float4(0,0,saturate(Fleet.a),0);
        if (View.z<=0 || max(box.x,box.y)>=.5) return other;
        // Surface orbits bend the bubble lanes. The stored chart remains fixed
        // in the emission frame, including after a turn or throttle change.
        // The chart stores births in world space. A full storm orbit can be
        // wider than a hull. Bend strand edges at sub-metre scale so a newly
        // deposited sheet stays connected to the actual point of impact.
        float2 bend = Flow-p;
        float2 uv = (p+bend*(.68/max(1.,length(bend))))*View.z;
        float4 field = lerp(Texture2DSampleLevel(A,ASampler,uv,0),
                            Texture2DSampleLevel(B,BSampler,uv,0),Blend);
        // Older bubbles disperse in patches along their original course.
        float eddy = .5+.5*sin(dot(p,float2(.53,-.24))+.8*sin(dot(p,float2(.13,.40))));
        float dilute = 1-smoothstep(.16,.78,max(field.r,max(field.g,field.b)));
        field.rgb *= 1-.28*dilute*eddy;
        return max(other,field*(1-smoothstep(.45,.5,max(box.x,box.y))));
        """,field_inputs,OUTPUT.CMOT_FLOAT4)
    whale_wash = shader(asset, """
        struct Footprint {
            float2 Coverage(float4 mark, float2 p, float time, float pores) {
                float age=time-mark.z;
                if (mark.w<=0 || age<0 || age>=16) return 0;
                float2 delta=p-mark.xy;
                if (dot(delta,delta)>36*36) return 0;
                float radius=length(delta);
                float edge=radius-2.5*age+.47*(pores-.5);
                float patch=smoothstep(.18,.74,pores+.18*sin(dot(delta,float2(.34,-.28))));
                float collar=exp(-edge*edge/(.42+.16*age))*exp(-.30*age)*(.12+.88*patch);
                float boil=(1-smoothstep(.24,1.,radius/(2.3+.24*age)))*exp(-.18*age);
                float wet=mark.w*smoothstep(0,.16,age)*(1-smoothstep(12,16,age));
                float slick=(1-smoothstep(.35,1.,radius/(2.6+.4*age)))*smoothstep(.4,2.,age);
                return wet*float2(.80*collar+.69*boil*(.35+.65*patch),slick);
            }
        }; Footprint wake;
        return max(wake.Coverage(NearWhalePrint,P.xy*.01,T,Pores),wake.Coverage(FarWhalePrint,P.xy*.01,T,Pores));
        """, {**whale_prints,"P":world,"T":time,"Pores":pores}, OUTPUT.CMOT_FLOAT2)
    transport_map=expression(asset,unreal.MaterialExpressionTextureObject,texture=wave_volume(source,"SurfTransport"),
        sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
    transport=shader(asset,"""
        if (Shore.z<=.001) return 0;
        // Periodic surface transport is sampled in the same travelling phase as the breaker.
        // A smooth world-space coordinate keeps the tracer continuous around headlands.
        float2 p=P.xy*.01;
        float along=dot(p,float2(.88,.47))/19.+.16*sin(.047*p.y-.034*p.x+.08*T);
        return Texture3DSampleLevel(Map,MapSampler,float3(Phase.z,along,Phase.w),0);
        """,{"P":world,"T":time,"Map":transport_map,"Phase":(shore,"Backwash"),"Shore":shore},OUTPUT.CMOT_FLOAT4)
    foam = shader(asset, """
        float gale = smoothstep(2.4,4.5,SeaScale);
        float face = -dot(Sea.yz,float2(-.052336,-.998630));
        float3 bubbles=lerp(Fine,FaceFroth,.83*smoothstep(.17,.65,abs(face)));
        float compression = Sea.x;
        float surviving = smoothstep(.34,.74,Detail.w);
        float froth = smoothstep(.25,.72,Streak.r+.14*(bubbles.r-.5));
        float front = compression+.44*face+.22*(Density-.5)+.12*(bubbles.g-.5);
        float breaker = smoothstep(lerp(.43,.18,gale),lerp(.73,.58,gale),front);
        // A spilling lip fills into an opaque sheet. Its thinner edge reveals
        // individual holes, with a raft of connected filaments behind the lip.
        float raft = smoothstep(.14,.84,.76*Lace.r+.48*bubbles.r);
        float cover = smoothstep(.55,.90,breaker+.46*(Density-.5)+.22*(bubbles.g-.5));
        // The newly broken lip contains milky sheets with sharply bounded
        // holes. As the water drains, only the rims of the holes stay white.
        float airPocket=smoothstep(.39,.64,.55*Density+.45*bubbles.b);
        float dense = saturate(.05+.54*raft+.42*airPocket*(.3+.7*bubbles.b));
        float cap = breaker*lerp(.07*smoothstep(.49,.83,bubbles.b)*froth,lerp(raft,dense,cover)*(.09+1.16*froth),gale);
        // Long breakers throw the lip. Bubbles in the short wind waves travel
        // on under it, leaving rafts in the trough after compression subsides.
        float back = smoothstep(-.23,.38,compression-.65*face+.25*(Density-.5));
        float afterwash = gale*surviving*(.08+.92*back*back)*froth*(.28+.72*max(bubbles.b,raft));
        float local = saturate(Sea.w);
        float localFoam = local*lerp(.83*raft,dense,smoothstep(.42,.95,local));
        // New air enters only where a portion of the crest overtakes its face.
        // The transported fraction survives the impact and thins on the outward stroke.
        float fine = smoothstep(.25,.75,.64*bubbles.b+.36*Strands.g);
        float spilling = Transport.g * smoothstep(.12,.64,local);
        float residueAir = Transport.r * smoothstep(.08,.37,local);
        // A dense packet at the toe breaks into narrow filaments as it drains.
        float contact = Backwash.x*.92*smoothstep(.28,.65,Strands.g+.22*(Density-.5));
        // Entrained air collects between patches of clear water. Use the
        // transported, decimetre-sized films here; the fine bubbles alone
        // average to an opaque-looking stripe even at standing eye height.
        float parcel=.72*Strands.g+.28*Density+.035*(Strands.r-.5);
        float clumps=smoothstep(.46,.69,parcel);
        float drainage=smoothstep(.50,.70,parcel+.025*(Lace.r-.5));
        float surf = spilling*clumps*(.06+.38*fine) + residueAir*drainage*(.04+.22*fine)
                   +contact*clumps*(.12+.39*fine);
        // A thin aerated toe follows the actual bed intersection, including individual
        // rock faces. As water recedes the wider foam fraction breaks into patches.
        float cm=max(0.,Depth.y*100.);
        float wetEdge=smoothstep(.06,.72,cm)*(1.-smoothstep(1.45,4.1,cm));
        float spillingToe=smoothstep(.12,1.45,-Shore.w);
        float beading=smoothstep(.24,.71,.56*bubbles.r+.27*Strands.g+.17*Streak.r);
        float toe=0.;
        [branch] if (wetEdge*Shore.z>.001) {
            // Decimetre-scale patches of entrained air leave open windows along
            // the leading edge. The same patches travel back with the thin sheet.
            float2 bed=Pshore.xy*.01-Shore.xy;
            float parcel=.5+.24*sin(6.1*bed.x-2.5*bed.y+.84*sin(4.7*bed.y))
                           +.26*sin(6.5*bed.y+.9*sin(7.1*bed.x));
            float patches=smoothstep(.28,.72,parcel+.19*(Strands.g-.5));
            toe=wetEdge*(.52*spillingToe*saturate(Backwash.x+.40*local)+.10*residueAir)*beading*(.08+.92*patches);
        }
        // Clear windows open between the draining cells. The foam field
        // moves their borders back through the channels around the stone.
        float rims=smoothstep(.18,.73,Pores+.23*(Strands.r-.5));
        localFoam = lerp(localFoam,max(surf,toe)*lerp(.18,.92,rims),Shore.z);
        // Most bubbles rise through the wake in patches. The broad turquoise
        // plume belongs to the water column; only fresh clusters whiten its surface.
        float raftEdge = smoothstep(.47,.73,Density+.19*(Fine.g-.5));
        float stern = .32*smoothstep(.30,1.,Trail.r)*raft;

        float propeller = .72*smoothstep(.31,1.,Trail.b)*dense;
        float wake = (.14+.86*raftEdge)*max(stern,propeller);
        float coverage=max(max(localFoam,wake),(1-(1-cap)*(1-afterwash))*(1-.84*Shore.z));
        // Thick young foam covers the centres of cells. As the film thins,
        // drainage opens holes and breaks their outlines at a second scale.
        float torn=smoothstep(.24,.70,.57*bubbles.g+.43*Streak.r);
        float drained=(.12+1.18*Pores)*(.46+.54*torn);
        float films=lerp(1.,lerp(drained,.73+.43*bubbles.b,cover*froth),gale);
        // Old rafts increasingly consist of disconnected films in the trough.
        float residue=.14*gale*surviving*Pores*Pores*(.23+.77*raft);
        // In the wake of a spilling crest the air is concentrated in the
        // stretched borders of draining films. Leave their interiors open.
        float filmEdges=smoothstep(.16,.72,max(Lace.r,.58*bubbles.r));
        float filmClumps=smoothstep(.27,.64,Density+.24*(Streak.r-.5));
        float oldFoam=gale*Orbit.z*filmEdges*(.25+.75*filmClumps)*(.35+.65*torn);
        // At re-entry the stem ventilates a dense sheet. As its air fraction
        // falls the wet holes join up and only irregular bubble rims remain.
        float wash=Trail.a;
        float patch=.50*Density+.32*bubbles.g+.18*Streak.r;
        float filled=smoothstep(.50,.79,wash+.52*(patch-.5));
        float strands=smoothstep(.23,.65,raft+.28*(patch-.5));
        float impact=wash*lerp(strands*(.20+.80*Pores),.79+.21*bubbles.b,filled);
        float windFoam=max(oldFoam*(1-Shore.z),coverage*films+(1-coverage)*residue*(1-Shore.z));
        // In a surveyed rock pool the solver already knows exactly where the
        // water has compressed and carried air. Depth contours by themselves
        // must never paint a solid ribbon around a bare stone.
        float air=smoothstep(.018,.42,Backwash.x);
        float islands=smoothstep(.38,.78,.48*Density+.32*Strands.g+.20*bubbles.b+.20*air);
        float poreFilm=smoothstep(.25,.72,.50*Lace.r+.32*bubbles.b+.18*Pores);
        float film=air*(.008+.33*islands*poreFilm)*smoothstep(.003,.036,Depth.y);
        // In the swash, a few centimetres of moving water can carry an open
        // lace of air over clear sand. The rising bore entrains new bubbles;
        // in backwash only its detached, draining filaments persist.
        float moving=smoothstep(.19,1.5,-Shore.w);
        float thin=smoothstep(.002,.023,Depth.y)*(1-smoothstep(.09,.24,Depth.y));
        float frontDistance=Front+.17*(Density-.5)+.074*(Strands.g-.5);
        // The fresh bore carries a narrow, aerated lip. Behind it the bubbles
        // stretch into open cells; most of the water ahead remains transparent.
        float lip=(1-smoothstep(.055,.29,abs(frontDistance-.29)))*moving;
        float apron=smoothstep(.18,.48,frontDistance)*(1-smoothstep(.49,1.18,frontDistance));
        float lace=smoothstep(.28,.74,.61*Lace.r+.23*bubbles.g+.16*Pores);
        float lipPatch=smoothstep(.27,.75,.54*Density+.46*Strands.g);
        float lipAir=lip*(.17+.79*lipPatch)*(.23+.77*lace);
        float tailAir=(.34*moving*apron+.17*thin)*lace*lipPatch*(.21+.79*Pores);
        float edgeFoam=(lipAir+tailAir)*smoothstep(.001,.023,Depth.y);
        float swashZone=Shore.z*(1-smoothstep(.15,.56,Depth.y));
        float breaking=lerp(windFoam,edgeFoam,swashZone);
        breaking=lerp(breaking,film,Backwash.y*Shore.z);
        breaking=max(breaking,wake);
        return saturate(max(impact,max(WhaleWash.x*(.27+1.25*raft),breaking)));
        """, {"WhaleWash":whale_wash,"Sea":sea,"Orbit":orbit,"Detail":detail,"Trail":history,"Lace":lace,"Density":(density,"G"),"Streak":streaks,
              "Fine":froth_detail,"FaceFroth":face_froth,"Pores":pores,"SeaScale":scale,"Shore":shore,"Depth":depth,
              "Transport":transport,"Strands":strands,"Pshore":world,"Backwash":(shore,"Backwash"),"Front":(shore,"Front")},OUTPUT.CMOT_FLOAT1,600)
    normal = shader(asset, """
        float slick=max(WhaleWash.y,saturate(Trail.r*.7+Trail.b*.4+Sea.w*.44+.65*Trail.a));
        // Shelter behind the breaking ridge leaves broader reflecting facets.
        // The exposed face still carries the full crossing capillary field.
        float shelter=smoothstep(2.4,4.5,Scale)*smoothstep(.08,.67,dot(Sea.yz,float2(-.052336,-.998630)));
        // Thick foam damps the capillary waves that reflect a sharp sky highlight.
        float film = Shore.z*(1-smoothstep(.08,.90,Depth.y));
        float grazing = 1-smoothstep(.045,.26,abs(View.z));
        float2 breakerRipple=(Transport.ba-.5)*float2(.072,.063)*Shore.z*smoothstep(.08,.58,Sea.w);
        float2 slopes=breakerRipple+Detail.xy*(1-.50*shelter)*(1-.70*max(slick,Foam))*(1-.38*film)*(1-.26*grazing);
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
        """,{"Transport":transport,"WhaleWash":whale_wash,"Sea":sea,"Detail":detail,"Trail":history,"Foam":foam,"P":drift,"Rain":rainfall,
              "Pixel":pixel,"T":time,"Scale":scale,"Shore":shore,"Depth":depth,"View":view},OUTPUT.CMOT_FLOAT3)
    opacity = shader(asset, "return lerp(.026+.052*smoothstep(.14,1.8,Depth.y),.96,Foam);",
                     {"Foam": foam, "Depth": depth}, OUTPUT.CMOT_FLOAT1)
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
        float grazing=1-smoothstep(.045,.23,abs(View.z));
        float film=Shore.z*(1-smoothstep(.05,.50,Depth.y));
        float base=lerp(.057+.024*distanceFilter+.026*grazing,.088,film)+.044*Rain;
        // UE's GGX alpha is perceptual roughness squared. Add unresolved
        // slope variance before converting the lobe width back to roughness.
        float rough=pow(pow(base,4)+.09*max(0,Detail.z)*(1-.77*film),.25);
        float gale=smoothstep(2.4,4.5,Scale);
        float shelter=smoothstep(.08,.67,dot(Sea.yz,float2(-.052336,-.998630)));
        rough=lerp(rough,rough*(1-.30*shelter)+.016*(1-shelter),gale);
        // Air films scatter sky light diffusely. In the gaps the clean surface
        // keeps the dark troughs and angled bands of reflected sky.
        return lerp(rough,.72,smoothstep(.12,.88,Foam));
        """, {"Foam":foam,"Detail":detail,"Sea":sea,"Pixel":pixel,"Scale":scale,"Rain":rainfall,
              "Shore":shore,"Depth":depth,"View":view}, OUTPUT.CMOT_FLOAT1)
    assign(offset, PROP.MP_WORLD_POSITION_OFFSET)
    assign(normal, PROP.MP_NORMAL)
    assign(base, PROP.MP_BASE_COLOR)
    assign(rough, PROP.MP_ROUGHNESS)
    assign(opacity, PROP.MP_OPACITY)
    assign(number(asset, .255), PROP.MP_SPECULAR)
    # Use the wave's refracted ray relative to calm water. The bounded offset
    # keeps a steep crest from dragging the unwarped shore across the screen.
    asset.set_editor_property("refraction_method", unreal.RefractionMode.RM_2D_OFFSET)
    refraction = shader(asset, """
        float eta = Side < 0 ? 1.333 : 1./1.333;
        float3 flat = refract(-View,float3(0,0,Side),eta);
        float3 bent = refract(-View,N*Side,eta);
        float2 offset = TransformWorldVectorToView(bent-flat).xy;
        float visible = smoothstep(.02,.18,Side*View.z)*(1-smoothstep(.04,.82,Foam));
        // A given lateral ray displacement subtends more pixels directly
        // below the observer. For deep water cap the screen-space lookup at
        // the existing horizon scale to avoid sampling past silhouettes.
        float thickness=1.-exp(-max(0.,Path.x)*.012);
        float2 shallow=offset*(max(0.,Path.x)/max(32.,EyeDistance))*.56;
        float2 deep=clamp(offset*.057,-.016,.016)*thickness;
        return clamp(lerp(shallow,deep,smoothstep(28.,105.,Path.x)),-.021,.021)*visible;
        """, {"View":view,"N":normal,"Foam":foam,"Side":side,"Path":depth,
              "EyeDistance":expression(asset,unreal.MaterialExpressionPixelDepth)}, OUTPUT.CMOT_FLOAT2)
    assign(refraction, PROP.MP_REFRACTION)
    # Integrate the diffuse part of the water column separately. Projecting a
    # sharp surface shadow through all forty metres made a sail look like a fin.
    # Keep the total extinction so the visibility of hulls and reef stays depth dependent.
    scattering = (.000016, .000114, .000146)
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
    view_cos = shader(asset, "return saturate(dot(N,View)*Side);",
                      {"N":normal,"View":view,"Side":side}, OUTPUT.CMOT_FLOAT1)
    window = shader(asset, """
        // At the critical angle for a water-to-air ray, the moving surface
        // reflects the water column. Allow a pixel of transition as it ripples.
        const float criticalCos = .661;
        float width = clamp(fwidth(Cosine),.012,.07);
        return Side > 0 ? 1. : smoothstep(criticalCos-width,criticalCos+width,Cosine);
        """, {"Cosine":view_cos,"Side":side}, OUTPUT.CMOT_FLOAT1)
    extinction = number(asset, WATER_EXTINCTION_CM)
    sediment = shader(asset, """
        // Turbulence suspends fine mineral grains on the sandy toe. Their
        // extinction is nearly neutral beside the red absorption of seawater.
        float stirred=.00003+.00026*saturate(Sea.w)+.00005*max(0.,Shore.w);
        return Shore.z*(1.-smoothstep(2.5,18.,Coast.x))*stirred*.60;
        """,{"Coast":coast,"Shore":shore,"Sea":sea},OUTPUT.CMOT_FLOAT1)
    behind = shader(asset, """
        if (Side > 0) return 1.;
        return lerp(.025,1.,Window)*exp(-(Extinction*Turbidity+Sediment)*Depth.x);
        """, {"Side":side,"Window":window,"Extinction":extinction,"Turbidity":turbidity,"Depth":depth,"Sediment":sediment}, OUTPUT.CMOT_FLOAT3)
    ground_light = unreal.MaterialExpressionSkyAtmosphereLightIlluminanceOnGround
    fill = shader(asset, """
        float pathCm = Depth.x;
        float3 waterK=Extinction*Turbidity, totalK=waterK+Sediment;
        float3 volume = (DiffuseAlbedo*waterK+float3(.34,.37,.24)*Sediment)/totalK
                      * (1 - exp(-totalK*pathCm));
        float transmission = .98 * (1 - pow(1 - Cosine, 5)) * (1 - Opacity);
        float3 incident = Sun*saturate(SunDir.z) + Moon*saturate(MoonDir.z);
        float thinShelf=Shore.z*(1.-smoothstep(.8,5.5,Depth.y));
        float3 diffuseVolume = incident * (1.0 / (4 * 3.14159265)) * volume * transmission
            * lerp(float3(1.,1.,1.),float3(.90,.62,.74),thinShelf);
        // Entrained bubbles return green-blue light beneath the white skin of
        // the wake. This blooms through its thin edges and dies with the trail.
        float aerated = saturate(.33*Trail.r+.82*Trail.b);
        diffuseVolume += incident * (float3(.0007,.028,.032)*aerated
                       + float3(.013,.027,.030)*Trail.a)*transmission;
        // Light traversing a thin, aerated crest escapes on its shaded face.
        float lip = smoothstep(.16,.58,Sea.x)*smoothstep(.04,.45,length(Sea.yz));
        float through = .12+.88*pow(saturate(dot(-ViewDir,SunDir)),3);
        float crestAir = (.12+.76*smoothstep(2.4,4.5,Scale))*lip+.22*Sea.w*Shore.z;
        diffuseVolume += Sun*float3(.0011,.0057,.0046)*crestAir*through*transmission;
        float3 diffuseFoam = (Sun * saturate(SunDir.z) + Moon * saturate(MoonDir.z)) / 3.14159265;
        float3 reflectedWater = (.6 + .4*Cosine) * incident * float3(.00007,.00043,.00055) * (1-Window);
        return diffuseVolume + reflectedWater + diffuseFoam * FoamReflectance * Foam;
        """, {"Sun": expression(asset, ground_light), "Moon": expression(asset, ground_light, light_index=1),
              "SunDir": expression(asset, unreal.MaterialExpressionSkyAtmosphereLightDirection),
              "MoonDir": expression(asset, unreal.MaterialExpressionSkyAtmosphereLightDirection, light_index=1),
              "FoamReflectance":number(asset,tuple(x * FOAM_DIFFUSE_SHARE for x in FOAM_ALBEDO)), "Foam":foam,
              "DiffuseAlbedo": number(asset, diffuse_albedo), "Extinction": extinction,"Turbidity":turbidity,"Sediment":sediment,
              "Depth": depth, "Opacity": opacity, "Shore": shore, "Cosine":view_cos, "Window":window,
              "ViewDir": view, "Sea":sea,"Scale":scale,"Trail":history}, OUTPUT.CMOT_FLOAT3)
    output = expression(asset, unreal.MaterialExpressionSingleLayerWaterMaterialOutput, -95, 1190)
    for pin, value in {
        "ScatteringCoefficients": direct,
        "AbsorptionCoefficients": absorption,
        "PhaseG": .25,
    }.items():
        coefficient=number(asset,value)
        if pin in ("AbsorptionCoefficients","ScatteringCoefficients"):
            # UE applies these coefficients to the distance beyond the surface.
            # Below water this part of the ray is in air.
            extra = "+Sediment" if pin == "AbsorptionCoefficients" else ""
            coefficient=shader(asset,f"return Side > 0 ? K*Turbidity{extra} : 0.;",
                               {"K":coefficient,"Turbidity":turbidity,"Side":side,"Sediment":sediment},OUTPUT.CMOT_FLOAT3)
        link(coefficient, output, pin)
    link(behind, output, "ColorScaleBehindWater")
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
        # Each drop keeps one seed and a fall rate in the static vertex buffer.
        # Reconstruct its camera-relative streak without streaming a mesh per frame.
        rain_vectors = {key:expression(asset,unreal.MaterialExpressionVectorParameter,parameter_name="Rain"+key)
                        for key in ("Eye","Travel","Drift","Right")}
        rest = expression(asset,unreal.MaterialExpressionWorldPosition,
                          world_position_shader_offset=unreal.WorldPositionIncludedOffsets.WPT_EXCLUDE_ALL_SHADER_OFFSETS)
        flight = expression(asset,unreal.MaterialExpressionTextureCoordinate,coordinate_index=1)
        streak = shader(asset,"""
            float3 Seed=P-Eye;
            float r=Flight.y, rate=Flight.x;
            float3 span=float3(2*r,2*r,1.44*r), center=float3(0,0,.25*r);
            float3 local=(frac((Seed+Travel*rate-Eye-center)/span+.5)-.5)*span+center;
            float distanceCm=length(local);
            // The fast near drops cross more of the exposure in a gale.
            float squall=Rain*smoothstep(520.,1080.,length(Drift.xy));
            float shutter=min(.016+.024*Rain+.016*squall,(.065+.034*squall)*distanceCm/(length(Drift)*rate+.001));
            float3 corner=Right*((2*UV.x-1)*r*(.00060+.00017*squall)*rate) - Drift*(1-UV.y)*shutter*rate;
            float visibility=Rain*smoothstep(40,210,distanceCm)*(1-smoothstep(.58*r,r,distanceCm));
            return float4(local+corner-Seed,visibility);
            """,{**rain_vectors,"P":rest,"Flight":flight,"UV":uv,"Rain":(rain_vectors["Right"],"A")},
                       OUTPUT.CMOT_FLOAT4)
        assign(shader(asset,"return Streak.xyz;",{"Streak":streak},OUTPUT.CMOT_FLOAT3), PROP.MP_WORLD_POSITION_OFFSET)
        inputs["Strength"]=interpolate_water(asset,shader(asset,"return Streak.w;",{"Streak":streak},OUTPUT.CMOT_FLOAT1))
        inputs["Contact"] = expression(asset,unreal.MaterialExpressionDepthFade,fade_distance_default=32.)
        inputs["Sun"] = expression(asset,unreal.MaterialExpressionSkyAtmosphereLightIlluminanceOnGround)
    assign(shader(asset, alpha_code, inputs, OUTPUT.CMOT_FLOAT1), PROP.MP_OPACITY)
    assign(shader(asset, luminosity, inputs, OUTPUT.CMOT_FLOAT3, 250), PROP.MP_EMISSIVE_COLOR)
    return save(asset)


def breaker_lip(name, source):
    asset = material(name, MAT.MSM_DEFAULT_LIT, unreal.BlendMode.BLEND_TRANSLUCENT, two_sided=True)
    asset.set_editor_property("translucency_lighting_mode", unreal.TranslucencyLightingMode.TLM_SURFACE_PER_PIXEL_LIGHTING)
    uv = expression(asset,unreal.MaterialExpressionTextureCoordinate)
    paint = expression(asset,unreal.MaterialExpressionVertexColor)
    flow = shader(asset, """
        float2 q=float2(UV.x*1.42+Seed*8, UV.y*.18-.37*Age);
        return q+.058*float2(sin(q.y*17+q.x*4),cos(q.x*8+Age*3));
        """,{"UV":uv,"Seed":(paint,"G"),"Age":(paint,"B")},OUTPUT.CMOT_FLOAT2)
    film = sample_texture(asset,import_texture(source,"T_BreakerFoam","linear"),flow,linear=True)
    aeration = shader(asset, """
        float tip=smoothstep(.58,.98,UV.y);
        float impact=smoothstep(.32,.76,Age);
        return tip*(.15+.85*impact)*Air*smoothstep(.15,.84,.62*Film.g+.54*Film.r);
        """,{"UV":uv,"Age":(paint,"B"),"Air":(paint,"R"),"Film":film},OUTPUT.CMOT_FLOAT1)
    assign(shader(asset,"return lerp(float3(.014,.13,.14),float3(.77,.85,.84),Air);",
                  {"Air":aeration},OUTPUT.CMOT_FLOAT3), PROP.MP_BASE_COLOR)
    assign(shader(asset,"return .085+.39*Air;",{"Air":aeration},OUTPUT.CMOT_FLOAT1), PROP.MP_ROUGHNESS)
    assign(shader(asset,"return Weight*(.085+.68*Air+.34*pow(1-abs(dot(N,V)),3))*Edge;",
                  {"Weight":(paint,"A"),"Air":aeration,
                   "N":expression(asset,unreal.MaterialExpressionPixelNormalWS),"V":expression(asset,unreal.MaterialExpressionCameraVectorWS),
                   "Edge":expression(asset,unreal.MaterialExpressionDepthFade,fade_distance_default=3.)},OUTPUT.CMOT_FLOAT1), PROP.MP_OPACITY)
    asset.set_editor_property("refraction_method", unreal.RefractionMode.RM_2D_OFFSET)
    assign(shader(asset,"return TransformWorldVectorToView(N).xy*(.013*Weight*(1-Air));",
        {"Weight":(paint,"A"),"Air":aeration,"N":expression(asset,unreal.MaterialExpressionPixelNormalWS)},OUTPUT.CMOT_FLOAT2),PROP.MP_REFRACTION)
    return save(asset)


def flight_banner(name, source):
    asset=material(name,two_sided=True)
    uv=expression(asset,unreal.MaterialExpressionTextureCoordinate)
    face=expression(asset,unreal.MaterialExpressionTwoSidedSign)
    both=shader(asset,"return float2(Face>0?UV.x:1-UV.x,UV.y);",{"Face":face,"UV":uv},OUTPUT.CMOT_FLOAT2)
    assign(sample_texture(asset,import_texture(source,"T_FlightBanner","color"),both),PROP.MP_BASE_COLOR)
    assign(number(asset,.83),PROP.MP_ROUGHNESS)
    return save(asset)


def display_smoke(name):
    asset=material(name,MAT.MSM_DEFAULT_LIT,unreal.BlendMode.BLEND_TRANSLUCENT,two_sided=True)
    uv=expression(asset,unreal.MaterialExpressionTextureCoordinate)
    paint=expression(asset,unreal.MaterialExpressionVertexColor)
    assign(number(asset,(.83,.86,.87)),PROP.MP_BASE_COLOR)
    assign(number(asset,.96),PROP.MP_ROUGHNESS)
    assign(shader(asset,"""
        float cloud=.67+.19*sin(24*UV.x+6*UV.y)+.14*cos(55*UV.x-11*UV.y);
        return Density*cloud*(1-smoothstep(.06,.97,abs(UV.y*2.-1.)));
        """,{"UV":uv,"Density":(paint,"A")},OUTPUT.CMOT_FLOAT1),PROP.MP_OPACITY)
    return save(asset)


def crab_material(kind, source):
    asset=material(f"M_Crab{kind}")
    coat=expression(asset,unreal.MaterialExpressionTextureSample,
                    texture=import_texture(source,f"T_Crab{kind}Color","color"))
    paint=expression(asset,unreal.MaterialExpressionVertexColor)
    # Wet carapace values in daylight. The source photo contains baked highlights.
    color=shader(asset,"float3 shell=lerp(dot(Coat,float3(.21,.72,.07)).xxx,Coat,.76); return lerp(Flat,.60*shell,saturate(Mask));",
                 {"Coat":coat,"Flat":paint,"Mask":(paint,"A")},OUTPUT.CMOT_FLOAT3)
    assign(color,PROP.MP_BASE_COLOR)
    if kind=="Blue":
        normal=import_texture(source,"T_CrabBlueNormal","normal")
        normal.set_editor_property("flip_green_channel",True)
        ASSETS.save_loaded_asset(normal)
        assign(expression(asset,unreal.MaterialExpressionTextureSample,texture=normal,
                          sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL),PROP.MP_NORMAL)
    assign(number(asset,.49 if kind=="Red" else .38),PROP.MP_ROUGHNESS)
    rest=expression(asset,unreal.MaterialExpressionPreSkinnedPosition)
    phase=expression(asset,unreal.MaterialExpressionPerInstanceCustomData,data_index=0)
    moving=expression(asset,unreal.MaterialExpressionPerInstanceCustomData,data_index=1)
    gait=shader(asset,"""
        float side=sign(P.y), distal=smoothstep(12.,45.,abs(P.y));
        float step=Phase+side*1.57+P.x*.32;
        float3 offset=float3(0,3.1*cos(step),4.5*max(0.,sin(step)))*distal*Moving;
        return TransformLocalVectorToWorld(Parameters,offset);
        """,{"P":rest,"Phase":phase,"Moving":moving},OUTPUT.CMOT_FLOAT3)
    assign(gait,PROP.MP_WORLD_POSITION_OFFSET)
    EDIT.set_material_usage(asset,unreal.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES)
    return save(asset)


def aircraft_paint(name):
    asset=material(name)
    assign(expression(asset,unreal.MaterialExpressionVertexColor),PROP.MP_BASE_COLOR)
    assign(number(asset,.39),PROP.MP_ROUGHNESS)
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
    inputs["Jet"] = expression(asset,unreal.MaterialExpressionVectorParameter,parameter_name="JetTrack",default_value=unreal.LinearColor(0,0,0,0))
    inputs["JetAge"] = (inputs["Jet"],"A")
    inputs["Eye"] = expression(asset,unreal.MaterialExpressionCameraPositionWS)
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
        float3 background=lerp(Air,panorama,nearHorizon*dot(Weights,float3(.96,.91,.99)));
        if (gaze.z<=.025 || Jet.z<1) return background;
        float distance=(Jet.z-Eye.z*.01)/gaze.z;
        if (distance<=0) return background;
        float2 rel=Eye.xy*.01+gaze.xy*distance-Jet.xy;
        const float2 heading=float2(.932327,.361615);
        float age=-dot(rel,heading)/172.;
        if (age<=.3 || age>100) return background;
        if (age>JetAge) return background;
        // An emitted parcel stays in the air mass as the aircraft moves away.
        float along=dot(Jet.xy,heading)-age*172.;
        float across=dot(rel,float2(-heading.y,heading.x));
        float breakup=.5+.5*sin(along*.0032+.92*sin(along*.0083));
        float curl=sin(along*.0092+age*.045)+.54*sin(along*.021-age*.073)+.22*sin(along*.038);
        float shear=1.-exp(-age*.15);
        across-=age*1.38+(3.6*sqrt(age)+age*.80)*shear*curl;
        float expansion=2.2+age*(.69+.52*breakup);
        float vortex=6.+2.6*sin(age*.38)*exp(-.040*age);
        float billow=sin(along*.026+curl)*shear;
        float left=(across-vortex-2.9*billow)/(expansion*(1.+.22*billow));
        float right=(across+vortex+2.4*billow)/(expansion*(1.-.18*billow));
        float twin=.55*exp(-.76*left*left)+.55*exp(-.76*right*right);
        float filaments=.5+.5*sin(across/(expansion*.43+1.)+along*.013+1.45*curl);
        float air=twin*lerp(1.,.23+.77*filaments,smoothstep(.8,14.,age));
        float alpha=.78*air*smoothstep(.25,1.15,age)*exp(-.018*age)
                   *(1-smoothstep(46.-18.*breakup,100.-18.*breakup,age));
        float daylight=dot(Weights,float3(1,.52,.18));
        return lerp(background,panorama+float3(.92,.93,.94)*daylight*max(1.,dot(panorama,float3(.22,.66,.12))),alpha*daylight);
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


def painted_masonry(name, tint, textures, height=None):
    asset = material(name)
    tex = texture_nodes(asset, textures)
    world = expression(asset, unreal.MaterialExpressionWorldPosition)
    if height:
        pom = expression(asset, unreal.MaterialExpressionMaterialFunctionCall)
        function = unreal.load_asset("/Engine/Functions/Engine_MaterialFunctions01/Texturing/ParallaxOcclusionMapping")
        if not pom.set_material_function(function):
            raise RuntimeError("Could not load the engine's parallax occlusion function")
        height_object = expression(asset, unreal.MaterialExpressionTextureObject, texture=height,
                                   sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_GRAYSCALE)
        link(height_object, pom, "Heightmap Texture")
        channel = expression(asset, unreal.MaterialExpressionConstant4Vector, constant=unreal.LinearColor(1, 0, 0, 0))
        link(channel, pom, "Heightmap Channel")
        link(number(asset, .024), pom, "Height Ratio")
        link(number(asset, 6), pom, "Min Steps")
        link(number(asset, 18), pom, "Max Steps")
        coordinates = expression(asset, unreal.MaterialExpressionQualitySwitch)
        link(expression(asset, unreal.MaterialExpressionTextureCoordinate), coordinates, "Default")
        link(pom, coordinates, "High", "Parallax UVs")
        for node in tex.values():
            link(coordinates, node, "")
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


def volcano_surface(textures, height):
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
    displacement = expression(asset, unreal.MaterialExpressionTextureSample, texture=height,
                              sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_GRAYSCALE)
    link(detail, displacement, "")
    asset.set_editor_property("enable_tessellation", True)
    asset.set_editor_property("enable_displacement_fade", True)
    asset.set_editor_property("displacement_scaling", unreal.DisplacementScaling(magnitude=35., center=.5))
    asset.set_editor_property("displacement_fade_range", unreal.DisplacementFadeRange(start_size_pixels=5., end_size_pixels=1.5))
    unreal.CoralMaterialAuthoring.set_displacement_height(asset, displacement)
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
    if not normal.get_editor_property("flip_green_channel"):
        normal.set_editor_property("flip_green_channel", True)
        ASSETS.save_loaded_asset(normal)
    tex = texture_nodes(asset, {"color":color, "normal":normal})
    from_space = unreal.MaterialVectorCoordTransformSource
    to_space = unreal.MaterialVectorCoordTransform
    local_normal = expression(asset, unreal.MaterialExpressionTransform,
                              transform_source_type=from_space.TRANSFORMSOURCE_WORLD,
                              transform_type=to_space.TRANSFORM_LOCAL)
    link(expression(asset, unreal.MaterialExpressionPixelNormalWS), local_normal, "")
    space = unreal.MaterialPositionTransformSource
    relative = expression(asset,unreal.MaterialExpressionTransformPosition,
                          transform_source_type=space.TRANSFORMPOSSOURCE_WORLD,transform_type=space.TRANSFORMPOSSOURCE_LOCAL)
    link(expression(asset,unreal.MaterialExpressionWorldPosition),relative,"")
    shade = shader(asset, """
        float up = normalize(N).z;
        float flank = (1-smoothstep(-94,-49,P.z)) * (1-smoothstep(.04,.62,up));
        float belly = (1-smoothstep(-126,-97,P.z)) * (1-smoothstep(-.64,-.14,up));
        float3 pigment = lerp(float3(.19,.27,.29),float3(.34,.45,.46),flank);
        return Skin*lerp(pigment,float3(.70,.75,.72),belly);
        """, {"Skin":tex["color"], "N":local_normal, "P":relative}, OUTPUT.CMOT_FLOAT3)
    assign(shade, PROP.MP_BASE_COLOR)
    assign(tex["normal"], PROP.MP_NORMAL)
    assign(number(asset,.52), PROP.MP_ROUGHNESS)
    assign(number(asset,.24), PROP.MP_SPECULAR)
    current = expression(asset, unreal.MaterialExpressionVectorParameter, parameter_name="SwimStroke",
                         use_custom_primitive_data=True, primitive_data_index=0)
    previous = expression(asset, unreal.MaterialExpressionVectorParameter, parameter_name="PreviousSwimStroke",
                          use_custom_primitive_data=True, primitive_data_index=4)
    uv = expression(asset, unreal.MaterialExpressionTextureCoordinate, coordinate_index=1)
    rest = expression(asset, unreal.MaterialExpressionPreSkinnedPosition)
    bend = shader(asset, """
        // Pin the dorsal tip and let the tail curve into the turn below the surface.
        float aft = saturate(-P.x/215.);
        float fore = saturate(P.x/220.);
        float tail = 100*dot(UV*2-1,Swim.xy);
        return float3(0, tail+(aft*aft+.24*fore*fore)*Swim.z, -aft*aft*Swim.w);
        """, {"UV":uv, "Swim":previous_frame(asset, (current,"RGBA"), (previous,"RGBA")),
              "P":rest}, OUTPUT.CMOT_FLOAT3)
    world_bend = expression(asset, unreal.MaterialExpressionTransform,
                            transform_source_type=from_space.TRANSFORMSOURCE_LOCAL,
                            transform_type=to_space.TRANSFORM_WORLD)
    link(bend, world_bend, "")
    assign(world_bend, PROP.MP_WORLD_POSITION_OFFSET)
    asset.set_editor_property("max_world_position_offset_displacement", 115)
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
    rock_height = None

    def maps():
        nonlocal pbr_maps
        if pbr_maps is None:
            pbr_maps = import_textures(source)
        return pbr_maps

    def heightmap():
        nonlocal rock_height
        if rock_height is None:
            rock_height = import_texture(source / "rock_face", "rock_face_disp_2k", "height")
        return rock_height

    builders = {
        "flight_banner": ("M_FlightBanner",lambda name: flight_banner(name,source)),
        "display_smoke": ("M_DisplaySmoke",display_smoke),
        "aircraft_paint": ("M_AircraftPaint", aircraft_paint),
        "tanker": ("M_ProductTanker", lambda name: marine_finish(name,source,"product",176)),
        "lng": ("M_GasCarrier", lambda name: marine_finish(name,source,"gas",184)),
        "blue_whale": ("M_BlueWhale", lambda _: blue_whale_skin(source)),
        "reef_shark": ("M_ReefShark", lambda _: reef_shark_skin(source)),
        "entry_bubble": ("M_EntryBubble", entry_bubble),
        "underwater_optics": ("M_UnderwaterOptics", underwater_optics),
        "dune_grass": ("M_DuneGrass", lambda name: shore_blades(name,False)),
        "sea_grass": ("M_SeaGrass", lambda name: shore_blades(name,True)),
        "reef_coral": ("M_ReefCoral", reef_coral_skin),
        "station_lens": ("M_StationLens", lambda _: fresnel_lens()),
        "ground": ("M_CoastalGround", lambda _: ground(maps(), forest_floor_maps(source))),
        "water": ("M_CoralWater", lambda _: water(source)),
        "breaker_lip": ("M_BreakerLip", lambda name: breaker_lip(name,source)),
        "spindrift": ("M_StormSpindrift", lambda _: storm_spindrift(source)),
        "leaves": ("M_PalmFronds", lambda _: foliage()),
        "canopy": ("M_CoastalCanopy", lambda _: coastal_canopy()),
        "cloud": ("M_CoralCloudVolume", lambda _: tropical_clouds()),
        "ash": ("M_EruptionColumn", lambda _: eruption_column()),
        "distant_sky": ("M_TradeWindSky", lambda _: distant_sky(source)),
        "bark": ("M_PalmBark", lambda name: pbr(name, maps()["palm_tree_bark"])),
        "rock": ("M_TidalRock", lambda name: pbr(name, maps()["coast_rocks_03"], arm=True, wet=True)),
        "boulder": ("M_Boulder", lambda name: pbr(name, maps()["boulder_01"], arm=True, wet=True)),
        "volcano": ("M_VolcanicRock", lambda _: volcano_surface(maps()["rock_face"], heightmap())),
        "plaster": ("M_LighthouseStone", lambda name: painted_masonry(name, (.81,.78,.70), maps()["rock_face"], heightmap())),
        "paint": ("M_LighthouseRed", lambda name: painted_masonry(name, (.62,.087,.047), maps()["rock_face"])),
        "concrete": ("M_QuayConcrete", lambda name: painted_masonry(name, (.32,.31,.25), maps()["rock_face"], heightmap())),
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
            """, "return .038*Sun + float3(.32,.38,.44) / max(Eye, .00001);")),
        "lightning": ("M_Lightning", lambda name: transparent_effect(name, """
            float x = abs(UV.x*2-1); return Strength*Flash*(exp(-x*x*25)*.24 + exp(-x*x*136)*.76);
            """, "return float3(12000,31000,75000);", unreal.BlendMode.BLEND_ADDITIVE)),
    }
    for kind in ("Red","Blue"):
        builders["crab_"+kind.lower()] = (f"M_Crab{kind}",lambda _,kind=kind: crab_material(kind,source))
    builders["skipper"] = ("M_Skipper", lambda name: pbr(name,baked_maps(source,"skipper"),arm=True,skin=True))
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
    for role in ("ground", "leaves", "bark", "canopy", "rock", "boulder", "volcano", "dune_grass", "sea_grass", "reef_coral"):
        asset = result[role]
        required = (nanite, instances) if role in ("leaves", "bark", "canopy", "dune_grass", "sea_grass", "reef_coral") else (nanite,)
        missing = [usage for usage in required if not EDIT.has_material_usage(asset, usage)]
        if missing:
            for usage in missing:
                EDIT.set_material_usage(asset, usage)
            save(asset)
    return result
