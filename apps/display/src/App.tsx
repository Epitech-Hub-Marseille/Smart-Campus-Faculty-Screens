import { VolumeX, WifiOff } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { showsBoard, visibleEndNotice, type LiveMessage } from "@smartcampus/faculty-local";
import { EmergencyScreen } from "./components/Emergency";
import { EndNotice } from "./components/EndNotice";
import { FallbackBoundary } from "./components/FallbackBoundary";
import { Enrolling } from "./components/Enrolling";
import { Header } from "./components/Header";
import { Scene } from "./components/Scene";
import { alarmLevel, createAlarm } from "./lib/alarm";
import { SilenceProvider } from "./lib/silence";
import { onUrgentSound, playSound, silenceSounds, soundBlocked, subscribeBlocked } from "./lib/sounds";
import { createLivePlayer } from "./lib/liveVoice";
import { useLive } from "./lib/useLive";
import { useNow } from "./lib/useNow";
import { useRotation } from "./lib/useRotation";
import { useTheme } from "./lib/useTheme";

const inWindow = (w: { enabled: boolean; from: string; to: string }, at: Date) => {
  if (!w.enabled) return false;
  const m = at.getHours() * 60 + at.getMinutes();
  const t = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return t(w.from) <= t(w.to) ? m >= t(w.from) && m < t(w.to) : m >= t(w.from) || m < t(w.to);
};

/** Said on the screen when the browser keeps sound from it, so a silent alarm is never a mystery. The kiosk is never in that state. */
function SoundNotice() {
  const blocked = useSyncExternalStore(subscribeBlocked, soundBlocked);
  return blocked ? (
    <div className="sound-notice" role="alert">
      <VolumeX aria-hidden /> Sound is blocked by the browser. Touch the screen to turn it on.
    </div>
  ) : null;
}

export function App() {
  return (
    <>
      <Screen />
      <SoundNotice />
    </>
  );
}

function Screen() {
  const alarm = useRef(createAlarm());
  // Whoever is speaking (an emergency read-out or a live announcement) is heard over the alarm, which steps back meanwhile.
  const speakers = useRef(new Set<string>());
  const duckFor = (who: string, speaking: boolean) => {
    if (speaking) speakers.current.add(who);
    else speakers.current.delete(who);
    alarm.current.duck(speakers.current.size > 0);
  };
  const livePlayer = useRef<ReturnType<typeof createLivePlayer> | undefined>(undefined);
  livePlayer.current ??= createLivePlayer((speaking) => duckFor("live", speaking));
  const { state, connected } = useLive(
    (message: Extract<LiveMessage, { type: "audio" }>) => playSound(message.src, message.volume, message.urgent === true),
    (message) => {
      if (message.event === "start") livePlayer.current!.start(message.streamId);
      else if (message.event === "chunk") livePlayer.current!.chunk(message.streamId, message.data);
      else livePlayer.current!.end(message.streamId);
    },
  );
  const now = useNow(state.clockOffsetMs);
  const page = useRotation(state.config, state.scenes, now);
  // While an emergency or its end notice is on screen the theme is off, except what it says about alerts (fonts, frame, corners, dark backgrounds).
  useTheme(state.theme, Boolean(state.emergency) || visibleEndNotice(state.endNotice, now) !== null);

  // The alarm follows the emergency: it starts when one appears and stops when it ends.
  const emergency = state.emergency;
  const alarmKey = emergency ? `${emergency.emergencyId}:${emergency.testMode}:${emergency.testVolume}` : "";
  // Nothing else may make a sound while it does: what plays stops, and nothing starts (see `lib/silence.tsx` for the tiles).
  useEffect(() => {
    silenceSounds(Boolean(emergency));
    return () => silenceSounds(false);
  }, [Boolean(emergency)]);
  // The read-out of the emergency itself is heard over the alarm: the alarm steps back while it speaks.
  useEffect(() => {
    onUrgentSound((speaking) => duckFor("urgent", speaking));
    return () => onUrgentSound(() => undefined);
  }, []);
  useEffect(() => {
    if (!emergency) return alarm.current.stop();
    const quiet = inWindow(state.audio.quietHours, new Date(Date.now() + state.clockOffsetMs));
    alarm.current.start(emergency.kind, alarmLevel(emergency, quiet));
    return () => alarm.current.stop();
  }, [alarmKey]);

  if (state.phase === "enrolling" && state.enrollment) return <Enrolling enrollment={state.enrollment} />;

  const notice = visibleEndNotice(state.endNotice, now);
  if (notice) {
    const plain = <EndNotice notice={notice} config={state.config} />;
    return (
      <FallbackBoundary key={notice.shownAt} fallback={plain}>
        <EndNotice notice={notice} config={state.config} theme={state.theme} />
      </FallbackBoundary>
    );
  }

  // The header (logo, clock, weather) goes with the information board; a full-bleed picture or stream has none.
  const board = showsBoard(page.scene);
  const screen = (
    <div className={`screen ${board ? "page-board" : "page-media"}`}>
      {board && <Header config={state.config} logoUrl={state.logoUrl} weather={state.weather} now={now} />}
      <Scene scene={page.scene} state={state} now={now} />
      {(!state.online || !connected) && (
        <div className="offline" role="status">
          <WifiOff aria-hidden /> {connected ? "Offline, showing the last known content" : "Waiting for the screen agent"}
        </div>
      )}
    </div>
  );

  // An alert opens over the normal screen, which stays visible but blurred behind it, instead of replacing it.
  if (emergency) {
    const plain = <EmergencyScreen emergency={emergency} config={state.config} />;
    return (
      <>
        <div className="alert-backdrop" aria-hidden inert>
          <SilenceProvider value>{screen}</SilenceProvider>
        </div>
        <FallbackBoundary key={emergency.emergencyId} fallback={plain}>
          <EmergencyScreen emergency={emergency} config={state.config} theme={state.theme} />
        </FallbackBoundary>
      </>
    );
  }
  return screen;
}
