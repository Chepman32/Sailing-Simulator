"use client";

import { useEffect, useRef } from "react";
import type { FeatureMessages } from "./featureMessages";

/**
 * Every control on one card: shown once on the first visit (instead of a
 * step-by-step tutorial) and whenever the player asks for it (H, or the "?"
 * button). On a keyboard it is a key map grouped by what you are doing; on a
 * touch screen it says where each control is.
 */

type Row = { keys: readonly (readonly string[])[]; text: string };
type Section = { title: string; rows: readonly Row[] };

function keyboardSections(m: FeatureMessages): Section[] {
  return [
    {
      title: m.sectionHelm,
      rows: [
        { keys: [["W"], ["↑"]], text: m.c_throttleUp },
        { keys: [["S"], ["↓"]], text: m.c_throttleDown },
        { keys: [["A", "D"], ["←", "→"]], text: m.c_helm },
        { keys: [["Q", "E"]], text: m.c_sheet },
        { keys: [["Space"]], text: m.c_engine },
        { keys: [["C"]], text: m.c_center },
      ],
    },
    {
      title: m.sectionView,
      rows: [
        { keys: [["V"]], text: m.c_camera },
        { keys: [["R"]], text: m.c_recenter },
        { keys: [["P"]], text: m.c_cinematic },
        { keys: [["N"]], text: m.c_chart },
        { keys: [[m.keyDrag], [m.keyWheel]], text: m.c_orbit },
      ],
    },
    {
      title: m.sectionSignals,
      rows: [
        { keys: [["J"]], text: m.c_horn },
        { keys: [["B"]], text: m.c_bell },
        { keys: [["F", "G"]], text: m.c_flares },
        { keys: [["M"]], text: m.c_sound },
        { keys: [["O"]], text: m.c_radio },
        { keys: [["Shift + O"]], text: m.c_radioBack },
      ],
    },
    {
      title: m.sectionAshore,
      rows: [
        { keys: [["T"]], text: m.c_overboard },
        { keys: [["W", "A", "S", "D"]], text: m.c_walk },
        { keys: [[m.keyMouse]], text: m.c_look },
        { keys: [["Shift"]], text: m.c_run },
        { keys: [["Space"]], text: m.c_jump },
        { keys: [["C"]], text: m.c_dive },
        { keys: [["E"]], text: m.c_board },
        { keys: [["F"]], text: m.c_torch },
      ],
    },
    {
      title: m.sectionGeneral,
      rows: [
        { keys: [["H"]], text: m.c_help },
        { keys: [["Esc"]], text: m.c_escape },
      ],
    },
  ];
}

function touchSections(m: FeatureMessages): Section[] {
  return [
    { title: m.sectionHelm, rows: [{ keys: [], text: m.c_t_engine }, { keys: [], text: m.c_t_rudder }] },
    { title: m.sectionView, rows: [{ keys: [], text: m.c_t_look }, { keys: [], text: m.c_t_buttons }] },
    { title: m.sectionAshore, rows: [{ keys: [], text: m.c_t_overboard }, { keys: [], text: m.c_t_move }, { keys: [], text: m.c_t_actions }] },
  ];
}

export function ControlsCard({
  messages,
  touch,
  firstVisit,
  onClose,
}: {
  messages: FeatureMessages;
  touch: boolean;
  /** The first time it is shown: the button says "set sail". */
  firstVisit: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);
  const sections = touch ? touchSections(messages) : keyboardSections(messages);
  return (
    <div
      className="controls-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={`controls-card${touch ? " is-touch" : ""}`} role="dialog" aria-modal="true" aria-labelledby="controls-title">
        <header className="controls-head">
          <div>
            <p className="eyebrow">Sailing Simulator Pro</p>
            <h2 id="controls-title">{messages.controlsTitle}</h2>
            <p className="controls-lead">{touch ? messages.controlsLeadTouch : messages.controlsLead}</p>
          </div>
        </header>
        <div className="controls-grid">
          {sections.map((section) => (
            <div className="controls-section" key={section.title}>
              <h3>{section.title}</h3>
              <ul>
                {section.rows.map((row) => (
                  <li key={row.text} className={row.keys.length === 0 ? "is-plain" : undefined}>
                    {row.keys.length > 0 && (
                      <span className="controls-keys">
                        {row.keys.map((group, groupIndex) => (
                          <span className="controls-key-group" key={groupIndex}>
                            {groupIndex > 0 && <span className="controls-or">/</span>}
                            {group.map((key) => (
                              <kbd key={key}>{key}</kbd>
                            ))}
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="controls-text">{row.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <footer className="controls-foot">
          <button ref={closeRef} type="button" className="controls-close" onClick={onClose}>
            {firstVisit ? messages.controlsStart : messages.controlsClose}
          </button>
        </footer>
      </section>
    </div>
  );
}
