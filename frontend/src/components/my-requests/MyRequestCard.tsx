import { preferredRooms } from '../../lib/conflicts';
import type { BookingRequest } from '../../types/api';
import { StatusPill } from '../ui/StatusPill';

interface Props {
  request: BookingRequest;
  roomName: (id: string) => string;
  onOpen: () => void;
}

// Summary card — one grid cell. The whole card is a button that opens the
// detail modal (full info + status-scoped actions); it no longer inlines the
// cancel / counter-proposal controls, which now live in the modal.
//
// A button may only hold phrasing content, so the rows are block <span>s. Its
// accessible name is the card text in reading order (title, status, org/room,
// date/time); decorative glyphs are hidden and "↻" is read as "Recurring".
export function MyRequestCard({ request, roomName, onOpen }: Props) {
  const isRecurring = Boolean(request.seriesId);
  const needsAction = request.status === 'counter_proposed';
  // Until approved, request.room is only the 1st choice; staff assign the room.
  const preferences = preferredRooms(request);
  const roomLabel =
    request.status === 'approved' || request.status === 'cancellation_requested'
      ? roomName(request.room)
      : `Prefers ${roomName(preferences[0])}${preferences.length > 1 ? ` +${preferences.length - 1}` : ''}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex h-full w-full flex-col rounded-2xl border bg-surface p-4 text-left transition-shadow hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 ${
        needsAction ? 'border-amber-400' : 'border-hairline hover:border-hairline-strong'
      }`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate font-semibold text-sm text-ink">
          {isRecurring && (
            <>
              <span aria-hidden="true">↻ </span>
              <span className="sr-only">Recurring: </span>
            </>
          )}
          {request.title}
        </span>
        <StatusPill status={request.status} />
      </span>

      <span className="block mt-1 truncate text-xs text-ink-3">
        {request.org} · {roomLabel}
      </span>
      <span className="block text-xs text-ink-3">
        {request.date} · {request.start}–{request.end} · {request.attendance} attendees
      </span>

      {needsAction && (
        <span className="mt-2 inline-flex w-fit items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
          ACTION NEEDED — REVIEW COUNTER-PROPOSAL
        </span>
      )}

      <span className="mt-3 flex items-center justify-between gap-2 border-t border-hairline pt-2">
        <span className="min-w-0 break-all text-[11px] text-ink-4">
          Submitted {request.submittedAt.slice(0, 10)} · {request.id}
        </span>
        <span className="shrink-0 text-[11px] font-medium text-primary-600">
          View details<span aria-hidden="true"> →</span>
        </span>
      </span>
    </button>
  );
}
