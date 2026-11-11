import { apiFetch } from './client';

export interface StaffMember {
  username: string;
  email: string;
  enabled: boolean;
  status: string;
  groups: string[];
}

export interface StaffRoster {
  staff: StaffMember[];
  availableGroups: string[];
}

export function listStaff(token: string) {
  return apiFetch<StaffRoster>('api/admin/staff', { token });
}

export function setStaffGroups(username: string, groups: string[], token: string) {
  return apiFetch<{ username: string; groups: string[] }>(
    `api/admin/staff/${encodeURIComponent(username)}/groups`,
    { method: 'PUT', body: { groups }, token },
  );
}

// Creates a staff (never admin) account; Cognito emails it a temporary password.
export function createStaff(email: string, groups: string[], token: string) {
  return apiFetch<StaffMember>('api/admin/staff', { method: 'POST', body: { email, groups }, token });
}
