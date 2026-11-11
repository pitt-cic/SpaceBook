import { GITHUB_URL, GitHubIcon, PlayIcon, Reveal } from '../ui';

export function CallToAction() {
  return (
    <section className="bg-navy-850 py-22">
      <div className="mx-auto max-w-[1120px] px-6">
        <Reveal className="glow-card mx-auto max-w-[780px] px-7 py-14 text-center">
          <h2 className="mb-3 text-[26px] font-extrabold md:text-4xl">
            Ready to Open Your Doors to the <span className="text-gold">Community</span>?
          </h2>
          <p className="mb-7 text-[17px] text-text-2">
            SpaceBook is open source and deploys to your own AWS account with a single CDK stack.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a href={GITHUB_URL} className="btn btn-gold">
              <GitHubIcon />
              View on GitHub
            </a>
            <a href="#demo" className="btn btn-ghost">
              <PlayIcon />
              Watch Demo
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
