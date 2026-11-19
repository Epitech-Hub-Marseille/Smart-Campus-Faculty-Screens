import { CheckCircle2 } from "lucide-react";
import type { ConfigView, EndNoticeView } from "@smartcampus/faculty-local";

/** Shown for a while after an emergency ends with a message, so people are told it is safe rather than left to guess. */
export function EndNotice({ notice, config }: { notice: EndNoticeView; config: ConfigView }) {
  return (
    <div className="end-notice" role="status">
      {config.site.zone && <span className="end-zone">{config.site.zone}</span>}
      <CheckCircle2 aria-hidden />
      <h1>Alert over</h1>
      <p>{notice.message}</p>
    </div>
  );
}
