export interface Room {
  id: string;
  name: string;
  floor: string;
  area: string;
  capacity: number;
  equipment: string[];
  setups: string[];
  restrictions: string[];
  emoji: string;
  // Present on every room returned by the admin listing; the public listing
  // (already active-only filtered server-side) omits inactive rooms entirely.
  active?: boolean;
  // Staff-only room: listed for staff views and the staff New Booking page,
  // filtered out of the public request form (and rejected on public submit).
  hidden?: boolean;
  /** Image URLs (e.g. from the existing CEC website), shown on the request form's room cards. */
  photos?: string[];
  openTime?: string;   // "HH:MM", defaults to "09:00"
  closeTime?: string;  // "HH:MM", defaults to "17:00"
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export type RequestStatus =
  | 'pending_approval'
  | 'approved'
  | 'denied'
  | 'counter_proposed'
  | 'cancellation_requested'
  | 'cancelled';

export interface CounterProposal {
  room: string;
  date: string;
  start: string;
  end: string;
  message: string;
}

export interface BookingRequest {
  id: string;
  site: string;
  // The assigned room once approved; until then, the requestor's 1st choice.
  room: string;
  // The requestor's 1st choice, set when staff approve into a different room.
  requestedRoom?: string | null;
  altRoom1?: string | null;
  altRoom2?: string | null;
  date: string;
  start: string;
  end: string;
  org: string;
  title: string;
  type: string;
  activityType: string;
  attendance: number;
  setupTime?: string | null;
  cleanupTime?: string | null;
  techNeeds: string[];
  notes?: string | null;
  minors: string;
  facilityRulesAccepted: boolean;
  firstname: string;
  lastname: string;
  email: string;
  phone?: string | null;
  status: RequestStatus;
  checkInStatus?: 'checked_in' | 'no_show' | null;
  checkInTime?: string | null;
  denyReason?: string | null;
  counterProposal?: CounterProposal | null;
  seriesId?: string | null;
  // Calendar invites (iCalendar to the CEC mailbox). calendarSequence is set
  // once a booking has been sent to the calendar; calendarInvite is notify's
  // record of the latest send.
  calendarSequence?: number | null;
  calendarInvite?: CalendarInviteResult | null;
  submittedAt: string;
  updatedAt: string;
}

export interface CalendarInviteResult {
  status: 'sent' | 'failed';
  method: 'REQUEST' | 'CANCEL';
  sequence: number;
  at: string;
  error?: string;
}

// requests_public.public_view's strict subset — only what an unauthenticated
// requestor tracking their own submission by id+email should see.
export interface PublicRequestStatus {
  id: string;
  site: string;
  room: string;
  date: string;
  start: string;
  end: string;
  title: string;
  status: RequestStatus;
  denyReason?: string | null;
  counterProposal?: CounterProposal | null;
}

export interface AvailabilityBooking {
  id: string;
  room: string;
  // The reserved window: setup + event + cleanup.
  start: string;
  end: string;
  // The event's own times; optional so an older deployed backend still type-checks.
  eventStart?: string;
  eventEnd?: string;
}

export type AvailabilityPending = Omit<AvailabilityBooking, 'id'>;

export interface AvailabilityResponse {
  site: string;
  date: string;
  bookings: AvailabilityBooking[];
  // pending_approval requests (no slot lock yet); optional so an older
  // deployed backend without the field still type-checks at runtime.
  pending?: AvailabilityPending[];
}

export interface RecurringInput {
  enabled: boolean;
  pattern?: 'weekly' | 'biweekly' | 'monthly';
  days?: string[];
  seriesStart?: string;
  endMode?: 'count' | 'date';
  endVal?: string | number;
}

export interface SubmitRequestInput {
  firstname: string;
  lastname: string;
  email: string;
  phone?: string;
  org: string;
  title: string;
  activityType: string;
  type: string;
  site: string;
  room: string;
  altRoom1?: string;
  altRoom2?: string;
  date: string;
  start: string;
  end: string;
  attendance: number;
  setupTime?: string;
  cleanupTime?: string;
  techNeeds?: string[];
  notes?: string;
  minors: 'no' | 'yes' | 'maybe';
  facilityRulesAccepted: boolean;
  recurring?: RecurringInput;
}

export interface SubmitRequestResponse {
  id: string;
  seriesId: string | null;
  occurrences: string[];
}

export interface AdminSitesSummary {
  sites: Record<string, Record<string, number>>;
}

// rooms_admin/handler.py's Sites-table row shape — the live source of truth for
// which sites exist. frontend/src/config/sites.ts's static SITES map is only a
// label/color fallback.
export interface Site {
  id: string;
  label: string;
  color: string;
  active: boolean;
  /** Most occurrences a repeating request may have at this site; absent = no site limit. */
  maxOccurrences?: number;
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
}
