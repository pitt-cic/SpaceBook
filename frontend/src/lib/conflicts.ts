import type { BookingRequest } from '../types/api';
import { reservedWindow, toMinutes } from './availability';

// A pure client-side cross-reference within an already-fetched site request
// list — no extra API call. Mirrors what requests_staff.approve_request's
// transactional slot-lock actually enforces server-side (backend/lambda/
// requests_staff/handler.py), surfaced here at read time so staff see it
// before attempting to approve (mockup Screen 6's "read-time conflict check").
// Compares reserved windows (setup + event + cleanup), as the slot locks do.
// The requestor's ranked room preferences. `room` is the 1st choice until staff
// approve into another room, which moves it to `requestedRoom`.
export function preferredRooms(request: BookingRequest): string[] {
  const ids = [request.requestedRoom ?? request.room, request.altRoom1, request.altRoom2];
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

// Labels for preference rank 0..2 ("1st choice", …).
export const PREFERENCE_ORDINALS = ['1st', '2nd', '3rd'];

// "1. Room A · 2. Room B" — or just the name when there's a single preference.
export function formatPreferences(ids: string[], roomName: (id: string) => string): string {
  return ids.length === 1 ? roomName(ids[0]) : ids.map((id, i) => `${i + 1}. ${roomName(id)}`).join(' · ');
}

// The approved booking a pending request would collide with in roomId, if any.
export function findRoomConflict(
  request: BookingRequest,
  roomId: string,
  all: BookingRequest[],
): BookingRequest | undefined {
  return findConflictingApproved({ ...request, room: roomId }, all);
}

export function findConflictingApproved(
  request: BookingRequest,
  all: BookingRequest[],
): BookingRequest | undefined {
  const mine = reservedWindow(request);
  return all.find((other) => {
    if (other.id === request.id || other.status !== 'approved' || other.room !== request.room || other.date !== request.date) {
      return false;
    }
    const theirs = reservedWindow(other);
    return toMinutes(theirs.start) < toMinutes(mine.end) && toMinutes(mine.start) < toMinutes(theirs.end);
  });
}
