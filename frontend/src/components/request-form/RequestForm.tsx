import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useAvailability } from '../../hooks/useAvailability';
import { useRooms } from '../../hooks/useRooms';
import { useNow } from '../../hooks/useNow';
import { bufferMinutes, passedBefore, toMinutes } from '../../lib/availability';
import { equipmentOptions, matchRooms, siteHours } from '../../lib/roomMatching';
import type { Site, SubmitRequestInput } from '../../types/api';
import { INITIAL_REQUEST_FORM_STATE, type RequestFormState } from '../../types/requestForm';
import { Button } from '../ui/Button';
import { ContactFields } from './ContactFields';
import { EventDetailsFields } from './EventDetailsFields';
import { RoomPicker } from './RoomPicker';
import { WhenAndNeedsFields } from './WhenAndNeedsFields';

const RECUR_INTERVAL_DAYS: Record<RequestFormState['recurPattern'], number> = { weekly: 7, biweekly: 14, monthly: 30 };

// How many dates the series will have — mirrors requests_public's
// generate_occurrence_dates so the site's repeat limit is caught before submit.
function countOccurrences(form: RequestFormState): number {
  if (form.recurEndMode === 'count') return Number(form.recurCount) || 0;
  const start = Date.parse(form.recurStart || form.date);
  const end = Date.parse(form.recurEndDate);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  const intervalMs = RECUR_INTERVAL_DAYS[form.recurPattern] * 24 * 60 * 60 * 1000;
  return Math.floor((end - start) / intervalMs) + 1;
}

function getPicks(form: RequestFormState): string[] {
  return [form.room, form.altRoom1, form.altRoom2].filter(Boolean);
}

function picksToFields(ids: string[]): Pick<RequestFormState, 'room' | 'altRoom1' | 'altRoom2'> {
  return { room: ids[0] ?? '', altRoom1: ids[1] ?? '', altRoom2: ids[2] ?? '' };
}

function buildSubmitInput(form: RequestFormState): SubmitRequestInput {
  return {
    firstname: form.firstname.trim(),
    lastname: form.lastname.trim(),
    email: form.email.trim(),
    phone: form.phone.trim() || undefined,
    org: form.org.trim(),
    title: form.title.trim(),
    activityType: form.activityType,
    type: form.type,
    site: form.site,
    room: form.room,
    altRoom1: form.altRoom1 || undefined,
    altRoom2: form.altRoom2 || undefined,
    date: form.date,
    start: form.start,
    end: form.end,
    attendance: Number(form.attendance),
    setupTime: form.setupTime === 'None' ? undefined : form.setupTime,
    cleanupTime: form.cleanupTime === 'None' ? undefined : form.cleanupTime,
    techNeeds: form.techNeeds,
    notes: form.notes.trim() || undefined,
    minors: form.minors,
    facilityRulesAccepted: form.facilityRulesAccepted,
    recurring: form.recurringEnabled
      ? {
          enabled: true,
          pattern: form.recurPattern,
          days: form.recurDays,
          seriesStart: form.recurStart || form.date,
          endMode: form.recurEndMode,
          endVal: form.recurEndMode === 'count' ? Number(form.recurCount) : form.recurEndDate,
        }
      : undefined,
  };
}

interface RequestFormProps {
  sites: Site[];
  sitesLoading: boolean;
  /**
   * Staff booking mode (StaffBookingPage): hidden rooms are offered, exactly
   * one room is picked (the booking is approved into it), and the site's
   * public repeat limit and the requestor's facility-rules agreement are
   * skipped.
   */
  staff?: boolean;
  submitLabel: string;
  isSubmitting: boolean;
  submitError?: string;
  onSubmit: (input: SubmitRequestInput, form: RequestFormState, roomLabel: string) => Promise<void>;
}

