import { apiFetch } from './client';
import type { BookingRequest } from '../types/api';

export function getMyRequests(token: string) {
  return apiFetch<{ requests: BookingRequest[] }>('api/my-requests', { token });
}

export function cancelRequest(id: string, token: string) {
  return apiFetch<{ id: string; status: string }>(`api/requests/${id}/cancel-request`, {
    method: 'POST',
    token,
  });
}

export function acceptCounterProposal(id: string, token: string) {
  return apiFetch<{ id: string; status: string }>(`api/requests/${id}/counter-proposal/accept`, {
    method: 'POST',
    token,
  });
}

export function declineCounterProposal(id: string, token: string) {
  return apiFetch<{ id: string; status: string }>(`api/requests/${id}/counter-proposal/decline`, {
    method: 'POST',
    token,
  });
}
