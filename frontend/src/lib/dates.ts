export function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday as the first day
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

// Sets the day to 1 before adding months so day-of-month rollover (e.g. Jan 31 + 1
// month landing on Mar 3 instead of Feb) never skips a month.
export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export function formatShort(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// Full 6-row (42-day) or shorter leading/trailing-trimmed grid of the weeks
// (Monday-first, matching startOfWeek) needed to cover every day of the month.
export function getMonthGridDays(monthStart: Date): Date[] {
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = addDays(startOfWeek(monthEnd), 6);
  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) {
    days.push(d);
  }
  return days;
}

// Rooms are booked in 30-minute slots, so any "HH:MM" time entered by hand
// (native time inputs don't always enforce `step` on keyboard entry) must
// land on :00 or :30.
export function isHalfHourAligned(time: string): boolean {
  const minutes = Number(time.split(':')[1]);
  return Number.isInteger(minutes) && (minutes === 0 || minutes === 30);
}

interface Dated {
  date: string;
  end: string;
  counterProposal?: { date: string; end: string } | null;
}

// Over once its end time has passed; a pending counter-proposal for a later
// time keeps it current.
export function isPastRequest(r: Dated, now: Date): boolean {
  const nowKey = `${toISODate(now)}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const ends = [r, r.counterProposal].filter((x): x is { date: string; end: string } => Boolean(x));
  return ends.every((x) => `${x.date}T${x.end}` <= nowKey);
}
