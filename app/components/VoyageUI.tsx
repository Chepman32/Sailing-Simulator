"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Discovery, SimulationSnapshot } from "@/src/simulator/types";
import { featureText, fill, type FeatureMessages } from "./featureMessages";

/**
 * The voyage's own controls and overlays: the signal buttons (horn, bell,
 * flare gun), the yacht radio, what is floating nearby, finds and
 * discoveries, the first-run guide, and the offer of a tow when stuck.
 */

export type VoyageIconName =
  | "horn"
  | "bell"
  | "flare"
  | "radio"
  | "prev"
  | "next"
  | "power"
  | "recenter"
  | "rescue"
  | "restart"
  | "install"
  | "bottle"
  | "crate"
  | "flamingo"
  | "close";

export function VoyageIcon({ name }: { name: VoyageIconName }) {
  return (
    <svg className="control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === "horn" && (
        <>
          <path d="M3 10.5h3l9-5v13l-9-5H3Z" />
          <path d="M6 13.5 7.5 19h2.4L9 14.6" />
          <path d="M18 9.5a3.5 3.5 0 0 1 0 5M20.2 7.4a6.5 6.5 0 0 1 0 9.2" />
        </>
      )}
      {name === "bell" && (
        <>
          <path d="M12 3.5v1.6M6.5 16.5c1-1.2 1.2-3 1.2-5.3A4.3 4.3 0 0 1 12 6.8a4.3 4.3 0 0 1 4.3 4.4c0 2.3.2 4.1 1.2 5.3Z" />
          <path d="M4.5 16.5h15M10.3 19.2a1.9 1.9 0 0 0 3.4 0" />
        </>
      )}
      {name === "flare" && (
        <>
          <path d="M4 20 13 11" />
          <path d="m10.5 9.5 4 4 2.6-2.6-4-4Z" />
          <path d="M17.5 3.5v2.4M20.5 6.5h-2.4M19.6 4.4l-1.6 1.6M15.1 4.5l.6 1.4M20.4 9.4l-1.4-.5" />
        </>
      )}
      {name === "radio" && (
        <>
          <rect x="3" y="8" width="18" height="12" rx="2.2" />
          <path d="m7 8 9.5-4.5" />
          <circle cx="15.5" cy="14" r="2.8" />
          <path d="M6.5 12h4M6.5 15h4M6.5 18h4" />
        </>
      )}
      {name === "prev" && <path d="M6 6v12M18 6l-9 6 9 6Z" />}
      {name === "next" && <path d="M18 6v12M6 6l9 6-9 6Z" />}
      {name === "power" && (
        <>
          <path d="M12 2.8v8.1" />
          <path d="M7.2 5.8a8 8 0 1 0 9.6 0" />
        </>
      )}
      {name === "install" && (
        <>
          <path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5" />
          <path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
        </>
      )}
      {name === "recenter" && (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
          <circle cx="12" cy="12" r="7.5" />
        </>
      )}
      {name === "rescue" && (
        <>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3.6" />
          <path d="m6.4 6.4 3 3M14.6 14.6l3 3M17.6 6.4l-3 3M9.4 14.6l-3 3" />
        </>
      )}
      {name === "restart" && <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" />}
      {name === "bottle" && (
        <>
          <path d="M10 2.8h4M10.5 2.8v4.4L8 10.5V20a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 16 20v-9.5l-2.5-3.3V2.8" />
          <path d="M10.2 13.5h3.6v4h-3.6Z" />
        </>
      )}
      {name === "crate" && (
        <>
          <rect x="3.5" y="5" width="17" height="14" rx="1" />
          <path d="M3.5 9.7h17M3.5 14.3h17M7 5l10 14M17 5 7 19" />
        </>
      )}
      {name === "flamingo" && (
        <>
          <ellipse cx="12" cy="17" rx="8" ry="3.4" />
          <path d="M14.5 15.5c2-3.2 3.4-6.4 1.2-9.3-1.5-2-4.6-1.3-4.6 1" />
          <path d="m11.1 7.2-2.6 1.6 2 1" />
        </>
      )}
      {name === "close" && <path d="M6 6l12 12M18 6 6 18" />}
    </svg>
  );
}

// --- Signals ------------------------------------------------------------------

