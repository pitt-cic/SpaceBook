import { apiFetch, buildUrl } from './client';

export interface CalendarToken {
  // null until the caller creates their first link.
  token: string | null;
}

export function getCalendarToken(token: string) {
  return apiFetch<CalendarToken>('api/calendar/token', { token });
}

// Creates the caller's link, or replaces it (the old URL stops working).
export function resetCalendarToken(token: string) {
  return apiFetch<{ token: string }>('api/calendar/token', { method: 'POST', token });
}

// The public .ics URL Outlook subscribes to. `site` narrows it to one site;
// omitted, it covers every site the account can staff.
export function calendarFeedUrl(feedToken: string, site?: string) {
  return buildUrl(`api/calendar/feed/${feedToken}.ics`, { site });
}
