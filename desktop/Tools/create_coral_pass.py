"""Import and assemble the playable Coral Pass level with Unreal's Python commandlet."""

import math
import os
from pathlib import Path
import random
import re
import sys

import unreal

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coastal_layout import CAYS, LIGHTHOUSE, VOLCANO_X, VOLCANO_Y, relief, volcano_relief
from coastal_materials import ASSETS, ROOT, TOOLS, create_materials


SOURCES = Path(__file__).resolve().parents[1] / "Saved" / "CoastalSources"
LEVEL = "/Game/Maps/CoralPass"
LEVELS = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
ACTORS = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
SHAPES = "/Engine/BasicShapes"
REIMPORT = {name.strip() for name in os.environ.get("SAILING_REIMPORT_MESHES", "").split(",")}


def cm(position):
    return unreal.Vector(*(v * 100 for v in position))


def spawn(cls, label, position=(0, 0, 0), pitch=0, yaw=0):
    actor = ACTORS.spawn_actor_from_class(cls, cm(position), unreal.Rotator(pitch=pitch, yaw=yaw))
    if not actor:
        raise RuntimeError(f"Could not spawn {label}")
    actor.set_actor_label(label)
    return actor


def cpp(name):
    return unreal.load_class(None, f"/Script/SailingSimulatorDesktop.{name}")


def configure(obj, **settings):
    for key, value in settings.items():
        obj.set_editor_property(key, value)


def import_mesh(name, material, *, nanite=True, collision=False, foliage=False):
    target = f"{ROOT}/Meshes/SM_{name}"
    mesh = ASSETS.load_asset(target) if ASSETS.does_asset_exist(target) else None
    refresh = mesh is not None and ("1" in REIMPORT or name in REIMPORT)
    if not mesh or refresh:
        ui = unreal.FbxImportUI()
        configure(ui, import_as_skeletal=False, import_mesh=True, import_materials=False, import_textures=False,
                  mesh_type_to_import=unreal.FBXImportType.FBXIT_STATIC_MESH, automated_import_should_detect_type=False)
        data = ui.get_editor_property("static_mesh_import_data")
        configure(data, combine_meshes=True, auto_generate_collision=False, generate_lightmap_u_vs=False,
                  build_nanite=nanite, remove_degenerates=True, convert_scene=True, convert_scene_unit=True,
                  import_mesh_lods=False, vertex_color_import_option=unreal.VertexColorImportOption.REPLACE,
                  normal_import_method=unreal.FBXNormalImportMethod.FBXNIM_IMPORT_NORMALS)
        task = unreal.AssetImportTask()
        configure(task, filename=str(SOURCES / f"{name}.fbx"), destination_path=f"{ROOT}/Meshes",
                  destination_name=f"SM_{name}", factory=unreal.FbxFactory(), options=ui, automated=True,
                  replace_existing=refresh, save=True)
        TOOLS.import_asset_tasks([task])
        objects = [asset for asset in task.get_objects() if isinstance(asset, unreal.StaticMesh)]
        if len(objects) != 1:
            raise RuntimeError(f"Expected one mesh from {name}; found {task.get_editor_property('imported_object_paths')}")
        mesh = objects[0]
        if mesh.get_name() != f"SM_{name}":
            if not ASSETS.rename_loaded_asset(mesh, target):
                raise RuntimeError(f"Could not rename {mesh.get_path_name()} to {target}")
            mesh = ASSETS.load_asset(target)

    slots = mesh.get_editor_property("static_materials")
    for index, slot in enumerate(slots):
        slot_name = str(slot.get_editor_property("imported_material_slot_name")).lower()
        # The FBX importer may append a suffix to duplicate source materials.
        source_name = re.sub(r"_ncl\d*_\d+$", "", slot_name)
        selected = material[source_name] if isinstance(material, dict) else material
        if mesh.get_material(index) != selected:
            mesh.set_material(index, selected)
    settings = mesh.get_editor_property("nanite_settings")
    preserve_area = unreal.NaniteShapePreservation.PRESERVE_AREA
    if settings.get_editor_property("enabled") != nanite or (foliage and settings.get_editor_property("shape_preservation") != preserve_area):
        settings.set_editor_property("enabled", nanite)
        if foliage:
            settings.set_editor_property("shape_preservation", preserve_area)
        mesh.set_editor_property("nanite_settings", settings)
    if collision:
        shape = mesh.get_editor_property("body_setup")
        trace = unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE
        if shape.get_editor_property("collision_trace_flag") != trace:
            shape.set_editor_property("collision_trace_flag", trace)
    if not ASSETS.save_loaded_asset(mesh):
        raise RuntimeError(f"Could not save {target}")
    bounds = mesh.get_bounding_box()
    unreal.log(f"Coral Pass mesh {name}: {len(slots)} material slots, min {bounds.min} max {bounds.max}")
    return mesh


