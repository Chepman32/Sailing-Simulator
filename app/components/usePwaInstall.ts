"use client";

import { useCallback, useEffect, useState } from "react";

/** Chrome's install prompt event (not in the DOM typings). */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Registers the service worker (production only: in development it would
 * cache Vite's modules) and offers the browser's install prompt when there
 * is one. `canInstall` is true only while the browser has a prompt ready and
 * the app is not already running installed.
 */
export function usePwaInstall(): { canInstall: boolean; install: () => void } {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      const register = () => {
        navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
      };
      if (document.readyState === "complete") register();
      else window.addEventListener("load", register, { once: true });
    }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(() => {
    if (!prompt) return;
    setPrompt(null);
    void prompt.prompt().catch(() => undefined);
  }, [prompt]);

  return { canInstall: prompt !== null, install };
}
