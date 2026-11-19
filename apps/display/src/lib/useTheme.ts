import { useEffect } from "react";
import { themeVariables, type ThemeView } from "@smartcampus/faculty-local";

const STYLE_ID = "theme-css";

/**
 * Applies a theme to the page: its tokens as CSS variables on the root and its CSS in one <style> element. With `suppressed`
 * (an emergency or the end-of-alert notice is showing) all of it is taken away again, so no theme can change how an alarm
 * looks. The agent already checked the CSS against the protocol rules; nothing here loads anything from elsewhere.
 */
export function useTheme(theme: ThemeView | null, suppressed: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    const applied: string[] = [];
    const active = theme && !suppressed ? theme : null;
    if (active) {
      for (const [name, value] of Object.entries(themeVariables(active))) {
        root.style.setProperty(name, value);
        applied.push(name);
      }
      if (active.css) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = active.css;
        document.head.appendChild(style);
      }
    }
    return () => {
      for (const name of applied) root.style.removeProperty(name);
      document.getElementById(STYLE_ID)?.remove();
    };
  }, [theme, suppressed]);
}
