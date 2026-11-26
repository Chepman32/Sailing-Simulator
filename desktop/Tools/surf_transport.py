"""Bake a looping surf tracer in crest coordinates for the native water material.

X spans one incoming wavelength, Y runs along the crest. Air enters at spilling
sections, moves with the orbital velocity and the outward return flow, and decays
in the trough. BGRA8 stores fading bubbles, fresh aeration and two ripple slopes.
"""
from pathlib import Path
import numpy as np

SIZE = 128
STEPS = 256
PERIOD = 2 * np.pi / 1.16


def bake(directory):
    y, x = np.mgrid[:SIZE, :SIZE]
    a, b = (x + .5) * (2*np.pi/SIZE), (y + .5) * (2*np.pi/SIZE)
    dt = PERIOD/STEPS
    density = np.zeros_like(a)
    target = Path(directory) / "SurfTransport.bgra"
    with target.open("wb") as out:
        for step in range(3*STEPS):
            clock = 2*np.pi*(step % STEPS)/STEPS
            p = a + clock
            slip = .24*np.sin(2*b + .27*np.sin(a)) + .11*np.sin(5*b-clock)
            crest = p + slip
            # Inshore is -X. Oblique little jets converge along the lip,
            # reverse after the crest and draw the bubble streaks seawards.
            vx = .28 - 1.15*np.cos(crest) - .48*np.maximum(0,np.cos(crest))**4
            vy = .45*np.sin(2*b-.5*np.sin(p)) + .29*np.sin(3*p-b)
            srcx, srcy = x - vx*dt*SIZE/12, y - vy*dt*SIZE/19
            ix, iy = np.floor(srcx).astype(int), np.floor(srcy).astype(int)
            u, v = srcx-ix, srcy-iy
            traced = ((1-u)*density[iy%SIZE,ix%SIZE] + u*density[iy%SIZE,(ix+1)%SIZE])*(1-v)
            traced += ((1-u)*density[(iy+1)%SIZE,ix%SIZE] + u*density[(iy+1)%SIZE,(ix+1)%SIZE])*v
            group = .48+.26*np.sin(2*b+.78*np.sin(p))+.19*np.sin(5*b+clock)+.15*np.cos(9*b-p)
            spill = np.exp(-((np.sin((crest-.10)*.5))/.09)**2)
            air = spill*np.clip((group-.23)*2.6,0,1)
            density = 1-(1-traced*np.exp(-dt*(.96+.30*np.cos(b-p))))*np.exp(-5.2*air*dt)
            if step>=2*STEPS and step%2==0:
                # Small transverse undulations travel down the spilling front.
                ripple = np.sin(6*b-2*p+.6*np.sin(3*b+p))*np.maximum(0,np.cos(crest))**4
                channels = np.stack((.5+.40*ripple,air,density,.5+.34*np.cos(3*b+p)*air),axis=-1)
                out.write(np.rint(255*np.clip(channels,0,1)).astype('uint8').tobytes())


if __name__ == "__main__":
    bake(Path(__file__).resolve().parents[1]/"Saved/CoastalSources")
