// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { emptyViewState, type SceneView, type TileView, type ViewState } from "@smartcampus/faculty-local";
import { NewsTile, ReservationsTile } from "./Board";
import { EmergencyScreen } from "./Emergency";
import { EndNotice } from "./EndNotice";
import { Enrolling } from "./Enrolling";
import { Header } from "./Header";
import { Scene } from "./Scene";
import { detectFormat } from "./tiles/LiveTiles";
import { StaffBoard } from "./StaffBoard";

afterEach(cleanup);

// jsdom has no media playback; the tiles only need these calls to exist.
beforeAll(() => {
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.load = vi.fn();
});

const H = 3_600_000;
const noon = new Date(2026, 10, 6, 12, 0, 0).getTime();
const site = { name: "Faculty of Engineering", subtitle: "Information desk: A101", zone: "Building 2", assemblyPoint: "Car park A", emergencyNumber: "112" };
const state = (patch: Partial<ViewState> = {}): ViewState => ({ ...emptyViewState(), phase: "running", online: true, config: { ...emptyViewState().config, site }, ...patch });
const faculty = (extra: Partial<NonNullable<ViewState["faculty"]>> = {}) => ({ news: [], staff: [], reservations: [], updatedAt: noon, ...extra });
const booking = (id: string, room: string, title: string, startH: number, endH: number) => ({ id, room, title, start: noon + startH * H, end: noon + endH * H, organizer: "Ada" });

