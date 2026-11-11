import { apiFetch } from './client';
import type { AvailabilityResponse, PublicRequestStatus, SubmitRequestInput, SubmitRequestResponse } from '../types/api';

export function getAvailability(site: string, date: string) {
  return apiFetch<AvailabilityResponse>(`api/sites/${site}/availability`, { params: { date } });
}

export function submitRequest(body: SubmitRequestInput) {
  return apiFetch<SubmitRequestResponse>('api/requests', { method: 'POST', body });
}

export function getRequestStatus(id: string, email: string) {
  return apiFetch<PublicRequestStatus>(`api/requests/${id}/status`, { params: { email } });
}
