import { Reveal, SectionHeading } from '../ui';

const steps = [
  {
    who: 'Requestor',
    title: 'Request a room',
    description: 'Fill out the public form, pick from the rooms that fit, and get a confirmation email.',
  },
  {
    who: 'CEC staff',
    title: 'Review & approve',
    description: 'See pending requests with live availability, including setup and cleanup time, then approve, deny, or counter.',
  },
  {
    who: 'Everyone',
    title: "It's on the calendar",
    description: 'The requestor gets a calendar invite, and the booking appears on the staff calendar and .ics feed.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-navy-850 py-22">
      <div className="mx-auto max-w-[1120px] px-6">
        <SectionHeading eyebrow="How it works" title="From Request to" highlight="Calendar Invite">
          Two audiences, one shared system.
        </SectionHeading>
        <ol className="grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="min-w-0">
              <Reveal delay={index * 100} className="h-full">
                <div className="glow-card h-full p-[26px]">
                  <span aria-hidden="true" className="mb-3.5 grid h-[34px] w-[34px] place-items-center rounded-full bg-gold text-[15px] font-extrabold text-gold-ink">
                    {index + 1}
                  </span>
                  <p className="text-xs font-bold uppercase tracking-[0.08em] text-text-3">{step.who}</p>
                  <h3 className="mb-2 mt-1 text-[19px] font-bold">{step.title}</h3>
                  <p className="text-[15px] text-text-2">{step.description}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
