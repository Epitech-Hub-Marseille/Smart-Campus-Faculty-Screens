import type { WeatherView } from "@smartcampus/faculty-local";
import { errorMessage, log } from "./log.js";

export interface WeatherSpot {
  label: string;
  latitude: number;
  longitude: number;
}

const FIFTEEN_MINUTES = 15 * 60_000;

/** WMO codes of Open-Meteo, in a few words. */
export function describeWeather(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "Rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "Snow";
  if (code >= 95) return "Thunderstorm";
  return "Cloudy";
}

/**
 * The weather for the header, asked for by the agent (not by the page: the page loads nothing from the internet).
 * A failure keeps the last reading until it is too old to be true, then shows none.
 */
export class WeatherPoller {
  private timer: NodeJS.Timeout | null = null;
  private spot: WeatherSpot | null = null;
  private last: WeatherView | null = null;

  constructor(
    private readonly onChange: (weather: WeatherView | null) => void,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Starts, moves or stops polling according to the screen's configuration. */
  configure(spot: WeatherSpot | null): void {
    const same = this.spot && spot && this.spot.latitude === spot.latitude && this.spot.longitude === spot.longitude && this.spot.label === spot.label;
    if (same) return;
    this.spot = spot;
    this.last = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!spot) return this.onChange(null);
    void this.poll();
    this.timer = setInterval(() => void this.poll(), FIFTEEN_MINUTES);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(): Promise<void> {
    const spot = this.spot;
    if (!spot) return;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${spot.latitude}&longitude=${spot.longitude}&current=temperature_2m,weather_code`;
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { current?: { temperature_2m?: number; weather_code?: number } };
      const t = body.current?.temperature_2m;
      const code = body.current?.weather_code;
      if (typeof t !== "number" || typeof code !== "number") throw new Error("unexpected answer");
      this.last = { temperature: Math.round(t), code, label: spot.label || describeWeather(code), updatedAt: this.now() };
      this.onChange(this.last);
    } catch (err) {
      log("warn", "weather unavailable", { error: errorMessage(err) });
      // Two hours old is no longer "the weather outside".
      if (this.last && this.now() - this.last.updatedAt > 2 * 3_600_000) {
        this.last = null;
        this.onChange(null);
      }
    }
  }
}
