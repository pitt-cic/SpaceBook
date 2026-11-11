import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

// Redesign: weightless surface — a 1px hairline border and a whisper of
// shadow instead of the old rounded-2xl shadow-lg slab.
export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`bg-surface rounded-2xl border border-hairline shadow-sm p-6 sm:p-8 ${className}`}>
      {children}
    </div>
  );
}
