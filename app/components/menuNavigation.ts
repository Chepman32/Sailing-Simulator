"use client";

import { useEffect, type RefObject } from "react";
import { menuBack, menuSelect, menuTick } from "./menuSound";

/**
 * Keyboard and sound for the menus (the main menu, the pause menu): the
 * arrows move the highlight up and down the items (round from the last to
 * the first), Enter or Space chooses; the mouse moving over an item
 * highlights it too, so the keys carry on from where the pointer was; and
 * each move ticks softly, each choice chimes (`menuSound`).
 */

const ITEMS = "button:not([disabled]), select:not([disabled]), input:not([disabled]):not([type=hidden]), a[href]";

function itemsOf(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ITEMS)].filter((item) => item.offsetParent !== null || item.getClientRects().length > 0);
}

/** Inputs that use the arrows themselves (a list, a slider, a text field). */
function ownsArrows(element: Element | null): boolean {
  if (!element) return false;
  if (element.tagName === "SELECT") return true;
  if (element.tagName !== "INPUT") return false;
  const type = (element as HTMLInputElement).type;
  return type !== "checkbox" && type !== "radio" && type !== "button" && type !== "submit";
}

/**
 * Up or down a menu by the arrows. Called from the menu's own key handler
 * (captured before the game's); true when the key was used here.
 */
export function moveMenuFocus(root: HTMLElement | null, event: KeyboardEvent): boolean {
  if (!root || (event.code !== "ArrowDown" && event.code !== "ArrowUp")) return false;
  const active = document.activeElement;
  if (active && root.contains(active) && ownsArrows(active)) return false;
  const items = itemsOf(root);
  if (!items.length) return false;
  event.preventDefault();
  const step = event.code === "ArrowDown" ? 1 : -1;
  const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
  const next = index < 0 ? (step > 0 ? 0 : items.length - 1) : (index + step + items.length) % items.length;
  const item = items[next]!;
  item.focus({ preventScroll: true });
  item.scrollIntoView({ block: "nearest" });
  return true;
}

/**
 * The menu's sounds and pointer highlight, on the element `ref` (`page`
 * changes when it shows another page: its first item is focused then,
 * silently).
 */
export function useMenuNavigation(ref: RefObject<HTMLElement | null>, page: unknown): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // The page's own first focus is not a move.
    const quietUntil = performance.now() + 200;
    const onFocus = (event: FocusEvent) => {
      if (performance.now() < quietUntil) return;
      if (event.target instanceof Element && event.target.matches(ITEMS)) menuTick();
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !(event.target instanceof Element)) return;
      const item = event.target.closest<HTMLElement>("button:not([disabled])");
      if (!item || !root.contains(item) || item === document.activeElement) return;
      // Not out of a field being typed or slid in.
      if (ownsArrows(document.activeElement) && root.contains(document.activeElement)) return;
      item.focus({ preventScroll: true });
    };
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLElement>("button");
      if (!button || !root.contains(button) || button.hasAttribute("disabled")) return;
      if (button.dataset.sound === "back") menuBack();
      else menuSelect();
    };
    root.addEventListener("focusin", onFocus);
    root.addEventListener("pointerover", onOver);
    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("focusin", onFocus);
      root.removeEventListener("pointerover", onOver);
      root.removeEventListener("click", onClick);
    };
  }, [ref, page]);
}
