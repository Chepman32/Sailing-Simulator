"""Import and assemble the playable Coral Pass level with Unreal's Python commandlet."""

import math
import os
from pathlib import Path
import random
import re
import sys

import unreal

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coastal_layout import CAYS, LIGHTHOUSE, VOLCANO_X, VOLCANO_Y, VOLCANO_RIM, reef_floor, relief, terrain_noise, volcano_relief
from coastal_materials import (ASSETS, ROOT, TOOLS, channel_beacon_material, coastal_weather_collection,
                               create_materials, downloaded_coastal_materials)


SOURCES = Path(__file__).resolve().parents[1] / "Saved" / "CoastalSources"
LEVEL = "/Game/Maps/CoralPass"
LEVELS = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
ACTORS = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
SHAPES = "/Engine/BasicShapes"
REIMPORT = {name.strip() for name in os.environ.get("SAILING_REIMPORT_MESHES", "").split(",")}
COASTAL_MODELS = ("CoconutPalm", "IslandTree02", "JacarandaTree", "LateralSeaMarker")
UNDERSTORY_MODELS = ("Fern02", "Anthurium")
UNDERSTORY_TAG = "SailingUnderstory"
REEF_GROWTH_TAG = "SailingReefGrowth"
BUOY_SCALE = .58
CHANNEL_MOORINGS = ((129, 42), (178, -34), (252, 64), (273, -38), (378, 63), (397, -51))
FOLIAGE_WIND_DISTANCE_CM = 8000


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


def enable_mesh_collision(mesh, *, double_sided=False, preserve_triangles=False):
    if preserve_triangles:
        # Chaos reads the Nanite fallback. Keep the shallow peaks of the reef in it.
        settings = mesh.get_editor_property("nanite_settings")
        target = unreal.NaniteFallbackTarget.PERCENT_TRIANGLES
        if settings.get_editor_property("fallback_target") != target or settings.get_editor_property("fallback_percent_triangles") != 1.0:
            configure(settings, fallback_target=target, fallback_percent_triangles=1.0)
            mesh.set_editor_property("nanite_settings", settings)
    shape = mesh.get_editor_property("body_setup")
    trace = unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE
    if shape.get_editor_property("collision_trace_flag") != trace:
        shape.set_editor_property("collision_trace_flag", trace)
    if double_sided and not shape.get_editor_property("double_sided_geometry"):
        shape.set_editor_property("double_sided_geometry", True)


def reduction_lods(mesh, levels, *, refresh=False):
    editor = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
    if not refresh and editor.get_lod_count(mesh) == len(levels):
        return
    lods = unreal.StaticMeshReductionOptions()
    reductions = []
    for fraction, screen in levels:
        level = unreal.StaticMeshReductionSettings()
        configure(level, percent_triangles=fraction, screen_size=screen)
        reductions.append(level)
    configure(lods, auto_compute_lod_screen_size=False, reduction_settings=reductions)
    if editor.set_lods(mesh, lods) != len(reductions):
        raise RuntimeError(f"Could not build the distance levels for {mesh.get_name()}")


def import_mesh(name, material, *, nanite=True, collision=False, foliage=False):
    target = f"{ROOT}/Meshes/SM_{name}"
    mesh = ASSETS.load_asset(target) if ASSETS.does_asset_exist(target) else None
    refresh = mesh is not None and ("1" in REIMPORT or name in REIMPORT)
    if not mesh or refresh:
        # Interchange matches individual source nodes on reimport. These FBXs are
        # single combined meshes whose constituent hulls, sails and rigging can change.
        unreal.SystemLibrary.execute_console_command(None, "Interchange.FeatureFlags.Import.FBX 0")
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
                  replace_existing=refresh, replace_existing_settings=True, save=True)
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
        enable_mesh_collision(mesh, double_sided=name in ("Boulder", "CoastRocks", "ProductTanker", "GasCarrier", "SirensLight"),
                              preserve_triangles=name == "ReefShelf")
    if name in ("ProductTanker","GasCarrier","SirensLight"):
        reduction_lods(mesh, ((1., 1.), (.42, .32), (.14, .11)), refresh=refresh)
    if not ASSETS.save_loaded_asset(mesh):
        raise RuntimeError(f"Could not save {target}")
    bounds = mesh.get_bounding_box()
    unreal.log(f"Coral Pass mesh {name}: {len(slots)} material slots, min {bounds.min} max {bounds.max}")
    return mesh


