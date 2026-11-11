import { toISODate } from './dates';

export const DAY_START = 9 * 60;
export const DAY_END = 17 * 60;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Minute of day before which start times on `date` have passed: 0 for a future
// date, now for today, all day for a past date. requests_* Lambdas reject these.
export function passedBefore(date: string, now: Date): number {
  const today = toISODate(now);
  if (!date || date > today) return 0;
  if (date < today) return 24 * 60;
  return now.getHours() * 60 + now.getMinutes();
}

export function toLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${displayHour}${period}` : `${displayHour}:${String(m).padStart(2, '0')}${period}`;
}

export function toHHMM(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// Setup/cleanup option ("None" | "15 min" | "1 hour", or null) → minutes.
export function bufferMinutes(option?: string | null): number {
  const n = parseInt(option ?? '', 10);
  if (Number.isNaN(n)) return 0;
  return option?.includes('hour') ? n * 60 : n;
}

interface Timed {
  start: string;
  end: string;
  setupTime?: string | null;
  cleanupTime?: string | null;
}

// The time the room is actually held: setup before the event's start through
// cleanup after its end. Mirrors reserved_window() in the requests_* Lambdas,
// which lock these slots; availability bookings already come back in this form.
export function reservedWindow(r: Timed): { start: string; end: string } {
  return {
    start: toHHMM(Math.max(0, toMinutes(r.start) - bufferMinutes(r.setupTime))),
    end: toHHMM(Math.min(24 * 60, toMinutes(r.end) + bufferMinutes(r.cleanupTime))),
  };
}

// "9:30AM–12PM (incl. setup/cleanup)" when the request has buffers, else ''.
export function reservedLabel(r: Timed): string {
  if (!bufferMinutes(r.setupTime) && !bufferMinutes(r.cleanupTime)) return '';
  const w = reservedWindow(r);
  return `${toLabel(toMinutes(w.start))}–${toLabel(toMinutes(w.end))} (incl. setup/cleanup)`;
}
