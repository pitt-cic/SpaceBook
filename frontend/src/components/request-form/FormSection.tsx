import type { ReactNode } from 'react';
import { useId } from 'react';

interface FormSectionProps {
  step: number;
  title: string;
  children: ReactNode;
}

// A numbered form step. The section is a named region (its heading labels it)
// so screen-reader users can jump between steps; the step badge is spoken as
// "Step N:" rather than a bare number.
export function FormSection({ step, title, children }: FormSectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
      <h2 id={headingId} className="flex items-center gap-2.5 mb-4 text-[15px] font-semibold text-ink">
        <span
          className="w-[22px] h-[22px] rounded-full bg-primary-50 text-primary-600 text-xs font-bold flex items-center justify-center"
          aria-hidden="true"
        >
          {step}
        </span>
        <span className="sr-only">Step {step}: </span>
        {title}
      </h2>
      {children}
    </section>
  );
}