def static(label, mesh, position, *, yaw=0, scale=(1, 1, 1), material=None, collision=False):
    actor = spawn(unreal.StaticMeshActor, label, position, yaw=yaw)
    component = actor.static_mesh_component
    component.set_static_mesh(mesh)
    if material:
        component.set_material(0, material)
    component.set_collision_profile_name("BlockAll" if collision else "NoCollision")
    actor.set_actor_scale3d(unreal.Vector(*scale))
    return actor


def plant_cay(cay, meshes, density):
    rng = random.Random(f"coral-pass/{cay.name}")
    groups = [[], [], []]
    planted = []
    for _ in range(density * 9):
        if len(planted) == density:
            break
        x, y = rng.uniform(-0.95, 0.95) * cay.length, rng.uniform(-0.92, 0.92) * cay.width
        height, greenery, stone = relief(cay, x, y)
        if height < 1.6 or greenery < 0.58 or stone > 0.68 or any((x - px)**2 + (y - py)**2 < 34 for px, py in planted):
            continue
        planted.append((x, y))
        scale = rng.uniform(0.59, 1.29)
        transform = unreal.Transform(
            location=cm((x, y, height - 0.28)), rotation=unreal.Rotator(yaw=rng.uniform(-180, 180)),
            scale=unreal.Vector(scale, scale, scale * rng.uniform(0.83, 1.11)))
        groups[rng.randrange(3)].append(transform)
    for variant, transforms in enumerate(groups):
        if transforms:
            grove = spawn(cpp("SailingGrove"), f"{cay.name} coconut grove {variant + 1}", (cay.x, cay.y, 0))
            grove.plant(meshes[variant], transforms)


def make_dock(material):
    cube, post, cap = (unreal.load_asset(f"{SHAPES}/{name}") for name in ("Cube", "Cylinder", "Cone"))
    # The quay and light mark the harbor beyond the starting run of open water.
    for i in range(10):
        y = -11 + 11 * i
        static(f"Quay wall {i+1}", cube, (472, y, -.72), scale=(21, 10.96, 6.3), material=material["concrete"], collision=True)
        static(f"Granite coping {i+1}", cube, (462.1, y, 2.55), scale=(1.45, 10.94, .43), material=material["plaster"])
        static(f"Rubber fender {i+1}", cube, (461.4, y, .71), scale=(.65, 1.15, 2.2), material=material["rubber"])
        static(f"Mooring bollard {i+1}", post, (463.2, y, 2.93), scale=(.58,.58,.54), material=material["steel"])
    for i, (y, width) in enumerate(((36, 19), (62, 22), (88, 17))):
        static(f"Harbor warehouse {i+1}", cube, (471,y,5.8), scale=(14,width,6.5), material=material["plaster"])
        static(f"Warehouse roof {i+1}", cube, (471,y,9.21), scale=(14.9,width+.64,.44), material=material["concrete"])
    for index, (x, y) in enumerate(((129, 42), (178, -34), (252, 64), (273, -38), (378, 81), (397, -51))):
        color = material["red"] if index % 2 else material["green"]
        static(f"Channel float {index + 1}", post, (x, y, -.02), scale=(.88, .88, .6), material=color)
        static(f"Channel stem {index + 1}", post, (x, y, .60), scale=(.24, .24, 1.3), material=color)
        static(f"Channel topmark {index + 1}", cap, (x, y, 1.36), scale=(.42, .42, .42), material=color)
        static(f"Channel lens {index + 1}", post, (x, y, 1.63), scale=(.20,.20,.16), material=material["warm"])


