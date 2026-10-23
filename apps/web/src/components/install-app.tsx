"use client";

import { useEffect, useState } from "react";

// Chromium fires this when the app can be installed; it is not in the DOM typings.
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** An "Install app" button, shown only where the browser offers installation and the app is not installed yet. */
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
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

  if (!prompt) return null;

  return (
    <section aria-labelledby="install-heading" className="mb-8">
      <h2 id="install-heading" className="mb-1 text-[16px] leading-6 font-semibold">
        Install the app
      </h2>
      <p className="mb-3 text-text-muted">Opens in its own window and keeps working without a connection.</p>
      <button
        type="button"
        className="rounded-md bg-accent px-3 py-2 font-medium text-on-accent hover:bg-accent-strong"
        onClick={async () => {
          await prompt.prompt();
          await prompt.userChoice;
          setPrompt(null);
        }}
      >
        Install app
      </button>
    </section>
  );
}