export function SignalButtons({
  messages,
  disabled,
  onHorn,
  onBell,
  onFlare,
}: {
  messages: FeatureMessages;
  disabled: boolean;
  onHorn: () => void;
  onBell: () => void;
  onFlare: (color: "red" | "green") => void;
}) {
  const [flareOpen, setFlareOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  // The chooser closes by itself after a while, or on any press elsewhere.
  useEffect(() => {
    if (!flareOpen) return;
    const outside = (event: PointerEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setFlareOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [flareOpen]);
  const keepOpen = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setFlareOpen(false), 5000);
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  return (
    <>
      <span className="scene-divider" aria-hidden="true" />
      <button type="button" className="scene-action signal-action" disabled={disabled} title={`${messages.horn} (H)`} aria-label={messages.horn} onClick={onHorn}>
        <VoyageIcon name="horn" />
        <span className="scene-action-label">{messages.horn}</span>
      </button>
      <button type="button" className="scene-action signal-action signal-bell" disabled={disabled} title={`${messages.bell} (B)`} aria-label={messages.bell} onClick={onBell}>
        <VoyageIcon name="bell" />
        <span className="scene-action-label">{messages.bell}</span>
      </button>
      <div className="scene-pop-anchor" ref={wrapRef}>
        <button
          type="button"
          className="scene-action signal-action"
          disabled={disabled}
          title={`${messages.flare} (F / G)`}
          aria-label={messages.flare}
          aria-expanded={flareOpen}
          aria-pressed={flareOpen}
          onClick={() => {
            setFlareOpen((open) => !open);
            keepOpen();
          }}
        >
          <VoyageIcon name="flare" />
          <span className="scene-action-label">{messages.flare}</span>
        </button>
        {flareOpen && (
          <div className="scene-pop flare-pop" role="group" aria-label={messages.flare}>
            {/* On narrow portrait screens the bell lives here, beside the flares. */}
            <button
              type="button"
              className="flare-choice pop-bell"
              aria-label={messages.bell}
              title={`${messages.bell} (B)`}
              onClick={() => {
                onBell();
                keepOpen();
              }}
            >
              <VoyageIcon name="bell" />
            </button>
            {(["red", "green"] as const).map((color) => (
              <button
                key={color}
                type="button"
                className={`flare-choice is-${color}`}
                aria-label={color === "red" ? messages.flareRed : messages.flareGreen}
                title={`${color === "red" ? messages.flareRed : messages.flareGreen} (${color === "red" ? "F" : "G"})`}
                onClick={() => {
                  onFlare(color);
                  keepOpen();
                }}
              >
                <span aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// --- Radio ----------------------------------------------------------------------

export type StationInfo = { id: string; name: string; genre: string; source?: string; homepage?: string; accent: string };

export function stationInfo(messages: FeatureMessages): StationInfo[] {
  return [
    { id: "lofi", name: messages.stationLofi, genre: messages.stationLofiGenre, source: "SomaFM · Groove Salad", homepage: "https://somafm.com/groovesalad/", accent: "#f2b46d" },
    { id: "synthwave", name: messages.stationSynthwave, genre: messages.stationSynthwaveGenre, source: "SomaFM · Underground 80s", homepage: "https://somafm.com/u80s/", accent: "#ff6fd2" },
    { id: "reggae", name: messages.stationReggae, genre: messages.stationReggaeGenre, source: "SomaFM · Heavyweight Reggae", homepage: "https://somafm.com/reggae/", accent: "#7fdc6a" },
    { id: "shanty", name: messages.stationShanty, genre: messages.stationShantyGenre, accent: "#7fc3ff" },
  ];
}

export function RadioPlayer({
  messages,
  snapshot,
  disabled,
  volume,
  onStation,
  onStep,
  onVolume,
}: {
  messages: FeatureMessages;
  snapshot: SimulationSnapshot;
  disabled: boolean;
  volume: number;
  onStation: (id: string | null) => void;
  onStep: (direction: 1 | -1) => void;
  onVolume: (volume: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stations = stationInfo(messages);
  const playing = stations.find((station) => station.id === snapshot.radioStation) ?? null;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);
  return (
    <div className="scene-pop-anchor" ref={wrapRef}>
      <button
        type="button"
        className={`scene-action radio-action${playing ? " is-playing" : ""}`}
        disabled={disabled}
        aria-expanded={open}
        aria-label={`${messages.radio}: ${playing ? playing.name : messages.radioOff}`}
        title={`${messages.radio} (M)`}
        onClick={() => setOpen((value) => !value)}
        style={playing ? ({ "--station": playing.accent } as React.CSSProperties) : undefined}
      >
        {playing && !snapshot.radioBuffering ? (
          <span className="eq-bars" aria-hidden="true"><i /><i /><i /></span>
        ) : (
          <VoyageIcon name="radio" />
        )}
        <span className="scene-action-label">{playing ? playing.name : messages.radio}</span>
      </button>
      {open && (
        <div className="scene-pop radio-card" role="dialog" aria-label={messages.radio}>
          <div className="radio-head">
            <button type="button" className="radio-round" aria-label={messages.radioPrevious} onClick={() => onStep(-1)}>
              <VoyageIcon name="prev" />
            </button>
            <div className="radio-now" aria-live="polite">
              <strong>{playing ? playing.name : messages.radioOff}</strong>
              <span>{playing ? (snapshot.radioBuffering ? messages.radioConnecting : playing.genre) : messages.radio}</span>
            </div>
            <button type="button" className="radio-round" aria-label={messages.radioNext} onClick={() => onStep(1)}>
              <VoyageIcon name="next" />
            </button>
            <button
              type="button"
              className="radio-round radio-power"
              aria-pressed={Boolean(playing)}
              aria-label={playing ? messages.radioOff : messages.radioOn}
              onClick={() => onStation(playing ? null : (stations[0]!.id))}
            >
              <VoyageIcon name="power" />
            </button>
          </div>
          <ul className="radio-stations">
            {stations.map((station) => (
              <li key={station.id}>
                <button
                  type="button"
                  aria-pressed={station.id === snapshot.radioStation}
                  style={{ "--station": station.accent } as React.CSSProperties}
                  onClick={() => onStation(station.id)}
                >
                  <span className="station-dot" aria-hidden="true" />
                  <span className="station-text">
                    <strong>{station.name}</strong>
                    <small>{station.source ?? messages.radioBand}</small>
                  </span>
                  <span className="station-badge">{station.source ? messages.radioLive : "♪"}</span>
                </button>
              </li>
            ))}
          </ul>
          <label className="radio-volume">
            <span>{messages.radioVolume}</span>
            <input type="range" min="0" max="100" value={Math.round(volume * 100)} onChange={(event) => onVolume(Number(event.target.value) / 100)} />
          </label>
          {playing?.homepage && (
            <p className="radio-credit">
              <a href={playing.homepage} target="_blank" rel="noreferrer">{playing.source}</a> — {messages.radioCredit}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** GTA-style: the station's name sweeps in at the top when tuned. */
export function StationBanner({ station, keyId }: { station: StationInfo | null; keyId: number }) {
  if (!station) return null;
  return (
    <div className="station-banner" key={keyId} aria-hidden="true" style={{ "--station": station.accent } as React.CSSProperties}>
      <strong>{station.name}</strong>
      <span>{station.genre}</span>
    </div>
  );
}

// --- Overlays -------------------------------------------------------------------

const LOOT_ICON: Record<"bottle" | "crate" | "flamingo", VoyageIconName> = { bottle: "bottle", crate: "crate", flamingo: "flamingo" };

/** What is floating nearby: kind, distance and an arrow pointing to it. */
export function LootChip({ loot, messages }: { loot: SimulationSnapshot["nearestLoot"]; messages: FeatureMessages }) {
  if (!loot) return null;
  const name = loot.kind === "bottle" ? messages.bottle : loot.kind === "crate" ? messages.crate : messages.flamingo;
  const close = loot.distance < 40;
  return (
    <div className={`loot-chip is-${loot.kind}`} role="status" title={messages.lootHint}>
      <VoyageIcon name={LOOT_ICON[loot.kind]} />
      <span>{name} · {Math.round(loot.distance)} m</span>
      <span className="loot-arrow" aria-hidden="true" style={{ transform: `rotate(${(loot.bearing * 180) / Math.PI}deg)` }}>↑</span>
      {close && <small>{messages.lootHint}</small>}
    </div>
  );
}

export type DiscoveryView = Discovery & { id: number };

const RIDDLES = new Set(["riddle-teeth", "riddle-shadow", "riddle-hole", "riddle-towel"]);
const PLACE_ICONS: Record<string, string> = { volcano: "🌋", barge: "🪩", wreck: "🏴‍☠️", monolith: "🗿" };

/** A find or a discovery: a card at the top, with its words, for a few seconds. */
export function DiscoveryCard({
  discovery,
  messages,
  onClose,
  onHoist,
}: {
  discovery: DiscoveryView | null;
  messages: FeatureMessages;
  onClose: () => void;
  onHoist: (color: string) => void;
}) {
  const [answer, setAnswer] = useState(false);
  useEffect(() => {
    if (!discovery) return;
    const riddle = RIDDLES.has(discovery.key);
    const timer = window.setTimeout(onClose, riddle ? 16000 : discovery.kind === "poi" ? 9000 : 8000);
    return () => window.clearTimeout(timer);
  }, [discovery, onClose]);
  if (!discovery) return null;
  let icon: ReactNode = null;
  let title = "";
  let body = "";
  let action: ReactNode = null;
  if (discovery.kind === "bottle") {
    icon = <VoyageIcon name="bottle" />;
    if (discovery.sailColor) {
      const colorName = featureText(messages, `sail_${discovery.sailColor}`);
      title = fill(messages.newSail, { color: colorName });
      body = messages.newSailText;
      action = (
        <button type="button" className="discovery-action" onClick={() => onHoist(discovery.sailColor!)}>
          <span className={`sail-swatch is-${discovery.sailColor}`} aria-hidden="true" />
          {messages.hoistSail}
        </button>
      );
    } else {
      title = messages.bottleFound;
      body = featureText(messages, discovery.key);
      if (RIDDLES.has(discovery.key)) {
        action = answer ? (
          <p className="discovery-answer">{featureText(messages, `${discovery.key}-answer`)}</p>
        ) : (
          <button type="button" className="discovery-action" onClick={() => setAnswer(true)}>{messages.showAnswer}</button>
        );
      }
    }
  } else if (discovery.kind === "crate") {
    icon = <VoyageIcon name="crate" />;
    title = messages.crateFound;
    body = `${featureText(messages, `cargo_${discovery.key}`)} ${fill(messages.coins, { n: discovery.coins ?? 0 })}`;
  } else if (discovery.kind === "flamingo") {
    icon = <VoyageIcon name="flamingo" />;
    title = discovery.first ? messages.flamingoFirst : messages.flamingoMore;
    body = discovery.first ? messages.flamingoFirstText : "";
  } else {
    icon = <span className="place-icon" aria-hidden="true">{PLACE_ICONS[discovery.key] ?? "★"}</span>;
    title = `${messages.placeFound}: ${featureText(messages, discovery.key)}`;
    body = featureText(messages, `${discovery.key}Text`);
  }
  return (
    <div className={`discovery-card is-${discovery.kind}`} role="status" aria-live="polite" key={discovery.id}>
      <div className="discovery-icon">{icon}</div>
      <div className="discovery-text">
        <strong>{title}</strong>
        {body && <p>{body}</p>}
        {action}
      </div>
      <button type="button" className="discovery-close" aria-label={messages.close} onClick={onClose}>
        <VoyageIcon name="close" />
      </button>
    </div>
  );
}

/** The first-run guide: three short steps, each ticked off by doing it. */
export function QuickStart({
  step,
  touch,
  messages,
  onSkip,
}: {
  step: number;
  touch: boolean;
  messages: FeatureMessages;
  onSkip: () => void;
}) {
  if (step < 1 || step > 3) return null;
  const texts = touch
    ? [messages.guideStep1Touch, messages.guideStep2Touch, messages.guideStep3Touch]
    : [messages.guideStep1Keys, messages.guideStep2Keys, messages.guideStep3Keys];
  return (
    <div className="quick-start" role="status" aria-live="polite">
      <div className="quick-start-head">
        <span className="guide-step-long"><span className="guide-title">{messages.guideTitle} · </span>{fill(messages.guideStep, { n: step })}</span>
        <span className="guide-step-short">{step} / 3</span>
        <button type="button" onClick={onSkip}>{messages.guideSkip}</button>
      </div>
      <ol>
        {texts.map((text, index) => (
          <li key={index} className={index + 1 < step ? "is-done" : index + 1 === step ? "is-current" : ""}>
            <span className="step-mark" aria-hidden="true">{index + 1 < step ? "✓" : index + 1}</span>
            {text}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function StuckChip({ messages, onRescue }: { messages: FeatureMessages; onRescue: () => void }) {
  return (
    <button type="button" className="stuck-chip" onClick={onRescue}>
      <VoyageIcon name="rescue" />
      {messages.stuck}
    </button>
  );
}
