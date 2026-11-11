"use client";

import { useState } from "react";
import type { LanguageCode } from "../i18n";
import { storyMessages } from "./storyMessages";

/**
 * The first choice of a voyage: the campaign (continued, or started over)
 * or free sailing as before. Shown once on a first visit; afterwards the
 * same choices live in the pause menu.
 */

type Props = {
  language: LanguageCode;
  saved: boolean;
  onContinue: () => void;
  onNew: () => void;
  onFree: () => void;
  /** Shown from the pause menu: it can be closed without choosing. */
  onClose?: () => void;
};

export function CampaignMenu({ language, saved, onContinue, onNew, onFree, onClose }: Props) {
  const messages = storyMessages(language);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="campaign-menu-scrim" role="dialog" aria-modal="true" aria-labelledby="campaign-menu-title">
      <section className="campaign-menu">
        <p className="campaign-menu-eyebrow">{messages.campaignTag}</p>
        <h2 id="campaign-menu-title">{messages.chooseTitle}</h2>
        <div className="campaign-menu-options">
          <article className="campaign-option is-campaign">
            <span className="campaign-option-badge">{messages.campaignBadge}</span>
            <h3>{messages.campaign}</h3>
            <p>{messages.campaignLead}</p>
            {confirming ? (
              <div className="campaign-confirm" role="alertdialog">
                <p>{messages.newCampaignConfirm}</p>
                <div>
                  <button type="button" className="campaign-primary is-danger" onClick={onNew}>
                    {messages.newCampaignYes}
                  </button>
                  <button type="button" className="campaign-secondary" onClick={() => setConfirming(false)}>
                    {messages.close}
                  </button>
                </div>
              </div>
            ) : (
              <div className="campaign-option-actions">
                {saved && (
                  <button type="button" className="campaign-primary" onClick={onContinue} autoFocus>
                    {messages.continueCampaign}
                  </button>
                )}
                <button type="button" className={saved ? "campaign-secondary" : "campaign-primary"} onClick={() => (saved ? setConfirming(true) : onNew())} autoFocus={!saved}>
                  {messages.newCampaign}
                </button>
              </div>
            )}
          </article>
          <article className="campaign-option is-free">
            <span className="campaign-option-badge">{messages.freeBadge}</span>
            <h3>{messages.freeSail}</h3>
            <p>{messages.freeSailLead}</p>
            <div className="campaign-option-actions">
              <button type="button" className="campaign-secondary" onClick={onFree}>
                {messages.freeSail}
              </button>
            </div>
          </article>
        </div>
        {onClose && (
          <button type="button" className="campaign-menu-close icon-button" onClick={onClose} aria-label={messages.close} title={messages.close}>
            ×
          </button>
        )}
      </section>
    </div>
  );
}