def import_coastal_models():
    paths = {name: f"{ROOT}/Meshes/SM_{name}" for name in (*COASTAL_MODELS, *UNDERSTORY_MODELS)}
    rebuild = ("1" in REIMPORT or any(name in REIMPORT for name in paths)
               or bool(os.environ.get("SAILING_REFRESH_COASTAL_MATERIALS")))
    if not rebuild and all(ASSETS.does_asset_exist(path) for path in paths.values()):
        return {name: ASSETS.load_asset(path) for name, path in paths.items()}
    textures = downloaded_coastal_materials(SOURCES)
    models = {}
    for name, path in paths.items():
        refresh = "1" in REIMPORT or name in REIMPORT or not ASSETS.does_asset_exist(path)
        foliage = name != "LateralSeaMarker"
        mesh = import_mesh(name, textures[name], foliage=foliage)
        if foliage:
            settings = mesh.get_editor_property("nanite_settings")
            if (settings.get_editor_property("fallback_target") != unreal.NaniteFallbackTarget.PERCENT_TRIANGLES
                    or abs(settings.get_editor_property("fallback_percent_triangles") - .10) > .0001):
                configure(settings, fallback_target=unreal.NaniteFallbackTarget.PERCENT_TRIANGLES,
                          fallback_percent_triangles=.10)
                mesh.set_editor_property("nanite_settings", settings)
            reduction_lods(mesh, ((1., 1.), (.28, .47), (.078, .17), (.018, .061)), refresh=refresh)
            ASSETS.save_loaded_asset(mesh)
        models[name] = mesh
    return models


def static(label, mesh, position, *, yaw=0, scale=(1, 1, 1), material=None, collision=False):
    actor = spawn(unreal.StaticMeshActor, label, position, yaw=yaw)
    component = actor.static_mesh_component
    component.set_static_mesh(mesh)
    if material:
        component.set_material(0, material)
    component.set_collision_profile_name("BlockAll" if collision else "NoCollision")
    actor.set_actor_scale3d(unreal.Vector(*scale))
    return actor


def configure_buoy(actor, mesh, green, scale=BUOY_SCALE):
    component = actor.static_mesh_component
    component.set_mobility(unreal.ComponentMobility.MOVABLE)
    component.set_static_mesh(mesh)
    component.set_material(0, mesh.get_material(0))
    component.set_default_custom_primitive_data_float(0, float(green))
    component.set_collision_profile_name("NoCollision")
    actor.set_actor_scale3d(unreal.Vector(scale, scale, scale))
    location = actor.get_actor_location()
    actor.set_actor_location(unreal.Vector(location.x, location.y, 0), False, True)
    tags = actor.get_editor_property("tags")
    if "SailingChannelBuoy" not in [str(tag) for tag in tags]:
        actor.set_editor_property("tags", [*tags, "SailingChannelBuoy"])


