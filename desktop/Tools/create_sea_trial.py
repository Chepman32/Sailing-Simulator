"""Run in the UE 5.8 editor to create the checked-in sea-trial map and materials."""

from pathlib import Path
import sys

import unreal

sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_coral_pass import configure_buoy, import_coastal_models


LEVEL = "/Game/Maps/SeaTrial"
MATERIALS = "/Game/Materials"
edit = unreal.MaterialEditingLibrary
assets = unreal.EditorAssetLibrary


def constant(material, value, row):
    if isinstance(value, tuple):
        node = edit.create_material_expression(material, unreal.MaterialExpressionConstant3Vector, -430, row)
        node.set_editor_property("constant", unreal.LinearColor(*value, 1.0))
    else:
        node = edit.create_material_expression(material, unreal.MaterialExpressionConstant, -430, row)
        node.set_editor_property("r", value)
    return node


def make_material(name, color, roughness, *, water=False, two_sided=False):
    path = f"{MATERIALS}/{name}"
    if assets.does_asset_exist(path):
        return assets.load_asset(path)

    material = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        name, MATERIALS, unreal.Material, unreal.MaterialFactoryNew()
    )
    if water:
        material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_SINGLE_LAYER_WATER)
    if two_sided:
        material.set_editor_property("two_sided", True)

    props = unreal.MaterialProperty
    values = [(props.MP_BASE_COLOR, color), (props.MP_ROUGHNESS, roughness)]
    if water:
        values.extend([(props.MP_SPECULAR, 0.255), (props.MP_OPACITY, 0.34)])
    for row, (prop, value) in enumerate(values):
        if not edit.connect_material_property(constant(material, value, row * 90), "", prop):
            raise RuntimeError(f"Could not connect {prop} in {name}")

    if water:
        output = edit.create_material_expression(material, unreal.MaterialExpressionSingleLayerWaterMaterialOutput, -130, 420)
        inputs = [
            ("ScatteringCoefficients", (0.00015, 0.00055, 0.00075)),
            ("AbsorptionCoefficients", (0.00350, 0.00068, 0.00028)),
            ("PhaseG", 0.25),
            ("ColorScaleBehindWater", 1.0),
        ]
        for row, (pin, value) in enumerate(inputs):
            if not edit.connect_material_expressions(constant(material, value, 415 + row * 90), "", output, pin):
                raise RuntimeError(f"Could not connect {pin} in {name}: {edit.get_material_expression_input_names(output)}")

    edit.recompile_material(material)
    if not assets.save_loaded_asset(material, only_if_is_dirty=False):
        raise RuntimeError(f"Could not save {path}")
    return material


def create_level():
    sand = make_material("M_TrialSand", (0.54, 0.37, 0.17), 0.86)
    vegetation = make_material("M_TrialVegetation", (0.07, 0.20, 0.061), 0.92)
    gelcoat = make_material("M_TrialGelcoat", (0.84, 0.88, 0.89), 0.25)
    red = make_material("M_TrialRed", (0.53, 0.035, 0.025), 0.40)
    make_material("M_TrialTeak", (0.27, 0.13, 0.058), 0.64)
    make_material("M_TrialFabric", (0.86, 0.91, 0.97), 0.69, two_sided=True)
    make_material("M_TrialWater", (0.003, 0.024, 0.035), 0.078, water=True)
    if assets.does_asset_exist(LEVEL):
        unreal.log(f"Sea trial already exists at {LEVEL}")
        return

    levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    if not levels.new_level(LEVEL):
        raise RuntimeError(f"Could not create {LEVEL}")

    def spawn(cls, name, position=(0, 0, 0), *, pitch=0, yaw=0):
        actor = actors.spawn_actor_from_class(cls, unreal.Vector(*position), unreal.Rotator(pitch=pitch, yaw=yaw))
        if not actor:
            raise RuntimeError(f"Could not spawn {name}")
        actor.set_actor_label(name)
        return actor

    def solid(name, shape, position, scale, material):
        actor = spawn(unreal.StaticMeshActor, name, position)
        mesh = actor.static_mesh_component
        mesh.set_static_mesh(unreal.load_asset(f"/Engine/BasicShapes/{shape}"))
        mesh.set_material(0, material)
        actor.set_actor_scale3d(unreal.Vector(*scale))

    solid("Seabed", "Cube", (0, 0, -4650), (8000, 8000, 1), sand)
    islands = [((55000, 20500), (250, 135, 17)), ((80500, -49700), (290, 188, 23)), ((133000, 51800), (510, 225, 42))]
    for index, ((x, y), (length, width, height)) in enumerate(islands, 1):
        solid(f"Cay {index} sand", "Sphere", (x, y, -height * 16), (length, width, height), sand)
        solid(f"Cay {index} greenery", "Sphere", (x, y, -height * 8), (length * 0.79, width * 0.77, height * 0.91), vegetation)

    solid("Light tower", "Cylinder", (54200, 20700, 1130), (3.0, 3.0, 19.0), gelcoat)
    solid("Light tower cap", "Cone", (54200, 20700, 2190), (3.7, 3.7, 3.0), red)
    buoy = import_coastal_models()["LateralSeaMarker"]
    for index, (x, y) in enumerate([(5200, 1650), (11800, -2100), (22800, 2250), (35200, -1850)], 1):
        marker = spawn(unreal.StaticMeshActor, f"Channel marker {index}", (x, y, 0), yaw=index * 43)
        configure_buoy(marker, buoy, green=index % 2 == 0, scale=.45)

    spawn(unreal.PlayerStart, "Yacht start", (0, 0, 20))
    spawn(unreal.load_class(None, "/Script/SailingSimulatorDesktop.SailingSea"), "Trial sea")
    sun = spawn(unreal.DirectionalLight, "Sun", pitch=-32, yaw=142).get_component_by_class(unreal.DirectionalLightComponent)
    sun.set_mobility(unreal.ComponentMobility.MOVABLE)
    sun.set_intensity(68000.0)
    sun.set_editor_property("atmosphere_sun_light", True)
    sun.set_editor_property("light_source_angle", 0.5357)
    spawn(unreal.SkyAtmosphere, "Sky atmosphere")
    spawn(unreal.VolumetricCloud, "Volumetric clouds")
    sky = spawn(unreal.SkyLight, "Sky capture").get_component_by_class(unreal.SkyLightComponent)
    sky.set_mobility(unreal.ComponentMobility.MOVABLE)
    sky.set_editor_property("real_time_capture", True)
    fog = spawn(unreal.ExponentialHeightFog, "Horizon haze").get_component_by_class(unreal.ExponentialHeightFogComponent)
    fog.set_editor_property("fog_density", 0.006)
    fog.set_editor_property("fog_height_falloff", 0.18)
    if not levels.save_current_level():
        raise RuntimeError(f"Could not save {LEVEL}")
    unreal.log(f"Created {LEVEL}")


create_level()
