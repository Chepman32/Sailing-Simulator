import type { LevelDefinition } from "../../level/LevelSystem";
import { STVOR9 } from "./stvor9";

/**
 * The story's built places (see `LevelSystem`), each in its own module:
 * where it stands, the ground it levels, how it is built.
 */
export const STORY_LEVELS: readonly LevelDefinition[] = [STVOR9];
