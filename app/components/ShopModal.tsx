"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { SimulationSnapshot } from "@/src/simulator/types";
import {
  DECOR,
  engineBoost,
  FIND_TIER,
  flareBoost,
  gearBoost,
  sonarDepth,
  sonarRange,
  upgradeDefinition,
  upgradePrice,
  type DecorSlot,
  type FindKind,
  type UpgradeId,
} from "@/src/simulator/economy/EconomyMath";
import { fill } from "./featureMessages";
import { findName, shopText, type ShopMessages } from "./shopMessages";

/** What the shop asks of the simulator (each returns whether it went through). */
export type ShopActions = {
  sell: (kind: FindKind | null) => number;
  buyUpgrade: (id: UpgradeId) => boolean;
  buyDecor: (id: string) => boolean;
  equip: (slot: DecorSlot, id: string | null) => void;
};

type Tab = "sell" | "yacht" | "decor" | "gear";
const TABS: readonly Tab[] = ["sell", "yacht", "decor", "gear"];
const YACHT: readonly UpgradeId[] = ["engine", "monitor", "sonar", "flare"];
const GEAR: readonly UpgradeId[] = ["tank", "fins", "torch"];
const SLOTS: readonly DecorSlot[] = ["flag", "charm", "bobble"];

/** Line icons for the upgrades (24 × 24, drawn in the current colour). */
const UPGRADE_ICON: Record<UpgradeId, string> = {
  // A propeller: three blades round a hub.
  engine: "M12 10.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zM12 10.2C11 6.5 11.6 3.6 14 3c2.3.6 1.6 4.6-2 7.2zM13.6 12.9c3.7.9 5.9 3 5.3 5.3-1.7 1.7-5-.8-5.3-5.3zM10.4 12.9c-2.6 2.8-5.4 3.8-7.1 2.1-.6-2.3 3.3-3.8 7.1-2.1z",
  // A wide screen on a pod.
  monitor: "M3 5.5h18v10.5H3zM9 19.5h6M12 16v3.5M6 12.5l3-3 2.5 2 3.5-4 3 3",
  // Sonar: a sweep of rings from a point.
  sonar: "M12 20a1.6 1.6 0 1 0 0-.01M7.8 15.8a6 6 0 0 1 8.4 0M5 13a10 10 0 0 1 14 0M2.4 10.2a14 14 0 0 1 19.2 0",
  // A flare bursting.
  flare: "M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  // A diving cylinder with its valve.
  tank: "M9 7.5a3 3 0 0 1 6 0V20a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM12 4.5v-2M10 2.5h4M9 11h6",
  // A fin.
  fins: "M9 3h6l1.5 6.5L20 20c-2.5 1.4-5.2 1.4-8 0-2.8 1.4-5.5 1.4-8 0l3.5-10.5zM12 9v11M8.6 10l-1.8 9M15.4 10l1.8 9",
  // A torch and its beam.
  torch: "M3 10.5h7v3H3zM10 9.5l3-2v9l-3-2M15 8.5l6-3M15 12h6.5M15 15.5l6 3",
};

const FIND_GLYPH: Record<FindKind, string> = {
  shell: "🐚",
  fishbones: "🐟",
  anchor: "⚓",
  bottle: "🍾",
  debris: "▦",
  can: "🛢",
  amphora: "🏺",
  compass: "🧭",
  sextant: "📐",
  coral: "🪸",
  statuette: "🗿",
  chest: "🧰",
};