def atmosphere(material):
    sky_atmosphere = spawn(unreal.SkyAtmosphere, "Atmosphere")
    sky_atmosphere.get_component_by_class(unreal.SkyAtmosphereComponent).set_aerial_pespective_view_distance_scale(1.05)
    dome = static("Distant cloud layer", unreal.load_asset(f"{SHAPES}/Sphere"), (0, 0, 0),
                  scale=(220000, 220000, 220000), material=material["distant_sky"])
    dome.static_mesh_component.set_cast_shadow(False)
    dome.static_mesh_component.set_visible_in_ray_tracing(False)
    sun = spawn(unreal.DirectionalLight, "Sun", pitch=-30, yaw=198)
    day = sun.get_component_by_class(unreal.DirectionalLightComponent)
    day.set_mobility(unreal.ComponentMobility.MOVABLE)
    day.set_intensity(83000)
    configure(day, atmosphere_sun_light=True, light_source_angle=1.1, cast_cloud_shadows=True, cast_volumetric_shadow=True,
              cloud_shadow_strength=.78, cloud_shadow_on_atmosphere_strength=1.0, cloud_shadow_on_surface_strength=.78,
              cloud_shadow_extent=10, cloud_shadow_map_resolution_scale=1.5, volumetric_scattering_intensity=1.7)

    moon = spawn(unreal.DirectionalLight, "Moon", pitch=-14, yaw=163)
    night = moon.get_component_by_class(unreal.DirectionalLightComponent)
    night.set_mobility(unreal.ComponentMobility.MOVABLE)
    night.set_intensity(0)
    night.set_light_color(unreal.LinearColor(.60,.71,1.0))
    configure(night, atmosphere_sun_light=True, atmosphere_sun_light_index=1, light_source_angle=.53,
              atmosphere_sun_disk_color_scale=unreal.LinearColor(1300,1450,1800), volumetric_scattering_intensity=1.5)

    clouds = spawn(unreal.VolumetricCloud, "Weather clouds")
    cloud = clouds.get_component_by_class(unreal.VolumetricCloudComponent)
    cloud_mat = material["cloud"]
    cloud.set_material(cloud_mat)
    cloud.set_render_in_main_pass(True)
    cloud.set_visible_in_real_time_sky_captures(True)
    configure(cloud, layer_bottom_altitude=.12, layer_height=3.8,
              tracing_start_max_distance=42, tracing_max_distance=13, view_sample_count_scale=1.5,
              shadow_view_sample_count_scale=1.2)
    cloud.set_reflection_view_sample_count_scale(.72)
    cloud.set_shadow_reflection_view_sample_count_scale(.62)

    ambient = spawn(unreal.SkyLight, "Sky and sea reflections", position=(0, 0, 20))
    sky = ambient.get_component_by_class(unreal.SkyLightComponent)
    sky.set_mobility(unreal.ComponentMobility.MOVABLE)
    configure(sky, real_time_capture=True, intensity=1.04, lower_hemisphere_is_black=True,
              lower_hemisphere_color=unreal.LinearColor(.008,.017,.018), cubemap_resolution=256)

    haze = spawn(unreal.ExponentialHeightFog, "Sea mist and sun shafts")
    fog = haze.get_component_by_class(unreal.ExponentialHeightFogComponent)
    fog.set_fog_density(.0053)
    fog.set_fog_height_falloff(.22)
    fog.set_fog_max_opacity(.94)
    fog.set_fog_inscattering_color(unreal.LinearColor(0,0,0))
    fog.set_directional_inscattering_color(unreal.LinearColor(0,0,0))
    fog.set_volumetric_fog(True)
    fog.set_volumetric_fog_scattering_distribution(.60)
    fog.set_volumetric_fog_extinction_scale(1.18)
    fog.set_volumetric_fog_distance(210000.0)
    fog.set_volumetric_fog_albedo(unreal.Color(229,237,240,255))

    post = spawn(unreal.PostProcessVolume, "Exposure and optics")
    settings = post.get_editor_property("settings")
    for name, value in {"auto_exposure_min_brightness": -6.4, "auto_exposure_max_brightness": 14.5,
                        "auto_exposure_bias": 0.13, "bloom_intensity": .23, "lens_flare_intensity": .012,
                        "vignette_intensity": .11, "motion_blur_amount": 0.08}.items():
        override = f"override_{name}"
        settings.set_editor_property(override, True)
        settings.set_editor_property(name, value)
    configure(post, unbound=True, settings=settings)

    weather = spawn(cpp("SailingWeather"), "Weather controls")
    configure(weather, sun=sun, moon=moon, clouds=clouds, cloud_material=cloud_mat, sky=ambient, sky_dome=dome,
              fog=haze, optics=post,
              rain_material=material["rain"], lightning_material=material["lightning"])


