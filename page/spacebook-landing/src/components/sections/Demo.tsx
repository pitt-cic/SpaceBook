import { useState } from 'react';
import { PlayIcon, Reveal, SectionHeading } from '../ui';

// Same video as the README's Demo section, self-hosted because the README's
// GitHub attachment URL needs a signed-in GitHub session (the repo is private).
// Remuxed with `ffmpeg -c copy -movflags +faststart` so playback starts before
// the whole file loads. If it fails to load, a placeholder shows instead.
const DEMO_SRC = `${import.meta.env.BASE_URL}demo.mp4`;

export function Demo() {
  const [missing, setMissing] = useState(false);

  return (
    <section id="demo" className="py-22">
      <div className="mx-auto max-w-[1120px] px-6">
        <SectionHeading eyebrow="Demo" title="See It In" highlight="Action">
          Watch a request go from the public form to an approved booking on the staff calendar.
        </SectionHeading>
        <Reveal className="glow-card mx-auto max-w-[940px] overflow-hidden">
          {missing ? (
            <div className="grid aspect-video place-items-center bg-gradient-to-br from-navy-800 to-navy-900 text-center">
              <div className="flex flex-col items-center gap-4">
                <span className="grid h-[76px] w-[76px] place-items-center rounded-full bg-gold text-gold-ink shadow-[0_0_0_12px_rgba(255,184,28,0.15)]">
                  <PlayIcon size={28} />
                </span>
                <p className="text-sm text-text-2">Demo video coming soon</p>
              </div>
            </div>
          ) : (
            <video controls preload="metadata" className="block aspect-video w-full bg-navy-800">
              <source src={DEMO_SRC} type="video/mp4" onError={() => setMissing(true)} />
              Your browser does not support the video tag.
            </video>
          )}
        </Reveal>
      </div>
    </section>
  );
}
