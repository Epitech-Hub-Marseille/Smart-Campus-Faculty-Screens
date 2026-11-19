import { TriangleAlert } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { emergencyPresentation, emergencyVariables, type ConfigView, type EmergencyView, type ThemeView } from "@smartcampus/faculty-local";
import { timeOf } from "../lib/format";

const STEP_HIGHLIGHT_MS = 4000;

/**
 * The emergency takeover, a terminal-style bulletin on the colour of the kind of alert: a header line, the alert in large
 * yellow, what is happening, the order to follow, the numbered steps, who to call, and hazard stripes. It covers everything
 * else and uses large monospace text that reads from across a hall.
 * A theme may dress it through the small set of `emergencyVariables` (fonts, frame, corners, dark backgrounds); the wording,
 * the white text and the alarm never change. Without a theme, or when the dressed alert cannot be drawn (see
 * FallbackBoundary), it is the default alert.
 */
export function EmergencyScreen({ emergency, config, now, theme = null }: { emergency: EmergencyView; config: ConfigView; now: number; theme?: ThemeView | null }) {
  const presentation = emergencyPresentation(emergency.kind, config.site.assemblyPoint);
  const closing = emergency.testMode
    ? "This is a test of the emergency system. No action is needed."
    : "Follow instructions from the staff and the emergency teams. Help others if it is safe to do so.";
  const steps = [...presentation.actions.map((a) => `${a.title}. ${a.detail}`), closing];
  // The highlight walks down the list and starts over, so each step is the one to do now in turn.
  const [active, setActive] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setActive((i) => (i + 1) % steps.length), STEP_HIGHLIGHT_MS);
    return () => clearInterval(timer);
  }, [steps.length]);
  const style = { "--accent": emergency.color, ...emergencyVariables(theme) } as CSSProperties;
  return (
    <div className={`emergency${theme?.emergency?.frame === "bar" ? " frame-bar" : ""}`} data-kind={emergency.kind} style={style} role="alert">
      <div className="alert-frame">
        <div className="alert-head">
          <span>&gt;&gt; SMART CAMPUS SECURITY SYSTEM [S.C.S.S]</span>
          <span>
            {emergency.testMode ? "TEST - NO REAL EMERGENCY" : config.site.zone ? `[${config.site.zone}]` : ""} <time>{timeOf(now)}</time>
          </span>
        </div>
        <div className="alert-title">
          <TriangleAlert aria-hidden />
          <h1>{emergency.title}</h1>
        </div>
        <p className="alert-detail">{emergency.instructions}</p>
        <p className="alert-call">&gt;&gt; {presentation.headline} &lt;&lt;</p>
        <ol className="steps">
          {steps.map((step, i) => (
            <li key={i} className={i === active ? "current" : undefined}>
              <span aria-hidden>&gt;&gt;</span> {i + 1}. {step}
            </li>
          ))}
        </ol>
        {config.site.emergencyNumber && (
          <p className="alert-foot">
            <span>&gt;&gt; EMERGENCY SERVICES</span>
            <strong>[{config.site.emergencyNumber}]</strong>
          </p>
        )}
        <div className="stripes" aria-hidden />
      </div>
    </div>
  );
}
