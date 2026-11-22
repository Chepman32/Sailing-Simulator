"""Bake a periodic foam coverage field for the Coral Pass water material."""

from pathlib import Path
import struct

import numpy as np


def smooth(lo, hi, x):
    t = np.clip((x - lo) / (hi - lo), 0., 1.)
    return t * t * (3. - 2. * t)


def noise(x, y, cells, rng):
    grid = rng.uniform(-1., 1., (cells, cells)).astype(np.float32)
    u, v = x * cells, y * cells
    i, j = np.floor(u).astype(int), np.floor(v).astype(int)
    u, v = smooth(0., 1., u - i), smooth(0., 1., v - j)
    a = grid[j % cells, i % cells] * (1 - u) + grid[j % cells, (i + 1) % cells] * u
    b = grid[(j + 1) % cells, i % cells] * (1 - u) + grid[(j + 1) % cells, (i + 1) % cells] * u
    return a + (b - a) * v


def cell_walls(x, y, cells, rng):
    offset = rng.uniform(.06, .94, (cells, cells, 2)).astype(np.float32)
    u, v = x * cells, y * cells
    i, j = np.floor(u).astype(int), np.floor(v).astype(int)
    ux, vy = u - i, v - j
    nearest = np.full(x.shape, 9.)
    second = nearest.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            site = offset[(j + dy) % cells, (i + dx) % cells]
            d = (dx + site[..., 0] - ux) ** 2 + (dy + site[..., 1] - vy) ** 2
            second = np.minimum(second, np.maximum(nearest, d))
            nearest = np.minimum(nearest, d)
    return np.sqrt(second) - np.sqrt(nearest)


def write_texture(filename, pixels):
    height, width, channels = pixels.shape
    order = [2,1,0,3] if channels == 4 else [2,1,0]
    with filename.open("wb") as out:
        out.write(struct.pack("<BBBHHBHHHHBB", 0, 0, 2, 0, 0, 0, 0, 0, width, height,
                              8*channels, 40 if channels == 4 else 32))
        out.write(np.rint(255*np.clip(pixels[:,:,order],0.,1.)).astype(np.uint8).tobytes())


