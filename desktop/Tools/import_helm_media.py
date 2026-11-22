"""Import the prepared ship recordings and interface sprites into cooked Unreal packages."""
from pathlib import Path
import unreal

source = Path(__file__).resolve().parents[1]/"Saved/CoastalSources"
for name in ("MarineDiesel", "MarineHorn", "ShipBell", "HelmAtlas"):
    ui = name == "HelmAtlas"
    task = unreal.AssetImportTask()
    task.filename = str(source/(name+(".png" if ui else ".wav")))
    task.destination_path = "/Game/Coastal/Interface" if ui else "/Game/Coastal/Audio"
    task.automated = task.replace_existing = task.save = True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    asset, = task.get_objects()
    if ui:
        asset.set_editor_property("lod_group", unreal.TextureGroup.TEXTUREGROUP_UI)
        asset.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_EDITOR_ICON)
        asset.set_editor_property("mip_gen_settings", unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
    else:
        asset.set_editor_property("looping", name == "MarineDiesel")
    unreal.EditorAssetLibrary.save_loaded_asset(asset, only_if_is_dirty=False)
