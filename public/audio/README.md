# Recorded sounds and their licences

Short one-shots of the skipper's own body (`src/simulator/audio/SampleBank.ts`),
converted to mono 44.1 kHz MP3, trimmed where noted and loudness-matched
(about −16 dBFS over the active part, peaks under −1 dBFS).

| Files | Source | Licence |
| --- | --- | --- |
| `foot-sand-1…3` | `default_sand_footstep.*.ogg` from [Minetest Game](https://github.com/minetest/minetest_game), originally [worthahep88 on Freesound](https://freesound.org/people/worthahep88/sounds/319224/) | CC0 1.0 |
| `step-ground-1…10` (steps on earth, sand, grass and rock), `step-wood-1…8` (on planks and the deck), `step-water-1…8` (wading), `swim-stroke-1…8` | Recordings supplied by the project's author (`walking-on-ground`, `walking-on-wood`, `walking-in-water`, `swimming`), cut into single steps and strokes, each with a short fade in and out | Supplied by the project's author for this game |
| `foot-wet-*` | “100 CC0 SFX #2” (`sfx100v2_footstep_wet_*`) by rubberduck, via [CC0-Public-Domain-Sounds](https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds) | CC0 1.0 |
| `stroke-*`, `plunge-*`, `bubble-*`, `bubbles-rush` | “40 CC0 water / splash / slime SFX” (`splash_*`, `bubble_*`, `loop_bubbles_1`, cut to 2.6 s) by rubberduck, via CC0-Public-Domain-Sounds | CC0 1.0 |

The supplied steps are the footfall itself; the dry grains of sand and the
squelch of wet sand (`foot-sand-*`, `foot-wet-*`) are laid quietly under
them on a beach. `stroke-*` stays as the fallback for a swimming stroke.
