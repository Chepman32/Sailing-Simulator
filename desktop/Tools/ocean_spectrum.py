"""Bake two periodic, dispersive wind-wave fields for hardware trilinear sampling on Metal."""

from pathlib import Path
import numpy as np

SIZE = 128
FRAMES = 128
DEST = Path(__file__).resolve().parents[1] / "Saved" / "CoastalSources"
# Span and loop in metres and seconds, wavelength band, RMS slope and encoding range.
BANDS = (("WindChop", 16., 8., .58, 3.7, .17, .76),
         ("Capillary", 2.8, 4.55, .085, .64, .095, .43))


def advect_foam(compression, velocity, span, period):
    """Move bubbles with the surface particles and let them drain after a crest passes."""
    y, x = np.indices((SIZE, SIZE), dtype=np.float32)
    dt = period / FRAMES
    texels = dt * SIZE / span
    px = x - (velocity[:, 0] + .32) * texels
    py = y - velocity[:, 1] * texels
    ix, iy = np.floor(px).astype(int), np.floor(py).astype(int)
    fx, fy = px-ix, py-iy
    ix, iy = ix % SIZE, iy % SIZE
    jx, jy = (ix+1) % SIZE, (iy+1) % SIZE
    # Whitecaps arrive rapidly at a converging crest, then drain over seconds.
    spill = np.clip((compression-.65)/1.65, 0., 1.)
    injection = 1 - np.exp(-dt * 11 * spill**2)
    decay = np.exp(-dt / 1.9)
    density = np.zeros_like(x)
    frames = np.empty_like(compression)
    # Warm the periodic solution for three cycles before recording its loop.
    for cycle in range(4):
        for t in range(FRAMES):
            a = density[iy[t], ix[t]] * (1-fx[t]) + density[iy[t], jx[t]] * fx[t]
            b = density[jy[t], ix[t]] * (1-fx[t]) + density[jy[t], jx[t]] * fx[t]
            carried = decay * (a * (1-fy[t]) + b * fy[t])
            density = carried + (1-carried) * injection[t]
            if cycle == 3:
                frames[t] = density
    return frames


def bake():
    DEST.mkdir(parents=True, exist_ok=True)
    for index, (name, span, period, shortest, longest, rms, slope_range) in enumerate(BANDS):
        rng = np.random.default_rng(5614 + index)
        k = 2*np.pi*np.fft.fftfreq(SIZE, span/SIZE)
        ku, kv = np.meshgrid(k, k)
        magnitude = np.maximum(np.hypot(ku,kv), .001)
        wavelength = 2*np.pi/magnitude
        band = np.exp(-(wavelength/longest)**4 - (shortest/wavelength)**4)
        spreading = .045 + .955*np.maximum(ku/magnitude, 0)**3.4
        amplitude = (rng.normal(size=ku.shape) + 1j*rng.normal(size=ku.shape)) * np.sqrt(band*spreading)/magnitude**2
        amplitude[0,0] = 0
        # Each Fourier component propagates independently. Quantization closes the time loop.
        omega = np.sqrt(9.81*magnitude + .000072*magnitude**3)
        harmonic = np.maximum(1, np.rint(omega*period/(2*np.pi)))
        # Parseval for the real part of the traveling spectrum, averaged over the loop.
        gain = rms * SIZE**2 / np.sqrt(.5*np.sum(magnitude**2*np.abs(amplitude)**2))
        wind_chop = name == "WindChop"
        volume = np.empty((FRAMES, SIZE, SIZE, 4),dtype=np.uint8)
        if wind_chop:
            compression = np.empty(volume.shape[:3],dtype=np.float32)
            velocity = np.empty((FRAMES, 2, SIZE, SIZE),dtype=np.float32)
        for frame in range(FRAMES):
            wave = gain*amplitude*np.exp(-2j*np.pi*harmonic*frame/FRAMES)
            sx, sy, crest = np.fft.ifft2(np.stack((1j*ku*wave,1j*kv*wave,magnitude*wave)),axes=(-2,-1)).real
            # B retains mean-square slope when the mip chain averages R/G away.
            bgra = np.stack(((sx*sx+sy*sy)/slope_range**2, .5+.5*sy/slope_range,
                             .5+.5*sx/slope_range, .5+crest/(6*rms)),axis=2)
            volume[frame] = np.rint(255*np.clip(bgra,0,1)).astype(np.uint8)
            if wind_chop:
                compression[frame] = crest/rms
                velocity[frame] = np.fft.ifft2(np.stack((ku,kv)) * (omega/magnitude) * wave,
                                               axes=(-2,-1)).real
        if wind_chop:
            # The water shader reads all four channels for the cost of one sample.
            foam = advect_foam(compression,velocity,span,period)
            volume[:,:,:,3] = np.rint(255*foam).astype(np.uint8)
        volume.tofile(DEST/f"{name}.bgra")


if __name__ == "__main__":
    bake()
