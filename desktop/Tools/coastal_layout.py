"""Coral Pass layout in metres, with +X forward, +Y to starboard, and Z up."""

import math
from dataclasses import dataclass


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


LIGHTHOUSE = (316.0, -26.0, 2.02)
CAYS = (
    Cay("LongCay", 368, 178, 189, 101, 16, 9, 0.8),
    Cay("CloudHead", 525, -385, 175, 86, 20, 11, 2.2),
    Cay("EastCay", 854, 260, 260, 128, 27, 27, 3.5),
    Cay("OuterCay", 1290, -270, 315, 142, 36, 41, 1.3),
    Cay("SouthCay", -260, 246, 138, 88, 26, 14, 4.8),
    Cay("LightCay", LIGHTHOUSE[0], LIGHTHOUSE[1], 27, 20, 2.15, 0, 4.2),
)
VOLCANO_X, VOLCANO_Y = 1510.0, -1100.0
VOLCANO_RADIUS = 640.0
VOLCANO_RIM = 305.0


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


def volcano_relief(x, y):
    """Asymmetric stratovolcano with a recessed crater and radial erosion."""
    angle = math.atan2(y, x)
    meters = math.hypot(x, y)
    coast = VOLCANO_RADIUS * (1 + .14 * math.sin(2 * angle + 1.1) + .093 * math.sin(5 * angle + .7))
    flank = meters / coast
    rim = 34 + 5 * math.cos(3 * angle + .8) + 2.7 * math.sin(8 * angle)
    rough = (.54 * math.sin(9 * angle + flank * 2.1) + .27 * math.sin(16 * angle - flank * 4.2)
             + .13 * math.cos(27 * angle + flank * 5.9) + .06 * math.sin(43 * angle + flank * 9))
    if meters < rim:
        crater = max(0.0, (meters / rim - .35) / .65)
        height = VOLCANO_RIM - 42 + crater**2.3 * (42 + 6 * rough)
    else:
        slope = max(0.0, 1 - (meters - rim) / (coast - rim))
        shoulder = 23 * max(0.0, math.sin(math.pi * flank))**2 * math.cos(4 * angle - flank * 4.5)
        gullies = 43 * rough * max(0.0, math.sin(math.pi * flank))**.9
        texture = 2.7 * math.sin(x*.052 + math.sin(y*.035)) * math.cos(y*.048)
        height = VOLCANO_RIM * slope**2.18 + (shoulder + gullies + texture) * min(1, 2.8 * slope) - .5
        if flank > 1:
            height -= min(34, (flank - 1) * 93)
    green = max(0.0, min(1.0, (144 - height + rough * 29) / 48, (height - 1.6) / 15))
    return height, green
