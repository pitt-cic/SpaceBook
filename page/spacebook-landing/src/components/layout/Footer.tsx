import { GITHUB_URL, GitHubIcon, Logo } from '../ui';

const team = [
  { name: 'Matthew Lu', href: 'https://www.linkedin.com/in/matthewlu2/' },
  { name: 'Tanishq Bansod', href: 'https://www.linkedin.com/in/tanishq-bansod/' },
];

export function Footer() {
  return (
    <footer className="border-t border-line py-9">
      <div className="mx-auto flex max-w-[1120px] flex-col justify-between gap-8 px-6 text-sm sm:flex-row">
        <div className="flex flex-col gap-2">
          <span className="mb-1 flex items-center gap-2.5 text-base font-extrabold">
            <Logo size={26} />
            SpaceBook
          </span>
          <a href={GITHUB_URL} className="flex items-center gap-2 text-text-2 no-underline hover:text-gold">
            <GitHubIcon size={16} />
            GitHub
          </a>
          <a href="https://digital.pitt.edu/cic" className="text-text-2 no-underline hover:text-gold">
            Pitt Cloud Innovation Center
          </a>
        </div>
        <div className="flex flex-col gap-2 sm:text-right">
          <h2 className="mb-1 text-xs font-bold uppercase tracking-[0.1em] text-text-3">Team</h2>
          {team.map((member) => (
            <a key={member.name} href={member.href} className="text-text-2 no-underline hover:text-gold">
              {member.name}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
