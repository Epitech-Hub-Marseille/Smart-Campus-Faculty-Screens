import { useEffect } from "react";
import { emergencyFontFaces, themeFontFaces, themeVariables, type ThemeView } from "@smartcampus/faculty-local";

const STYLE_ID = "theme-css";

/**
 * Applies a theme to the page: its tokens as CSS variables on the root and its CSS in one <style> element. With `suppressed`
 * (an emergency or the end-of-alert notice is showing) all of it is taken away again, except the font files an alert may use,
 * so a theme can only change an alarm through the small set it is allowed (`emergencyVariables`). The agent already checked the CSS against the protocol rules; nothing here loads anything from elsewhere.
 */
export function useTheme(theme: ThemeView | null, suppressed: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    const applied: string[] = [];
    // During an alert the theme's colours, scale and CSS are off. Only what the theme says about alerts stays: its font files,
    // used by the alert's own variables (see EmergencyScreen).
    const active = theme && !suppressed ? theme : null;
    const css = active ? [themeFontFaces(active), active.css] : [suppressed ? emergencyFontFaces(theme) : ""];
    if (active) {
      for (const [name, value] of Object.entries(themeVariables(active))) {
        root.style.setProperty(name, value);
        applied.push(name);
      }
    }
    const text = css.filter(Boolean).join("\n");
    if (text) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = text;
      document.head.appendChild(style);
    }
    return () => {
      for (const name of applied) root.style.removeProperty(name);
      document.getElementById(STYLE_ID)?.remove();
    };
  }, [theme, suppressed]);
}
