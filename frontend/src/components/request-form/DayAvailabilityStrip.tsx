import { useId } from 'react';
import type { AvailabilityResponse, Room } from '../../types/api';
import { toLabel, toMinutes } from '../../lib/availability';

interface Props {
  rooms: Room[];
  availability?: AvailabilityResponse;
  openMinutes: number;
  closeMinutes: number;
  /** Minute of day before which start times have passed (see passedBefore). */
  passedBefore: number;
  /** Minute of day to mark as "now", or null when the date isn't today. */
  nowMinutes: number | null;
  start: string;
  end: string;
}

type CellState = 'past' | 'selected' | 'full' | 'open';

// Each state differs by more than hue (WCAG 1.4.1): passed is hatched, open
// is a light tint with a green edge, fully booked is solid dark gray, and your
// time is navy with a white center bar (CellMark).
const CELL_CLASS: Record<CellState, string> = {
  past: 'bg-[repeating-linear-gradient(135deg,#C9CED8_0_4px,#F7F8FA_4px_8px)]',
  selected: 'bg-primary-600',
  full: 'bg-neu-fg',
  open: 'bg-ok-bg border border-ok-fg/60',
};

function CellMark({ state }: { state: CellState }) {
  return state === 'selected' ? <span className="block h-0.5 w-2/3 mx-auto rounded bg-white" /> : null;
}

const LEGEND: { state: CellState; label: string }[] = [
  { state: 'past', label: 'Passed' },
  { state: 'open', label: 'Open' },
  { state: 'full', label: 'Fully booked' },
  { state: 'selected', label: 'Your time' },
];

// Half-hour overview of the picked day across the site: passed time is
// hatched, "Fully booked" means no room open then is free. The colored strip
// is hidden from screen readers; an equivalent list of time ranges and their
// state is rendered visually hidden beside it (WCAG 1.1.1).
export function DayAvailabilityStrip({ rooms, availability, openMinutes, closeMinutes, passedBefore, nowMinutes, start, end }: Props) {
  const headingId = useId();
  const span = closeMinutes - openMinutes;
  if (span <= 0) return null;
  const selStart = start ? toMinutes(start) : -1;
  const selEnd = end ? toMinutes(end) : -1;
  const bookings = availability?.bookings ?? [];

  const cells = Array.from({ length: span / 30 }, (_, i) => {
    const cellStart = openMinutes + i * 30;
    const cellEnd = cellStart + 30;
    let state: CellState = 'open';
    if (cellStart < passedBefore) state = 'past';
    else if (cellStart >= selStart && cellEnd <= selEnd) state = 'selected';
    else {
      const openRooms = rooms.filter(
        (r) => toMinutes(r.openTime ?? '09:00') <= cellStart && cellEnd <= toMinutes(r.closeTime ?? '17:00'),
      );
      const free = openRooms.some(
        (r) => !bookings.some((b) => b.room === r.id && toMinutes(b.start) < cellEnd && cellStart < toMinutes(b.end)),
      );
      if (!free) state = 'full';
    }
    return { cellStart, state };
  });

  // Consecutive cells with the same state, as text ranges for the list.
  const ranges: { from: number; to: number; state: CellState }[] = [];
  for (const { cellStart, state } of cells) {
    const last = ranges[ranges.length - 1];
    if (last && last.state === state) last.to = cellStart + 30;
    else ranges.push({ from: cellStart, to: cellStart + 30, state });
  }
  const stateLabel = (state: CellState) => LEGEND.find((l) => l.state === state)?.label;

  const nowPct = nowMinutes !== null && nowMinutes > openMinutes && nowMinutes < closeMinutes
    ? ((nowMinutes - openMinutes) / span) * 100
    : null;

  return (
    <div className="mt-3">
      <p id={headingId} className="text-xs font-medium text-ink-2 mb-1.5">
        Day at a glance
      </p>
      <ul className="sr-only" aria-labelledby={headingId}>
        {ranges.map(({ from, to, state }) => (
          <li key={from}>
            {toLabel(from)} to {toLabel(to)}: {stateLabel(state)}
          </li>
        ))}
        {nowMinutes !== null && <li>Current time: {toLabel(nowMinutes)}</li>}
      </ul>
      <div className="relative" aria-hidden="true">
        <div className="flex gap-0.5">
          {cells.map(({ cellStart, state }) => (
            <div
              key={cellStart}
              title={`${toLabel(cellStart)}: ${stateLabel(state)}`}
              className={`h-5 flex-1 rounded flex items-center ${CELL_CLASS[state]}`}
            >
              <CellMark state={state} />
            </div>
          ))}
        </div>
        {nowPct !== null && (
          <div className="absolute -top-1 -bottom-1 w-0.5 bg-err-fg rounded" style={{ left: `${nowPct}%` }} aria-hidden="true" />
        )}
      </div>
      <div className="relative h-4 mt-1 text-[10px] text-ink-4" aria-hidden="true">
        <span className="absolute left-0">{toLabel(openMinutes)}</span>
        <span className="absolute right-0">{toLabel(closeMinutes)}</span>
        {nowPct !== null && (
          <span
            className="absolute -translate-x-1/2 font-semibold text-err-fg whitespace-nowrap"
            style={{ left: `${Math.min(Math.max(nowPct, 8), 92)}%` }}
          >
            ▲ now {toLabel(nowMinutes!)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px] text-ink-3" aria-hidden="true">
        {LEGEND.map(({ state, label }) => (
          <span key={state} className="inline-flex items-center gap-1">
            <span className={`w-3 h-3 rounded-sm flex items-center ${CELL_CLASS[state]}`}>
              <CellMark state={state} />
            </span>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
