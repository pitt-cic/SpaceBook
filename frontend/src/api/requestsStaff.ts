import { apiFetch } from './client';
import type {
  AdminSitesSummary,
  BookingRequest,
  CounterProposal,
  SubmitRequestInput,
  SubmitRequestResponse,
} from '../types/api';

export interface SiteRequestsFilters {
  [key: string]: string | undefined;
  status?: string;
  room?: string;
  type?: string;
  date?: string;
}

export interface ModifyRequestInput {
  room?: string;
  date?: string;
  start?: string;
  end?: string;
  message?: string;
}

// `site` is only meaningful for an `admin` caller with no site membership of
// their own — it hints load_authorized_request() which site's GSI2 partition
// to search (backend/lambda/requests_staff/handler.py). staff-<site> callers
// can omit it; the Lambda scopes to their own site regardless.
export function listSiteRequests(site: string, filters: SiteRequestsFilters, token: string) {
  return apiFetch<{ requests: BookingRequest[] }>(`api/sites/${site}/requests`, {
    params: filters,
    token,
  });
}

// Staff-created booking: approved on creation (slot locks taken immediately),
// hidden rooms allowed. 409 if any occurrence overlaps an existing booking.
export function createBooking(site: string, input: SubmitRequestInput, token: string) {
  return apiFetch<SubmitRequestResponse>(`api/sites/${site}/requests`, { method: 'POST', body: input, token });
}

export function getRequest(id: string, token: string, site?: string) {
  return apiFetch<BookingRequest>(`api/requests/${id}`, { params: { site }, token });
}

// room: the room staff assign (any active room at the site); omitted, the
// request is approved into the requestor's 1st choice.
export function approveRequest(id: string, token: string, site?: string, room?: string) {
  return apiFetch<{ id: string; status: string; room: string }>(`api/requests/${id}/approve`, {
    method: 'POST',
    body: room ? { room } : undefined,
    params: { site },
    token,
  });
}

export function denyRequest(id: string, reason: string, token: string, site?: string) {
  return apiFetch<{ id: string; status: string }>(`api/requests/${id}/deny`, {
    method: 'POST',
    body: { reason },
    params: { site },
    token,
  });
}

export function modifyRequest(id: string, proposal: ModifyRequestInput, token: string, site?: string) {
  return apiFetch<{ id: string; status: string; counterProposal: CounterProposal }>(
    `api/requests/${id}/modify`,
    { method: 'POST', body: proposal, params: { site }, token },
  );
}

// Re-queues the calendar invite for the booking's current state (same UID and
// SEQUENCE, so the mailbox treats a repeat as the same message).
export function resendInvite(id: string, token: string, site?: string) {
  return apiFetch<{ id: string; method: string; sequence: number }>(`api/requests/${id}/resend-invite`, {
    method: 'POST',
    params: { site },
    token,
  });
}

export function confirmCancellation(id: string, token: string, site?: string) {
  return apiFetch<{ id: string; status: string }>(`api/requests/${id}/confirm-cancellation`, {
    method: 'POST',
    params: { site },
    token,
  });
}

export function rejectCancellation(id: string, token: string, site?: string) {
  return apiFetch<{ id: string; status: string }>(`api/requests/${id}/reject-cancellation`, {
    method: 'POST',
    params: { site },
    token,
  });
}

export function checkIn(id: string, token: string) {
  return apiFetch<{ id: string; checkInStatus: string; checkInTime: string }>(
    `api/requests/${id}/checkin`,
    { method: 'POST', token },
  );
}

export function markNoShow(id: string, token: string) {
  return apiFetch<{ id: string; checkInStatus: string }>(
    `api/requests/${id}/no-show`,
    { method: 'POST', token },
  );
}

export function undoCheckin(id: string, token: string) {
  return apiFetch<{ id: string }>(
    `api/requests/${id}/undo-checkin`,
    { method: 'POST', token },
  );
}

// GET /api/admin/sites — despite the path, this is scoped server-side to
// whichever sites the caller belongs to (backend/lambda/requests_staff/handler.py's
// sites_summary/dashboard_sites): every active site for an admin
// caller, or just the caller's own staff-<site>/checkin-<site> sites
// otherwise. Backs the Dashboard page for every role, not just admin.
export function sitesSummary(token: string) {
  return apiFetch<AdminSitesSummary>('api/admin/sites', { token });
}