def spray_atlas():
    """Coverage of airborne droplets and their mist, in four different fans."""
    size = 512
    rng = np.random.default_rng(1625)
    atlas = np.zeros((2*size, 2*size, 4), dtype=np.float32)
    frequency = np.fft.fftfreq(size) ** 2
    radius2 = frequency[:, None] + frequency[None, :]
    centres = (np.arange(size) + .5) / size
    x, y = np.meshgrid(centres, centres)
    for index in range(4):
        # Neighbouring jets share a launch direction. Smaller droplets spread
        # away from each jet as drag carries them over the falling sheet.
        count = 100000
        jet_count = 115
        jet = rng.integers(0, jet_count, count)
        source = rng.uniform(-.23,.23,jet_count)[jet]
        spread = rng.normal(0,.13,jet_count)[jet] + source*.67
        lift = rng.uniform(.74,1.14,jet_count)[jet]
        foot = rng.uniform(-.040,.065,jet_count)[jet]
        eddy = rng.uniform(-.10,.10,jet_count)[jet]
        age = rng.uniform(.04,1.2,count)
        side = (.5 + source + rng.normal(0,.012,count) + age*spread
                + age**2*(.12 + rng.normal(0,.09,count)) + eddy*age*np.sin(4*age))
        altitude = foot + age*(lift+rng.normal(0,.075,count)) - .48*age**2
        row = (.93-altitude*1.24)*size
        col = side*size
        keep = (row>=0)&(row<size)&(col>=0)&(col<size)
        field = np.zeros((size,size))
        np.add.at(field,(row[keep].astype(int),col[keep].astype(int)),rng.uniform(.3,1.1,keep.sum()))
        spectrum = np.fft.fft2(field)
        def blur(sigma):
            return np.fft.ifft2(spectrum*np.exp(-2*np.pi**2*sigma**2*radius2)).real
        veil = np.maximum(0,blur(8))
        threads = np.maximum(0,blur(1.3))
        # A gutter surrounds each tile so mips fade out at the card boundary.
        edge = smooth(.012,.09,np.minimum.reduce((x,y,1-x,1-y))) * (1-smooth(.70,.98,y))
        texture = np.stack((1-np.exp(-threads*.55),1-np.exp(-veil*.45),
                            1-np.exp(-field*1.35)),axis=2)*edge[:,:,None]
        row0, col0 = size*(index//2), size*(index%2)
        tile = atlas[row0:row0+size,col0:col0+size]
        tile[:,:,:3] = texture
        # An atomized sheet no longer has a foot. Give the wind a ragged veil
        # to stretch; the alpha rides in the same texture fetch as the droplets.
        wind_rng = np.random.default_rng(4592+index)
        u, v = x.copy(), y.copy()
        for _ in range(16):
            cx, cy = wind_rng.uniform((.12,.24),(.91,.76))
            dx, dy = u-cx, v-cy
            radius = wind_rng.uniform(.06,.17)
            bend = wind_rng.uniform(-1.9,1.9)*np.exp(-(dx*dx+dy*dy)/(radius*radius))
            u, v = cx+dx*np.cos(bend)-dy*np.sin(bend), cy+dx*np.sin(bend)+dy*np.cos(bend)
        envelope = smooth(.015,.33,u)*(1-smooth(.54,.985,u))
        density = np.zeros_like(u)
        for level, thickness in ((.35,.09),(.49,.11),(.62,.066)):
            axis = level + .069*np.sin(u*6+wind_rng.uniform(0.,6.3))
            density += np.exp(-((v-axis)/thickness)**2)
        texture_grain = .23*noise(u,v,11,wind_rng)+.17*noise(u,v,35,wind_rng)+.11*noise(u,v,89,wind_rng)
        coverage = envelope*(1-np.exp(-.70*density))*(.77+texture_grain)
        drops = wind_rng.poisson(coverage*2.5)
        gutter = smooth(.015,.11,np.minimum.reduce((x,y,1-x,1-y)))
        tile[:,:,3] = gutter*(.66*coverage+.34*(1-np.exp(-.8*drops)))
    return atlas


def bake(directory):
    size = 1024
    rng = np.random.default_rng(71868)
    centers = (np.arange(size, dtype=np.float32) + .5) / size
    x, y = np.meshgrid(centers, centers)
    # Successive shears stretch and fold a sheet as a breaker rolls over.
    # Keep closed pockets in the foam. The shader stretches old rafts downwind
    # and a low camera foreshortens them again on the surface of a wave.
    u = x + .045 * noise(x, y, 4, rng) + .013 * noise(x, y, 13, rng)
    v = y + .046 * noise(x, y, 5, rng) + .010 * noise(y, x, 17, rng)
    u += .019 * noise(u, v, 9, rng)
    u += .0028 * noise(u, v, 43, rng)
    v += .0032 * noise(u, v, 39, rng)
    density = .52 + .30 * noise(u, v, 8, rng) + .13 * noise(u, v, 23, rng)
    grain = noise(u, v, 85, rng)
    filaments = 1 - smooth(.025, .235, cell_walls(u, v, 12, rng))
    bubbles = 1 - smooth(.02, .24, cell_walls(u, v, 38, rng))
    # Old films drain, leaving interconnected strands and small rafts of beads.
    rafts = smooth(.38, .65, density + .09 * grain)
    lace = np.maximum(filaments * (.50 + .45 * rafts), bubbles * rafts * .83)
    # Freshly aerated water still has small pockets of open water in the sheet.
    pores = smooth(.22, .70, density + .34 * bubbles + .14 * grain)
    rgb = np.stack((lace, density, pores), axis=2)
    directory.mkdir(parents=True, exist_ok=True)
    write_texture(directory / "T_BreakerFoam.tga", rgb)
    write_texture(directory / "T_BreakerSpray.tga", spray_atlas())


if __name__ == "__main__":
    bake(Path(__file__).resolve().parents[1] / "Saved" / "CoastalSources")
