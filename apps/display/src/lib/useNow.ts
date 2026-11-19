import { useEffect, useState } from "react";

/** The time of the room (the device's clock corrected by the server's), refreshed every second. */
export function useNow(clockOffsetMs: number): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  return tick + clockOffsetMs;
}
