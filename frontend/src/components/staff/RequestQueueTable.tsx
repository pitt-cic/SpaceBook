import { findRoomConflict, preferredRooms } from '../../lib/conflicts';
import type { BookingRequest, Room } from '../../types/api';
import { StatusPill } from '../ui/StatusPill';

interface Props {
  requests: BookingRequest[];
  allRequests: BookingRequest[];
  rooms: Room[];
  onView: (id: string) => void;
}

function roomName(rooms: Room[], roomId: string): string {
  return rooms.find((r) => r.id === roomId)?.name ?? roomId;
}

export function RequestQueueTable({ requests, allRequests, rooms, onView }: Props) {
  if (requests.length === 0) {
    return (
      <div className="rounded-2xl border border-hairline bg-surface py-10 text-center text-sm text-ink-3">
        No requests match these filters.
      </div>
    );
  }

  return (
    <div className="relative overflow-x-auto rounded-2xl border border-hairline bg-surface">
      <table className="w-full text-[13px]">
        <caption className="sr-only">Booking requests ({requests.length})</caption>
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
            <th scope="col" className="font-semibold px-4 py-2.5 border-b border-hairline">Request</th>
            <th scope="col" className="font-semibold px-4 py-2.5 border-b border-hairline">Event</th>
            <th scope="col" className="font-semibold px-4 py-2.5 border-b border-hairline whitespace-nowrap">Date &amp; time</th>
            <th scope="col" className="font-semibold px-4 py-2.5 border-b border-hairline">Room</th>
            <th scope="col" className="font-semibold px-4 py-2.5 border-b border-hairline text-center">
              <span aria-hidden="true">Att.</span>
              <span className="sr-only">Attendance</span>
            </th>
            <th scope="col" className="font-semibold px-4 py-2.5 border-b border-hairline">Status</th>
            <th scope="col" className="px-4 py-2.5 border-b border-hairline">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => {
            const pending = request.status === 'pending_approval';
            const preferences = preferredRooms(request);
            // Staff can assign any free preference, so it's only a conflict when none is free.
            const conflict = pending && preferences.every((id) => findRoomConflict(request, id, allRequests));
            return (
              <tr key={request.id} className="hover:bg-surface-2 border-b border-hairline last:border-b-0">
                <th scope="row" className="px-4 py-3 align-middle text-left font-normal">
                  <div className="font-semibold text-ink">{request.org}</div>
                  <div className="text-[11.5px] text-ink-4 flex flex-wrap items-center gap-1.5 mt-0.5">
                    <span className="font-mono">{request.id}</span>
                    {conflict && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-warn-bg text-warn-fg font-semibold px-1.5 py-0.5 text-[10.5px]">
                        <span aria-hidden="true">⚠</span> conflict
                        <span className="sr-only">: none of the requested rooms is free</span>
                      </span>
                    )}
                    {request.seriesId && (
                      <span className="inline-flex items-center gap-0.5">
                        <span aria-hidden="true">↻</span> recurring
                      </span>
                    )}
                  </div>
                </th>
                <td className="px-4 py-3 align-middle text-ink-2">{request.title}</td>
                <td className="px-4 py-3 align-middle whitespace-nowrap text-ink-2">{request.date}</td>
                <td className="px-4 py-3 align-middle text-ink-2">
                  {roomName(rooms, request.room)}
                  {pending && preferences.length > 1 && (
                    <span className="text-ink-4" title={preferences.map((id) => roomName(rooms, id)).join(', ')}>
                      {' '}
                      <span aria-hidden="true">+{preferences.length - 1}</span>
                      <span className="sr-only">
                        (also requested: {preferences.slice(1).map((id) => roomName(rooms, id)).join(', ')})
                      </span>
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 align-middle text-center text-ink-2">{request.attendance}</td>
                <td className="px-4 py-3 align-middle">
                  <StatusPill status={request.status} />
                </td>
                <td className="px-4 py-3 align-middle text-right">
                  <button
                    type="button"
                    onClick={() => onView(request.id)}
                    className="text-[12px] font-medium text-primary-600 border border-field rounded-lg px-3 py-1.5 hover:border-primary-400 hover:bg-primary-50"
                  >
                    Review<span className="sr-only">: {request.title}, {request.org}</span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
