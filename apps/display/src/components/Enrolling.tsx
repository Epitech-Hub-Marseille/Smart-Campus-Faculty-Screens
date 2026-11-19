import { ShieldCheck } from "lucide-react";
import type { ViewState } from "@smartcampus/faculty-local";

const TEXT: Record<string, string> = {
  requesting: "Sending the connection request…",
  waiting: "Waiting for an administrator to approve this screen.",
  denied: "The request was denied.",
  expired: "The request expired without an answer.",
  error: "The server cannot be reached.",
};

/** Shown until the screen is approved: the fingerprint of its key, to compare with the one the administrator sees. */
export function Enrolling({ enrollment }: { enrollment: NonNullable<ViewState["enrollment"]> }) {
  const groups = enrollment.fingerprint.toUpperCase().match(/.{1,4}/g) ?? [];
  return (
    <main className="enrolling">
      <ShieldCheck aria-hidden />
      <h1>Connect this screen</h1>
      <p>{enrollment.message ?? TEXT[enrollment.status] ?? ""}</p>
      <p className="hint">In the console, open Devices and approve the request after checking that the fingerprint below is the same.</p>
      <p className="fingerprint" aria-label="Key fingerprint">
        {groups.map((g, i) => (
          <span key={i}>{g}</span>
        ))}
      </p>
    </main>
  );
}
