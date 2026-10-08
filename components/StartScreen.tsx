"use client";

import { createContext, useState } from "react";
import { unlockAudio } from "@/lib/radio-audio";

/** False until Mo opens Crewline. The desk rail stays hidden until then. */
export const AppOpenContext = createContext(true);

/** Title card on the phone. Tap opens Crewline and unlocks sound. */
export default function StartScreen({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <AppOpenContext.Provider value={open}>
      {open ? (
        children
      ) : (
        <button
          type="button"
          onClick={() => {
            unlockAudio();
            setOpen(true);
          }}
          className="flex h-full min-h-0 w-full cursor-pointer flex-col items-center justify-center bg-white px-7 pb-10 pt-16 md:pt-20"
          aria-label="Open Crewline"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/start-page.png"
            alt="Crewline. Every call heard. Every post covered."
            className="h-auto w-full object-contain"
          />
          <span className="mt-8 text-xs font-medium tracking-wide text-slate-500">Tap to open</span>
        </button>
      )}
    </AppOpenContext.Provider>
  );
}
