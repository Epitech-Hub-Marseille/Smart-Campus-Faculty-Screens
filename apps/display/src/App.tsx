import { WifiOff } from "lucide-react";
import { useEffect, useRef } from "react";
import { showsBoard, visibleEndNotice, type LiveMessage } from "@smartcampus/faculty-local";
import { EmergencyScreen } from "./components/Emergency";
import { EndNotice } from "./components/EndNotice";
import { FallbackBoundary } from "./components/FallbackBoundary";
import { Enrolling } from "./components/Enrolling";
import { Header } from "./components/Header";
import { Scene } from "./components/Scene";
import { alarmLevel, createAlarm } from "./lib/alarm";
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

function playSound(message: Extract<LiveMessage, { type: "audio" }>) {
  const audio = new Audio(message.src);
  audio.volume = Math.min(1, Math.max(0, message.volume / 100));
  void audio.play().catch(() => undefined);
}

export function App() {
  const { state, connected } = useLive(playSound);
  const now = useNow(state.clockOffsetMs);
  const page = useRotation(state.config, state.scenes, now);
  const alarm = useRef(createAlarm());
  // While an emergency or its end notice is on screen the theme is off, except what it says about alerts (fonts, frame, corners, dark backgrounds).
  useTheme(state.theme, Boolean(state.emergency) || visibleEndNotice(state.endNotice, now) !== null);

  // The alarm follows the emergency: it starts when one appears and stops when it ends.
  const emergency = state.emergency;
  const alarmKey = emergency ? `${emergency.emergencyId}:${emergency.testMode}:${emergency.testVolume}` : "";
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
          {screen}
        </div>
        <FallbackBoundary key={emergency.emergencyId} fallback={plain}>
          <EmergencyScreen emergency={emergency} config={state.config} theme={state.theme} />
        </FallbackBoundary>
      </>
    );
  }
  return screen;
}
