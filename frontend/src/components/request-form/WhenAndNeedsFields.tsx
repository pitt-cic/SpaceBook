import type { AvailabilityResponse, Room, Site } from '../../types/api';
import { passedBefore, reservedLabel, toMinutes } from '../../lib/availability';
import { toISODate } from '../../lib/dates';
import type { RequestFormState } from '../../types/requestForm';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { DayAvailabilityStrip } from './DayAvailabilityStrip';
import { FormSection } from './FormSection';
import { RecurringFields } from './RecurringFields';

interface Props {
  form: RequestFormState;
  onChange: <K extends keyof RequestFormState>(key: K, value: RequestFormState[K]) => void;
  sites: Site[];
  sitesLoading: boolean;
  /** Equipment listed by the site's rooms — the tech checklist's options. */
  techOptions: string[];
  /** Widest open/close span across the site's rooms, in minutes. */
  openMinutes: number;
  closeMinutes: number;
  maxOccurrences?: number;
  rooms: Room[];
  availability?: AvailabilityResponse;
  now: Date;
}

const SETUP_OPTIONS = ['None', '15 min', '30 min', '45 min', '1 hour'];
const CLEANUP_OPTIONS = ['None', '15 min', '30 min'];

function buildTimeOptions(openMin: number, closeMin: number) {
  return Array.from({ length: (closeMin - openMin) / 30 + 1 }, (_, i) => {
    const mins = openMin + i * 30;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const label = `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    return { value, label };
  });
}

function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

// Step 1: everything the room list is filtered on (date, time, headcount,
// tech, setup/cleanup buffers), plus the repeat schedule.
export function WhenAndNeedsFields({
  form,
  onChange,
  sites,
  sitesLoading,
  techOptions,
  openMinutes,
  closeMinutes,
  maxOccurrences,
  rooms,
  availability,
  now,
}: Props) {
  const timeOptions = buildTimeOptions(openMinutes, closeMinutes);
  const today = toISODate(now);
  const passed = passedBefore(form.date, now);
  const reserved = form.start && form.end ? reservedLabel(form) : '';

  return (
    <FormSection step={1} title="When & what you need">
      <div className="grid sm:grid-cols-2 gap-3">
        <Select
          label="Site"
          value={form.site}
          onChange={(e) => onChange('site', e.target.value)}
          disabled={sitesLoading || sites.length === 0}
        >
          {sitesLoading && <option value="">Loading sites…</option>}
          {!sitesLoading && sites.length === 0 && <option value="">No sites available</option>}
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.label}
            </option>
          ))}
        </Select>
        <Input label="Date" type="date" required min={today} value={form.date} onChange={(e) => onChange('date', e.target.value)} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
        <Select label="Start" required value={form.start} onChange={(e) => onChange('start', e.target.value)}>
          <option value="">Select time</option>
          {timeOptions.slice(0, -1).map((t) => {
            const isPast = toMinutes(t.value) < passed;
            return (
              <option key={t.value} value={t.value} disabled={isPast}>
                {isPast ? `${t.label} (passed)` : t.label}
              </option>
            );
          })}
        </Select>
        <Select label="End" required value={form.end} onChange={(e) => onChange('end', e.target.value)}>
          <option value="">Select time</option>
          {timeOptions.filter((t) => !form.start || t.value > form.start).map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <div className="col-span-2 sm:col-span-1">
          <Input
            label="People"
            type="number"
            min={1}
            required
            value={form.attendance}
            onChange={(e) => onChange('attendance', e.target.value)}
          />
        </div>
        <Select label="Setup time" value={form.setupTime} onChange={(e) => onChange('setupTime', e.target.value)}>
          {SETUP_OPTIONS.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </Select>
        <Select label="Cleanup time" value={form.cleanupTime} onChange={(e) => onChange('cleanupTime', e.target.value)}>
          {CLEANUP_OPTIONS.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </Select>
      </div>
      {/* Live so a screen reader hears the reserved window update as times and buffers change. */}
      <p className="mt-2 text-xs text-ink-3 empty:hidden" aria-live="polite">
        {reserved && `The room will be reserved ${reserved}.`}
      </p>
      {form.date && (
        <DayAvailabilityStrip
          rooms={rooms}
          availability={availability}
          openMinutes={openMinutes}
          closeMinutes={closeMinutes}
          passedBefore={passed}
          nowMinutes={form.date === today ? passed : null}
          start={form.start}
          end={form.end}
        />
      )}

      {techOptions.length > 0 && (
        <fieldset className="mt-4">
          <legend className="text-xs font-medium text-ink-2 mb-1.5">Tech needs</legend>
          <div className="flex flex-wrap gap-2">
            {techOptions.map((option) => {
              const on = form.techNeeds.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange('techNeeds', toggle(form.techNeeds, option))}
                  className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${
                    on
                      ? 'bg-primary-50 border-primary-200 text-primary-600 font-semibold'
                      : 'bg-surface border-hairline-strong text-ink-2 hover:border-primary-200'
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="mt-4">
        <RecurringFields form={form} onChange={onChange} maxOccurrences={maxOccurrences} />
      </div>
    </FormSection>
  );
}
