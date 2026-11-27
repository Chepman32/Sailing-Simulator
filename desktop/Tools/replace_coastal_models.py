"""Replace the legacy plants and markers in the existing desktop maps."""

import os
from pathlib import Path
import re
import sys

import unreal

sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_coral_pass import (ACTORS, FOLIAGE_WIND_DISTANCE_CM, LEVELS, SOURCES, UNDERSTORY_TAG,
                              coastal_weather_collection, configure_buoy, cpp, import_coastal_models, spawn,
                              plant_understory, woodland_groups)
from coastal_materials import CHANNEL_BUOY_MODELS, forest_floor_maps, ground, import_textures


PALMS = {f"SM_CoconutPalm{index}" for index in range(1, 4)}


def relocate_woodland(actor, instances, trees):
    forest = actor.get_actor_label() == "Volcanic foothill forest"
    transforms = []
    for index in range(instances.get_instance_count()):
        transform = instances.get_instance_transform(index, False)
        size = transform.scale3d.x
        height = 1.25 if forest else 1.7 * size
        transform.translation += unreal.Vector(0, 0, (height - .12 * size) * 100.)
        transforms.append(transform)
    coast, jacarandas = woodland_groups(transforms)
    actor.plant(trees[0], coast)
    if jacarandas:
        location = actor.get_actor_location()
        jacaranda_grove = spawn(cpp("SailingGrove"), actor.get_actor_label() + " jacarandas",
                                (location.x / 100., location.y / 100., location.z / 100.))
        jacaranda_grove.set_actor_rotation(actor.get_actor_rotation(), False)
        jacaranda_grove.set_actor_scale3d(actor.get_actor_scale3d())
        jacaranda_grove.set_editor_property("tags", actor.get_editor_property("tags"))
        jacaranda_grove.plant(trees[1], jacarandas)
    return len(transforms)


def replace_vegetation(actors, models, coral):
    trees = (models["IslandTree02"], models["JacarandaTree"])
    weather_class = cpp("SailingWeather")
    palms = woodland = 0
    for actor in actors:
        if actor.get_class() == weather_class:
            actor.set_editor_property("coastal_weather", coastal_weather_collection())
        instances = actor.get_component_by_class(unreal.InstancedStaticMeshComponent)
        if instances:
            mesh = instances.get_editor_property("static_mesh")
            name = mesh.get_name() if mesh else ""
            if name in PALMS:
                instances.set_static_mesh(models["CoconutPalm"])
                palms += instances.get_instance_count()
            elif name == "SM_CoastalCanopy":
                woodland += relocate_woodland(actor, instances, trees)
            elif name == "SM_DuneGrass":
                for index in range(instances.get_instance_count()):
                    blade = instances.get_instance_transform(index, False)
                    size = blade.scale3d
                    blade.scale3d = unreal.Vector(size.x, size.y, .64 * size.x)
                    instances.update_instance_transform(index, blade, False, index == instances.get_instance_count() - 1, True)
            current = instances.get_editor_property("static_mesh")
            if current in (models["CoconutPalm"], *trees):
                instances.set_world_position_offset_disable_distance(FOLIAGE_WIND_DISTANCE_CM)
            continue
        if not isinstance(actor, unreal.StaticMeshActor):
            continue
        component = actor.static_mesh_component
        mesh = component.get_editor_property("static_mesh")
        name = mesh.get_name() if mesh else ""
        if name in PALMS:
            component.set_static_mesh(models["CoconutPalm"])
            palms += 1
        elif name == "SM_CoastalCanopy":
            thicket = re.fullmatch(r"Light station thicket (\d+)", actor.get_actor_label())
            component.set_static_mesh(trees[int(bool(thicket and int(thicket[1]) in (2, 4)))])
            if thicket:
                location = actor.get_actor_location() + unreal.Vector(0, 0, 47.)
                actor.set_actor_location(location, False, True)
            woodland += 1
        if component.get_editor_property("static_mesh") in (models["CoconutPalm"], *trees):
            component.set_world_position_offset_disable_distance(FOLIAGE_WIND_DISTANCE_CM)

    if coral:
        for actor in actors:
            if unreal.SystemLibrary.is_valid(actor) and actor.actor_has_tag(UNDERSTORY_TAG):
                ACTORS.destroy_actor(actor)
        plant_understory(models)
    return palms, woodland


def replace_buoys(actors, models, coral):
    count = 0
    for actor in actors:
        if not isinstance(actor, unreal.StaticMeshActor):
            continue
        label = actor.get_actor_label()
        match = re.fullmatch(r"Channel (?:float|marker) (\d+)", label)
        if match:
            index = int(match[1])
            configure_buoy(actor, models, index, green=(index % 2 == 1) == coral)
            count += 1
        elif re.fullmatch(r"Channel (?:lens|stem|topmark) \d+", label):
            ACTORS.destroy_actor(actor)
    return count


def replace_map(level, models, *, buoys_only=False):
    if not LEVELS.load_level(level):
        raise RuntimeError(f"Could not open {level}")
    coral = level.endswith("CoralPass")
    actors = ACTORS.get_all_level_actors()
    palms, woodland = (0, 0) if buoys_only else replace_vegetation(actors, models, coral)
    buoys = replace_buoys(actors, models, coral)
    if not buoys:
        raise RuntimeError(f"No channel markers found in {level}")
    if not LEVELS.save_current_level():
        raise RuntimeError(f"Could not save {level}")
    unreal.log(f"Coastal replacements in {level}: {palms} palms, {woodland} trees, {buoys} buoys")


def main():
    buoys_only = os.environ.get("SAILING_BUOYS_ONLY") == "1"
    if buoys_only:
        models = import_coastal_models(CHANNEL_BUOY_MODELS)
    else:
        models = import_coastal_models()
        ground(import_textures(SOURCES), forest_floor_maps(SOURCES))
    for level in ("/Game/Maps/SeaTrial", "/Game/Maps/CoralPass"):
        replace_map(level, models, buoys_only=buoys_only)


if __name__ == "__main__":
    main()
