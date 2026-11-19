/**
 * English is written day first on a campus in Europe ("6 November 2026"), whatever the variant the browser reports;
 * any other language follows the browser.
 */
const locale = typeof navigator !== "undefined" && navigator.language && !navigator.language.startsWith("en") ? navigator.language : "en-GB";

const hhmm = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export const timeOf = (ms: number): string => hhmm.format(new Date(ms));
export const range = (start: number, end: number): string => `${timeOf(start)} – ${timeOf(end)}`;

export function dateParts(ms: number): { weekday: string; date: string } {
  const d = new Date(ms);
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: "long" }).format(d),
    date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(d),
  };
}
