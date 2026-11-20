import { useEffect, useState } from "react";
import type { TileView } from "@smartcampus/faculty-local";
import { useSilenced } from "../../lib/silence";

const text = (v: unknown) => (typeof v === "string" ? v : "");
const fitOf = (tile: TileView) => (tile.settings.fit === "cover" ? "cover" : "contain");

/** A picture of the library, from the local cache. */
export function ImageTile({ tile }: { tile: TileView }) {
  return tile.src ? <img className={`tile-media ${fitOf(tile)}`} src={tile.src} alt="" /> : null;
}

/** A video of the library. It plays muted unless the tile says otherwise (the kiosk allows sound without a touch). */
export function VideoTile({ tile }: { tile: TileView }) {
  const silenced = useSilenced();
  const muted = silenced || tile.settings.muted !== false;
  const loop = tile.settings.loop !== false;
  return tile.src ? <video key={`${tile.id}:${tile.src}`} className={`tile-media ${fitOf(tile)}`} src={tile.src} autoPlay loop={loop} muted={muted} playsInline /> : null;
}

export function TextTile({ tile }: { tile: TileView }) {
  return (
    <div className={`tile-text align-${tile.settings.align === "left" ? "left" : "center"}`}>
      <p>{text(tile.settings.text)}</p>
    </div>
  );
}

/** A web page, reloaded on its own schedule so a live page stays live. */
export function WebTile({ tile }: { tile: TileView }) {
  const silenced = useSilenced();
  const url = text(tile.settings.url);
  const refresh = typeof tile.settings.refreshSeconds === "number" ? tile.settings.refreshSeconds : 0;
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!refresh) return;
    const timer = setInterval(() => setReload((n) => n + 1), refresh * 1000);
    return () => clearInterval(timer);
  }, [refresh, url]);
  // A page's sound cannot be reached from here, so while an alarm sounds it is not drawn.
  if (silenced || !/^https?:\/\//i.test(url)) return null;
  return (
    <iframe
      key={`${url}:${reload}`}
      className="tile-frame"
      src={url}
      title="Web page"
      // A third-party page may run its own scripts but gets no access to the screen's page, and no referrer.
      sandbox="allow-scripts allow-same-origin allow-forms"
      referrerPolicy="no-referrer"
    />
  );
}