// The public request form's fields, validation, and submit button — shared by
// RequestFormPage (public) and StaffBookingPage (staff shell).
export function RequestForm({ sites, sitesLoading, staff = false, submitLabel, isSubmitting, submitError, onSubmit }: RequestFormProps) {
  const [form, setForm] = useState<RequestFormState>(INITIAL_REQUEST_FORM_STATE);
  const [validationError, setValidationError] = useState<string | null>(null);
  // Bumped on every submit attempt that ends in an error, so focus moves to the
  // error message even when the message text is unchanged (WCAG 3.3.1).
  const [errorAttempt, setErrorAttempt] = useState(0);
  const errorRef = useRef<HTMLDivElement>(null);
  const { data: roomsData } = useRooms(form.site || undefined);

  const rooms = useMemo(() => {
    const allRooms = roomsData?.rooms ?? [];
    return staff ? allRooms : allRooms.filter((r) => !r.hidden);
  }, [roomsData, staff]);
  const maxOccurrences = staff ? undefined : sites.find((s) => s.id === form.site)?.maxOccurrences;
  const maxPicks = staff ? 1 : 3;
  const techOptions = equipmentOptions(rooms);
  const hours = siteHours(rooms);

  const availability = useAvailability(form.site, form.date || null);
  const now = useNow();
  const attendance = Number(form.attendance);
  const criteriaReady = Boolean(form.date && form.start && form.end && attendance > 0);
  const matchResult = useMemo(
    () =>
      criteriaReady
        ? matchRooms(
            rooms,
            {
              start: form.start,
              end: form.end,
              attendance,
              setupMinutes: bufferMinutes(form.setupTime),
              cleanupMinutes: bufferMinutes(form.cleanupTime),
              techNeeds: form.techNeeds,
            },
            availability.data,
          )
        : null,
    [criteriaReady, rooms, form.start, form.end, attendance, form.setupTime, form.cleanupTime, form.techNeeds, availability.data],
  );
  const picks = getPicks(form);

  // Drop picked rooms that no longer fit after step 1 changes. Skipped while
  // step 1 is incomplete (e.g. End cleared by a new Start) so picks survive
  // a momentary gap.
  useEffect(() => {
    if (!matchResult) return;
    const matchIds = new Set(matchResult.matches.map((m) => m.room.id));
    setForm((prev) => {
      const current = getPicks(prev);
      const kept = current.filter((id) => matchIds.has(id));
      return kept.length === current.length ? prev : { ...prev, ...picksToFields(kept) };
    });
  }, [matchResult]);

  useEffect(() => {
    if (sites.length > 0 && !form.site) {
      setForm((prev) => ({ ...prev, site: sites[0].id }));
    }
  }, [sites, form.site]);

  function onChange<K extends keyof RequestFormState>(key: K, value: RequestFormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'site') {
        Object.assign(next, picksToFields([]));
        // Tech options come from the site's rooms.
        next.techNeeds = [];
      }
      // The End picker only lists times after Start; drop an End it no longer offers.
      if (key === 'start' && next.end && next.end <= next.start) {
        next.end = '';
      }
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate();
    setValidationError(error);
    if (error) {
      setErrorAttempt((n) => n + 1);
      return;
    }
    const roomLabel = picks.map((id) => rooms.find((r) => r.id === id)?.name ?? id).join(', ');
    await onSubmit(buildSubmitInput(form), form, roomLabel);
  }

  function validate(): string | null {
    if (!form.site) {
      return 'Please select a site.';
    }
    const firstDate = form.recurringEnabled && form.recurStart ? form.recurStart : form.date;
    if (form.start && toMinutes(form.start) < passedBefore(firstDate, now)) {
      return 'That start time has already passed. Please choose a later time or date.';
    }
    if (picks.length === 0) {
      return staff ? 'Please choose a room.' : 'Please choose at least one room.';
    }
    if (!form.activityType) {
      return 'Please choose a type for your event.';
    }
    if (!form.type) {
      return "Please choose who's involved in your event.";
    }
    if (form.recurringEnabled && maxOccurrences && countOccurrences(form) > maxOccurrences) {
      return `This site allows at most ${maxOccurrences} occurrences for a repeating request.`;
    }
    if (form.minors !== 'no' && !form.minorsCompliance) {
      return 'Please confirm compliance with the Working with Minors policy.';
    }
    if (!staff && !form.facilityRulesAccepted) {
      return 'You must agree to the CEC Facility Use Rules and Requirements.';
    }
    return null;
  }

  const formError = validationError || submitError;

  // Move focus to the error (and scroll it into view) after a failed submit;
  // the alert role also announces it. Server errors arrive via submitError.
  useEffect(() => {
    if (errorAttempt > 0) errorRef.current?.focus();
  }, [errorAttempt]);
  useEffect(() => {
    if (submitError) errorRef.current?.focus();
  }, [submitError]);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <WhenAndNeedsFields
        form={form}
        onChange={onChange}
        sites={sites}
        sitesLoading={sitesLoading}
        techOptions={techOptions}
        openMinutes={hours.open}
        closeMinutes={hours.close}
        maxOccurrences={maxOccurrences}
        rooms={rooms}
        availability={availability.data}
        now={now}
      />
      <RoomPicker
        date={form.date}
        result={matchResult}
        availabilityLoading={availability.isLoading}
        availabilityError={availability.isError}
        techNeeds={form.techNeeds}
        picks={picks}
        maxPicks={maxPicks}
        onPicksChange={(ids) => setForm((prev) => ({ ...prev, ...picksToFields(ids) }))}
      />
      <EventDetailsFields form={form} onChange={onChange} />
      <ContactFields form={form} onChange={onChange} />

      {!staff && (
        <label className="flex items-start gap-2 text-sm text-ink-2 px-1">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.facilityRulesAccepted}
            onChange={(e) => onChange('facilityRulesAccepted', e.target.checked)}
          />
          <span>
            I agree to the{' '}
            <a
              href="https://www.cec.pitt.edu/CECUseRequirements"
              target="_blank"
              rel="noreferrer"
              className="underline text-primary-600"
            >
              CEC Facility Use Rules and Requirements<span className="sr-only"> (opens in a new tab)</span>
            </a>
            .
          </span>
        </label>
      )}

      {formError && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="p-3 rounded-xl bg-err-bg border border-red-200 focus:outline-none">
          <p className="text-sm text-err-fg">{formError}</p>
        </div>
      )}
      <div className="flex justify-end">
        <div className="w-full sm:w-44">
          <Button type="submit" isLoading={isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