def volcano_groves(palms):
    rng = random.Random("coral-pass/volcano")
    groups = [[] for _ in palms]
    for _ in range(1500):
        x, y = rng.uniform(-675, 675), rng.uniform(-675, 675)
        height, green = volcano_relief(x, y)
        if green < .73 or height > 118:
            continue
        scale = rng.uniform(.57, .94)
        transform = unreal.Transform(location=cm((x, y, height - .4)), rotation=unreal.Rotator(yaw=rng.uniform(-180,180)),
                                     scale=unreal.Vector(scale, scale, scale*rng.uniform(.81,1.18)))
        groups[rng.randrange(len(palms))].append(transform)
    for i, (palm, transforms) in enumerate(zip(palms, groups)):
        grove = spawn(cpp("SailingGrove"), f"Volcano foothill grove {i+1}", (VOLCANO_X, VOLCANO_Y, 0))
        grove.plant(palm, transforms)


def rocky_shore_and_reef(boulder):
    rng = random.Random("coral-pass/shoals")
    x0, y0, _ = LIGHTHOUSE
    for i in range(30):
        theta = rng.uniform(0, math.tau)
        radius = rng.uniform(.72, 1.06)
        scale = rng.uniform(.8, 4.4)
        static(f"Lighthouse rock {i+1}", boulder,
               (x0+math.cos(theta)*27*radius, y0+math.sin(theta)*20*radius, rng.uniform(-.95,.40)),
               yaw=rng.uniform(-180,180), scale=(scale,scale,scale*rng.uniform(.64,.94)))
    for i in range(31):
        x, y = rng.uniform(-38, 103), rng.uniform(26, 51)
        z = -18.3 + 12.5*math.sqrt(max(0,1-((x-32)/88)**2-((y-29)/37)**2))
        scale = rng.uniform(1.2, 3.8)
        static(f"Shallow reef outcrop {i+1}", boulder, (x,y,z-.51), yaw=rng.uniform(-180,180),
               scale=(scale,scale,scale*rng.uniform(.66,1.23)))


