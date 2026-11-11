// University of Pittsburgh Procedure CS 26 §III.E.1 recommends a link to the
// University's accessibility statement on every webpage, so people can report
// barriers. URLs are the statement/report pages pitt.edu's own footer links to.
export const ACCESSIBILITY_STATEMENT_URL =
  'https://www.wellbeing.pitt.edu/disability-resources-services/accessibility-statement';
export const REPORT_BARRIER_URL =
  'https://www.wellbeing.pitt.edu/disability-access-accommodations/digital-accessibility/report-a-barrier';
export const ACCESSIBILITY_EMAIL = 'accessibility@pitt.edu';

interface Props {
  // 'dark' for the navy staff sidebar, 'light' for page canvases.
  tone?: 'light' | 'dark';
  className?: string;
}

export function AccessibilityFooter({ tone = 'light', className = '' }: Props) {
  const link =
    tone === 'dark'
      ? 'text-white/80 underline underline-offset-2 hover:text-white'
      : 'text-primary-600 underline underline-offset-2 hover:text-primary-700';
  return (
    <footer className={`text-xs ${tone === 'dark' ? 'text-white/70' : 'text-ink-3'} ${className}`}>
      <p className="flex flex-wrap gap-x-3 gap-y-1">
        <a href={ACCESSIBILITY_STATEMENT_URL} target="_blank" rel="noreferrer" className={link}>
          Accessibility statement<span className="sr-only"> (opens in a new tab)</span>
        </a>
        <a href={REPORT_BARRIER_URL} target="_blank" rel="noreferrer" className={link}>
          Report an accessibility barrier<span className="sr-only"> (opens in a new tab)</span>
        </a>
        <a href={`mailto:${ACCESSIBILITY_EMAIL}`} className={link}>
          {ACCESSIBILITY_EMAIL}
        </a>
      </p>
    </footer>
  );
}
