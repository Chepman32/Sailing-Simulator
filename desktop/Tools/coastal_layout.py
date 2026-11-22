"""Coral Pass layout in metres, with +X forward, +Y to starboard, and Z up."""

import math
import sys
import zlib
from array import array
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class Cay:
    name: str
    x: float
    y: float
    length: float
    width: float
    rise: float
    ridge: float
    phase: float


# Read the same footprint definitions that the native buoyancy and GPU wave field use.
LAYOUT = Path(__file__).resolve().parents[1] / "Source/SailingSimulatorDesktop/CoralPassLayout.inl"
def _footprints():
    cays = []
    for line in LAYOUT.read_text().splitlines():
        if line.startswith("CORAL_CAY("):
            name, *values = line[len("CORAL_CAY("):-1].split(",")
            cays.append(Cay(name, *map(float, values)))
        elif line.startswith("CORAL_VOLCANO("):
            volcano = tuple(map(float, line[len("CORAL_VOLCANO("):-1].split(",")))
    return tuple(cays), volcano


CAYS, (VOLCANO_X, VOLCANO_Y, VOLCANO_RADIUS, VOLCANO_RIM) = _footprints()
LIGHTHOUSE = (CAYS[-1].x, CAYS[-1].y, 2.02)


def shore_scale(theta, phase):
    return (1 + 0.129 * math.sin(3 * theta + phase)
            + 0.070 * math.cos(5 * theta - phase)
            + 0.038 * math.sin(8 * theta + 2 * phase)
            + 0.021 * math.cos(13 * theta - 3 * phase))


def relief(cay, x, y):
    u, v = x / cay.length, y / cay.width
    theta = math.atan2(v, u)
    radius = math.hypot(u, v) / shore_scale(theta, cay.phase)
    # The same height function drives the mesh, reefs and foliage placement.
    if radius >= 1:
        shelf = min(1.0, (radius - 1) / 0.86)
        return -0.1 - 23 * shelf**1.55 - 4.8 * shelf**0.5, 0.0, 0.0

    interior = 1 - radius
    mound = max(0.0, 1.0 - (1.35 * (u - 0.26))**2 - (1.6 * (v - 0.16))**2)
    crag = (math.cos(4 * u + 2 * v) * math.sin(5 * v - 3 * u + cay.phase))**2
    erosion = (0.39 * math.sin(17 * u + 6 * v) * math.cos(16 * v - 3 * u)
               + 0.13 * math.sin(37 * u + 23 * v) + 0.045 * math.sin(93 * u - 73 * v))
    face = max(0.0, mound - 0.39) * min(1.0, 3.4 * interior)
    height = (-0.1 + cay.rise * interior**1.36 + cay.ridge * face * (0.77 + 0.58 * crag)
              + erosion * min(1.0, 3.1 * interior) * (1.7 + 0.06 * cay.ridge))
    vegetation = max(0.0, min(1.0, (height - 1.25) / 4.0 + 0.4 * erosion))
    rock = max(0.0, min(1.0, (face * (0.26 + crag) - 0.14) * 4.1))
    return height, vegetation, rock


def terrain_noise(x, y):
    # Smooth seeded lattice values in [-1, 1], shared by mesh baking and planting.
    i, j = math.floor(x), math.floor(y)
    u, v = x-i, y-j
    u, v = u*u*(3-2*u), v*v*(3-2*v)

    def corner(a,b):
        h = (a*1597334677 ^ b*3812015801) & 0xffffffff
        h = ((h ^ h >> 16)*2246822519) & 0xffffffff
        return (h ^ h >> 13)/2147483648 - 1

    a, b = corner(i,j), corner(i+1,j)
    c, d = corner(i,j+1), corner(i+1,j+1)
    return (a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v


SURVEY_SIZE = 768


@lru_cache(maxsize=1)
def volcano_survey():
    """North-up USGS 3DEP elevations, quantized to unsigned decimetres."""
    path = Path(__file__).with_name("data") / "st_helens_3dep.u16z"
    samples = array("H", zlib.decompress(path.read_bytes()))
    if sys.byteorder != "little":
        samples.byteswap()
    if len(samples) != SURVEY_SIZE**2:
        raise ValueError(f"Unexpected elevation grid in {path}")
    return samples


def volcano_raster(x, y):
    # The southern rim faces the opening reach. The orthophoto has the same extent.
    return 344 + x*.43, 438 + y*.43


def volcano_relief(x, y):
    """Surveyed lava domes, cliffs and alluvial fans fitted to a fictional coastline."""
    radius, angle = math.hypot(x,y), math.atan2(y,x)
    coast = VOLCANO_RADIUS * (1+.13*math.sin(2*angle+1.1)+.075*math.sin(5*angle+.7))
    r = radius/coast
    if r >= 1:
        return -.6-min(34,(r-1)*93), 0
    u, v = volcano_raster(x,y)
    u, v = max(0,min(SURVEY_SIZE-1.001,u)), max(0,min(SURVEY_SIZE-1.001,v))
    col, row = int(u), int(v)
    cell = row*SURVEY_SIZE+col
    grid = volcano_survey()
    fx, fy = u-col, v-row
    north = grid[cell]*(1-fx) + grid[cell+1]*fx
    south = grid[cell+SURVEY_SIZE]*(1-fx) + grid[cell+SURVEY_SIZE+1]*fx
    elevation = .1*(north*(1-fy) + south*fy)
    apron = min(1,(1-r)/.28)
    vent = 24*max(0,1-(radius/19)**2)**2
    height = max(1.6,(elevation-975)*.198)*apron*apron*(3-2*apron) - vent - .6
    patch = terrain_noise(x*.013,y*.013)
    green = min(1,max(0,(115-height+47*patch)/45))
    return height, green*min(1,max(0,(height-1.9)/6))


def reef_floor(x,y):
    """Coral heads and sand channels under the opening reach, in world metres."""
    r = math.hypot((x-20)/77,(y-19)/39)
    patches = terrain_noise(x*.069,y*.069)*.63 + terrain_noise(x*.22,y*.22)*.37
    shoal = -3.4 - 10*r*r + 2.8*patches + terrain_noise(x*.034,y*.034)*1.75
    return max(-44,shoal-75*max(0,r-.80)**2), min(1,max(0,.48+patches*1.9))
