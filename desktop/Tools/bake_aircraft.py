"""Blender stage of bake_aircraft.mjs. Write one vertex-painted draw per aircraft."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from coastal_geometry import Mesh, clear_scene, export

for name, data in json.loads(Path(sys.argv[-1]).read_text()).items():
    clear_scene()
    mesh = Mesh()
    for point, color in zip(data["vertices"],data["colors"]):
        mesh.vertex(point,color=color)
    for triangle in data["faces"]:
        mesh.face(triangle)
    export(name,[mesh.create(name,["AircraftPaint"])])
