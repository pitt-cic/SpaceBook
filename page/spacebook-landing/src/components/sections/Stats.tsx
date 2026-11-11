const stats = [
  { value: '~$7/mo', label: 'to run the whole stack' },
  { value: '0', label: 'double-bookings, enforced server-side' },
  { value: 'WCAG 2.2 AA', label: '0 axe-core violations' },
  { value: 'No passwords', label: 'for requestors, just email codes' },
];

export function Stats() {
  return (
    <section aria-label="At a glance" className="border-y border-line">
      <dl className="mx-auto grid max-w-[1120px] grid-cols-2 px-6 md:grid-cols-4">
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            className={`flex flex-col-reverse px-5 py-7 text-center ${index < 3 ? 'md:border-r md:border-line' : ''} ${
              index % 2 === 0 ? 'border-r border-line md:border-r' : ''
            } ${index < 2 ? 'border-b border-line md:border-b-0' : ''}`}
          >
            <dt className="text-[13.5px] text-text-2">{stat.label}</dt>
            <dd className="m-0 text-[22px] font-extrabold sm:text-[28px] tracking-[-0.02em] text-gold">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
