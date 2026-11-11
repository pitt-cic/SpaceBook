import type { CSSProperties } from 'react';
import { siteColor, siteLabel } from '../../config/sites';

interface SiteBadgeProps {
  site: string;
  label?: string;
  color?: string;
  className?: string;
}

// Site colors are runtime data (config/sites.ts), not build-time Tailwind
// tokens — Tailwind's JIT scanner can't see a class name built from a
// runtime string, so this sets --site-color inline and consumes it through
// the static `bg-[var(--site-color)]` utility instead.
//
// `label`/`color` let a caller override the config/sites.ts lookup with
// live Sites-table data (e.g. AdminRoomsPage resolving a site created after
// this config file was written) — omit them to keep the config-based lookup.
export function SiteBadge({ site, label, color, className = '' }: SiteBadgeProps) {
  const style = { '--site-color': color ?? siteColor(site) } as CSSProperties;

  // Redesign: a soft chip (hairline surface + colored dot) instead of a solid
  // fill, so the site color reads as an identity marker rather than a loud
  // block. The dot fills from the --site-color custom property set inline.
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-hairline-strong bg-surface px-2.5 py-1 text-xs font-medium text-ink-2 ${className}`}
    >
      <span className="w-2 h-2 rounded-full bg-[var(--site-color)]" style={style} aria-hidden="true" />
      {label ?? siteLabel(site)}
    </span>
  );
}
