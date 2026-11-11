import type { ReactNode } from 'react';
import { AccessibilityFooter } from './AccessibilityFooter';
import { SkipLink } from './SkipLink';

interface Props {
  // Rendered above <main> inside a <header> landmark (logo row, nav links).
  header?: ReactNode;
  children: ReactNode;
  // Classes for the outer page wrapper (background, padding, centering).
  className?: string;
  // Classes for <main> (width, layout).
  mainClassName?: string;
}

// Landmark skeleton for the public / sign-in pages: skip link, optional
// <header>, the one <main id="main-content"> the skip link targets, and the
// accessibility-statement footer. The staff shell (StaffLayout) has its own.
export function PublicLayout({ header, children, className = '', mainClassName = '' }: Props) {
  return (
    <div className={`min-h-screen bg-canvas flex flex-col ${className}`}>
      <SkipLink />
      {header && <header>{header}</header>}
      <main id="main-content" tabIndex={-1} className={`relative flex-1 focus:outline-none ${mainClassName}`}>
        {children}
      </main>
      <AccessibilityFooter className="px-4 py-6 max-w-2xl w-full mx-auto" />
    </div>
  );
}
