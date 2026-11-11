import { useAvailability } from '../../hooks/useAvailability';
import { toLabel, toMinutes } from '../../lib/availability';
import type { Room } from '../../types/api';

interface Props {
  site: string;
  date: string;
  label: string;
  rooms: Room[];
  roomFilter: string;
  isToday: boolean;
  // Whether this day is the one the timeline panel below is showing.
  isSelected: boolean;
  onSelect: () => void;
}

// Cap the number of booking chips a day column shows before collapsing the
// rest into a "+N more" line, so a busy day doesn't stretch the whole week
// row taller than the others (matches CalendarMonthDayCell's behavior).
const MAX_VISIBLE = 3;

function roomName(rooms: Room[], roomId: string): string {
  return rooms.find((r) => r.id === roomId)?.name ?? roomId;
}

// A real <button> (selecting the day for the timeline below). Its content is
// its accessible name, so a screen reader hears the full date, the booking
// count, and each visible booking — the same information the chips show.
export function CalendarDayColumn({ site, date, label, rooms, roomFilter, isToday, isSelected, onSelect }: Props) {
  const { data, isLoading } = useAvailability(site, date);
  const isWeekend = new Date(`${date}T00:00:00`).getDay() % 6 === 0;
  const bookings = (data?.bookings ?? [])
    .filter((b) => !roomFilter || b.room === roomFilter)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const visible = bookings.slice(0, MAX_VISIBLE);
  const overflowCount = bookings.length - visible.length;
  const fullDate = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      aria-current={isToday ? 'date' : undefined}
      className={`w-full h-full text-left align-top rounded-xl border p-2 min-h-[128px] text-xs cursor-pointer transition hover:border-primary-300 hover:ring-1 hover:ring-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-400/40 ${
        isSelected ? 'ring-2 ring-primary-400/60 ' : ''
      }${
        isToday
          ? 'border-primary-300 ring-1 ring-primary-200 bg-surface'
          : isWeekend
            ? 'border-hairline bg-surface-2'
            : 'border-hairline bg-surface'
      }`}
    >
      <span className={`block font-semibold ${isToday ? 'text-primary-700' : isWeekend ? 'text-ink-4' : 'text-ink-2'}`}>
        <span aria-hidden="true">{label}</span>
        <span className="sr-only">
          {fullDate}
          {isToday ? ', today' : ''}
        </span>
      </span>
      {isLoading && (
        <span className="block text-ink-4 mt-1.5">
          <span aria-hidden="true">…</span>
          <span className="sr-only">, loading bookings</span>
        </span>
      )}
      {!isLoading && (
        <span className="sr-only">
          , {bookings.length === 0 ? 'no bookings' : `${bookings.length} booking${bookings.length === 1 ? '' : 's'}`}
          {bookings.length > 0 ? ':' : ''}
        </span>
      )}
      {!isLoading &&
        visible.map((b) => (
          <span
            key={b.id}
            className="block mt-1 truncate rounded-md border-l-2 border-primary-500 bg-info-bg text-info-fg px-1.5 py-1 leading-tight"
          >
            {toLabel(toMinutes(b.start))}–{toLabel(toMinutes(b.end))} · {roomName(rooms, b.room)}
            <span className="sr-only">;</span>
          </span>
        ))}
      {!isLoading && overflowCount > 0 && (
        <span className="block mt-1 px-1.5 text-[11px] font-medium text-ink-3">+{overflowCount} more</span>
      )}
      {!isLoading && bookings.length === 0 && !isWeekend && (
        <span className="block text-ink-4 mt-1.5" aria-hidden="true">
          —
        </span>
      )}
    </button>
  );
}
