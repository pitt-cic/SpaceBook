import type { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'neutral' | 'success' | 'warning' | 'error' | 'info';
  className?: string;
}

// Soft status pills (redesign): a tinted background + a colored dot + colored
// text, replacing the old solid saturated badges. The dot is drawn with a
// leading pseudo-less span so it inherits the text color per variant.
const variants = {
  neutral: 'bg-neu-bg text-neu-fg',
  success: 'bg-ok-bg text-ok-fg',
  warning: 'bg-warn-bg text-warn-fg',
  error: 'bg-err-bg text-err-fg',
  info: 'bg-info-bg text-info-fg',
};

export function Badge({ children, variant = 'neutral', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ${variants[variant]} ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-90" aria-hidden="true" />
      {children}
    </span>
  );
}
