import { Biohazard, Bomb, Radiation, Activity, Flame, Zap, Footprints, LogOut, Users, ShieldAlert, Lightbulb, ArrowUpRight, Home, TriangleAlert } from "lucide-react";
import type { CSSProperties, ReactElement } from "react";
import { emergencyPresentation, type ConfigView, type EmergencyAction, type EmergencyView } from "@smartcampus/faculty-local";
import { timeOf } from "../lib/format";

const KIND_ICON: Record<string, () => ReactElement> = {
  fire: () => <Flame aria-hidden />,
  biohazard: () => <Biohazard aria-hidden />,
  nuclear: () => <Radiation aria-hidden />,
  bomb: () => <Bomb aria-hidden />,
  seismic: () => <Activity aria-hidden />,
  power: () => <Zap aria-hidden />,
};

/** Lucide has no stairs: a plain staircase, drawn to match the other icons. */
const Stairs = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 21h5v-5h5v-5h5V6h3" />
  </svg>
);

const ACTION_ICON: Record<EmergencyAction["icon"], () => ReactElement> = {
  stairs: () => <Stairs />,
  exit: () => <LogOut aria-hidden />,
  assemble: () => <Users aria-hidden />,
  stay: () => <Home aria-hidden />,
  doors: () => <ShieldAlert aria-hidden />,
  cover: () => <ShieldAlert aria-hidden />,
  calm: () => <Footprints aria-hidden />,
  distance: () => <ArrowUpRight aria-hidden />,
  report: () => <TriangleAlert aria-hidden />,
  light: () => <Lightbulb aria-hidden />,
};

/**
 * The emergency takeover, after the reference: hazard stripes top and bottom, the alert and its kind, a headline that
 * reads from across a hall, what it means, three things to do, and who to call. It covers everything else.
 */
export function EmergencyScreen({ emergency, config, now }: { emergency: EmergencyView; config: ConfigView; now: number }) {
  const presentation = emergencyPresentation(emergency.kind, config.site.assemblyPoint);
  const style = { "--accent": emergency.color } as CSSProperties;
  const icon = KIND_ICON[emergency.kind] ?? KIND_ICON.fire!;
  return (
    <div className="emergency" style={style} role="alert">
      <div className="stripes stripes-top" aria-hidden />
      <div className="emergency-body">
        <div className="emergency-top">
          <span className="alert-pill">
            <i aria-hidden /> {emergency.testMode ? "TEST · EMERGENCY ALERT" : "EMERGENCY ALERT"}
          </span>
          <span className="alert-kind">{emergency.title}</span>
          <span className="alert-place">
            {config.site.zone && <span>{config.site.zone}</span>}
            {config.site.zone && <span className="bar" aria-hidden />}
            <time>{timeOf(now)}</time>
          </span>
        </div>

        <div className="emergency-main">
          <div className="emblem">{icon()}</div>
          <div>
            <h1>{presentation.headline}</h1>
            <p>{emergency.instructions}</p>
          </div>
        </div>

        <ul className="actions">
          {presentation.actions.map((action) => (
            <li key={action.title} className="action">
              <span className="action-icon">{ACTION_ICON[action.icon]()}</span>
              <div>
                <strong>{action.title}</strong>
                <span>{action.detail}</span>
              </div>
            </li>
          ))}
        </ul>

        <div className="emergency-foot">
          <p>{emergency.testMode ? "This is a test of the emergency system. No action is needed." : "Follow instructions from the staff and the emergency teams. Help others if it is safe to do so."}</p>
          {config.site.emergencyNumber && (
            <p className="services">
              EMERGENCY SERVICES: <strong>{config.site.emergencyNumber}</strong>
            </p>
          )}
        </div>
      </div>
      <div className="stripes stripes-bottom" aria-hidden />
    </div>
  );
}
