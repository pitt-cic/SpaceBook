import type { RequestFormState } from '../../types/requestForm';
import { Input } from '../ui/Input';
import { FormSection } from './FormSection';

interface Props {
  form: RequestFormState;
  onChange: <K extends keyof RequestFormState>(key: K, value: RequestFormState[K]) => void;
}

// autoComplete tokens identify each field's purpose (WCAG 1.3.5) so browsers
// and assistive tech can fill them in.
export function ContactFields({ form, onChange }: Props) {
  return (
    <FormSection step={4} title="Your contact info">
      <div className="grid sm:grid-cols-2 gap-3">
        <Input
          label="First name"
          required
          autoComplete="given-name"
          value={form.firstname}
          onChange={(e) => onChange('firstname', e.target.value)}
        />
        <Input
          label="Last name"
          required
          autoComplete="family-name"
          value={form.lastname}
          onChange={(e) => onChange('lastname', e.target.value)}
        />
        <Input
          label="Email"
          type="email"
          required
          autoComplete="email"
          aria-describedby="contact-email-note"
          value={form.email}
          onChange={(e) => onChange('email', e.target.value)}
        />
        <Input
          id="phone"
          label="Phone (optional)"
          type="tel"
          autoComplete="tel"
          value={form.phone}
          onChange={(e) => onChange('phone', e.target.value)}
        />
      </div>
      <p id="contact-email-note" className="mt-2 text-xs text-ink-4">
        We'll email updates here, and you can use it to manage your request later.
      </p>
    </FormSection>
  );
}
