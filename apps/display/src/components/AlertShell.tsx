import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

/** The alert is designed at this size and scaled down, never reflowed, on a smaller screen. */
const WIDTH = 1280;
const HEIGHT = 820;
/** On a bigger screen it keeps its design size: the screen behind it stays recognisable around it. */
const MAX_SCALE = 1;

/** The window is drawn 18% smaller than the size it fits to, so more of the screen behind shows around it. */
const SIZE = 0.82;

const fit = () => SIZE * Math.min(MAX_SCALE, window.innerWidth / WIDTH, window.innerHeight / HEIGHT);

/**
 * The layer an alert lives in: dims and very lightly blurs whatever is behind it (never more than 3px, so the screen is still
 * recognisable), and centres the alert window, which is drawn at its design size and scaled to fit. The blur is on this layer's
 * backdrop, so the window itself is never blurred.
 */
export function AlertShell({ children, role, label, kind, className, style, solo = false }: { children: ReactNode; role: "alertdialog" | "status"; label: string; kind?: string; className: string; style?: CSSProperties; solo?: boolean }) {
  const [scale, setScale] = useState(fit);
  useEffect(() => {
    const onResize = () => setScale(fit());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <div className={`alert-overlay${solo ? " solo" : ""}`}>
      <div className={className} data-kind={kind} role={role} aria-label={label} style={{ ...style, "--fit": scale } as CSSProperties}>
        {children}
      </div>
    </div>
  );
}
