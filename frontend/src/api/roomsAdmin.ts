import { apiFetch } from './client';
import type { Room } from '../types/api';

export interface RoomInput {
  name: string;
  floor?: string;
  area?: string;
  capacity?: number;
  equipment?: string[];
  setups?: string[];
  restrictions?: string[];
  emoji?: string;
  hidden?: boolean;
  photos?: string[];
}

export type UpdateRoomInput = Partial<RoomInput> & { active?: boolean };

export function listAllRooms(site: string, token: string) {
  return apiFetch<{ site: string; rooms: Room[] }>(`api/admin/sites/${site}/rooms`, { token });
}

export function createRoom(site: string, input: RoomInput, token: string) {
  return apiFetch<Room>(`api/sites/${site}/rooms`, { method: 'POST', body: input, token });
}

export function updateRoom(site: string, roomId: string, input: UpdateRoomInput, token: string) {
  return apiFetch<Room>(`api/sites/${site}/rooms/${roomId}`, { method: 'PUT', body: input, token });
}

export interface PhotoUpload {
  upload: { url: string; fields: Record<string, string> };
  photoUrl: string;
}

export function createPhotoUpload(site: string, contentType: string, token: string) {
  return apiFetch<PhotoUpload>(`api/admin/sites/${site}/room-photos`, { method: 'POST', body: { contentType }, token });
}

// Presigned S3 POST: policy fields first, file last (S3 ignores fields after it).
export async function uploadPhoto({ upload }: PhotoUpload, file: Blob) {
  const form = new FormData();
  Object.entries(upload.fields).forEach(([k, v]) => form.append(k, v));
  form.append('file', file);
  const res = await fetch(upload.url, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}
