"""Fetch the public-domain scan and PBR image sources used to bake Coral Pass."""

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen


DEST = Path(__file__).resolve().parents[1] / "Saved" / "CoastalSources"
SOURCES = {
    "aerial_beach_01": ("Diffuse", "nor_dx", "Rough"),
    "boulder_01": ("Diffuse", "nor_dx", "arm", "gltf"),
    "coast_rocks_03": ("Diffuse", "nor_dx", "arm", "gltf"),
    "palm_tree_bark": ("Diffuse", "nor_dx", "Rough"),
    "rock_face": ("Diffuse", "nor_dx", "Rough"),
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


def main():
    files = {}
    for asset, maps in SOURCES.items():
        with request(f"https://api.polyhaven.com/files/{asset}") as stream:
            metadata = json.load(stream)
        for kind in maps:
            source = metadata[kind]["4k"]["gltf" if kind == "gltf" else "jpg"]
            files[DEST / asset / source["url"].rsplit("/", 1)[-1]] = source
            for path, dependency in source.get("include", {}).items():
                files[DEST / asset / path] = dependency
    for asset in SKIES:
        with request(f"https://api.polyhaven.com/files/{asset}") as stream:
            source = json.load(stream)["tonemapped"]
        files[DEST / "skies" / f"{asset}.jpg"] = source

    with ThreadPoolExecutor(max_workers=4) as workers:
        list(workers.map(lambda job: fetch(*job), files.items()))


if __name__ == "__main__":
    main()
