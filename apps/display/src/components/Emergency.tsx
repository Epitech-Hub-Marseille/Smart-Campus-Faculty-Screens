import type { CSSProperties } from "react";
import { emergencyPresentation, emergencySteps, emergencyVariables, fitFontSize, type ConfigView, type EmergencyView, type ThemeView } from "@smartcampus/faculty-local";
import { AlertShell } from "./AlertShell";

/** Room for the hero line, between the two triangles, and for an instruction line, inside the frame, at the design size. */
const HERO_WIDTH = 1164 - 2 * 92 - 2 * 48;
const STEP_WIDTH = 1164 - 40 - 68;

/** The warning triangle: yellow, with a black outline and a black exclamation mark. */
function Triangle({ side }: { side: "left" | "right" }) {
  return (
    <svg className={`triangle ${side}`} width="92" height="92" viewBox="0 0 92 92" aria-hidden>
      <polygon points="46,8 86,80 6,80" fill="#ffff55" stroke="#000" strokeWidth="6" strokeLinejoin="round" />
      <rect x="42" y="30" width="8" height="28" fill="#000" />
      <circle cx="46" cy="68" r="5" fill="#000" />
    </svg>
  );
}

/**
 * The emergency alert: a window in the style of a terminal bulletin, over the screen it interrupts. A title bar, the alert in
 * large yellow between two blinking triangles, what is happening, the order to follow, five lines of what to do (the one to do
 * now is reversed, one after the other), who to call and a band of hazard stripes. It is red, or the dark colour of the kind of
 * alert. All the motion is CSS (see styles.css), so nothing has to run for it to move.
 * A theme may dress it through the small set of `emergencyVariables` (fonts, frame, corners, dark backgrounds); the wording,
 * the white text and the alarm never change. Without a theme, or when the dressed alert cannot be drawn (see
 * FallbackBoundary), it is the default alert.
 */
export function EmergencyScreen({ emergency, config, theme = null }: { emergency: EmergencyView; config: ConfigView; theme?: ThemeView | null }) {
  const steps = emergencySteps(emergency.kind, config.site.assemblyPoint, emergency.testMode);
  const title = emergency.title.toUpperCase();
  const style = { "--accent": emergency.color, ...emergencyVariables(theme) } as CSSProperties;
  return (
    <AlertShell
      className={`emergency${theme?.emergency?.frame === "bar" ? " frame-bar" : ""}`}
      role="alertdialog"
      label={`${emergency.testMode ? "Test: " : ""}${emergency.title}. ${emergency.instructions}`}
      kind={emergency.kind}
      style={style}
    >
      <div className="alert-frame">
        <div className="alert-head">
          <span>&gt;&gt; SMART CAMPUS SECURITY SYSTEM [S.C.S.S]</span>
          <span>{emergency.testMode ? "TEST - NO REAL EMERGENCY" : config.site.zone ? `[${config.site.zone}]` : ""}</span>
        </div>
        <div className="alert-title">
          <Triangle side="left" />
          <h1 style={{ fontSize: `${fitFontSize(title, HERO_WIDTH, 104)}px` }}>{title}</h1>
          <Triangle side="right" />
        </div>
        <p className="alert-detail">{emergency.instructions}</p>
        <p className="alert-call">
          <span className="blink">&gt;&gt;</span>
          <span>{emergencyPresentation(emergency.kind, config.site.assemblyPoint).headline}</span>
          <span className="blink">&lt;&lt;</span>
        </p>
        <hr className="alert-rule" />
        <ol className="steps">
          {steps.map((step, i) => (
            <li key={i}>
              <span className="chev" aria-hidden>
                &gt;&gt;
              </span>
              <span style={{ fontSize: `${fitFontSize(step, STEP_WIDTH, 32, 0.02)}px` }}>{step}</span>
            </li>
          ))}
        </ol>
        <p className="alert-foot">
          <span>&gt;&gt; EMERGENCY SERVICES</span>
          <strong>{config.site.emergencyNumber || "112"}</strong>
        </p>
        <div className="stripes" aria-hidden />
      </div>
    </AlertShell>
  );
}
