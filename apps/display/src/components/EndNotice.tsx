import { CheckCircle2 } from "lucide-react";
import type { CSSProperties } from "react";
import { emergencyVariables, type ConfigView, type EndNoticeView, type ThemeView } from "@smartcampus/faculty-local";

/** Shown for a while after an emergency ends with a message, so people are told it is safe rather than left to guess. Same bulletin as the alert, on green. */
export function EndNotice({ notice, config, theme = null }: { notice: EndNoticeView; config: ConfigView; theme?: ThemeView | null }) {
  return (
    <div className="end-notice" style={emergencyVariables(theme) as CSSProperties} role="status">
      <div className="alert-frame">
        <div className="alert-head">
          <span>&gt;&gt; SMART CAMPUS SECURITY SYSTEM [S.C.S.S]</span>
          <span>{config.site.zone ? `[${config.site.zone}]` : ""}</span>
        </div>
        <div className="alert-title">
          <CheckCircle2 aria-hidden />
          <h1>Alert over</h1>
        </div>
        <p className="alert-call">&gt;&gt; ALL CLEAR &lt;&lt;</p>
        <p className="alert-detail">{notice.message}</p>
      </div>
    </div>
  );
}
