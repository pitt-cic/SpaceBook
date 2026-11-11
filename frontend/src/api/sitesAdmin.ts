import { apiFetch } from './client';
import type { Site } from '../types/api';

export interface SiteInput {
  label: string;
  color?: string;
  /** null clears the site's limit. */
  maxOccurrences?: number | null;
}

export type UpdateSiteInput = Partial<SiteInput> & { active?: boolean };

// Public — no authorizer on this route, so no token is passed.
export function listSites() {
  return apiFetch<{ sites: Site[] }>('api/sites');
}

export function createSite(input: SiteInput, token: string) {
  return apiFetch<Site>('api/sites', { method: 'POST', body: input, token });
}

export function updateSite(site: string, input: UpdateSiteInput, token: string) {
  return apiFetch<Site>(`api/sites/${site}`, { method: 'PUT', body: input, token });
}