def attach_buoy_lens(actor, lens, mesh, index):
    component = lens.static_mesh_component
    component.set_mobility(unreal.ComponentMobility.MOVABLE)
    component.set_material(0, channel_beacon_material())
    component.set_default_custom_primitive_data_float(0, float(index % 2 == 1))
    component.set_default_custom_primitive_data_float(1, (index // 2) * 1.19)
    top = mesh.get_bounding_box().max.z * actor.get_actor_scale3d().z
    lens.set_actor_location(actor.get_actor_location() + unreal.Vector(0, 0, top + 5.), False, True)
    lens.set_actor_scale3d(unreal.Vector(.145, .145, .11))
    keep = unreal.AttachmentRule.KEEP_WORLD
    lens.attach_to_actor(actor, "", keep, keep, keep, False)


def woodland_groups(transforms):
    coast, jacarandas = [], []
    for index, transform in enumerate(transforms):
        (jacarandas if index % 9 == 3 else coast).append(transform)
    return coast, jacarandas


def plant_woodland(label, position, transforms, trees):
    for suffix, mesh, group in zip(("", " jacarandas"), trees, woodland_groups(transforms)):
        if group:
            grove = spawn(cpp("SailingGrove"), label + suffix, position)
            grove.plant(mesh, group)


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


def plant_understory(models):
    count = 0
    for cay in CAYS:
        if not cay.ridge:
            continue
        long_cay = cay == CAYS[0]
        spacing = 2.45 if long_cay else 5.8
        rng = random.Random(f"forest floor/{cay.name}")
        groups = [[], []]
        for i in range(-int(cay.length / spacing), int(cay.length / spacing) + 1):
            for j in range(-int(cay.width / spacing), int(cay.width / spacing) + 1):
                x, y = (i + rng.uniform(-.46, .46)) * spacing, (j + rng.uniform(-.46, .46)) * spacing
                z, green, rock = relief(cay, x, y)
                damp = terrain_noise(.08 * x + cay.phase, .08 * y)
                if z < 2.2 or green < .42 or rock > .65 or rng.random() > .64 + .31 * damp:
                    continue
                trail = -74 + .18 * (x + 32) + 4 * math.sin((x + 32) / 13)
                if long_cay and -45 < x < 78 and abs(y - trail) < 1.9:
                    continue
                group = groups[int(rng.random() < .30 + .19 * damp)]
                scale = rng.uniform(.57, 1.32)
                group.append(unreal.Transform(location=cm((x, y, z - .09)),
                    rotation=unreal.Rotator(yaw=rng.uniform(-180, 180)), scale=unreal.Vector(scale, scale, scale)))
        for name, transforms in zip(UNDERSTORY_MODELS, groups):
            if not transforms:
                continue
            grove = spawn(cpp("SailingGrove"), f"{cay.name} {name}", (cay.x, cay.y, 0))
            grove.set_editor_property("tags", ["CoralPassGenerated", UNDERSTORY_TAG])
            grove.plant(models[name], transforms)
            component = grove.get_component_by_class(unreal.InstancedStaticMeshComponent)
            component.set_world_position_offset_disable_distance(3800)
            component.set_cull_distances(10500, 14500)
            component.set_visible_in_ray_tracing(False)
            component.set_affect_distance_field_lighting(False)
            count += len(transforms)
    unreal.log(f"Coral Pass understory: {count} planted patches")


def make_dock(material, buoy):
    cube, post = (unreal.load_asset(f"{SHAPES}/{name}") for name in ("Cube", "Cylinder"))
    # The quay and light mark the harbor beyond the starting run of open water.
    for i in range(10):
        y = -205 + 11 * i
        static(f"Quay wall {i+1}", cube, (472, y, -.72), scale=(21, 10.96, 6.3), material=material["concrete"], collision=True)
        static(f"Granite coping {i+1}", cube, (462.1, y, 2.55), scale=(1.45, 10.94, .43), material=material["plaster"])
        static(f"Rubber fender {i+1}", cube, (461.4, y, .71), scale=(.65, 1.15, 2.2), material=material["rubber"])
        static(f"Mooring bollard {i+1}", post, (463.2, y, 2.93), scale=(.58,.58,.54), material=material["steel"])
    for i, (y, width) in enumerate(((-158, 19), (-132, 22), (-106, 17))):
        static(f"Harbor warehouse {i+1}", cube, (471,y,5.8), scale=(14,width,6.5), material=material["plaster"])
        static(f"Warehouse roof {i+1}", cube, (471,y,9.21), scale=(14.9,width+.64,.44), material=material["concrete"])
    for index, (x, y) in enumerate(CHANNEL_MOORINGS, 1):
        marker = static(f"Channel float {index}", buoy, (x, y, 0), yaw=43 * index)
        configure_buoy(marker, buoy, green=index % 2 == 1)
        lens = static(f"Channel lens {index}", post, (x, y, 0))
        attach_buoy_lens(marker, lens, buoy, index)


def plant_grass(cay, mesh):
    rng = random.Random("dune grass/" + cay.name)
    patches = []
    spacing = 2.45 if cay == CAYS[0] else 4.7
    for i in range(-int(cay.length/spacing), int(cay.length/spacing)+1):
        for j in range(-int(cay.width/spacing), int(cay.width/spacing)+1):
            x, y = (i+rng.uniform(-.46,.46))*spacing, (j+rng.uniform(-.46,.46))*spacing
            height, green, rock = relief(cay,x,y)
            patch = terrain_noise(.14*x+4,.11*y-8)
            trail = -74 + .18*(x+32) + 4*math.sin((x+32)/13)
            if cay == CAYS[0] and -45<x<78 and abs(y-trail)<1.3:
                continue
            if .11 < green < .95 and rock < .56 and rng.random() < .52+.36*patch:
                size = rng.uniform(.63,1.38)
                patches.append(unreal.Transform(location=cm((x,y,height-.13)),
                               rotation=unreal.Rotator(yaw=rng.uniform(0,360)), scale=unreal.Vector(size,size,.85*size)))
    if patches:
        grass = spawn(cpp("SailingGrove"), f"{cay.name} dune grass", (cay.x,cay.y,0))
        grass.plant(mesh,patches)
        component = grass.get_component_by_class(unreal.InstancedStaticMeshComponent)
        component.set_world_position_offset_disable_distance(3800)
        component.set_cull_distances(6500,10800)
        component.set_visible_in_ray_tracing(False)
        component.set_affect_distance_field_lighting(False)
        grass.set_editor_property("tags", ["CoralPassGenerated"])


def plant_reef(grass, coral, boulder):
    rng = random.Random("coral-pass/seagrass")
    regions = [("Opening reef", 20, 19, 67, 36, reef_floor)]
    for cay in CAYS[:3]:
        regions.append((cay.name, cay.x, cay.y, 1.18*cay.length, 1.18*cay.width,
                        lambda x,y,cay=cay: relief(cay,x-cay.x,y-cay.y)[:3:2]))
    for name, cx, cy, reach_x, reach_y, seabed in regions:
        groups = [[], []]
        spacing = 3.3 if name in ("Opening reef","LongCay") else 5.4
        for i in range(-int(reach_x/spacing),int(reach_x/spacing)+1):
            for j in range(-int(reach_y/spacing),int(reach_y/spacing)+1):
                lx,ly = (i+rng.uniform(-.48,.48))*spacing, (j+rng.uniform(-.48,.48))*spacing
                x,y = cx+lx,cy+ly
                z,stone = seabed(x,y)
                if not -11.<z<-1.25:
                    continue
                patch = terrain_noise(.18*x+7,.15*y-11)
                if rng.random() > .55+.38*patch:
                    continue
                kind = int(z<-2.1 and rng.random() < .19+.20*stone-.08*patch)
                size = rng.uniform(.68,1.46) if kind else rng.uniform(.52,1.12)
                groups[kind].append(unreal.Transform(
                    location=cm((lx,ly,z-.13)), rotation=unreal.Rotator(yaw=rng.uniform(0,360)),
                    scale=unreal.Vector(size,size,rng.uniform(.61,1.15)*size)))
        for label,mesh,transforms in zip(("seagrass","coral colonies"),(grass,coral),groups):
            if not transforms:
                continue
            patch_actor = spawn(cpp("SailingGrove"),f"{name} {label}",(cx,cy,0))
            patch_actor.plant(mesh,transforms)
            patch_actor.set_editor_property("tags",["CoralPassGenerated",REEF_GROWTH_TAG])
            component = patch_actor.get_component_by_class(unreal.InstancedStaticMeshComponent)
            component.set_cull_distances(4500,8800)
            component.set_world_position_offset_disable_distance(3600)
            component.set_visible_in_ray_tracing(False)
            component.set_affect_distance_field_lighting(False)
            unreal.log(f"Planted {name} {label}: {len(transforms)}")
    # Exposed heads on the outer Long Cay shelf give the coral beds relief.
    # Their high points stay under the navigation clearance of the catamaran.
    cay = CAYS[0]
    bounds = boulder.get_bounding_box()
    sites = [(284,58), (293,69), (302,60), (310,67), (315,57),
             (317,76), (327,66), (338,64), (363,61), (389,56)]
    for index, (x,y) in enumerate(sites, 1):
        depth, _, _ = relief(cay,x-cay.x,y-cay.y)
        if depth >= -2.2:
            continue
        scale = rng.uniform(1.45,2.7)
        vertical = scale*rng.uniform(.57,.81)
        top = bounds.max.z*.01*vertical
        bottom = bounds.min.z*.01*vertical
        base = min(depth-bottom-.26,-2.05-top)
        actor = coastal_rock(f"Long Cay reef head {index}",boulder,(x,y,base),
                             rng.uniform(-180,180),(scale,scale,vertical))
        actor.set_editor_property("tags",["SailingRock","CoralPassGenerated",REEF_GROWTH_TAG])


def atmosphere(material):
    sky_atmosphere = spawn(unreal.SkyAtmosphere, "Atmosphere")
    sky_atmosphere.get_component_by_class(unreal.SkyAtmosphereComponent).set_aerial_pespective_view_distance_scale(1.05)
    dome = static("Distant cloud layer", unreal.load_asset(f"{SHAPES}/Sphere"), (0, 0, 0),
                  scale=(220000, 220000, 220000), material=material["distant_sky"])
    dome.static_mesh_component.set_cast_shadow(False)
    dome.static_mesh_component.set_visible_in_ray_tracing(False)
    sun = spawn(unreal.DirectionalLight, "Sun", pitch=-36, yaw=157)
    day = sun.get_component_by_class(unreal.DirectionalLightComponent)
    day.set_mobility(unreal.ComponentMobility.MOVABLE)
    day.set_intensity(86000)
    configure(day, atmosphere_sun_light=True, light_source_angle=.75, cast_cloud_shadows=True, cast_volumetric_shadow=True,
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
    configure(cloud, layer_bottom_altitude=.94, layer_height=3.2,
              tracing_start_max_distance=42, tracing_max_distance=13, view_sample_count_scale=.77,
              shadow_view_sample_count_scale=.67)
    cloud.set_reflection_view_sample_count_scale(.42)
    cloud.set_shadow_reflection_view_sample_count_scale(.38)

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
              rain_material=material["rain"], lightning_material=material["lightning"],
              coastal_weather=coastal_weather_collection())


def volcano_groves(palms, trees):
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

    crowns = []
    for _ in range(24500):
        x, y = rng.uniform(-675,675),rng.uniform(-675,675)
        height,green = volcano_relief(x,y)
        corridor = .64 + .4*terrain_noise(x*.012,y*.012) + .23*terrain_noise(x*.033,y*.033)
        if green < .30 or rng.random() > green*corridor:
            continue
        size = rng.uniform(.33,.96)
        crowns.append(unreal.Transform(location=cm((x,y,height-.12*size)),
                      rotation=unreal.Rotator(yaw=rng.uniform(-180,180)),scale=unreal.Vector(size,size,size*rng.uniform(.78,1.15))))
    plant_woodland("Volcanic foothill forest", (VOLCANO_X,VOLCANO_Y,0), crowns, trees)


def coastal_rock(label, boulder, position, yaw, scale):
    rock = static(label, boulder, position, yaw=yaw, scale=scale, collision=True)
    rock.set_editor_property("tags", ["SailingRock"])
    return rock


def place_pirate_wreck(ship, boulder):
    # The western shelf of Long Cay gives the rock roots a seabed and leaves the channel open.
    x0, y0, ship_yaw = 190, 168, -53
    wreck = static("The Siren's Light", ship, (x0, y0, 4.65), yaw=ship_yaw, collision=True)
    wreck.set_actor_rotation(unreal.Rotator(yaw=ship_yaw, roll=5), False)
    wreck.set_editor_property("tags", ["SailingPirate"])

    angle = math.radians(ship_yaw)
    c, s = math.cos(angle), math.sin(angle)
    cay = CAYS[0]
    # Along and across the wreck, horizontal scale, crest above water, local yaw.
    # The first two rocks meet the keel where the shelf is deepest.
    rocks = [(-13.5, -.1, 5.1, 1.55, 90), (9.6, .25, 5.5, 1.53, -90),
             (-17.1, -4.3, 3.7, 2.35, 20), (-9.0, 4.8, 3.0, 1.08, -38),
             (1.2, -5.8, 4.0, 1.16, -17), (12.0, -4.8, 3.5, 2.1, -22),
             (13.5, 4.8, 3.2, 1.24, 39), (20.0, -.9, 2.5, .76, 82)]
    rock_height = boulder.get_bounding_box().max.z * .01
    for i, (along, across, size, crest, yaw) in enumerate(rocks):
        x, y = x0 + along*c - across*s, y0 + along*s + across*c
        base = min(relief(cay, x - cay.x + dx*size, y - cay.y + dy*size)[0]
                   for dx, dy in ((0, 0), (-.8, 0), (.8, 0), (0, -.8), (0, .8))) - .4
        rock = coastal_rock(f"Siren's Light reef rock {i+1}", boulder, (x, y, base),
                            ship_yaw + yaw, (size, size, (crest - base)/rock_height))
        rock.set_editor_property("tags", ["SailingRock", "SailingWreckRock"])


def rocky_shore_and_reef(boulder):
    rng = random.Random("coral-pass/shoals")
    x0, y0, _ = LIGHTHOUSE
    for i in range(30):
        theta = rng.uniform(0, math.tau)
        radius = rng.uniform(.72, 1.06)
        scale = rng.uniform(.8, 4.4)
        coastal_rock(f"Lighthouse rock {i+1}", boulder,
                     (x0+math.cos(theta)*27*radius, y0+math.sin(theta)*20*radius, rng.uniform(-.95,.40)),
                     rng.uniform(-180,180), (scale,scale,scale*rng.uniform(.64,.94)))
    for i in range(85):
        x, y = rng.uniform(-44,88),rng.uniform(-8,51)
        z,stone = reef_floor(x,y)
        if stone < .40 or z < -12:
            continue
        scale = rng.uniform(1.2, 3.8)
        vertical = scale*rng.uniform(.55,.87)
        top = boulder.get_bounding_box().max.z * .01 * vertical
        coastal_rock(f"Shallow reef outcrop {i+1}", boulder, (x,y,min(z-.51,-1.75-top)),
                     rng.uniform(-180,180), (scale,scale,vertical))


def container_ship():
    # Reuse the textured hull and reconstructed broadside already in the project.
    path = f"{ROOT}/Meshes/SM_ContainerShip"
    mesh = ASSETS.load_asset(path)
    if not mesh:
        raise RuntimeError(f"Missing the authored container ship at {path}")
    settings = mesh.get_editor_property("nanite_settings")
    if settings.get_editor_property("enabled"):
        configure(settings, enabled=False)
        mesh.set_editor_property("nanite_settings", settings)
    enable_mesh_collision(mesh, double_sided=True)
    ship_lods(mesh)
    if not ASSETS.save_loaded_asset(mesh):
        raise RuntimeError(f"Could not save {path}")
    return mesh


def place_regional_merchants(meshes):
    # Ships in the outer waters cover both sides of each island chain.
    # The four volcano positions keep a visible anchorage on each side of its high ridge.
    berths = (
        ("East Cay container anchorage", "container", (1030, 680, -.18), 18),
        ("Outer Cay LNG anchorage", "lng", (1930, -390, -.15), 79),
        ("South Cay tanker anchorage", "tanker", (-530, 615, -.24), -23),
        ("Volcano pass container anchorage", "container", (745, -1130, -.18), 21),
        ("North volcano tanker anchorage", "tanker", (1945, -2230, -.24), -62),
        ("West volcano LNG anchorage", "lng", (990, -3115, -.15), 13),
        ("South volcano container anchorage", "container", (-100, -2255, -.18), 63),
    )
    ships = []
    for label, model, position, yaw in berths:
        ship = static(label, meshes[model], position, yaw=yaw, collision=True)
        ship.set_editor_property("tags", ["SailingMerchant", "SailingRegionalMerchant"])
        ships.append(ship)
    return ships


def build_level(material, meshes, cays, palms, trees, coastal_models):
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
    static("Reef shelf", meshes["reef"], (0,0,0), collision=True)
    plant_reef(meshes["sea_grass"],meshes["reef_coral"],meshes["boulder"])
    for index, cay in enumerate(CAYS):
        static(cay.name, cays[cay.name], (cay.x, cay.y, 0), collision=True)
        plant_cay(cay, palms, (118, 87, 119, 100, 65, 0)[index])
        plant_grass(cay, meshes["grass"])

        if cay.ridge > 0:
            rng = random.Random("windward scrub/"+cay.name)
            shrubs = []
            for _ in range(1600):
                x,y = rng.uniform(-cay.length,cay.length),rng.uniform(-cay.width,cay.width)
                z,green,rock = relief(cay,x,y)
                if green < .65 or rock > .68:
                    continue
                size = rng.uniform(.36,.94)
                shrubs.append(unreal.Transform(location=cm((x,y,z-size*.12)),
                    rotation=unreal.Rotator(yaw=rng.uniform(-180,180)),scale=unreal.Vector(size,size,size)))
            plant_woodland(f"{cay.name} coastal woodland", (cay.x,cay.y,0), shrubs, trees)

    plant_understory(coastal_models)
    static("Volcano and lava fields", meshes["volcano"], (VOLCANO_X,VOLCANO_Y,0), collision=True)
    volcano_groves(palms,trees)
    plume = static("Eruption column", floor, (VOLCANO_X+37,VOLCANO_Y+76,VOLCANO_RIM+303),
                   scale=(570,650,656), material=material["ash"])
    plume.static_mesh_component.set_cast_shadow(False)
    plume.static_mesh_component.set_visible_in_ray_tracing(False)
    static("Coral Pass light", meshes["lighthouse"], (*LIGHTHOUSE[:2], .25), scale=(1.10,1.10,1.10), collision=True)
    for i, (x, y, heading, size) in enumerate(((-11,-7,28,.92), (6,-13,105,1.05), (-14,2,173,.84), (1,13,63,.76))):
        height, _, _ = relief(CAYS[-1], x, y)
        static(f"Lighthouse palm {i+1}", palms[i % len(palms)], (LIGHTHOUSE[0]+x,LIGHTHOUSE[1]+y,height-.18),
               yaw=heading, scale=(size,size,size))
    for i, (x,y,size) in enumerate(((-10,-6,.46),(5,12,.51),(16,-11,.35),(-13,3,.47),(-2,-12,.43))):
        z,_,_ = relief(CAYS[-1],x,y)
        static(f"Light station thicket {i+1}",trees[int(i in (1,3))],(LIGHTHOUSE[0]+x,LIGHTHOUSE[1]+y,z-.08),
               yaw=i*104,scale=(size,size,size))
    # Keep the tanker parallel to the quay and the carrier visible past the lighthouse from the departure view.
    for label, key, position, yaw in (("Product tanker at the quay","tanker",(439,-155,-.24),-90),
                                      ("LNG carrier at the outer anchorage","lng",(385,-625,-.15),33)):
        ship = static(label, meshes[key], position, yaw=yaw, collision=True)
        ship.set_editor_property("tags", ["SailingMerchant"])
    place_regional_merchants(meshes)
    place_pirate_wreck(meshes["pirate"], meshes["boulder"])
    rocky_shore_and_reef(meshes["boulder"])

    # The full-resolution scan is used at shoreline scale and as larger headland outcrops.
    placements = [(244, 118, -.57, -43, 1.0), (253, 111, -.7, -16, 1.3), (292, 89, -.35, 13, .85),
                  (367, 74, -.28, 168, 1.2), (415, 92, 1.0, 34, .93), (268, -30, -.42, 79, 1.13),
                  (390, -294, -.72, -31, 2.0), (430, -305, 2.9, -11, 1.24),
                  (483, -309, 11.5, 127, 1.7), (455, -379, 11.2, 62, 2.5),
                  (777, 150, .24, 32, 1.42), (905, 147, 0.10, -41, 1.0)]
    for i, (x, y, z, yaw, scale) in enumerate(placements):
        static(f"Scanned headland {i + 1}", meshes["rocks"], (x, y, z), yaw=yaw, scale=(scale, scale, scale), collision=True)
    make_dock(material, meshes["buoy"])
    spawn(unreal.PlayerStart, "Free sailing start", (0, 0, .14), yaw=25)
    sea = spawn(cpp("SailingSea"), "Open sea")
    configure(sea, water_material=material["water"])
    spawn(cpp("SailingWake"), "Catamaran wake and prop wash")
    dolphin = spawn(cpp("SailingDolphinPod"), "Dolphins in the pass")
    configure(dolphin, dolphin_mesh=meshes["dolphin"])
    whale = spawn(cpp("SailingWhales"), "Blue whales offshore")
    configure(whale, whale_mesh=meshes["whale"])
    sharks = spawn(cpp("SailingSharks"), "Reef sharks")
    configure(sharks, shark_mesh=meshes["shark"])
    atmosphere(material)

    for actor in set(ACTORS.get_all_level_actors()) - existing:
        actor.set_editor_property("tags", [*actor.get_editor_property("tags"), "CoralPassGenerated"])
    if not LEVELS.save_current_level():
        raise RuntimeError(f"Could not save {LEVEL}")
    unreal.log(f"Created playable level {LEVEL}")


def main():
    material = create_materials(SOURCES)
    if os.environ.get("SAILING_MATERIALS_ONLY") == "1":
        return
    lighthouse = {key.removeprefix("station_"): value for key,value in material.items() if key.startswith("station_")}
    lighthouse.update(dark=material["rubber"], glass=material["lantern"], lamp=material["beacon"])
    coastal_models = import_coastal_models()
    meshes = {
        "reef": import_mesh("ReefShelf",material["ground"], collision=True),
        "buoy": coastal_models["LateralSeaMarker"],
        "grass": import_mesh("DuneGrass",material["dune_grass"],foliage=True),
        "sea_grass": import_mesh("SeaGrass",material["sea_grass"],foliage=True),
        "reef_coral": import_mesh("ReefCoral",material["reef_coral"]),
        "rocks": import_mesh("CoastRocks", material["rock"], collision=True),
        "boulder": import_mesh("Boulder", material["boulder"], collision=True),
        "volcano": import_mesh("Volcano", material["volcano"], collision=True),
        "lighthouse": import_mesh("LightStation", lighthouse, nanite=False, collision=True),
        "tanker": import_mesh("ProductTanker", material["tanker"], collision=True, nanite=False),
        "lng": import_mesh("GasCarrier", material["lng"], collision=True, nanite=False),
        "container": container_ship(),
        "pirate": import_mesh("SirensLight", {k:v for k,v in material.items() if k.startswith("pirate")},
                              collision=True, nanite=False),
        "whale": import_mesh("BlueWhale", material["blue_whale"], nanite=False),
        "shark": import_mesh("ReefShark", material["reef_shark"], nanite=False),
        "dolphin": import_mesh("Dolphin", {name: value for name, value in material.items() if name.startswith("dolphin_")},
                                nanite=False),
    }
    for aircraft in ("Floatplane","Airliner"):
        import_mesh(aircraft, material["aircraft_paint"], nanite=False)
    cays = {cay.name: import_mesh(cay.name, material["ground"], collision=True) for cay in CAYS}
    palms = [coastal_models["CoconutPalm"]] * 3
    trees = (coastal_models["IslandTree02"], coastal_models["JacarandaTree"])
    yacht = {"rough_white": material["gelcoat"], "white_fiberglass": material["gelcoat"],
             "glass": material["glass"], "stainless_stile": material["steel"], "cloth": material["sail"],
             "black": material["rubber"], "material_0": material["steel"], "material_002": material["wood"],
             "material.002": material["wood"]}
    for name in ("Catamaran", "CatamaranRig", "CatamaranJib"):
        import_mesh(name, yacht, nanite=False)
    import_mesh("Skipper", {"skipperskin":material["skipper"],"deckshirt":material["shirt"],
                            "material_0":material["skipper"]}, nanite=False)
    build_level(material, meshes, cays, palms, trees, coastal_models)


if __name__ == "__main__":
    main()
