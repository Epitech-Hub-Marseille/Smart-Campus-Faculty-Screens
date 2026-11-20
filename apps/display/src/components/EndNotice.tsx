import type { CSSProperties } from "react";
import { emergencyVariables, type ConfigView, type EndNoticeView, type ThemeView } from "@smartcampus/faculty-local";
import { AlertShell } from "./AlertShell";

/** Shown for a while after an emergency ends with a message, so people are told it is safe rather than left to guess. Same window as the alert, on green and still. */
export function EndNotice({ notice, config, theme = null }: { notice: EndNoticeView; config: ConfigView; theme?: ThemeView | null }) {
  return (
    <AlertShell className="end-notice" role="status" label={`Alert over. ${notice.message}`} style={emergencyVariables(theme) as CSSProperties} solo>
      <div className="alert-frame">
        <div className="alert-head">
          <span>&gt;&gt; SMART CAMPUS SECURITY SYSTEM [S.C.S.S]</span>
          <span>{config.site.zone ? `[${config.site.zone}]` : ""}</span>
        </div>
        <div className="alert-title">
          <h1>ALERT OVER</h1>
        </div>
        <p className="alert-call">
          <span>&gt;&gt;</span>
          <span>ALL CLEAR</span>
          <span>&lt;&lt;</span>
        </p>
        <p className="alert-detail">{notice.message}</p>
      </div>
    </AlertShell>
  );
}
