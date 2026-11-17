export const MIN_DATE = "2010-01-04";
export const PRESETS = [
  { id: "1W", name: "Past week", days: 7 },
  { id: "1M", name: "Past month", months: 1 },
  { id: "3M", name: "3 months", months: 3 },
  { id: "6M", name: "6 months", months: 6 },
  { id: "YTD", name: "Year to date", ytd: true },
  { id: "1Y", name: "Past year", years: 1 },
  { id: "5Y", name: "5 years", years: 5 },
  { id: "MAX", name: "All time", all: true },
] as const;
export type PresetId = (typeof PRESETS)[number]["id"];
export type DefaultPreset = PresetId | "1D";

export function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function fromIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatDate(value: string) {
  if (!value) return "Select date";
  return `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}`;
}

export function shiftMonth(date: Date, offset: number) {
  const year = date.getFullYear();
  const month = date.getMonth() + offset;
  const targetMonth = new Date(year, month, 1);
  const day = Math.min(date.getDate(), new Date(year, month + 1, 0).getDate());
  return new Date(targetMonth.getFullYear(), targetMonth.getMonth(), day);
}

export function presetRange(id: PresetId, today: Date) {
  const preset = PRESETS.find((item) => item.id === id);
  if (!preset) return { start: toIsoDate(today), end: toIsoDate(today) };
  let start = new Date(today);
  if ("days" in preset) start.setDate(start.getDate() - preset.days);
  if ("months" in preset) start = shiftMonth(start, -preset.months);
  if ("years" in preset) start = shiftMonth(start, -preset.years * 12);
  if ("ytd" in preset) start = new Date(today.getFullYear(), 0, 1);
  if ("all" in preset) return { start: MIN_DATE, end: toIsoDate(today) };
  return { start: toIsoDate(start), end: toIsoDate(today) };
}

export function weekdaysBetween(start: string, end: string) {
  const from = fromIsoDate(start);
  const to = fromIsoDate(end);
  let weekdays = 0;
  for (const day = new Date(from); day <= to; day.setDate(day.getDate() + 1)) {
    if (day.getDay() !== 0 && day.getDay() !== 6) weekdays++;
  }
  return weekdays;
}
