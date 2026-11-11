import type { ReactNode } from 'react';
import { Reveal, SectionHeading } from '../ui';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const features = [
  {
    title: 'Filter-First Request Form',
    description: 'Requestors enter date, time, headcount, and tech needs, then choose from only the rooms that fit.',
    icon: <Icon><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></Icon>,
  },
  {
    title: 'Staff Review Workflow',
    description: 'Approve into any room, deny, or counter-propose a new time or room, all from one queue.',
    icon: <Icon><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></Icon>,
  },
  {
    title: 'Conflict-Proof Booking',
    description: 'A transactional lock on every 15-minute slot means overlapping approvals fail instead of double-booking.',
    icon: <Icon><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Icon>,
  },
  {
    title: 'Requestor Self-Service',
    description: 'One-time email codes let requestors check status, cancel, or accept a counter-proposal. No passwords.',
    icon: <Icon><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></Icon>,
  },
  {
    title: 'Multi-Site Administration',
    description: 'Admins manage sites, rooms, photos, and staff access right in the app, with no redeploy.',
    icon: <Icon><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /></Icon>,
  },
  {
    title: 'Calendar Integration',
    description: 'Confirmed bookings send Outlook and Google invites, and staff can subscribe to a personal .ics feed.',
    icon: <Icon><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></Icon>,
  },
];

export function Features() {
  return (
    <section id="features" className="relative py-22">
      <div className="mx-auto max-w-[1120px] px-6">
        <SectionHeading eyebrow="Features" title="Key" highlight="Capabilities">
          Everything a CEC needs to lend its rooms to the neighborhood, from the first request to the calendar invite.
        </SectionHeading>
        <ul className="grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => (
            <li key={feature.title} className="min-w-0">
              <Reveal delay={index * 80} className="h-full">
                <div className="glow-card h-full p-[26px] hover:-translate-y-0.5 hover:border-gold">
                  <div className="mb-4 grid h-[46px] w-[46px] place-items-center rounded-xl bg-gradient-to-br from-gold to-gold-dark text-navy-900">
                    {feature.icon}
                  </div>
                  <h3 className="mb-2 text-lg font-bold">{feature.title}</h3>
                  <p className="text-[15px] text-text-2">{feature.description}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
