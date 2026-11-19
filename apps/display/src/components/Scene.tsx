import { isKnownKind, SCENE_LAYOUTS, type SceneView, type TileView, type ViewState } from "@smartcampus/faculty-local";
import { NewsTile, ReservationsTile } from "./Board";
import { StaffBoard } from "./StaffBoard";
import { ImageTile, TextTile, VideoTile, WebTile } from "./tiles/MediaTiles";
import { RadioTile, StreamTile, YoutubeTile } from "./tiles/LiveTiles";

/** What goes in a tile. A kind this page does not know draws nothing: the server may be newer than the screen. */
function TileContent({ tile, state, now }: { tile: TileView; state: ViewState; now: number }) {
  switch (tile.kind) {
    case "news":
      return <NewsTile state={state} now={now} />;
    case "staff":
      return <StaffBoard state={state} now={now} />;
    case "reservations":
      return <ReservationsTile state={state} now={now} />;
    case "image":
      return <ImageTile tile={tile} />;
    case "video":
      return <VideoTile tile={tile} />;
    case "text":
      return <TextTile tile={tile} />;
    case "web":
      return <WebTile tile={tile} />;
    case "radio":
      return <RadioTile tile={tile} />;
    case "stream":
      return <StreamTile tile={tile} />;
    case "youtube":
      return <YoutubeTile tile={tile} />;
    default:
      return null;
  }
}

/** One scene: its layout as a CSS grid, one tile per slot. */
export function Scene({ scene, state, now }: { scene: SceneView; state: ViewState; now: number }) {
  const layout = SCENE_LAYOUTS[scene.layout] ?? SCENE_LAYOUTS.full!;
  return (
    <main className="scene" data-scene={scene.id} style={{ gridTemplateColumns: layout.columns, gridTemplateRows: layout.rows }}>
      {layout.tiles.map(([r1, c1, r2, c2], i) => {
        const tile = scene.tiles[i];
        if (!tile) return null;
        return (
          <section key={tile.id} className={`tile tile-${isKnownKind(tile.kind) ? tile.kind : "unknown"}`} style={{ gridRow: `${r1} / ${r2}`, gridColumn: `${c1} / ${c2}` }}>
            <TileContent tile={tile} state={state} now={now} />
          </section>
        );
      })}
    </main>
  );
}