def build_level(material, meshes, cays, palms):
    if ASSETS.does_asset_exist(LEVEL):
        if not LEVELS.load_level(LEVEL):
            raise RuntimeError(f"Could not open {LEVEL}")
        for actor in ACTORS.get_all_level_actors():
            tags = actor.get_editor_property("tags")
            if "CoralPassGenerated" in [str(tag) for tag in tags]:
                ACTORS.destroy_actor(actor)
    elif not LEVELS.new_level(LEVEL):
        raise RuntimeError(f"Could not create {LEVEL}")
    existing = set(ACTORS.get_all_level_actors())

    floor = unreal.load_asset(f"{SHAPES}/Cube")
    static("Deep seabed", floor, (0, 0, -41), scale=(6500, 6500, 1.0), material=material["ground"], collision=True)
    static("Reef shelf", unreal.load_asset(f"{SHAPES}/Sphere"), (32,29,-18.3), scale=(176,74,25), material=material["ground"])
    for index, cay in enumerate(CAYS):
        static(cay.name, cays[cay.name], (cay.x, cay.y, 0), collision=True)
        plant_cay(cay, palms, (118, 87, 119, 100, 65, 0)[index])

    static("Volcano and lava fields", meshes["volcano"], (VOLCANO_X,VOLCANO_Y,0), collision=True)
    volcano_groves(palms)
    static("Coral Pass light", meshes["lighthouse"], LIGHTHOUSE)
    for i, (x, y, heading, size) in enumerate(((-9,-6,28,.92), (8,-9,105,1.05), (-14,2,173,.84), (10,-3,63,.76))):
        height, _, _ = relief(CAYS[-1], x, y)
        static(f"Lighthouse palm {i+1}", palms[i % len(palms)], (LIGHTHOUSE[0]+x,LIGHTHOUSE[1]+y,height-.18),
               yaw=heading, scale=(size,size,size))
    static("Container ship at anchor", meshes["ship"], (502, 26, -.20), yaw=91, collision=True)
    static("Distant merchant ship", meshes["ship"], (1280, -170, 0), yaw=-145, scale=(.95,.95,.95), collision=True)
    rocky_shore_and_reef(meshes["boulder"])

    # The full-resolution scan is used at shoreline scale and as larger headland outcrops.
    placements = [(244, 118, -.57, -43, 1.0), (253, 111, -.7, -16, 1.3), (292, 89, -.35, 13, .85),
                  (367, 74, -.28, 168, 1.2), (415, 92, 1.0, 34, .93), (268, -30, -.42, 79, 1.13),
                  (390, -294, -.72, -31, 2.0), (430, -305, 2.9, -11, 1.24),
                  (483, -309, 11.5, 127, 1.7), (455, -379, 11.2, 62, 2.5),
                  (777, 150, .24, 32, 1.42), (905, 147, 0.10, -41, 1.0)]
    for i, (x, y, z, yaw, scale) in enumerate(placements):
        static(f"Scanned headland {i + 1}", meshes["rocks"], (x, y, z), yaw=yaw, scale=(scale, scale, scale), collision=False)
    make_dock(material)
    spawn(unreal.PlayerStart, "Free sailing start", (0, 0, .14), yaw=8)
    sea = spawn(cpp("SailingSea"), "Open sea")
    configure(sea, water_material=material["water"])
    wake = spawn(cpp("SailingWake"), "Catamaran wake and prop wash")
    configure(wake, foam_material=material["foam"])
    dolphin = spawn(cpp("SailingDolphinPod"), "Dolphins in the pass")
    configure(dolphin, dolphin_mesh=meshes["dolphin"])
    atmosphere(material)

    for actor in set(ACTORS.get_all_level_actors()) - existing:
        actor.set_editor_property("tags", ["CoralPassGenerated"])
    if not LEVELS.save_current_level():
        raise RuntimeError(f"Could not save {LEVEL}")
    unreal.log(f"Created playable level {LEVEL}")


def main():
    material = create_materials(SOURCES)
    if os.environ.get("SAILING_MATERIALS_ONLY") == "1":
        return
    lighthouse = {"lighthousestone": material["plaster"], "lighthousered": material["paint"],
                  "steel": material["steel"], "lampglass": material["lantern"], "beacon": material["beacon"]}
    meshes = {
        "rocks": import_mesh("CoastRocks", material["rock"]),
        "boulder": import_mesh("Boulder", material["boulder"]),
        "volcano": import_mesh("Volcano", material["volcano"], collision=True),
        "lighthouse": import_mesh("Lighthouse", lighthouse, nanite=False),
        "ship": import_mesh("ContainerShip", {name: material[f"ship_{name}"] for name in ("hull", "bridge", "containers")},
                            nanite=False, collision=True),
        "dolphin": import_mesh("Dolphin", {name: value for name, value in material.items() if name.startswith("dolphin_")},
                                nanite=False),
    }
    cays = {cay.name: import_mesh(cay.name, material["ground"], collision=True) for cay in CAYS}
    palms = [import_mesh(f"CoconutPalm{i}", {"palmbark": material["bark"], "palmfronds": material["leaves"]},
                         foliage=True) for i in range(1, 4)]
    yacht = {"rough_white": material["gelcoat"], "white_fiberglass": material["gelcoat"],
             "glass": material["glass"], "stainless_stile": material["steel"], "cloth": material["sail"],
             "black": material["rubber"], "material_0": material["steel"], "material_002": material["wood"],
             "material.002": material["wood"]}
    for name in ("Catamaran", "CatamaranRig", "CatamaranJib"):
        import_mesh(name, yacht, nanite=False)
    import_mesh("Skipper", material["skipper"], nanite=False)
    build_level(material, meshes, cays, palms)


main()
