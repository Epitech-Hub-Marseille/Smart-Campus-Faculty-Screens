import { Cloud, CloudRain, Sun } from "lucide-react";
import type { ConfigView, WeatherView } from "@smartcampus/faculty-local";
import { dateParts, timeOf } from "../lib/format";

function WeatherIcon({ code }: { code: number }) {
  if (code === 0 || code === 1) return <Sun aria-hidden />;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return <CloudRain aria-hidden />;
  return <Cloud aria-hidden />;
}

/** Who the screen belongs to on the left, the date, the weather and the time on the right. */
export function Header({ config, logoUrl, weather, now }: { config: ConfigView; logoUrl: string | null; weather: WeatherView | null; now: number }) {
  const { weekday, date } = dateParts(now);
  const title = config.site.name || "Faculty information";
  const subtitle = config.site.subtitle || "Information board";
  return (
    <header className="header">
      <div className="header-brand">
        {logoUrl && <img className="logo" src={logoUrl} alt="" />}
        {logoUrl && <span className="divider" aria-hidden />}
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="header-time">
        {config.widgets.weather && weather && (
          <div className="weather" aria-label={`Weather: ${weather.label}, ${weather.temperature} degrees`}>
            <WeatherIcon code={weather.code} />
            <span className="weather-temp">{weather.temperature}°</span>
            <span className="weather-label">{weather.label}</span>
          </div>
        )}
        {config.widgets.date && (
          <div className="date">
            <span className="weekday">{weekday}</span>
            <span className="full-date">{date}</span>
          </div>
        )}
        {config.widgets.clock && (
          <>
            {config.widgets.date && <span className="divider" aria-hidden />}
            <time className="clock">{timeOf(now)}</time>
          </>
        )}
      </div>
    </header>
  );
}
