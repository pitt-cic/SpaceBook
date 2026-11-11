import { toLabel, toMinutes } from '../../lib/availability';
import type { AvailabilityBooking, Room } from '../../types/api';

interface Props {
  date: Date;
  bookings: AvailabilityBooking[];
  rooms: Room[];
  roomFilter: string;
  isToday: boolean;
  isCurrentMonth: boolean;
  isLoading: boolean;
  // Whether this day is the one the timeline panel below is showing.
  isSelected: boolean;
  onSelect: () => void;
}

const MAX_VISIBLE = 3;

function roomName(rooms: Room[], roomId: string): string {
  return rooms.find((r) => r.id === roomId)?.name ?? roomId;
}

// Same accessible-button approach as CalendarDayColumn: the visible day number
// is replaced for screen readers by the full date plus the booking count and
// the visible bookings, since the month grid has no weekday header to read.
export function CalendarMonthDayCell({
  date,
  bookings,
  rooms,
  roomFilter,
  isToday,
  isCurrentMonth,
  isLoading,
  isSelected,
  onSelect,
}: Props) {
  const filtered = bookings
    .filter((b) => !roomFilter || b.room === roomFilter)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const visible = filtered.slice(0, MAX_VISIBLE);
  const overflowCount = filtered.length - visible.length;
  const fullDate = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      aria-current={isToday ? 'date' : undefined}
      className={`w-full h-full text-left align-top rounded-xl border p-1.5 min-h-[92px] text-[11px] cursor-pointer transition hover:border-primary-300 hover:ring-1 hover:ring-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-400/40 ${
        isSelected ? 'ring-2 ring-primary-400/60 ' : ''
      }${isToday ? 'border-primary-300 ring-1 ring-primary-200' : 'border-hairline'} ${
        isCurrentMonth ? 'bg-surface' : 'bg-surface-2'
      }`}
    >
      <span
        className={`font-semibold ${
          isToday
            ? 'inline-flex items-center justify-center w-5 h-5 rounded-md bg-primary-600 text-white'
            : isCurrentMonth
              ? 'block text-ink-2'
              : 'block text-ink-4'
        }`}
      >
        <span aria-hidden="true">{date.getDate()}</span>
        <span className="sr-only">
          {fullDate}
          {isToday ? ', today' : ''}
        </span>
      </span>
      {isLoading && (
        <span className="block text-ink-4 mt-0.5">
          <span aria-hidden="true">…</span>
          <span className="sr-only">, loading bookings</span>
        </span>
      )}
      {!isLoading && (
        <span className="sr-only">
          , {filtered.length === 0 ? 'no bookings' : `${filtered.length} booking${filtered.length === 1 ? '' : 's'}`}
          {filtered.length > 0 ? ':' : ''}
        </span>
      )}
      {!isLoading &&
        visible.map((b) => (
          <span
            key={b.id}
            className={`block mt-0.5 truncate rounded px-1 py-0.5 ${
              isCurrentMonth ? 'bg-info-bg text-info-fg' : 'bg-neu-bg text-ink-4'
            }`}
          >
            {toLabel(toMinutes(b.start))} · {roomName(rooms, b.room)}
            <span className="sr-only">;</span>
          </span>
        ))}
      {!isLoading && overflowCount > 0 && <span className="block mt-0.5 text-ink-4">+{overflowCount} more</span>}
    </button>
  );
}
