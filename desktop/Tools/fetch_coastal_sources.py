"""Fetch the public-domain scan and PBR image sources used to bake Coral Pass."""

from concurrent.futures import ThreadPoolExecutor
from array import array
import hashlib
import json
import math
from pathlib import Path
from statistics import median
import struct
import subprocess
from urllib.request import Request, urlopen


DEST = Path(__file__).resolve().parents[1] / "Saved" / "CoastalSources"
SOURCES = {
    "aerial_beach_01": ("Diffuse", "nor_dx", "Rough"),
    "boulder_01": ("Diffuse", "nor_dx", "arm", "gltf"),
    "coast_rocks_03": ("Diffuse", "nor_dx", "arm", "gltf"),
    "palm_tree_bark": ("Diffuse", "nor_dx", "Rough"),
    "rock_face": ("Diffuse", "nor_dx", "Rough", "Displacement"),
    "wooden_planks": ("Diffuse", "nor_dx", "Rough"),
}
SKIES = ("kloofendal_48d_partly_cloudy_puresky", "qwantani_sunset_puresky", "wasteland_clouds_puresky")


def request(url):
    return urlopen(Request(url, headers={"User-Agent": "SailingSimulatorDesktop/1.0 (UE asset import)"}), timeout=90)


def fetch(destination, source):
    if destination.is_file() and hashlib.md5(destination.read_bytes()).hexdigest() == source["md5"]:
        return
    with request(source["url"]) as stream:
        data = stream.read()
    if hashlib.md5(data).hexdigest() != source["md5"]:
        raise RuntimeError(f"Download checksum did not match {destination.name}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".download")
    partial.write_bytes(data)
    partial.replace(destination)
    print(destination.relative_to(DEST))


def bake_daylight_gain(directory):
    """Recover directional cloud radiance lost in the 8K display-referred photograph."""
    name = SKIES[0]
    width, height = 1024, 512
    def pixels(path, pixel_format):
        return subprocess.check_output(["ffmpeg","-loglevel","error","-i",str(path),
            "-vf",f"scale={width}:{height}","-pix_fmt",pixel_format,"-f","rawvideo","-"])
    hdr = array("f")
    hdr.frombytes(pixels(directory / f"{name}_1k.hdr","gbrpf32le"))
    jpg = pixels(directory / f"{name}.jpg","rgb24")
    linear = [v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in (i/255 for i in range(256))]
    gain = array("f")
    count = width*height
    for i in range(count):
        r,g,b = jpg[3*i:3*i+3]
        display = .2126*linear[r]+.7152*linear[g]+.0722*linear[b]
        radiance = .2126*hdr[2*count+i]+.7152*hdr[i]+.0722*hdr[count+i]
        gain.append(radiance/max(.002,display))
    reference = median(gain[:count//2])
    # The directional light already supplies the solar disc. Limit the gain to
    # two stops, retaining cloud edges and gaps without reflecting the sun twice.
    values = bytearray()
    for value in gain:
        encoded = round(255*max(0,min(1,(1+math.log2(max(value/reference,.5)))/3)))
        values.extend((encoded,encoded,encoded))
    target = directory / "T_DaylightGain.tga"
    target.write_bytes(struct.pack("<BBBHHBHHHHBB",0,0,2,0,0,0,0,0,width,height,24,32)+values)


def main():
    # Preserve the original meshes and finishes for the anchored ships.
    for name, path, digest in (
        ("ProductTanker", "000-071/96ebf61af42b4062ae98a6ad848e1a25", "4b9fdd1dad65acae86b28a2434937070d869a97d7e3ee0a0b14e2f05274fa02d"),
        ("GasCarrier", "000-048/fa335b96450d4344863bbf5d912a0288", "9f38a2e69d5a087b5d6fefe50d86a9db324476fc25594672d4f3c252eff8e117"),
        ("SirensLight", "000-025/01d53ebc2b2148cd972c491eefa02c03", "0f1853c5c57e3cdb9b4911bc0a81d5d5aee8f5718b04ef3cab52d324276f29ca"),
    ):
        target = DEST / f"{name}.glb"
        if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == digest:
            continue
        with request(f"https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/{path}.glb") as stream:
            data = stream.read()
        if hashlib.sha256(data).hexdigest() != digest:
            raise RuntimeError(f"Unexpected source for {name}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    tower = DEST / "HarborLighthouse.glb"
    tower_sha256 = "0ee4b4231309127f436f9adb3fdc4427ab9369eda62e4b8df3740c3e28730425"
    if not tower.is_file() or hashlib.sha256(tower.read_bytes()).hexdigest() != tower_sha256:
        with request("https://tevy.dev/models/lighthouse/v2/lod0.glb") as stream:
            data = stream.read()
        if hashlib.sha256(data).hexdigest() != tower_sha256:
            raise RuntimeError("Unexpected lighthouse model checksum")
        tower.parent.mkdir(parents=True, exist_ok=True)
        partial = tower.with_suffix(".download")
        partial.write_bytes(data)
        partial.replace(tower)
    files = {}
    for asset, maps in SOURCES.items():
        with request(f"https://api.polyhaven.com/files/{asset}") as stream:
            metadata = json.load(stream)
        for kind in maps:
            if kind == "Displacement":
                source = metadata[kind]["2k"]["png"]
            else:
                source = metadata[kind]["4k"]["gltf" if kind == "gltf" else "jpg"]
            files[DEST / asset / source["url"].rsplit("/", 1)[-1]] = source
            for path, dependency in source.get("include", {}).items():
                files[DEST / asset / path] = dependency
    for asset in SKIES:
        with request(f"https://api.polyhaven.com/files/{asset}") as stream:
            metadata = json.load(stream)
        files[DEST / "skies" / f"{asset}.jpg"] = metadata["tonemapped"]
        if asset == SKIES[0]:
            files[DEST / "skies" / f"{asset}_1k.hdr"] = metadata["hdri"]["1k"]["hdr"]

    with ThreadPoolExecutor(max_workers=4) as workers:
        list(workers.map(lambda job: fetch(*job), files.items()))
    bake_daylight_gain(DEST / "skies")


if __name__ == "__main__":
    main()