/** A small swatch for each piece of decor (its colours, as the yacht shows them). */
const DECOR_SWATCH: Record<string, string> = {
  "flag-jolly": "linear-gradient(135deg, #111 0 60%, #eee 60% 64%, #111 64%)",
  "flag-tropic": "linear-gradient(180deg, #ffb347, #ff5e62 55%, #2a9d8f 56%)",
  "flag-signal": "conic-gradient(#f4d03f 0 25%, #1f4e99 0 50%, #f4d03f 0 75%, #1f4e99 0)",
  "flag-rainbow": "linear-gradient(180deg, #e74c3c, #f39c12, #f1c40f, #2ecc71, #3498db, #8e44ad)",
  "flag-dragon": "radial-gradient(circle at 40% 45%, #f6c344 0 18%, #12325a 19%)",
  "charm-shell": "radial-gradient(circle at 50% 40%, #fff3e3, #e8b48f)",
  "charm-anchor": "radial-gradient(circle at 50% 40%, #ffe9a8, #b8862b)",
  "charm-dreamcatcher": "radial-gradient(circle, transparent 38%, #c79a6b 40% 48%, #6ec6c9 50%)",
  "charm-pearl": "radial-gradient(circle at 35% 35%, #9aa5b8, #11151d 70%)",
  "bobble-hula": "radial-gradient(circle at 50% 30%, #8b5a3c 0 26%, #3fa34d 28%)",
  "bobble-captain": "radial-gradient(circle at 50% 30%, #f1d2b6 0 24%, #1d2c4f 26%)",
  "bobble-parrot": "radial-gradient(circle at 50% 30%, #e53935 0 30%, #2e7d32 32% 60%, #1e88e5 62%)",
  "bobble-shark": "radial-gradient(circle at 50% 70%, #f5f7fa 0 26%, #6f8597 28%)",
};

/**
 * The island trader's shop: sell the finds, buy the yacht's upgrades, its
 * decor and the diving gear. Prices rise by ×1.65 a level, so each tab
 * always shows what the next step costs and how far off it is.
 */
