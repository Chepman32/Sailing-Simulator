"""Bake one repeatable shallow-water cycle per surveyed rock tile using Blender's Python.

The incident train enters from the surrounding shelf. A staggered grid carries
water around emergent rock and over submerged ledges. Subtracting a run on bare
sand leaves the displacement and velocity to add to the shared offshore model.
The fourth channel carries bubbles with the wet flow throughout the ebb.
"""
from pathlib import Path
import numpy as np
from coastal_layout import CAYS, LAYOUT, relief, shore_scale

SIZE, FRAMES, STEPS = 128, 32, 256
OMEGA = 1.16
DT = 2 * np.pi / (OMEGA * STEPS)
DESKTOP = LAYOUT.parents[2]


def trace(field, x, y):
    x, y = np.clip(x, 0, SIZE-1.001), np.clip(y, 0, SIZE-1.001)
    i, j = x.astype(int), y.astype(int)
    fx, fy = x-i, y-j
    return ((1-fx)*field[j, i]+fx*field[j, i+1])*(1-fy) + ((1-fx)*field[j+1, i]+fx*field[j+1, i+1])*fy


def cycle(bed, phase, amplitude, cell, sources=None):
    iy, ix = np.indices(bed.shape, dtype=np.float32)
    edge = np.minimum.reduce([ix, iy, SIZE-1-ix, SIZE-1-iy])
    relaxation = DT * (.24 + 3.5 * np.clip(1-edge/12, 0, 1)**2)
    eta = np.maximum(bed, 0).copy()
    u, v, foam = (np.zeros_like(eta) for _ in range(3))
    face_x = np.maximum(bed[:, 1:], bed[:, :-1])
    face_y = np.maximum(bed[1:, :], bed[:-1, :])
    result = np.empty((FRAMES, SIZE, SIZE, 4), dtype=np.float32)
    damp = np.exp(-DT*.33)
    for step in range(7*STEPS):
        clock = 2*np.pi*(step % STEPS)/STEPS
        incoming = amplitude*(np.cos(phase+clock)+.13*np.cos(2*(phase+clock)))
        eta += relaxation*(np.maximum(bed, incoming)-eta)
        # Face openings close as the water drops below the taller adjacent bed.
        dx = np.clip(np.maximum(eta[:,1:],eta[:,:-1])-face_x,0,7)
        dy = np.clip(np.maximum(eta[1:,:],eta[:-1,:])-face_y,0,7)
        u[:,:-1] = np.where(dx>.008, np.clip(damp*u[:,:-1] - (9.81*DT/cell)*np.diff(eta,axis=1),-3,3),0)
        v[:-1,:] = np.where(dy>.008, np.clip(damp*v[:-1,:] - (9.81*DT/cell)*np.diff(eta,axis=0),-3,3),0)
        flux_x, flux_y = dx*u[:,:-1]*(DT/cell), dy*v[:-1,:]*(DT/cell)
        eta[:,:-1] -= flux_x
        eta[:,1:] += flux_x
        eta[:-1,:] -= flux_y
        eta[1:,:] += flux_y
        eta = np.maximum(bed, eta)
        if sources is not None and step >= 4*STEPS:
            ux, vy = (u+np.roll(u,1,1))*.5, (v+np.roll(v,1,0))*.5
            foam = trace(foam, ix-ux*DT/cell, iy-vy*DT/cell)*np.exp(-DT*.61)
            compression = (np.roll(u,1,1)-u+np.roll(v,1,0)-v)/cell
            wet = np.clip((eta-bed)/.08,0,1)
            spill = np.clip((compression-.27)*1.5,0,2.5)*wet*sources
            foam += (1-foam)*(-np.expm1(-DT*2.4*spill))
            foam *= np.where(wet>.01, 1., .93)
        if step >= 6*STEPS and step % (STEPS//FRAMES) == 0:
            frame = result[(step%STEPS)//(STEPS//FRAMES)]
            frame[:,:,0] = np.maximum(eta,bed)-np.maximum(bed,0)
            frame[:,:,1] = (u+np.roll(u,1,1))*.5
            frame[:,:,2] = (v+np.roll(v,1,0))*.5
            frame[:,:,3] = foam
    return result


def bake():
    beds = np.fromfile(DESKTOP/'Saved/CoastalSources/RockBed.f32',dtype='<f4').reshape(-1,SIZE,SIZE)
    atlas = np.empty((FRAMES,SIZE,len(beds),SIZE,4),np.uint8)
    for line in (LAYOUT.parent/'CoralSurfTiles.inl').read_text().splitlines():
        if not line.startswith('SURF_TILE('):
            continue
        row, tile, ox, oy, cell = map(float,line[10:-1].split(','))
        tile, cay = int(tile), CAYS[int(row)]
        iy, ix = np.indices((SIZE,SIZE),dtype=np.float32)
        x, y = ox+ix*cell, oy+iy*cell
        sand = np.array([relief(cay,a-cay.x,b-cay.y)[0] for a,b in zip(x.flat,y.flat)],np.float32).reshape(SIZE,SIZE)
        a,b = (x-cay.x)/cay.length,(y-cay.y)/cay.width
        radius = np.hypot(a,b)/np.vectorize(shore_scale)(np.arctan2(b,a),cay.phase)
        distance = (radius-1)*min(cay.length,cay.width)
        # Integrate the same finite-depth dispersion relation as the offshore sampler.
        d = np.arange(-9.,220.,.125)
        shelf = np.clip(d/(.86*min(cay.length,cay.width)),0,1)
        depth = np.maximum(.46,.1+23*shelf**1.55+4.8*np.sqrt(shelf))
        k = OMEGA/np.sqrt(9.81*depth)
        for _ in range(6):
            th = np.tanh(k*depth)
            k -= (k*th-OMEGA**2/9.81)/(th+k*depth*(1-th**2))
        travel = np.cumsum(k)*.125
        travel -= np.interp(0.,d,travel)
        peel = .020*x-.013*y+1.18*np.sin(.042*x+.025*y+row)+.67*np.sin(.019*x-.062*y-1.7*row)
        peel += .46*np.sin(.218*x+.143*y+2.3*row)+.68*np.sin(.114*x+.081*y+.36*np.sin(.096*x-.066*y)+row)
        phase = (np.interp(distance,d,travel)+OMEGA*peel+row).astype(np.float32)
        amplitude = np.minimum(.64,.13+.32*np.maximum(0.,-sand)).astype(np.float32)
        rocky = np.maximum(sand,beds[tile])
        # The offshore roller already makes its own foam. New white water is
        # entrained on impact with rock, then carried beyond this source.
        ledge = ((rocky-sand>.18) & (rocky>-.68) & (rocky<1.1)).astype(np.float32)
        sources = ledge.copy()
        for dy in range(-3,4):
            for dx in range(-3,4):
                weight = max(0.,1.-np.hypot(dx,dy)*cell/1.75)
                sources = np.maximum(sources,weight*np.roll(ledge,(dy,dx),(0,1)))
        sea = cycle(rocky,phase,amplitude,cell,sources)
        sea[:,:,:,:3] -= cycle(sand,phase,amplitude,cell)[:,:,:,:3]
        # Bound the scattered height of a depth-limited crest on a flooded ledge.
        # The shore profile already carries the incoming wave and the long run-up.
        limit=.19+.17*np.minimum(2.,np.maximum(0.,-sand))
        sea[:,:,:,0]=limit*np.tanh(sea[:,:,:,0]/limit)
        margin = np.clip(np.minimum.reduce([ix,iy,SIZE-1-ix,SIZE-1-iy])/6,0,1)
        sea *= margin[None,:,:,None]
        sea[:,:,:,:3] = 128 + sea[:,:,:,:3]*np.array([128,48,48])
        sea[:,:,:,3] *= 255
        atlas[:,:,tile,:,:] = np.rint(np.clip(sea,0,255)).astype(np.uint8)
    (DESKTOP/'Content/Coastal/Surf/RockWash.rgba').write_bytes(atlas.tobytes())


if __name__ == '__main__':
    bake()
