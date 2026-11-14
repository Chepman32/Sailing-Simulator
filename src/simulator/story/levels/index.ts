import type { LevelDefinition } from "../../level/LevelSystem";
import { M01_PLACES } from "./m01Places";
import { M02_PLACES } from "./m02Places";
import { M03_PLACES } from "./m03Places";
import { STVOR9 } from "./stvor9";

/** Every built place of the story (their pads level the ground from the start; each stands while the story wants it). */
export const STORY_LEVELS: readonly LevelDefinition[] = [STVOR9, ...M01_PLACES, ...M02_PLACES, ...M03_PLACES];
