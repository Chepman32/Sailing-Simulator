"""Cookable gear art and footfalls from the project recordings."""
import os
import subprocess
import tempfile
from pathlib import Path

import unreal


def import_asset(path, destination):
    task = unreal.AssetImportTask()
    task.filename = str(path)
    task.destination_path = destination
    task.automated = task.replace_existing = task.save = True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    asset, = task.get_objects()
    return asset


desktop = Path(__file__).resolve().parents[1]
if os.environ.get("SAILING_FOOTSTEPS_ONLY") != "1":
    art = import_asset(desktop / "Art/InventoryGear.png", "/Game/Coastal/Interface")
    art.set_editor_property("lod_group", unreal.TextureGroup.TEXTUREGROUP_UI)
    art.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_EDITOR_ICON)
    art.set_editor_property("mip_gen_settings", unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
    unreal.EditorAssetLibrary.save_loaded_asset(art)

recordings = desktop.parent / "public/audio"
with tempfile.TemporaryDirectory(dir=desktop / "Saved") as scratch:
    for surface, source, count in (("Deck", "step-wood", 8), ("Ground", "step-ground", 10),
                                   ("Water", "step-water", 8), ("Sand", "foot-sand", 3)):
        for variant in range(1, count + 1):
            wav = Path(scratch) / f"Footstep{surface}{variant}.wav"
            # Align the dry impact with contact and keep the whole natural tail.
            if surface in ("Deck", "Ground"):
                layer = ["-af", "silenceremove=start_periods=1:start_duration=0.008:"
                                 "start_threshold=-34dB:start_silence=0.02"]
            else:
                layer = ["-af", "adelay=22"] if surface == "Sand" else []
            subprocess.run([
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                "-i", str(recordings / f"{source}-{variant}.mp3"), *layer,
                "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", str(wav),
            ], check=True)
            clip = import_asset(wav, "/Game/Coastal/Audio")
            clip.set_editor_property("looping", False)
            unreal.EditorAssetLibrary.save_loaded_asset(clip)
