"use client";

import { useEffect, useRef, useState } from "react";
import type { SimulationSnapshot } from "@/src/simulator/types";
import { BAG_COLUMNS, BAG_SLOTS, FIND_TIER, STACK_SIZE, type FindKind } from "@/src/simulator/economy/EconomyMath";
import { fill } from "./featureMessages";
import { FIND_GLYPH } from "./ShopModal";
import { findName, shopText, type ShopMessages } from "./shopMessages";

/**
 * The backpack (Tab, on foot and at the helm): a 10 × 10 grid of slots, each
 * a stack of up to 100 finds of one kind. A slot shows its find and count;
 * selected, its name, tier, how full it is, what it fetches, and a button
 * to throw it out (to make room when the backpack is full).
 */
export function InventoryModal({
  economy,
  gold,
  messages,
  onDiscard,
  onClose,
}: {
  economy: SimulationSnapshot["economy"];
  gold: number;
  messages: ShopMessages;
  onDiscard: (index: number) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(economy.stacks.length > 0 ? 0 : null);
  const gridRef = useRef<HTMLDivElement>(null);
  const stacks = economy.stacks;
  const stack = selected !== null ? stacks[selected] : undefined;

  useEffect(() => {
    gridRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Escape" || (event.code === "Tab" && !event.repeat)) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  /** Arrow keys move round the grid. */
  const move = (index: number, key: string) => {
    const column = index % BAG_COLUMNS;
    const next =
      key === "ArrowRight" ? (column < BAG_COLUMNS - 1 ? index + 1 : index)
        : key === "ArrowLeft" ? (column > 0 ? index - 1 : index)
          : key === "ArrowDown" ? Math.min(BAG_SLOTS - 1, index + BAG_COLUMNS)
            : key === "ArrowUp" ? Math.max(0, index - BAG_COLUMNS)
              : index;
    if (next === index) return;
    gridRef.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
    setSelected(next < stacks.length ? next : null);
  };

  const level = (id: string) => economy.upgrades[id] ?? 0;

  return (
    <div
      className="controls-backdrop shop-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="controls-card inventory-card" role="dialog" aria-modal="true" aria-labelledby="inventory-title">
        <header className="shop-head">
          <div className="shop-trader" aria-hidden="true">
            <span>🎒</span>
          </div>
          <div className="shop-titles">
            <p className="eyebrow">{fill(messages.invSlots, { used: stacks.length, max: BAG_SLOTS })}</p>
            <h2 id="inventory-title">{messages.invTitle}</h2>
            <p className="controls-lead">{messages.invLead}</p>
          </div>
          <div className="shop-gold">
            <span className="shop-coin" aria-hidden="true" />
            <span className="shop-gold-value">{gold.toLocaleString()}</span>
            <span className="shop-gold-label">{messages.gold}</span>
          </div>
        </header>

        <div className="inventory-body">
          <div ref={gridRef} className="inventory-grid" role="grid" aria-label={messages.invTitle}>
            {Array.from({ length: BAG_SLOTS }, (_, index) => {
              const item = stacks[index];
              const tier = item ? FIND_TIER[item.kind as FindKind] ?? 1 : 0;
              return (
                <button
                  key={index}
                  type="button"
                  role="gridcell"
                  className={`inventory-slot${item ? ` tier-${tier}` : " is-empty"}${selected === index ? " is-selected" : ""}`}
                  aria-label={item ? `${findName(messages, item.kind)} × ${item.count}` : messages.invEmpty}
                  aria-selected={selected === index}
                  onClick={() => setSelected(item ? index : null)}
                  onKeyDown={(event) => {
                    if (event.key.startsWith("Arrow")) {
                      event.preventDefault();
                      move(index, event.key);
                    }
                  }}
                >
                  {item && (
                    <>
                      <span className="inventory-glyph" aria-hidden="true">{FIND_GLYPH[item.kind as FindKind] ?? "•"}</span>
                      <span className="inventory-count">{item.count}</span>
                      <span className="inventory-fill" style={{ transform: `scaleX(${item.count / STACK_SIZE})` }} aria-hidden="true" />
                    </>
                  )}
                </button>
              );
            })}
          </div>

          <aside className="inventory-side">
            {stack ? (
              <div className="inventory-detail">
                <span className="inventory-detail-glyph" aria-hidden="true">{FIND_GLYPH[stack.kind as FindKind] ?? "•"}</span>
                <h3>{findName(messages, stack.kind)}</h3>
                <span className={`shop-tier tier-${FIND_TIER[stack.kind as FindKind] ?? 1}`}>{shopText(messages, `tier${FIND_TIER[stack.kind as FindKind] ?? 1}`)}</span>
                <p>{fill(messages.invCount, { count: stack.count, max: STACK_SIZE })}</p>
                <p className="inventory-worth">
                  <span className="shop-coin is-small" aria-hidden="true" /> {fill(messages.invWorth, { gold: stack.total.toLocaleString() })}
                </p>
                <button
                  type="button"
                  className="shop-action inventory-discard"
                  onClick={() => {
                    if (selected === null) return;
                    onDiscard(selected);
                    setSelected(stacks.length > 1 ? Math.min(selected, stacks.length - 2) : null);
                  }}
                >
                  {messages.invDiscard}
                </button>
              </div>
            ) : (
              <p className="inventory-hint">{stacks.length === 0 ? messages.bagEmpty : messages.invPick}</p>
            )}
            <div className="inventory-gear">
              <h3>{messages.invGear}</h3>
              <ul>
                <li><span>{messages.invTank}</span><strong>{level("tank")}</strong></li>
                <li><span>{messages.invFins}</span><strong>{level("fins")}</strong></li>
                <li><span>{messages.invTorch}</span><strong>{level("torch")}</strong></li>
              </ul>
            </div>
          </aside>
        </div>

        <footer className="shop-foot">
          <span className="inventory-total">
            <span className="shop-coin is-small" aria-hidden="true" /> {fill(messages.invWorth, { gold: economy.bagValue.toLocaleString() })}
          </span>
          <button type="button" className="controls-close" onClick={onClose}>
            {messages.close}
          </button>
        </footer>
      </section>
    </div>
  );
}
