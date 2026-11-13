"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  start: string;
  end: string;
  defaultStart: string;
  defaultEnd: string;
  defaultPreset: DefaultPreset;
  onApply: (start: string, end: string) => void;
};

const MIN_DATE = "2010-01-04";
const PRESETS = [
  { id: "1W", name: "Past week", days: 7 },
  { id: "1M", name: "Past month", months: 1 },
  { id: "3M", name: "3 months", months: 3 },
  { id: "6M", name: "6 months", months: 6 },
  { id: "YTD", name: "Year to date", ytd: true },
  { id: "1Y", name: "Past year", years: 1 },
  { id: "5Y", name: "5 years", years: 5 },
  { id: "MAX", name: "All time", all: true },
] as const;
type PresetId = (typeof PRESETS)[number]["id"];
type DefaultPreset = PresetId | "1D";
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fromIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(value: string) {
  if (!value) return "Select date";
  return `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}`;
}

function shiftMonth(date: Date, offset: number) {
  const year = date.getFullYear();
  const month = date.getMonth() + offset;
  const targetMonth = new Date(year, month, 1);
  const day = Math.min(date.getDate(), new Date(year, month + 1, 0).getDate());
  return new Date(targetMonth.getFullYear(), targetMonth.getMonth(), day);
}

function presetRange(id: PresetId, today: Date) {
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

function weekdaysBetween(start: string, end: string) {
  const from = fromIsoDate(start);
  const to = fromIsoDate(end);
  let weekdays = 0;
  for (const day = new Date(from); day <= to; day.setDate(day.getDate() + 1)) {
    if (day.getDay() !== 0 && day.getDay() !== 6) weekdays++;
  }
  return weekdays;
}

export default function DateRangePicker({
  start,
  end,
  defaultStart,
  defaultEnd,
  defaultPreset,
  onApply,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [hoverDate, setHoverDate] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [todayIso, setTodayIso] = useState("");
  const [month, setMonth] = useState(() => new Date(2010, 0, 1));
  const pickerRef = useRef<HTMLDivElement>(null);
  const shownStart = start || defaultStart;
  const shownEnd = end || defaultEnd;

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function openPicker() {
    const today = new Date();
    const todayDate = toIsoDate(today);
    const fallback = defaultPreset === "1D"
      ? { start: todayDate, end: todayDate }
      : presetRange(defaultPreset, today);
    const initialStart = start || defaultStart || fallback.start;
    const initialEnd = end || defaultEnd || fallback.end;
    setTodayIso(todayDate);
    setDraftStart(initialStart);
    setDraftEnd(initialEnd);
    setSelectingEnd(false);
    setHoverDate("");
    setSelectedPreset(start || defaultPreset === "1D" ? null : defaultPreset);
    setMonth(shiftMonth(fromIsoDate(initialEnd), -1));
    setOpen(true);
  }

  function togglePicker() {
    if (open) setOpen(false);
    else openPicker();
  }

  function chooseDay(value: string) {
    if (!selectingEnd || value < draftStart) {
      setDraftStart(value);
      setDraftEnd("");
      setSelectingEnd(true);
    } else {
      setDraftEnd(value);
      setSelectingEnd(false);
    }
    setHoverDate("");
    setSelectedPreset(null);
  }

  function choosePreset(id: (typeof PRESETS)[number]["id"]) {
    const selection = presetRange(id, fromIsoDate(todayIso));
    setDraftStart(selection.start);
    setDraftEnd(selection.end);
    setSelectingEnd(false);
    setHoverDate("");
    setSelectedPreset(id);
  }

  function apply() {
    if (!draftStart || !draftEnd || selectingEnd) return;
    const today = todayIso || toIsoDate(new Date());
    if (draftEnd > today) return;
    onApply(draftStart, draftEnd);
    setOpen(false);
  }

  const previewEnd = selectingEnd && hoverDate
    ? hoverDate < draftStart ? draftStart : hoverDate
    : draftEnd;
  const rangeStart = selectingEnd && hoverDate && hoverDate < draftStart
    ? hoverDate
    : draftStart;
  const rangeEnd = previewEnd;
  const dayCount =
    draftStart && draftEnd && !selectingEnd
      ? Math.round((fromIsoDate(draftEnd).getTime() - fromIsoDate(draftStart).getTime()) / 86400000) + 1
      : 0;
  const previousDisabled =
    month.getFullYear() === 2010 && month.getMonth() === 0;
  const maxMonth = todayIso
    ? shiftMonth(fromIsoDate(todayIso), -1)
    : month;
  const nextDisabled =
    month.getFullYear() === maxMonth.getFullYear() &&
    month.getMonth() === maxMonth.getMonth();

  return (
    <div className="date-picker" ref={pickerRef}>
      <button
        className="date-range-trigger"
        type="button"
        aria-label={`Date range ${formatDate(shownStart)} to ${formatDate(shownEnd)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={togglePicker}
      >
        <svg className="date-range-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
        <span className="date-range-trigger-copy">
          <span>Date range</span>
          <span className="date-range-trigger-values">
            {formatDate(shownStart)}
            <span aria-hidden="true">→</span>
            {formatDate(shownEnd)}
          </span>
        </span>
        <svg className={`date-range-chevron${open ? " is-open" : ""}`} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>

      {open && (
        <div className="date-picker-popover" role="dialog" aria-label="Choose date range">
          <aside className="date-picker-presets">
            <h3>Quick range</h3>
            {PRESETS.map((preset) => (
              <button
                className={selectedPreset === preset.id ? "preset-active" : ""}
                key={preset.id}
                type="button"
                aria-pressed={selectedPreset === preset.id}
                onClick={() => choosePreset(preset.id)}
              >
                <span>{preset.name}</span>
                <span className="preset-code">{preset.id}</span>
              </button>
            ))}
          </aside>
          <div className="date-picker-calendar">
            <div className="calendar-months">
              {[0, 1].map((offset) => {
                const shownMonth = new Date(month.getFullYear(), month.getMonth() + offset, 1);
                const year = shownMonth.getFullYear();
                const monthIndex = shownMonth.getMonth();
                const firstDay = new Date(year, monthIndex, 1).getDay();
                const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
                return (
                  <section className="calendar-month" key={`${year}-${monthIndex}`}>
                    <div className="calendar-month-heading">
                      {offset === 0 && (
                        <button
                          type="button"
                          aria-label="Previous month"
                          disabled={previousDisabled}
                          onClick={() => setMonth(shiftMonth(month, -1))}
                        >
                          ‹
                        </button>
                      )}
                      <h3>{MONTHS[monthIndex]} {year}</h3>
                      {offset === 0 && (
                        <button
                          className="calendar-next-mobile"
                          type="button"
                          aria-label="Next month"
                          disabled={nextDisabled}
                          onClick={() => setMonth(shiftMonth(month, 1))}
                        >
                          ›
                        </button>
                      )}
                      {offset === 1 && (
                        <button
                          type="button"
                          aria-label="Next month"
                          disabled={nextDisabled}
                          onClick={() => setMonth(shiftMonth(month, 1))}
                        >
                          ›
                        </button>
                      )}
                    </div>
                    <div className="calendar-grid calendar-weekdays" aria-hidden="true">
                      {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
                    </div>
                    <div className="calendar-grid calendar-days">
                      {Array.from({ length: firstDay }, (_, index) => (
                        <span className="calendar-empty" key={`empty-${index}`} />
                      ))}
                      {Array.from({ length: daysInMonth }, (_, index) => {
                        const value = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`;
                        const selected = value === rangeStart || value === rangeEnd;
                        const inRange = Boolean(rangeStart && rangeEnd && value >= rangeStart && value <= rangeEnd);
                        const disabled = value > todayIso || value < MIN_DATE;
                        return (
                          <button
                            className={`calendar-day${selected ? " day-selected" : ""}${inRange && !selected ? " day-in-range" : ""}${value === todayIso ? " day-today" : ""}`}
                            key={value}
                            type="button"
                            aria-label={`${MONTHS[monthIndex]} ${index + 1}, ${year}`}
                            aria-pressed={selected}
                            disabled={disabled}
                            onClick={() => chooseDay(value)}
                            onMouseEnter={() => selectingEnd && setHoverDate(value)}
                          >
                            {index + 1}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
            <footer className="date-picker-footer">
              <div className="date-range-summary">
                <strong>
                  {draftStart ? formatDate(draftStart) : "Select start date"}
                  <span>→</span>
                  <span className={draftEnd && !selectingEnd ? "" : "summary-placeholder"}>
                    {draftEnd && !selectingEnd ? formatDate(draftEnd) : "Select end date"}
                  </span>
                </strong>
                <span>
                  {dayCount
                    ? `${dayCount} days · ${weekdaysBetween(draftStart, draftEnd)} weekdays`
                    : "Click a second date to finish"}
                </span>
              </div>
              <div className="date-picker-actions">
                <button className="date-picker-cancel" type="button" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button
                  className="date-picker-apply"
                  type="button"
                  disabled={!draftStart || !draftEnd || selectingEnd}
                  onClick={apply}
                >
                  Apply
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
