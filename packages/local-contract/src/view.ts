/**
 * What the agent hands the kiosk page over ws://localhost. The page never sees the identity key, the session or
 * the protocol: it receives this, already checked, and draws it. Times are milliseconds since epoch (server time
 * once `clockOffsetMs` is applied).
 */

export type Availability = "available" | "busy" | "away" | "absent";
export type Priority = "info" | "important" | "urgent";

export interface NewsView {
  id: string;
  title: string;
  text: string;
  priority: Priority;
  publishedAt: number;
  expiresAt?: number;
}

export interface StaffView {
  id: string;
  name: string;
  service: "pedagogical" | "administrative";
  jobTitle?: string;
  availability: Availability;
  note?: string;
  until?: number;
}

export interface ReservationView {
  id: string;
  room: string;
  title: string;
  start: number;
  end: number;
  organizer?: string;
}

export interface AnnouncementView {
  id: string;
  title?: string;
  text: string;
  priority: Priority;
  expiresAt?: number;
}

/**
 * What a tile can show. The server decides the list (`TILE_KINDS` in its protocol package) and may add to it before
 * every screen is updated, so the page treats a kind it does not know as "nothing to draw here" rather than an error.
 */
export const KNOWN_TILE_KINDS = ["news", "staff", "reservations", "image", "video", "text", "web", "radio", "stream", "youtube"] as const;
export type KnownTileKind = (typeof KNOWN_TILE_KINDS)[number];
export const isKnownKind = (kind: string): kind is KnownTileKind => (KNOWN_TILE_KINDS as readonly string[]).includes(kind);

/** One tile of a scene. `src` is the local URL of its file once downloaded and verified (image and video tiles). */
export interface TileView {
  id: string;
  kind: string;
  settings: Record<string, unknown>;
  src?: string;
}

/** Tile slots as CSS grid lines: [row start, column start, row end, column end]. A copy of the server's layouts, checked against them by a test in the agent. */
export interface SceneLayoutDef {
  columns: string;
  rows: string;
  tiles: readonly (readonly [number, number, number, number])[];
}

export const SCENE_LAYOUTS: Record<string, SceneLayoutDef> = {
  full: { columns: "1fr", rows: "1fr", tiles: [[1, 1, 2, 2]] },
  columns: { columns: "1fr 1fr", rows: "1fr", tiles: [[1, 1, 2, 2], [1, 2, 2, 3]] },
  rows: { columns: "1fr", rows: "1fr 1fr", tiles: [[1, 1, 2, 2], [2, 1, 3, 2]] },
  focus: { columns: "2fr 1fr", rows: "1fr", tiles: [[1, 1, 2, 2], [1, 2, 2, 3]] },
  "focus-split": { columns: "2fr 1fr", rows: "1fr 1fr", tiles: [[1, 1, 3, 2], [1, 2, 2, 3], [2, 2, 3, 3]] },
  quad: { columns: "1fr 1fr", rows: "1fr 1fr", tiles: [[1, 1, 2, 2], [1, 2, 2, 3], [2, 1, 3, 2], [2, 2, 3, 3]] },
};

/** A page of the carousel: a layout and its tiles, shown for `durationSeconds` between its (optional) dates. */
export interface SceneView {
  id: string;
  name: string;
  layout: string;
  durationSeconds: number;
  startsAt?: number;
  endsAt?: number;
  tiles: TileView[];
}

export interface ConfigView {
  site: { name: string; subtitle: string; zone: string; assemblyPoint: string; emergencyNumber: string };
  /** `enabled: false` holds the first scene instead of rotating. */
  carousel: { enabled: boolean };
  widgets: { clock: boolean; date: boolean; weather: boolean };
  service: "all" | "pedagogical" | "administrative";
}

export const DEFAULT_CONFIG: ConfigView = {
  site: { name: "", subtitle: "", zone: "", assemblyPoint: "", emergencyNumber: "" },
  carousel: { enabled: true },
  widgets: { clock: true, date: true, weather: false },
  service: "all",
};

/**
 * A visual theme, as the agent checked it: tokens (colours, font, text scale, corner radius) and optional CSS. Both were
 * validated by the protocol package, so the page only applies them. They never reach an emergency screen.
 */
export interface ThemeView {
  id: string;
  name: string;
  version: number;
  tokens: {
    mode?: "light" | "dark";
    colors: Partial<Record<"background" | "surface" | "text" | "muted" | "primary" | "primaryText" | "border" | "success" | "warning" | "danger", string>>;
    typography: { fontFamily?: "system" | "sans" | "serif" | "mono" | "condensed"; scale?: number };
    shape: { radius?: number };
  };
  /** How an alert is dressed, as the agent checked it (see the protocol's `emergencyTheme`). Absent: the default alert. */
  emergency?: {
    fonts: boolean;
    frame: "stripes" | "bar";
    radius?: number;
    colors: { background?: string; card?: string };
  };
  /** Local URLs of the verified font files, by slot. A slot without a file is absent. */
  fonts?: Partial<Record<"body" | "heading" | "mono", string>>;
  css?: string;
}

export type EmergencyKind = "fire" | "biohazard" | "nuclear" | "bomb" | "seismic" | "power";

export interface EmergencyView {
  emergencyId: string;
  kind: EmergencyKind;
  title: string;
  instructions: string;
  testMode: boolean;
  testVolume: number;
  startedAt: number;
  /** Accent of the kind and whether its alarm is a siren or a soft chime, both from the protocol's catalogue. */
  color: string;
  loud: boolean;
}

export interface EndNoticeView {
  message: string;
  shownAt: number;
  durationMs: number;
}

export interface WeatherView {
  temperature: number;
  /** WMO weather code of Open-Meteo. */
  code: number;
  label: string;
  updatedAt: number;
}

export type EnrollmentStatus = "requesting" | "waiting" | "denied" | "expired" | "error";

export interface ViewState {
  phase: "starting" | "enrolling" | "running";
  enrollment: { status: EnrollmentStatus; fingerprint: string; message?: string } | null;
  online: boolean;
  offlineSince: number | null;
  clockOffsetMs: number;
  config: ConfigView;
  /** Null until the server has sent the first snapshot, so the page can tell "nothing yet" from "nothing to show". */
  faculty: { news: NewsView[]; staff: StaffView[]; reservations: ReservationView[]; updatedAt: number } | null;
  /** What the screen rotates through, files already verified. */
  scenes: SceneView[];
  announcements: AnnouncementView[];
  emergency: EmergencyView | null;
  endNotice: EndNoticeView | null;
  weather: WeatherView | null;
  /** Null: the page's own look. */
  theme: ThemeView | null;
  logoUrl: string | null;
  audio: { volume: number; quietHours: { enabled: boolean; from: string; to: string } };
}

/** Messages of the local socket, agent to page. The page sends nothing. */
export type LiveMessage =
  | { type: "state"; state: ViewState }
  /** A sound to play now (an InterCom broadcast or an emergency read-out), already downloaded and verified. */
  /** `urgent`: an emergency read-out, heard through the silence of an alarm while the alarm itself steps back. */
  | { type: "audio"; id: string; src: string; volume: number; urgent?: boolean };

export const emptyViewState = (): ViewState => ({
  phase: "starting",
  enrollment: null,
  online: false,
  offlineSince: null,
  clockOffsetMs: 0,
  config: DEFAULT_CONFIG,
  faculty: null,
  scenes: [],
  announcements: [],
  emergency: null,
  endNotice: null,
  weather: null,
  theme: null,
  logoUrl: null,
  audio: { volume: 80, quietHours: { enabled: false, from: "22:00", to: "06:00" } },
});
