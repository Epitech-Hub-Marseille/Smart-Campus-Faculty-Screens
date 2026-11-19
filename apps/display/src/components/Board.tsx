import { CalendarDays, DoorOpen, Megaphone, Newspaper } from "lucide-react";
import {
  boardEvents,
  roomRows,
  visibleAnnouncements,
  type AnnouncementView,
  type NewsView,
  type ReservationView,
  type ViewState,
} from "@smartcampus/faculty-local";
import { range } from "../lib/format";

const PHASE_LABEL = { now: "NOW", next: "NEXT", later: "LATER" } as const;
const STATUS_LABEL = { "in-use": "In use", reserved: "Reserved" } as const;
const PRIORITY_LABEL = { info: "INFO", important: "IMPORTANT", urgent: "URGENT" } as const;

function EventsPanel({ reservations, now }: { reservations: readonly ReservationView[]; now: number }) {
  const events = boardEvents(reservations, now);
  return (
    <section className="card events" aria-labelledby="events-title">
      <div className="card-head">
        <h2 id="events-title">
          <CalendarDays aria-hidden /> Current events
        </h2>
        <span className="today">
          <i aria-hidden /> Today
        </span>
      </div>
      {events.length === 0 && <p className="empty">Nothing is scheduled for the rest of the day.</p>}
      <ul className="event-list">
        {events.map((e) => (
          <li key={e.id} className="event">
            <div className="event-time">
              <strong>{range(e.start, e.end)}</strong>
              <span className={`pill pill-${e.phase}`}>{PHASE_LABEL[e.phase]}</span>
            </div>
            <div className="event-what">
              <strong>{e.title}</strong>
              <span>{[e.room, e.organizer].filter(Boolean).join(" · ")}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoomsPanel({ reservations, now }: { reservations: readonly ReservationView[]; now: number }) {
  const rows = roomRows(reservations, now);
  return (
    <section className="card rooms" aria-labelledby="rooms-title">
      <div className="card-head">
        <h2 id="rooms-title">
          <DoorOpen aria-hidden /> Reserved rooms
        </h2>
      </div>
      {rows.length === 0 ? (
        <p className="empty">No room is booked.</p>
      ) : (
        <table>
          <colgroup>
            <col className="c-room" />
            <col className="c-time" />
            <col className="c-for" />
            <col className="c-status" />
          </colgroup>
          <thead>
            <tr>
              <th>Room</th>
              <th>Time</th>
              <th>Reserved for</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="room-name">{r.room}</td>
                <td>{range(r.start, r.end)}</td>
                <td className="room-for">{r.title}</td>
                <td>
                  <span className={`pill pill-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AnnouncementsPanel({ announcements, now }: { announcements: readonly AnnouncementView[]; now: number }) {
  const shown = visibleAnnouncements(announcements, now).slice(0, 3);
  return (
    <section className="card announcements" aria-labelledby="announcements-title">
      <div className="card-head">
        <h2 id="announcements-title">
          <Megaphone aria-hidden /> Announcements
        </h2>
      </div>
      {shown.length === 0 && <p className="empty">No announcement.</p>}
      <ul>
        {shown.map((a) => (
          <li key={a.id} className={`announcement priority-${a.priority}`}>
            {a.title && <strong>{a.title}</strong>}
            <p>{a.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A news item: the priority tag, the title and the text. */
function NewsCard({ item }: { item: NewsView }) {
  return (
    <li className={`news-card priority-${item.priority}`}>
      <b className={`ticker-tag tag-${item.priority}`}>{PRIORITY_LABEL[item.priority]}</b>
      <div>
        <strong>{item.title}</strong>
        {item.text && <p>{item.text}</p>}
      </div>
    </li>
  );
}

/** The news tile: the news feed, and above it the announcements that are showing. */
export function NewsTile({ state, now }: { state: ViewState; now: number }) {
  const news = (state.faculty?.news ?? []).filter((n) => n.expiresAt === undefined || n.expiresAt > now);
  return (
    <div className="tile-board news-tile">
      <AnnouncementsPanel announcements={state.announcements} now={now} />
      <section className="card news" aria-labelledby="news-title">
        <div className="card-head">
          <h2 id="news-title">
            <Newspaper aria-hidden /> News
          </h2>
        </div>
        {news.length === 0 ? (
          <p className="empty">No news at the moment.</p>
        ) : (
          <ul className="news-list">
            {news.map((n) => (
              <NewsCard key={n.id} item={n} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The reservations tile: what is on today and which rooms are booked, side by side. */
export function ReservationsTile({ state, now }: { state: ViewState; now: number }) {
  const reservations = state.faculty?.reservations ?? [];
  return (
    <div className="tile-board reservations-tile">
      <EventsPanel reservations={reservations} now={now} />
      <RoomsPanel reservations={reservations} now={now} />
    </div>
  );
}
