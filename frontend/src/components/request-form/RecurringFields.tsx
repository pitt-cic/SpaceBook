import type { RequestFormState } from '../../types/requestForm';
import { toISODate } from '../../lib/dates';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { ToggleGroup } from '../ui/ToggleGroup';

interface Props {
  form: RequestFormState;
  onChange: <K extends keyof RequestFormState>(key: K, value: RequestFormState[K]) => void;
  /** The selected site's repeat limit, if it has one. */
  maxOccurrences?: number;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function RecurringFields({ form, onChange, maxOccurrences }: Props) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input
          type="checkbox"
          checked={form.recurringEnabled}
          onChange={(e) => onChange('recurringEnabled', e.target.checked)}
        />
        This repeats
      </label>
      {form.recurringEnabled && (
        <div className="mt-2 rounded-xl border border-hairline bg-surface-2 p-3 flex flex-col gap-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Select
              id="recur-pattern"
              label="Repeats"
              value={form.recurPattern}
              onChange={(e) => onChange('recurPattern', e.target.value as RequestFormState['recurPattern'])}
            >
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </Select>
            <Input
              id="recur-start"
              label="Series starts"
              type="date"
              min={toISODate(new Date())}
              value={form.recurStart}
              onChange={(e) => onChange('recurStart', e.target.value)}
            />
          </div>
          <fieldset>
            <legend className="text-xs font-medium text-ink-2 mb-1.5">
              On<span className="sr-only"> these days</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={form.recurDays.includes(day)}
                  onClick={() => onChange('recurDays', toggle(form.recurDays, day))}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border ${
                    form.recurDays.includes(day)
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-surface text-ink-2 border-hairline-strong'
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-xs font-medium text-ink-2 mb-1.5" aria-hidden="true">
                Ends
              </p>
              <ToggleGroup
                label="Series ends"
                options={[
                  { value: 'count', label: 'Repeat X times' },
                  { value: 'date', label: 'End by date' },
                ]}
                value={form.recurEndMode}
                onChange={(v) => onChange('recurEndMode', v as RequestFormState['recurEndMode'])}
              />
            </div>
            <div className="w-44">
              {form.recurEndMode === 'date' ? (
                <Input
                  id="recur-end-date"
                  label="End date"
                  type="date"
                  value={form.recurEndDate}
                  onChange={(e) => onChange('recurEndDate', e.target.value)}
                />
              ) : (
                <Input
                  id="recur-count"
                  label="Number of times"
                  type="number"
                  min={1}
                  value={form.recurCount}
                  onChange={(e) => onChange('recurCount', e.target.value)}
                />
              )}
            </div>
          </div>
          <p id="recur-note" className="text-xs text-ink-4">
            {maxOccurrences && `This site allows up to ${maxOccurrences} occurrences per repeating request. `}
            Room availability below is checked for the first date only — staff will confirm the rest.
          </p>
        </div>
      )}
    </div>
  );
}
