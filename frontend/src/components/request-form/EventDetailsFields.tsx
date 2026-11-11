import type { RequestFormState } from '../../types/requestForm';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { ToggleGroup } from '../ui/ToggleGroup';
import { FormSection } from './FormSection';

interface Props {
  form: RequestFormState;
  onChange: <K extends keyof RequestFormState>(key: K, value: RequestFormState[K]) => void;
}

const ACTIVITY_TYPES = [
  { value: 'Event', label: 'Event' },
  { value: 'Meeting', label: 'Meeting' },
  { value: 'Other', label: 'Other' },
];
// Values are what the backend and staff views already store; only the labels changed.
const AUDIENCE_TYPES = [
  { value: 'Academic Event', label: 'Pitt only' },
  { value: 'Community Event', label: 'Community only' },
  { value: 'University Event', label: 'Both' },
];
const MINORS_OPTIONS: { value: RequestFormState['minors']; label: string }[] = [
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes' },
  { value: 'maybe', label: 'Not sure' },
];

export function EventDetailsFields({ form, onChange }: Props) {
  return (
    <FormSection step={3} title="About your event">
      <div className="grid sm:grid-cols-2 gap-3">
        <Input label="Event title" required value={form.title} onChange={(e) => onChange('title', e.target.value)} />
        <Input
          label="Organization"
          required
          autoComplete="organization"
          value={form.org}
          onChange={(e) => onChange('org', e.target.value)}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <div>
          <p className="text-xs font-medium text-ink-2 mb-1.5" aria-hidden="true">
            Type
          </p>
          <ToggleGroup
            label="Event type"
            options={ACTIVITY_TYPES}
            value={form.activityType}
            onChange={(v) => onChange('activityType', v)}
          />
        </div>
        <div>
          <p className="text-xs font-medium text-ink-2 mb-1.5" aria-hidden="true">
            Who's involved
          </p>
          <ToggleGroup label="Who's involved" options={AUDIENCE_TYPES} value={form.type} onChange={(v) => onChange('type', v)} />
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium text-ink-2 mb-1.5" aria-hidden="true">
          Any attendees under 18?
        </p>
        <ToggleGroup
          label="Any attendees under 18?"
          options={MINORS_OPTIONS}
          value={form.minors}
          onChange={(v) => onChange('minors', v)}
        />
        {form.minors !== 'no' && (
          <div className="mt-2 rounded-lg bg-warn-bg p-3 text-xs text-warn-fg flex flex-col gap-2">
            <p>
              Events with youth in attendance need special processing under the University's{' '}
              <a
                href="https://www.hr.pitt.edu/clearances-training/programs"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Working with Minors policy<span className="sr-only"> (opens in a new tab)</span>
              </a>
              .
            </p>
            <label className="flex items-start gap-2 text-ink-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.minorsCompliance}
                onChange={(e) => onChange('minorsCompliance', e.target.checked)}
              />
              I agree to comply with the University's requirements for working with minors.
            </label>
          </div>
        )}
      </div>

      <div className="mt-4">
        <Textarea
          label="Notes for staff (optional)"
          rows={3}
          value={form.notes}
          onChange={(e) => onChange('notes', e.target.value)}
          placeholder="Accessibility needs, room layout, anything else…"
        />
      </div>
    </FormSection>
  );
}
