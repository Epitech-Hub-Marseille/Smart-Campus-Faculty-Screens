import { Radio, VideoOff } from "lucide-react";
import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import type { TileView } from "@smartcampus/faculty-local";
import { useSilenced } from "../../lib/silence";

const text = (v: unknown) => (typeof v === "string" ? v : "");
const isHttp = (u: string) => /^https?:\/\//i.test(u);

/** Starts playback and ignores a refusal: the retry loop deals with a stream that does not come up. */
const play = (el: HTMLMediaElement) => void Promise.resolve(el.play?.()).catch(() => undefined);

/** How long to wait before trying a stream again after it failed or ended. */
const RETRY_MS = 15_000;

export type StreamFormat = "hls" | "mp4" | "mjpeg";

/** What a stream address is, when the tile says "detect": by the end of the path, never by fetching it. */
export function detectFormat(url: string, format: unknown): StreamFormat {
  if (format === "hls" || format === "mp4" || format === "mjpeg") return format;
  let path = url.toLowerCase();
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    /* keep the raw text */
  }
  if (path.endsWith(".m3u8")) return "hls";
  if (/\.(mjpg|mjpeg|cgi)$/.test(path) || path.includes("mjpeg")) return "mjpeg";
  return "mp4";
}

/**
 * Plays an HLS or a plain stream on a <video>. A stream that fails (or ends, for a live one) is retried, and a
 * message says so meanwhile: a camera that is down must not freeze the whole carousel on a black tile.
 */
function useStream(video: React.RefObject<HTMLVideoElement | null>, url: string, format: StreamFormat, active: boolean) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const el = video.current;
    if (!el || !active) return;
    setFailed(false);
    let hls: Hls | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const fail = () => {
      setFailed(true);
      retry = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
    };
    const ok = () => setFailed(false);

    if (format === "hls" && Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: true });
      hls.on(Hls.Events.ERROR, (_e, data) => data.fatal && fail());
      hls.on(Hls.Events.MANIFEST_PARSED, () => play(el));
      hls.loadSource(url);
      hls.attachMedia(el);
    } else {
      // Safari plays HLS natively; every other format is a plain source.
      el.src = url;
      play(el);
    }
    el.addEventListener("playing", ok);
    el.addEventListener("error", fail);
    el.addEventListener("ended", fail);
    return () => {
      clearTimeout(retry);
      el.removeEventListener("playing", ok);
      el.removeEventListener("error", fail);
      el.removeEventListener("ended", fail);
      hls?.destroy();
      el.removeAttribute("src");
      el.load();
    };
  }, [url, format, active, attempt]);

  return failed;
}

/** A live video that is not on YouTube: HLS, a live MP4 or an MJPEG camera. */
export function StreamTile({ tile }: { tile: TileView }) {
  const url = text(tile.settings.url);
  const label = text(tile.settings.label);
  const format = detectFormat(url, tile.settings.format);
  const silenced = useSilenced();
  const muted = silenced || tile.settings.muted !== false;
  const video = useRef<HTMLVideoElement>(null);
  const failed = useStream(video, url, format, isHttp(url) && format !== "mjpeg");
  const [imgFailed, setImgFailed] = useState(false);
  const [imgKey, setImgKey] = useState(0);

  // An MJPEG camera is a never-ending image: when it drops, load it again after a while.
  useEffect(() => {
    if (!imgFailed) return;
    const timer = setTimeout(() => (setImgFailed(false), setImgKey((n) => n + 1)), RETRY_MS);
    return () => clearTimeout(timer);
  }, [imgFailed]);

  if (!isHttp(url)) return null;
  const down = format === "mjpeg" ? imgFailed : failed;
  return (
    <div className="tile-live">
      {format === "mjpeg" ? <img key={imgKey} className="tile-media contain" src={url} alt="" onError={() => setImgFailed(true)} /> : <video ref={video} className="tile-media contain" muted={muted} autoPlay playsInline />}
      {label && <div className="tile-caption">{label}</div>}
      {down && (
        <div className="tile-down" role="status">
          <VideoOff aria-hidden /> Stream unavailable, trying again
        </div>
      )}
    </div>
  );
}

/** A live radio: the station on screen and the sound from its stream. Muted, it only shows the station. */
export function RadioTile({ tile }: { tile: TileView }) {
  const url = text(tile.settings.url);
  const label = text(tile.settings.label) || "Live radio";
  const silenced = useSilenced();
  const muted = silenced || tile.settings.muted === true;
  const audio = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const el = audio.current;
    // While an alarm sounds the stream is not even loaded: it must be silent, and a muted stream would only use the network.
    if (!el || !isHttp(url) || silenced) return;
    setFailed(false);
    el.src = url;
    play(el);
    let retry: ReturnType<typeof setTimeout> | undefined;
    const fail = () => {
      setFailed(true);
      retry = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
    };
    const ok = () => setFailed(false);
    el.addEventListener("playing", ok);
    el.addEventListener("error", fail);
    el.addEventListener("ended", fail);
    return () => {
      clearTimeout(retry);
      el.removeEventListener("playing", ok);
      el.removeEventListener("error", fail);
      el.removeEventListener("ended", fail);
      el.removeAttribute("src");
      el.load();
    };
  }, [url, attempt, silenced]);

  if (!isHttp(url)) return null;
  return (
    <div className="tile-radio">
      <audio ref={audio} muted={muted} />
      <Radio aria-hidden className={failed || muted ? "" : "on-air"} />
      <strong>{label}</strong>
      <span>{failed ? "Reconnecting…" : muted ? "Sound off" : "On air"}</span>
    </div>
  );
}

/**
 * A YouTube video or live stream, through the privacy-friendly embed. The page loads only this frame from YouTube,
 * and a sandbox keeps it from reaching the screen's page.
 */
export function YoutubeTile({ tile }: { tile: TileView }) {
  const silenced = useSilenced();
  const id = text(tile.settings.video);
  // Its sound cannot be reached from here, so while an alarm sounds the frame is not drawn.
  if (silenced || !/^[\w-]{11}$/.test(id)) return null;
  const muted = tile.settings.muted !== false;
  const params = new URLSearchParams({ autoplay: "1", mute: muted ? "1" : "0", controls: "0", rel: "0", modestbranding: "1", playsinline: "1", loop: "1", playlist: id });
  return (
    <iframe
      className="tile-frame"
      src={`https://www.youtube-nocookie.com/embed/${id}?${params}`}
      title="YouTube"
      allow="autoplay; encrypted-media"
      sandbox="allow-scripts allow-same-origin"
      // YouTube refuses an embed that does not say where it is shown from.
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}
