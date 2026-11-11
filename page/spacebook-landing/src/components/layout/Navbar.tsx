import { useEffect, useState } from 'react';
import { GITHUB_URL, GitHubIcon, Logo } from '../ui';

const links = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#demo', label: 'Demo' },
  { href: '#architecture', label: 'Architecture' },
  { href: '#tech-stack', label: 'Tech Stack' },
];

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        isScrolled ? 'border-b border-line bg-navy-900/95 backdrop-blur-lg' : 'bg-transparent'
      }`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-gold focus:px-4 focus:py-2 focus:font-semibold focus:text-gold-ink"
      >
        Skip to content
      </a>
      <nav aria-label="Primary" className="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-4 px-6">
        <a href="#top" className="flex items-center gap-2.5 text-[19px] font-extrabold no-underline">
          <Logo />
          SpaceBook
        </a>
        <div className="flex items-center gap-7 text-[14.5px]">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="hidden text-text-2 no-underline transition-colors hover:text-gold md:inline">
              {link.label}
            </a>
          ))}
          <a href={GITHUB_URL} className="btn btn-gold !px-3.5 !py-2 text-sm">
            <GitHubIcon />
            GitHub
          </a>
        </div>
      </nav>
    </header>
  );
}
