import type { TextareaHTMLAttributes } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  // Help text shown under the field and announced with it (aria-describedby).
  hint?: string;
}

export function Textarea({ label, error, hint, id, className = '', ...props }: TextareaProps) {
  const textareaId = id || label.replace('*', '').trim().toLowerCase().replace(/\s+/g, '-');
  const hintId = hint ? `${textareaId}-hint` : undefined;
  const errorId = error ? `${textareaId}-error` : undefined;
  const describedBy = [props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="w-full">
      <label htmlFor={textareaId} className="block text-xs font-medium text-ink-2 mb-1.5">
        {label}
      </label>
      <textarea
        id={textareaId}
        aria-invalid={error ? true : undefined}
        className={`
          w-full px-3 py-2.5 rounded-lg border bg-surface-2 text-sm text-ink transition-colors duration-150
          focus:outline-none focus:ring-2 focus:ring-primary-400/25 focus:border-primary-400 focus:bg-surface
          ${error ? 'border-err-fg focus:ring-err-fg/25 focus:border-err-fg' : 'border-field'}
          ${className}
        `}
        {...props}
        aria-describedby={describedBy}
      />
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
