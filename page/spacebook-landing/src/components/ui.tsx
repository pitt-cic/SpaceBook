import type { CSSProperties, ReactNode } from 'react';
import { useInView } from './hooks/useInView';

export const GITHUB_URL = 'https://github.com/pitt-cic/SpaceBook';

/** Fades its children up the first time they scroll into view. */
export function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const { ref, isInView } = useInView<HTMLDivElement>();
  const style: CSSProperties = { transitionDelay: `${delay}ms` };
  return (
    <div ref={ref} style={style} className={`reveal ${isInView ? 'is-visible' : ''} ${className}`}>
      {children}
    </div>
  );
}

export function SectionHeading({ eyebrow, title, highlight, children }: { eyebrow: string; title: string; highlight: string; children: ReactNode }) {
  return (
    <Reveal className="mx-auto mb-11 max-w-[660px] text-center">
      <p className="mb-2.5 text-xs font-bold uppercase tracking-[0.12em] text-gold">{eyebrow}</p>
      <h2 className="mb-3 text-3xl font-extrabold md:text-4xl">
        {title} <span className="text-gold">{highlight}</span>
      </h2>
      <p className="text-[17px] text-text-2">{children}</p>
    </Reveal>
  );
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-[9px] bg-navy-800 font-extrabold text-gold ring-1 ring-gold/35"
      style={{ width: size, height: size, fontSize: size * 0.6 }}
    >
      S
    </span>
  );
}

export function GitHubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.79-.26.79-.58v-2.23c-3.34.73-4.03-1.42-4.03-1.42-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49 1 .11-.78.42-1.31.76-1.6-2.67-.31-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.19.7.8.58C20.57 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export function PlayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}
