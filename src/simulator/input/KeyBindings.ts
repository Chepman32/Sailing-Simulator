/**
 * The skipper's keys on foot and in the water, which the player may change
 * in the pause menu (Esc), with the mouse's sensitivity and its vertical
 * sense. One shared instance (`keyBindings`) is read by the diver's
 * controller and by the interface's own key handler; it is kept in the
 * browser's storage between visits.
 *
 * Each action has one key of the player's choosing. The arrow keys stay as
 * a fixed second way to walk, whatever the walking keys are.
 */

export const BINDING_ACTIONS = [
  "forward",
  "back",
  "left",
  "right",
  "jump",
  "sprint",
  "crouch",
  "interact",
  "torch",
  "chart",
  "backpack",
  "helm",
] as const;

export type BindingAction = (typeof BINDING_ACTIONS)[number];

export type KeyMap = Record<BindingAction, string>;

export const DEFAULT_KEYS: Readonly<KeyMap> = Object.freeze({
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  jump: "Space",
  sprint: "ShiftLeft",
  crouch: "KeyC",
  interact: "KeyE",
  torch: "KeyF",
  chart: "KeyQ",
  backpack: "Tab",
  helm: "KeyT",
});

/** Fixed second keys (not shown as bindings, never rebound). */
const ALTERNATES: Partial<Record<BindingAction, readonly string[]>> = {
  forward: ["ArrowUp"],
  back: ["ArrowDown"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  sprint: ["ShiftRight"],
  crouch: ["ControlLeft", "ControlRight"],
  chart: ["KeyN"],
};

/** Keys no action may take: they belong to the browser or to the menus themselves. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(["Escape", "F5", "F11", "F12", "MetaLeft", "MetaRight", "AltLeft", "AltRight", "KeyM", "KeyH"]);

export const MOUSE_SENSITIVITY_MIN = 0.3;
export const MOUSE_SENSITIVITY_MAX = 2.5;

export type LookSettings = { sensitivity: number; invertY: boolean };

const STORAGE_KEY = "sailing-simulator-keys-v1";

type Stored = { keys?: Partial<Record<string, string>>; sensitivity?: number; invertY?: boolean };

/**
 * Puts `code` on `action`. A key already used by another action is swapped
 * onto that action's old key, so no two actions ever share one and nothing
 * is left without a key. Reserved keys are refused (the map is returned as
 * it was).
 */
export function rebind(map: Readonly<KeyMap>, action: BindingAction, code: string): KeyMap {
  const next = { ...map };
  if (RESERVED_KEYS.has(code) || !code) return next;
  const previous = next[action];
  for (const other of BINDING_ACTIONS) {
    if (other !== action && next[other] === code) next[other] = previous;
  }
  next[action] = code;
  return next;
}

/** A readable name for a key code ("KeyW" → "W", "ShiftLeft" → "Shift"). */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  const names: Record<string, string> = {
    Space: "Space",
    ShiftLeft: "Shift",
    ShiftRight: "R-Shift",
    ControlLeft: "Ctrl",
    ControlRight: "R-Ctrl",
    Tab: "Tab",
    Enter: "Enter",
    Backspace: "⌫",
    CapsLock: "Caps",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
  };
  return names[code] ?? code;
}

function sanitize(stored: Stored | null): { keys: KeyMap; look: LookSettings } {
  let keys: KeyMap = { ...DEFAULT_KEYS };
  for (const action of BINDING_ACTIONS) {
    const code = stored?.keys?.[action];
    if (typeof code === "string" && code.length > 0 && code.length < 24) keys = rebind(keys, action, code);
  }
  const raw = Number(stored?.sensitivity);
  const sensitivity = Number.isFinite(raw) ? Math.min(MOUSE_SENSITIVITY_MAX, Math.max(MOUSE_SENSITIVITY_MIN, raw)) : 1;
  return { keys, look: { sensitivity, invertY: stored?.invertY === true } };
}

export class KeyBindings {
  private map: KeyMap = { ...DEFAULT_KEYS };
  private lookSettings: LookSettings = { sensitivity: 1, invertY: false };
  private readonly listeners = new Set<() => void>();
  private loaded = false;

  /** Reads the saved keys once (lazily: storage may not exist at import time). */
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    let stored: Stored | null = null;
    try {
      const text = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      stored = text ? (JSON.parse(text) as Stored) : null;
    } catch {
      stored = null;
    }
    const { keys, look } = sanitize(stored);
    this.map = keys;
    this.lookSettings = look;
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ keys: this.map, ...this.lookSettings }));
    } catch {
      // Storage blocked: the keys hold for this visit.
    }
    for (const listener of this.listeners) listener();
  }

  get keys(): Readonly<KeyMap> {
    this.load();
    return this.map;
  }

  get look(): Readonly<LookSettings> {
    this.load();
    return this.lookSettings;
  }

  /** Whether `code` is one of the keys of `action` (its own, or a fixed alternate). */
  matches(action: BindingAction, code: string): boolean {
    this.load();
    return this.map[action] === code || (ALTERNATES[action]?.includes(code) ?? false);
  }

  /** Any action's key (so the diver can claim it and keep the page from scrolling). */
  bound(code: string): boolean {
    this.load();
    for (const action of BINDING_ACTIONS) if (this.matches(action, code)) return true;
    return false;
  }

  set(action: BindingAction, code: string): boolean {
    this.load();
    if (RESERVED_KEYS.has(code)) return false;
    this.map = rebind(this.map, action, code);
    this.save();
    return true;
  }

  setLook(look: Partial<LookSettings>): void {
    this.load();
    this.lookSettings = sanitize({ keys: this.map, ...this.lookSettings, ...look }).look;
    this.save();
  }

  reset(): void {
    this.map = { ...DEFAULT_KEYS };
    this.lookSettings = { sensitivity: 1, invertY: false };
    this.loaded = true;
    this.save();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** The one set of keys, shared by the simulator and the interface. */
export const keyBindings = new KeyBindings();
