import { createContext, useContext } from "react";

/**
 * True while an alarm sounds. The screen behind the alert stays visible but makes no sound at all: a video or a radio next to
 * a siren would hide it, and a web page or a YouTube frame (whose sound the page cannot reach into) is not drawn.
 */
const SilenceContext = createContext(false);
export const SilenceProvider = SilenceContext.Provider;
export const useSilenced = () => useContext(SilenceContext);
