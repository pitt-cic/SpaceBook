import { useEffect, useState } from 'react';
import { PlayIcon } from '../ui';

const filters = ['Tue, Nov 4', '6:00 – 8:00 PM', '25 people', 'Projector'];

const rooms = [
  { name: 'Community Room A', detail: 'Seats 40 · Projector · Mic', fits: true, selected: true },
  { name: 'Conference Room 2', detail: 'Seats 30 · Projector', fits: true, selected: false },
  { name: 'Small Meeting Room', detail: 'Seats 12', fits: false, selected: false },
];

export function Hero() {
  return (
    <section id="top" className="bg-grid relative overflow-hidden pb-24 pt-36">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute left-1/2 top-[8%] h-[420px] w-[720px] max-w-full -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(255,184,28,0.13),transparent_70%)]" />

      <div className="relative mx-auto grid max-w-[1120px] items-center gap-14 px-6 text-center lg:grid-cols-[1.2fr_1fr] lg:text-left">
        <div className="min-w-0">
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-card px-3.5 py-1.5 text-[13px] text-text-2">
            <span className="h-2 w-2 rounded-full bg-gold shadow-[0_0_0_4px_rgba(255,184,28,0.18)]" />
            Room booking for Pitt's Community Engagement Centers
          </p>
          <h1 className="mb-5 text-4xl font-extrabold leading-[1.1] sm:text-5xl lg:text-[52px]">
            Book Community Space
            <br />
            <span className="text-gold">Without the <span className="whitespace-nowrap">Back-and-Forth</span></span>
          </h1>
          <p className="mx-auto mb-8 max-w-[540px] text-lg text-text-2 lg:mx-0">
            Community groups request meeting rooms online, CEC staff approve with one click, and double-bookings are
            impossible by design. Serverless on AWS for about $7 a month.
          </p>
          <div className="flex flex-wrap justify-center gap-3 lg:justify-start">
            <a href="#demo" className="btn btn-gold">
              <PlayIcon />
              Watch Demo
            </a>
            <a href="#architecture" className="btn btn-ghost">
              View Architecture
            </a>
          </div>
        </div>

        <RequestPreview />
      </div>
    </section>
  );
}

/** Illustrative booking request: filters → rooms that fit → pending, then approved. */
function RequestPreview() {
  const [approved, setApproved] = useState(false);

  // Plays once and stops under 5 s, so no pause control is needed (WCAG 2.2.2).
  useEffect(() => {
    const timer = setTimeout(() => setApproved(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <figure className="glow-card m-0 min-w-0 bg-navy-850/75 p-[22px] text-left shadow-[0_30px_70px_rgba(0,23,63,0.35)] backdrop-blur-md">
      <figcaption className="sr-only">
        Example request: a 25-person meeting with a projector on Tuesday, November 4, from 6 to 8 PM. SpaceBook lists
        the rooms that fit, and staff approve Community Room A.
      </figcaption>
      <div aria-hidden="true">
        <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-text-3">
          New request · Hill District CEC
        </p>
        <div className="mb-[18px] flex flex-wrap gap-1.5">
          {filters.map((filter) => (
            <span key={filter} className="rounded-lg border border-line bg-gold/12 px-2.5 py-1 text-[12.5px]">
              {filter}
            </span>
          ))}
        </div>

        <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-text-3">Rooms that fit</p>
        <ul className="mb-[18px] grid list-none gap-2 p-0">
          {rooms.map((room) => (
            <li
              key={room.name}
              className={`flex items-center justify-between gap-2.5 rounded-[11px] border px-3.5 py-2.5 text-sm ${
                room.selected ? 'border-gold bg-gold/12' : 'border-line'
              } ${room.fits ? '' : 'border-dashed text-text-3'}`}
            >
              <div className="min-w-0">
                {room.name}
                <small className="block text-xs text-text-3">{room.detail}</small>
              </div>
              <span
                className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
                  room.fits ? 'bg-ok-bg text-ok-fg' : 'border border-line text-text-3'
                }`}
              >
                {room.fits ? 'Available' : 'Too small'}
              </span>
            </li>
          ))}
        </ul>

        <div className="mb-4 h-px bg-gradient-to-r from-transparent via-gold to-transparent opacity-35" />

        <div className="flex min-h-16 items-start gap-3">
          <div className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-gold/12 text-gold">
            {approved ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <div className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-line border-t-gold" />
            )}
          </div>
          <div key={approved ? 'approved' : 'pending'} className="animate-fade-up min-w-0">
            {approved ? (
              <>
                <span className="mb-1 inline-block rounded-full bg-ok-bg px-2.5 py-0.5 text-xs font-semibold text-ok-fg">Approved</span>
                <p className="text-[13.5px] text-text-2">Community Room A is locked for 6–8 PM. Calendar invite sent to the requestor.</p>
              </>
            ) : (
              <>
                <span className="mb-1 inline-block rounded-full bg-warn-bg px-2.5 py-0.5 text-xs font-semibold text-warn-fg">Pending approval</span>
                <p className="text-[13.5px] text-text-2">Sent to Hill District CEC staff for review…</p>
              </>
            )}
          </div>
        </div>
      </div>
    </figure>
  );
}
