import { isKnownKind, type AnnouncementView, type EndNoticeView, type ReservationView, type SceneView, type StaffView, type ViewState } from "./view.js";

/**
 * The scenes to show right now: the ones whose window has begun and not ended, that have something this page can
 * draw (a scene made only of tiles of an unknown kind would be a blank screen), in playlist order.
 */
export function activeScenes(scenes: readonly SceneView[], now: number): SceneView[] {
  return scenes.filter(
    (s) => (s.startsAt === undefined || s.startsAt <= now) && (s.endsAt === undefined || s.endsAt > now) && s.tiles.some((t) => isKnownKind(t.kind)),
  );
}

export const visibleAnnouncements = (items: readonly AnnouncementView[], now: number): AnnouncementView[] =>
  items
    .filter((a) => a.expiresAt === undefined || a.expiresAt > now)
    .sort((a, b) => rank(b.priority) - rank(a.priority));

const rank = (p: AnnouncementView["priority"]) => (p === "urgent" ? 2 : p === "important" ? 1 : 0);

export const visibleEndNotice = (notice: EndNoticeView | null, now: number): EndNoticeView | null =>
  notice && notice.shownAt + notice.durationMs > now ? notice : null;

export type EventPhase = "now" | "next" | "later";

export interface BoardEvent extends ReservationView {
  phase: EventPhase;
}

/**
 * The events panel: what is on now, then what follows, today. A booking that ended is gone; the first one still
 * to come is "next" and the rest "later". Without a date filter a booking tomorrow would sit in the list all day.
 */
export function boardEvents(reservations: readonly ReservationView[], now: number, limit = 5): BoardEvent[] {
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const upcoming = reservations
    .filter((r) => r.end > now && r.start <= endOfDay.getTime())
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let nextTaken = false;
  return upcoming.slice(0, limit).map((r) => {
    if (r.start <= now) return { ...r, phase: "now" as const };
    if (!nextTaken) {
      nextTaken = true;
      return { ...r, phase: "next" as const };
    }
    return { ...r, phase: "later" as const };
  });
}

export type RoomStatus = "in-use" | "reserved";

export interface RoomRow extends ReservationView {
  status: RoomStatus;
}

/** The rooms panel: for each room, the booking that is on or the next one, soonest first. */
export function roomRows(reservations: readonly ReservationView[], now: number, limit = 5): RoomRow[] {
  const byRoom = new Map<string, ReservationView>();
  for (const r of [...reservations].filter((x) => x.end > now).sort((a, b) => a.start - b.start)) {
    if (!byRoom.has(r.room)) byRoom.set(r.room, r);
  }
  return [...byRoom.values()]
    .sort((a, b) => a.start - b.start)
    .slice(0, limit)
    .map((r) => ({ ...r, status: r.start <= now ? ("in-use" as const) : ("reserved" as const) }));
}

/** A status with an end time that has passed means the person is available again (the server applies the same rule). */
export function effectiveStaff(staff: readonly StaffView[], now: number): StaffView[] {
  return staff.map((s) => (s.availability !== "available" && s.until !== undefined && s.until <= now ? { ...s, availability: "available", note: undefined, until: undefined } : s));
}

/** One step of the rotation. */
export interface Page {
  scene: SceneView;
  seconds: number;
}

const boardScene = (kind: "news" | "staff" | "reservations", name: string): SceneView => ({
  id: `fallback-${kind}`,
  name,
  layout: "full",
  durationSeconds: 15,
  tiles: [{ id: `fallback-${kind}-tile`, kind, settings: {} }],
});

/** What a wall screen shows when it has nothing else: the information board. It is never left blank. */
export const FALLBACK_SCENES: readonly SceneView[] = [boardScene("reservations", "Events"), boardScene("news", "News"), boardScene("staff", "Staff")];

/** Does this scene show part of the information board (and so wear the header with the clock and the logo)? */
export const showsBoard = (scene: SceneView) => scene.tiles.some((t) => t.kind === "news" || t.kind === "staff" || t.kind === "reservations");

/** The carousel: each active scene for its time. With none to show, the information board. */
export function rotation(scenes: readonly SceneView[], now: number): Page[] {
  const active = activeScenes(scenes, now);
  return (active.length > 0 ? active : FALLBACK_SCENES).map((scene) => ({ scene, seconds: scene.durationSeconds }));
}

/** The clock of the room: the device's, corrected by what the server said the time is. */
export const serverNow = (state: Pick<ViewState, "clockOffsetMs">, deviceNow = Date.now()) => deviceNow + state.clockOffsetMs;

export type EmergencyAction = { icon: "stairs" | "exit" | "assemble" | "stay" | "doors" | "cover" | "calm" | "distance" | "report" | "light"; title: string; detail: string };

export interface EmergencyPresentation {
  /** The big words, readable at a glance and from far away. */
  headline: string;
  actions: [EmergencyAction, EmergencyAction, EmergencyAction];
}

/**
 * The headline and the three actions of each kind of emergency. This is what people read while moving, so it is
 * short and fixed on the screen rather than taken from free text. `assemblyPoint` is the site's, when it has one.
 */
export function emergencyPresentation(kind: string, assemblyPoint: string): EmergencyPresentation {
  const assemble = { icon: "assemble" as const, title: "Assemble outside", detail: assemblyPoint ? `Meet at ${assemblyPoint}.` : "Go to the assembly point." };
  switch (kind) {
    case "biohazard":
      return {
        headline: "STAY INSIDE",
        actions: [
          { icon: "doors", title: "Close doors and windows", detail: "Seal the room if you can." },
          { icon: "stay", title: "Stay where you are", detail: "Do not leave until told to." },
          { icon: "report", title: "Touch nothing suspicious", detail: "Wait for staff instructions." },
        ],
      };
    case "nuclear":
      return {
        headline: "SHELTER NOW",
        actions: [
          { icon: "stay", title: "Go inside, stay inside", detail: "Move away from outer walls." },
          { icon: "doors", title: "Close doors and windows", detail: "Switch off ventilation." },
          { icon: "report", title: "Wait for instructions", detail: "Follow official guidance only." },
        ],
      };
    case "bomb":
      return {
        headline: "LEAVE CALMLY",
        actions: [
          { icon: "exit", title: "Use the nearest exit", detail: "Do not run. Help others." },
          { icon: "distance", title: "Move well away", detail: "Keep clear of the building." },
          { icon: "report", title: "Touch nothing unknown", detail: "No phones near the building." },
        ],
      };
    case "seismic":
      return {
        headline: "DROP, COVER, HOLD",
        actions: [
          { icon: "cover", title: "Take cover", detail: "Under a sturdy table, away from windows." },
          { icon: "stay", title: "Do not run outside", detail: "Wait until the shaking stops." },
          { ...assemble, title: "Then evacuate", detail: assemblyPoint ? `Meet at ${assemblyPoint}.` : "Go to the assembly point." },
        ],
      };
    case "power":
      return {
        headline: "STAY CALM",
        actions: [
          { icon: "light", title: "Emergency lights on", detail: "Stay where you are." },
          { icon: "stairs", title: "Do not use lifts", detail: "Use the stairs if you must move." },
          { icon: "report", title: "Follow staff", detail: "Wait for instructions." },
        ],
      };
    default:
      return {
        headline: "EVACUATE NOW",
        actions: [
          { icon: "stairs", title: "Use the stairs", detail: "Do not use elevators." },
          { icon: "exit", title: "Leave belongings", detail: "Go to the nearest exit now." },
          assemble,
        ],
      };
  }
}
