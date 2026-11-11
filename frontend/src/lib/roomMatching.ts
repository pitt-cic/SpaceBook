import type { AvailabilityResponse, Room } from '../types/api';
import { DAY_END, DAY_START, toMinutes } from './availability';

export interface RoomCriteria {
  start: string;
  end: string;
  attendance: number;
  setupMinutes: number;
  cleanupMinutes: number;
  techNeeds: string[];
}

export type RoomExclusion = 'capacity' | 'tech' | 'hours' | 'booked';

export interface RoomMatch {
  room: Room;
  /** A pending_approval request overlaps the buffered window (no slot lock yet). */
  pending: boolean;
}

export interface RoomMatchResult {
  matches: RoomMatch[];
  /** Rooms left out, counted under the first criterion each one failed. */
  excluded: Record<RoomExclusion, number>;
}

// The tech checklist is whatever equipment the site's rooms actually list, so
// every option can match at least one room.
export function equipmentOptions(rooms: Room[]): string[] {
  return [...new Set(rooms.flatMap((r) => r.equipment))].sort((a, b) => a.localeCompare(b));
}

// Widest open/close span across the site's rooms, for the Start/End pickers
// (shown before any room is chosen).
export function siteHours(rooms: Room[]): { open: number; close: number } {
  if (rooms.length === 0) return { open: DAY_START, close: DAY_END };
  return {
    open: Math.min(...rooms.map((r) => toMinutes(r.openTime ?? '09:00'))),
    close: Math.max(...rooms.map((r) => toMinutes(r.closeTime ?? '17:00'))),
  };
}

// Rooms that fit the headcount, have every requested piece of tech, and are
// open and free (no approved booking) for the whole reserved window
// [start − setup, end + cleanup]. Availability bookings are already reserved
// windows. `availability` undefined (loading/failed) skips the booked check.
// Best fit (smallest capacity) first.
export function matchRooms(rooms: Room[], criteria: RoomCriteria, availability?: AvailabilityResponse): RoomMatchResult {
  const excluded: Record<RoomExclusion, number> = { capacity: 0, tech: 0, hours: 0, booked: 0 };
  const windowStart = toMinutes(criteria.start) - criteria.setupMinutes;
  const windowEnd = toMinutes(criteria.end) + criteria.cleanupMinutes;
  const overlaps = (b: { room: string; start: string; end: string }, roomId: string) =>
    b.room === roomId && toMinutes(b.start) < windowEnd && windowStart < toMinutes(b.end);

  const matches: RoomMatch[] = [];
  for (const room of rooms) {
    if (room.capacity < criteria.attendance) {
      excluded.capacity++;
    } else if (!criteria.techNeeds.every((t) => room.equipment.includes(t))) {
      excluded.tech++;
    } else if (windowStart < toMinutes(room.openTime ?? '09:00') || windowEnd > toMinutes(room.closeTime ?? '17:00')) {
      excluded.hours++;
    } else if (availability?.bookings.some((b) => overlaps(b, room.id))) {
      excluded.booked++;
    } else {
      matches.push({ room, pending: (availability?.pending ?? []).some((p) => overlaps(p, room.id)) });
    }
  }
  matches.sort((a, b) => a.room.capacity - b.room.capacity || a.room.name.localeCompare(b.room.name));
  return { matches, excluded };
}