export function ShopModal({
  economy,
  gold,
  messages,
  actions,
  onClose,
}: {
  economy: SimulationSnapshot["economy"];
  gold: number;
  messages: ShopMessages;
  actions: ShopActions;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(economy.bagCount > 0 ? "sell" : "yacht");
  const [flash, setFlash] = useState<{ text: string; key: number } | null>(null);
  const [goldPulse, setGoldPulse] = useState(0);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ sell: null, yacht: null, decor: null, gear: null });

  const firstTab = useRef(tab);
  useEffect(() => {
    // Only on opening: later the focus stays where the player put it.
    tabRefs.current[firstTab.current]?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Escape" || (event.code === "KeyE" && !event.repeat)) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      const index = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(event.code);
      if (index >= 0) {
        setTab(TABS[index]!);
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const say = (text: string) => {
    setFlash((previous) => ({ text, key: (previous?.key ?? 0) + 1 }));
    setGoldPulse((value) => value + 1);
  };

  const tabLabel: Record<Tab, string> = {
    sell: messages.tabSell,
    yacht: messages.tabYacht,
    decor: messages.tabDecor,
    gear: messages.tabGear,
  };

  return (
    <div
      className="controls-backdrop shop-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="controls-card shop-card" role="dialog" aria-modal="true" aria-labelledby="shop-title">
        <header className="shop-head">
          <div className="shop-trader" aria-hidden="true">
            <span>⛵</span>
          </div>
          <div className="shop-titles">
            <p className="eyebrow">{messages.traderName}</p>
            <h2 id="shop-title">{messages.shopTitle}</h2>
            <p className="controls-lead">{messages.shopLead}</p>
          </div>
          <div key={goldPulse} className={`shop-gold${goldPulse > 0 ? " is-pulse" : ""}`} aria-live="polite">
            <span className="shop-coin" aria-hidden="true" />
            <span className="shop-gold-value">{gold.toLocaleString()}</span>
            <span className="shop-gold-label">{messages.gold}</span>
          </div>
        </header>

        <nav className="shop-tabs" role="tablist" aria-label={messages.shopTitle}>
          {TABS.map((id, index) => (
            <button
              key={id}
              ref={(node) => {
                tabRefs.current[id] = node;
              }}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className="shop-tab"
              onClick={() => setTab(id)}
            >
              <kbd aria-hidden="true">{index + 1}</kbd>
              <span>{tabLabel[id]}</span>
              {id === "sell" && economy.bagCount > 0 && <span className="shop-badge">{economy.bagCount}</span>}
            </button>
          ))}
        </nav>

        <div className="shop-body" role="tabpanel">
          {tab === "sell" && <SellTab economy={economy} messages={messages} actions={actions} say={say} />}
          {tab === "yacht" && <UpgradeList ids={YACHT} economy={economy} gold={gold} messages={messages} actions={actions} say={say} />}
          {tab === "gear" && <UpgradeList ids={GEAR} economy={economy} gold={gold} messages={messages} actions={actions} say={say} />}
          {tab === "decor" && <DecorTab economy={economy} gold={gold} messages={messages} actions={actions} say={say} />}
        </div>

        <footer className="shop-foot">
          {flash && (
            <p key={flash.key} className="shop-flash" role="status">
              {flash.text}
            </p>
          )}
          {tab === "sell" && economy.bagCount > 0 && (
            <button
              type="button"
              className="shop-sell-all"
              onClick={() => {
                const paid = actions.sell(null);
                if (paid > 0) say(fill(messages.sold, { gold: paid }));
              }}
            >
              <span className="shop-coin is-small" aria-hidden="true" />
              {fill(messages.sellAll, { gold: economy.bagValue.toLocaleString() })}
            </button>
          )}
          <button type="button" className="controls-close" onClick={onClose}>
            {messages.close}
          </button>
        </footer>
      </section>
    </div>
  );
}

type TabProps = {
  economy: SimulationSnapshot["economy"];
  messages: ShopMessages;
  actions: ShopActions;
  say: (text: string) => void;
};

function SellTab({ economy, messages, actions, say }: TabProps) {
  if (economy.bag.length === 0) {
    return <p className="shop-empty">{messages.bagEmpty}</p>;
  }
  const rows = [...economy.bag].sort((a, b) => b.total - a.total);
  return (
    <div className="shop-sell">
      <ul className="shop-list">
        {rows.map((row) => {
          const kind = row.kind as FindKind;
          const tier = FIND_TIER[kind] ?? 1;
          return (
            <li key={row.kind} className={`shop-row tier-${tier}`}>
              <span className="shop-glyph" aria-hidden="true">{FIND_GLYPH[kind] ?? "•"}</span>
              <span className="shop-row-main">
                <span className="shop-row-name">{findName(messages, row.kind)}</span>
                <span className="shop-row-meta">
                  <span className={`shop-tier tier-${tier}`}>{shopText(messages, `tier${tier}`)}</span>
                  {fill(messages.each, { count: row.count, gold: row.total })}
                </span>
              </span>
              <button
                type="button"
                className="shop-action"
                onClick={() => {
                  const paid = actions.sell(kind);
                  if (paid > 0) say(fill(messages.sold, { gold: paid }));
                }}
              >
                {messages.sell}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What a level of an upgrade does, in words. */
function effectText(id: UpgradeId, level: number, messages: ShopMessages): string {
  if (level <= 0) return messages.fx_none;
  const percent = (value: number) => Math.round((value - 1) * 100);
  switch (id) {
    case "engine": {
      const boost = engineBoost(level);
      return fill(messages.fx_engine, { thrust: percent(boost.thrust), speed: percent(boost.fade), response: percent(boost.response) });
    }
    case "monitor":
      return shopText(messages, `fx_monitor_${Math.min(4, level)}`);
    case "sonar": {
      const marks = level >= 6 ? messages.fx_sonar_all : level >= 3 ? messages.fx_sonar_artefacts : messages.fx_sonar_chests;
      return fill(messages.fx_sonar, { range: sonarRange(level), depth: Math.round(sonarDepth(level)), marks });
    }
    case "flare": {
      const boost = flareBoost(level);
      return fill(messages.fx_flare, { apex: percent(boost.apex), burn: percent(boost.burn), power: percent(boost.power), reach: percent(boost.reach) });
    }
    case "tank":
      return fill(messages.fx_tank, { air: gearBoost(level, 0, 0).air.toFixed(2).replace(/\.?0+$/, "") });
    case "fins":
      return fill(messages.fx_fins, { swim: percent(gearBoost(0, level, 0).swim) });
    case "torch": {
      const boost = gearBoost(0, 0, level);
      return fill(messages.fx_torch, { power: percent(boost.torch), range: percent(boost.torchRange) });
    }
  }
}

function UpgradeList({ ids, economy, gold, messages, actions, say }: TabProps & { ids: readonly UpgradeId[]; gold: number }) {
  return (
    <ul className="shop-cards">
      {ids.map((id) => {
        const definition = upgradeDefinition(id);
        const level = economy.upgrades[id] ?? 0;
        const maxed = level >= definition.max;
        const price = maxed ? 0 : upgradePrice(definition.base, level);
        const short = Math.max(0, price - gold);
        const name = shopText(messages, `up_${id}`);
        return (
          <li key={id} className={`shop-upgrade${maxed ? " is-max" : ""}`}>
            <div className="shop-upgrade-head">
              <span className="shop-upgrade-glyph" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d={UPGRADE_ICON[id]} />
                </svg>
              </span>
              <div>
                <h3>{name}</h3>
                <p>{shopText(messages, `up_${id}_text`)}</p>
              </div>
            </div>
            <div className="shop-pips" role="img" aria-label={fill(messages.level, { level, max: definition.max })}>
              {Array.from({ length: definition.max }, (_, index) => (
                <span key={index} className={index < level ? "is-on" : undefined} />
              ))}
              <span className="shop-pips-label">{maxed ? messages.maxed : fill(messages.level, { level, max: definition.max })}</span>
            </div>
            <dl className="shop-effects">
              <div>
                <dt>{messages.now}</dt>
                <dd>{effectText(id, level, messages)}</dd>
              </div>
              {!maxed && (
                <div className="is-next">
                  <dt>{messages.next}</dt>
                  <dd>{effectText(id, level + 1, messages)}</dd>
                </div>
              )}
            </dl>
            {!maxed && (
              <button
                type="button"
                className="shop-buy"
                disabled={short > 0}
                onClick={() => {
                  if (actions.buyUpgrade(id)) say(fill(messages.bought, { name, level: level + 1 }));
                }}
              >
                <span className="shop-coin is-small" aria-hidden="true" />
                {short > 0 ? fill(messages.short, { gold: short.toLocaleString() }) : fill(messages.buy, { gold: price.toLocaleString() })}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DecorTab({ economy, gold, messages, actions, say }: TabProps & { gold: number }) {
  const slotName: Record<DecorSlot, string> = { flag: messages.slotFlag, charm: messages.slotCharm, bobble: messages.slotBobble };
  return (
    <div className="shop-decor">
      {SLOTS.map((slot) => (
        <section key={slot} className="shop-slot">
          <h3>{slotName[slot]}</h3>
          <ul>
            {DECOR.filter((item) => item.slot === slot).map((item) => {
              const owned = economy.decor.includes(item.id);
              const on = economy.equipped[slot] === item.id;
              const short = Math.max(0, item.price - gold);
              const name = shopText(messages, item.id);
              return (
                <li key={item.id} className={`shop-decor-item${on ? " is-on" : ""}`}>
                  <span className="shop-swatch" aria-hidden="true" style={{ "--swatch": DECOR_SWATCH[item.id] ?? "#888" } as CSSProperties} />
                  <span className="shop-row-main">
                    <span className="shop-row-name">{name}</span>
                    {owned && <span className="shop-row-meta">{on ? messages.equipped : messages.owned}</span>}
                  </span>
                  {owned ? (
                    <button
                      type="button"
                      className="shop-action"
                      aria-pressed={on}
                      onClick={() => actions.equip(slot, on ? null : item.id)}
                    >
                      {on ? messages.takeDown : messages.equip}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="shop-action is-buy"
                      disabled={short > 0}
                      title={short > 0 ? fill(messages.short, { gold: short }) : undefined}
                      onClick={() => {
                        if (actions.buyDecor(item.id)) say(fill(messages.decorBought, { name }));
                      }}
                    >
                      {short > 0 ? fill(messages.short, { gold: short.toLocaleString() }) : fill(messages.buy, { gold: item.price.toLocaleString() })}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
