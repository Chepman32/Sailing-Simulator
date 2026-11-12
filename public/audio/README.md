# Recorded sounds and their licences

Short one-shots of the skipper's own body (`src/simulator/audio/SampleBank.ts`),
converted to mono 44.1 kHz MP3, trimmed where noted and loudness-matched
(about −16 dBFS over the active part, peaks under −1 dBFS).

| Files | Source | Licence |
| --- | --- | --- |
| `foot-sand-1…3` | `default_sand_footstep.*.ogg` from [Minetest Game](https://github.com/minetest/minetest_game), originally [worthahep88 on Freesound](https://freesound.org/people/worthahep88/sounds/319224/) | CC0 1.0 |
| `step-ground-1…10` (steps on earth, sand, grass and rock), `step-wood-1…8` (on planks and the deck), `step-water-1…8` (wading), `swim-stroke-1…8` | Recordings supplied by the project's author (`walking-on-ground`, `walking-on-wood`, `walking-in-water`, `swimming`), cut into single steps and strokes, each with a short fade in and out | Supplied by the project's author for this game |
| `stroke-*`, `plunge-*`, `bubble-*`, `bubbles-rush` | “40 CC0 water / splash / slime SFX” (`splash_*`, `bubble_*`, `loop_bubbles_1`, cut to 2.6 s) by rubberduck, via CC0-Public-Domain-Sounds | CC0 1.0 |

The supplied steps are the footfall itself; the dry grains of sand
(`foot-sand-*`) are laid quietly under them on a beach. On wet sand by the
water the footfall is played duller and lower over a soft synthesised give of
the sand; in a film of water at the edge the wading recording comes in
quietly through a low-pass that opens with the depth (`wadeTone`), so
nothing bright crackles underfoot where the sea meets the sand.
`stroke-*` stays as the fallback for a swimming stroke.

## The story's recordings (`story/`)

The voiced lines and the scenes' sound effects of the prologue and M01,
supplied by the project's author for this game (archive `audio_output_v4`).

- `story/<chapter>/<id>_<speaker>.mp3` — the voices, by the voice script's
  ids (PR — the prologue, D — M01's dialogue, E — the outpost's people,
  L — Luis, EXD — extra lines); re-encoded to 80 kbit/s mono;
- `story/<chapter>/radio/…_radio.mp3` — the same lines through a radio set
  (the dispatcher, the patrol's channel, the network's broadcast);
- `story/<chapter>/sfx/…` — the effects and the place beds (loops), as supplied.

Which recording speaks which line is `src/simulator/story/content/voices.ts`
(matched by the Russian words); the effects and beds are named in the
missions (`sfx`, `bed`) and played by `StoryAudio`. Not every line of the
scenario is recorded yet: the rest stay subtitles until it is.

