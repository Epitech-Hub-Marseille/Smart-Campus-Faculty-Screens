import { describe, expect, it, vi } from "vitest";
import type { WeatherView } from "@smartcampus/faculty-local";
import { describeWeather, WeatherPoller } from "./weather.js";

const answer = (temperature: number, code: number) => new Response(JSON.stringify({ current: { temperature_2m: temperature, weather_code: code } }));
const spot = { label: "Marseille", latitude: 43.3, longitude: 5.4 };

describe("WeatherPoller", () => {
  it("reads the temperature and the code for the configured place", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(answer(17.6, 2));
    const seen: (WeatherView | null)[] = [];
    const poller = new WeatherPoller((w) => seen.push(w), fetchImpl as never, () => 1_000);
    poller.configure(spot);
    await new Promise((r) => setTimeout(r, 20));
    poller.stop();
    expect(fetchImpl.mock.calls[0]![0]).toContain("latitude=43.3&longitude=5.4");
    expect(seen.at(-1)).toEqual({ temperature: 18, code: 2, label: "Marseille", updatedAt: 1_000 });
  });

  it("clears the weather when the widget is turned off, and does not ask again for an unchanged place", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(answer(10, 0));
    const seen: (WeatherView | null)[] = [];
    const poller = new WeatherPoller((w) => seen.push(w), fetchImpl as never);
    poller.configure(spot);
    poller.configure({ ...spot });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    poller.configure(null);
    poller.stop();
    expect(seen.at(-1)).toBeNull();
  });

  it("keeps the last reading when the service fails, and drops it once it is too old to be true", async () => {
    let now = 0;
    const fetchImpl = vi.fn().mockResolvedValueOnce(answer(20, 1)).mockRejectedValue(new Error("offline"));
    const seen: (WeatherView | null)[] = [];
    const poller = new WeatherPoller((w) => seen.push(w), fetchImpl as never, () => now);
    poller.configure(spot);
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.at(-1)?.temperature).toBe(20);
    now = 3_600_000;
    await poller.poll();
    expect(seen.at(-1)?.temperature).toBe(20);
    now = 3 * 3_600_000;
    await poller.poll();
    expect(seen.at(-1)).toBeNull();
    poller.stop();
  });

  it("ignores an answer it does not understand", async () => {
    const seen: (WeatherView | null)[] = [];
    const poller = new WeatherPoller((w) => seen.push(w), vi.fn().mockResolvedValue(new Response(JSON.stringify({ nope: 1 }))) as never);
    poller.configure(spot);
    await new Promise((r) => setTimeout(r, 20));
    poller.stop();
    expect(seen.filter(Boolean)).toEqual([]);
  });

  it("describes the codes in a few words", () => {
    expect([0, 2, 3, 45, 53, 63, 73, 82, 96].map(describeWeather)).toEqual(["Clear", "Partly cloudy", "Overcast", "Fog", "Drizzle", "Rain", "Snow", "Rain", "Thunderstorm"]);
  });
});
