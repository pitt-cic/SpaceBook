import type { ReactNode, SelectHTMLAttributes } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  // Help text shown under the field and announced with it (aria-describedby).
  hint?: string;
  children: ReactNode;
}

export function Select({ label, error, hint, id, className = '', children, ...props }: SelectProps) {
  const selectId = id || label.replace('*', '').trim().toLowerCase().replace(/\s+/g, '-');
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;
  const describedBy = [props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="w-full">
      <label htmlFor={selectId} className="block text-xs font-medium text-ink-2 mb-1.5">
        {label}
      </label>
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        className={`
          w-full px-3 py-2.5 rounded-lg border bg-surface-2 text-sm text-ink transition-colors duration-150
          focus:outline-none focus:ring-2 focus:ring-primary-400/25 focus:border-primary-400 focus:bg-surface
          ${error ? 'border-err-fg focus:ring-err-fg/25 focus:border-err-fg' : 'border-field'}
          ${className}
        `}
        {...props}
        aria-describedby={describedBy}
      >
        {children}
      </select>
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-err-fg">
          {error}
        </p>
      )}
    </div>
  );
}