describe("Header", () => {
  it("shows the site, the date and the clock, and the logo only when there is one", () => {
    const { container, rerender } = render(<Header config={state().config} logoUrl={null} weather={null} now={noon} />);
    expect(screen.getByRole("heading", { name: "Faculty of Engineering" })).toBeTruthy();
    expect(screen.getByText("Information desk: A101")).toBeTruthy();
    expect(screen.getByText("12:00")).toBeTruthy();
    expect(screen.getByText("6 November 2026")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    rerender(<Header config={state().config} logoUrl="/media/LOGO.png" weather={null} now={noon} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/media/LOGO.png");
  });

  it("follows the widgets: no clock, no date, and the weather only when asked for and known", () => {
    const config = { ...state().config, widgets: { clock: false, date: false, weather: true } };
    const weather = { temperature: 18, code: 1, label: "Marseille", updatedAt: noon };
    render(<Header config={config} logoUrl={null} weather={weather} now={noon} />);
    expect(screen.queryByText("12:00")).toBeNull();
    expect(screen.queryByText("6 November 2026")).toBeNull();
    expect(screen.getByLabelText("Weather: Marseille, 18 degrees")).toBeTruthy();
  });

  it("has sensible words when the site has no name yet", () => {
    render(<Header config={emptyViewState().config} logoUrl={null} weather={null} now={noon} />);
    expect(screen.getByRole("heading", { name: "Faculty information" })).toBeTruthy();
  });
});

describe("Board tiles", () => {
  const s = state({
    faculty: faculty({
      reservations: [booking("1", "A101", "Guest lecture", -0.5, 1.5), booking("2", "S3", "Student council", 2, 4), booking("3", "C012", "Career talk", 5, 6), booking("4", "B1", "Yesterday", -30, -29)],
      news: [
        { id: "n1", title: "Open day", text: "Saturday", priority: "important", publishedAt: noon },
        { id: "n2", title: "Old news", text: "", priority: "info", publishedAt: noon, expiresAt: noon - 1 },
      ],
    }),
    announcements: [
      { id: "a1", title: "Exam registration", text: "Closes soon", priority: "important" },
      { id: "a2", text: "Gone", priority: "info", expiresAt: noon - 1 },
    ],
  });

  it("the reservations tile shows what is on today and the booked rooms, without what is over", () => {
    render(<ReservationsTile state={s} now={noon} />);
    expect(screen.getByRole("region", { name: /Current events/ })).toBeTruthy();
    expect(screen.getByRole("region", { name: /Reserved rooms/ })).toBeTruthy();
    expect(screen.getAllByText("Guest lecture").length).toBeGreaterThan(0);
    expect(screen.queryByText("Yesterday")).toBeNull();
  });

  it("the news tile shows live announcements and the news without expired items", () => {
    render(<NewsTile state={s} now={noon} />);
    expect(screen.getByText("Exam registration")).toBeTruthy();
    expect(screen.queryByText("Gone")).toBeNull();
    expect(screen.getByText("Open day")).toBeTruthy();
    expect(screen.queryByText("Old news")).toBeNull();
  });

  it("says so when there is nothing to show instead of leaving empty panels", () => {
    const empty = state({ faculty: faculty() });
    render(
      <>
        <ReservationsTile state={empty} now={noon} />
        <NewsTile state={empty} now={noon} />
      </>,
    );
    expect(screen.getByText("Nothing is scheduled for the rest of the day.")).toBeTruthy();
    expect(screen.getByText("No room is booked.")).toBeTruthy();
    expect(screen.getByText("No announcement.")).toBeTruthy();
    expect(screen.getByText("No news at the moment.")).toBeTruthy();
  });
});

describe("StaffBoard", () => {
  it("shows each person with their status and note, and takes a lapsed status for available", () => {
    const staff = [
      { id: "1", name: "Ada Martin", service: "pedagogical" as const, availability: "busy" as const, note: "In a meeting", until: noon + H },
      { id: "2", name: "Bruno Petit", service: "administrative" as const, availability: "away" as const, note: "Lunch", until: noon - 1 },
    ];
    render(<StaffBoard state={state({ faculty: faculty({ staff }) })} now={noon} />);
    expect(screen.getByText("Busy")).toBeTruthy();
    expect(screen.getByText(/In a meeting until/)).toBeTruthy();
    expect(screen.getByText("Available")).toBeTruthy();
    expect(screen.queryByText("Lunch")).toBeNull();
  });
});

describe("EmergencyScreen", () => {
  const emergency = { emergencyId: "E1", kind: "fire" as const, title: "Fire detected", instructions: "Leave by the nearest exit.", testMode: false, testVolume: 20, startedAt: noon, color: "#ff6a1f", loud: true };

  it("shows the alert, what it means, the order to follow, five lines to act on, the place and who to call", () => {
    render(<EmergencyScreen emergency={emergency} config={state().config} />);
    const alert = screen.getByRole("alertdialog");
    expect(alert.getAttribute("aria-label")).toContain("Fire detected");
    expect(screen.getByRole("heading", { name: "FIRE DETECTED" })).toBeTruthy();
    expect(screen.getByText("Leave by the nearest exit.")).toBeTruthy();
    expect(screen.getByText("EVACUATE NOW")).toBeTruthy();
    const steps = [...alert.querySelectorAll(".steps li")].map((li) => li.textContent);
    expect(steps).toEqual([
      ">>Use the stairs. Do not use elevators.",
      ">>Leave belongings. Go to the nearest exit now.",
      ">>Assemble outside. Meet at Car park A.",
      ">>Do not re-enter until staff allow it.",
      ">>Follow staff. Help others if it is safe.",
    ]);
    expect(screen.getByText(/\[Building 2\]/)).toBeTruthy();
    expect(screen.getByText("112")).toBeTruthy();
    expect(alert.getAttribute("data-kind")).toBe("fire");
  });

  it("has every part of the bulletin: two triangles blinking in turns, the blinking chevrons, the stripes", () => {
    render(<EmergencyScreen emergency={emergency} config={state().config} />);
    const alert = screen.getByRole("alertdialog");
    expect(alert.querySelectorAll("svg.triangle")).toHaveLength(2);
    expect(alert.querySelectorAll(".alert-call .blink")).toHaveLength(2);
    expect(alert.querySelector(".alert-rule")).toBeTruthy();
    expect(alert.querySelector(".alert-foot")).toBeTruthy();
    expect(alert.querySelector(".stripes")).toBeTruthy();
  });

  it("says it is a test, and not that people must act", () => {
    render(<EmergencyScreen emergency={{ ...emergency, testMode: true }} config={state().config} />);
    expect(screen.getByText(/TEST - NO REAL EMERGENCY/)).toBeTruthy();
    expect(screen.getByText(/This is a test\. No action is needed\./)).toBeTruthy();
  });

  it("adapts to each kind of emergency and to a site with no details, always showing who to call", () => {
    render(<EmergencyScreen emergency={{ ...emergency, kind: "seismic" }} config={emptyViewState().config} />);
    expect(screen.getByText("DROP, COVER, HOLD")).toBeTruthy();
    expect(screen.getByText(/EMERGENCY SERVICES/)).toBeTruthy();
    expect(screen.getByRole("alertdialog").getAttribute("data-kind")).toBe("seismic");
  });

  it("is dressed by the theme's alert part, and plain without one", () => {
    const theme = { id: "t", name: "T", version: 1, tokens: { colors: {}, typography: {}, shape: {} }, emergency: { fonts: false, frame: "bar" as const, radius: 8, colors: { background: "#001070" } } };
    const dressed = render(<EmergencyScreen emergency={emergency} config={state().config} theme={theme} />);
    const alert = dressed.getByRole("alertdialog");
    expect(alert.className).toContain("frame-bar");
    expect(alert.style.getPropertyValue("--em-solid")).toBe("#001070");
    expect(alert.style.getPropertyValue("--em-radius")).toBe("0.5rem");
    cleanup();
    expect(render(<EmergencyScreen emergency={emergency} config={state().config} />).getByRole("alertdialog").getAttribute("style")).not.toContain("--em-");
  });
});

describe("EndNotice", () => {
  it("tells people the alert is over, with the message", () => {
    render(<EndNotice notice={{ message: "You may return to the building.", shownAt: noon, durationMs: 60_000 }} config={state().config} />);
    expect(screen.getByRole("heading", { name: "ALERT OVER" })).toBeTruthy();
    expect(screen.getByText("ALL CLEAR")).toBeTruthy();
    expect(screen.getByText("You may return to the building.")).toBeTruthy();
  });
});

describe("Enrolling", () => {
  it("shows the fingerprint in groups, to compare with the console, and the state of the request", () => {
    render(<Enrolling enrollment={{ status: "waiting", fingerprint: "6f13d3d35381e1fd" }} />);
    expect(screen.getByText("6F13")).toBeTruthy();
    expect(screen.getByText("5381")).toBeTruthy();
    expect(screen.getByText(/Waiting for an administrator/)).toBeTruthy();
  });

  it("shows the server's message when there is one", () => {
    render(<Enrolling enrollment={{ status: "error", fingerprint: "00", message: "Cannot reach the server: ECONNREFUSED" }} />);
    expect(screen.getByText("Cannot reach the server: ECONNREFUSED")).toBeTruthy();
  });
});

describe("Scene", () => {
  const tile = (kind: string, settings: Record<string, unknown> = {}, extra: Partial<TileView> = {}): TileView => ({ id: `${kind}-t`, kind, settings, ...extra });
  const scene = (layout: string, tiles: TileView[]): SceneView => ({ id: "s", name: "s", layout, durationSeconds: 15, tiles });
  const draw = (sc: SceneView) => render(<Scene scene={sc} state={state()} now={noon} />);

  it("lays the tiles out in the grid of the layout, one section per tile", () => {
    const { container } = draw(scene("focus-split", [tile("text", { text: "a" }), tile("text", { text: "b" }, { id: "b" }), tile("text", { text: "c" }, { id: "c" })]));
    const main = container.querySelector("main")!;
    expect(main.style.gridTemplateColumns).toBe("2fr 1fr");
    const sections = [...container.querySelectorAll("section.tile")] as HTMLElement[];
    expect(sections).toHaveLength(3);
    expect(sections[0]!.style.gridRow).toBe("1 / 3");
    expect(sections[1]!.style.gridColumn).toBe("2 / 3");
  });

  it("shows an image with the chosen fit", () => {
    const { container } = draw(scene("full", [tile("image", { fit: "cover" }, { src: "/media/A.png" })]));
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/media/A.png");
    expect(img.className).toContain("cover");
  });

  it("plays a video muted and looping unless told otherwise", () => {
    const { container, unmount } = draw(scene("full", [tile("video", {}, { src: "/media/V.mp4" })]));
    const video = container.querySelector("video")!;
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.autoplay).toBe(true);
    unmount();
    const loud = draw(scene("full", [tile("video", { muted: false, loop: false }, { src: "/media/V.mp4" })])).container.querySelector("video")!;
    expect(loud.muted).toBe(false);
    expect(loud.loop).toBe(false);
  });

  it("shows a text", () => {
    draw(scene("full", [tile("text", { text: "Open day on Saturday" })]));
    expect(screen.getByText("Open day on Saturday")).toBeTruthy();
  });

  it("frames a web page in a sandbox that gives it no access to the screen's page and no referrer, and refuses other schemes", () => {
    const { container, unmount } = draw(scene("full", [tile("web", { url: "https://example.org/live", refreshSeconds: 60 })]));
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe("https://example.org/live");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-forms");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-top-navigation");
    unmount();
    expect(draw(scene("full", [tile("web", { url: "javascript:alert(1)" })])).container.querySelector("iframe")).toBeNull();
  });

  it("embeds YouTube through the privacy-friendly address, muted by default, and only for a real video id", () => {
    const { container, unmount } = draw(scene("full", [tile("youtube", { video: "dQw4w9WgXcQ" })]));
    const src = container.querySelector("iframe")!.getAttribute("src")!;
    expect(src.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?")).toBe(true);
    expect(src).toContain("autoplay=1");
    expect(src).toContain("mute=1");
    unmount();
    expect(draw(scene("full", [tile("youtube", { video: "https://evil.example" })])).container.querySelector("iframe")).toBeNull();
  });

  it("shows the station of a radio and says whether it is on air", () => {
    const { unmount } = draw(scene("full", [tile("radio", { url: "https://radio.example.org/live.mp3", label: "Campus radio" })]));
    expect(screen.getByText("Campus radio")).toBeTruthy();
    expect(screen.getByText("On air")).toBeTruthy();
    unmount();
    draw(scene("full", [tile("radio", { url: "https://radio.example.org/live.mp3", label: "Campus radio", muted: true })]));
    expect(screen.getByText("Sound off")).toBeTruthy();
  });

  it("draws an MJPEG camera as an image and a plain live stream as a muted video", () => {
    const camera = draw(scene("full", [tile("stream", { url: "https://cam.example.org/video.mjpg", format: "auto" })]));
    expect(camera.container.querySelector("img")!.getAttribute("src")).toBe("https://cam.example.org/video.mjpg");
    camera.unmount();
    const live = draw(scene("full", [tile("stream", { url: "https://cam.example.org/live.mp4", format: "mp4" })]));
    expect(live.container.querySelector("video")!.muted).toBe(true);
  });

  it("detects a stream format from the address, and lets the tile say it", () => {
    expect(detectFormat("https://x.org/a/live.m3u8?token=1", "auto")).toBe("hls");
    expect(detectFormat("https://x.org/cam.mjpg", "auto")).toBe("mjpeg");
    expect(detectFormat("https://x.org/live", "auto")).toBe("mp4");
    expect(detectFormat("https://x.org/live", "hls")).toBe("hls");
  });

  it("draws nothing in a tile of a kind it does not know, and does not fail", () => {
    const { container } = draw(scene("columns", [tile("hologram", { anything: true }), tile("text", { text: "still here" }, { id: "b" })]));
    expect(screen.getByText("still here")).toBeTruthy();
    expect(container.querySelector(".tile-unknown")?.childElementCount).toBe(0);
  });
});
