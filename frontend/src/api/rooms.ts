import { apiFetch } from './client';
import type { Room } from '../types/api';

export function listRooms(site: string) {
  return apiFetch<{ site: string; rooms: Room[] }>(`api/sites/${site}/rooms`);
}
