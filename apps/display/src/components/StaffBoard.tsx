import { Users } from "lucide-react";
import { effectiveStaff, type ViewState } from "@smartcampus/faculty-local";
import { timeOf } from "../lib/format";

const LABEL = { available: "Available", busy: "Busy", away: "Away", absent: "Absent" } as const;

/** Who can be reached, with the note they left. A status whose end time passed shows as available again. */
export function StaffBoard({ state, now }: { state: ViewState; now: number }) {
  const staff = effectiveStaff(state.faculty?.staff ?? [], now);
  return (
    <div className="tile-board staff-tile">
      <section className="card" aria-labelledby="staff-title">
        <div className="card-head">
          <h2 id="staff-title">
            <Users aria-hidden /> Staff availability
          </h2>
        </div>
        {staff.length === 0 && <p className="empty">No staff member is listed.</p>}
        <ul className="staff-grid">
          {staff.map((s) => (
            <li key={s.id} className="staff-card">
              <div>
                <strong>{s.name}</strong>
                {s.jobTitle && <span>{s.jobTitle}</span>}
              </div>
              <div className="staff-status">
                <span className={`status status-${s.availability}`}>
                  <i aria-hidden /> {LABEL[s.availability]}
                </span>
                {(s.note || s.until) && (
                  <span className="note">
                    {s.note}
                    {s.until ? ` until ${timeOf(s.until)}` : ""}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
