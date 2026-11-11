import { useState } from 'react';
import { Reveal, SectionHeading } from '../ui';

// Drop the diagram (the same one as the README) at public/architecture-diagram.png.
const DIAGRAM_SRC = `${import.meta.env.BASE_URL}architecture-diagram.png`;

export function Architecture() {
  const [missing, setMissing] = useState(false);

  return (
    <section id="architecture" className="bg-navy-850 py-22">
      <div className="mx-auto max-w-[1120px] px-6">
        <SectionHeading eyebrow="Architecture" title="System" highlight="Architecture">
          A fully serverless stack on AWS managed services.
        </SectionHeading>
        <Reveal className="glow-card mx-auto max-w-[1040px] p-6 md:p-8">
          {missing ? (
            <div className="grid aspect-[2/1] place-items-center rounded-xl border-2 border-dashed border-line text-sm text-text-3">
              Architecture diagram coming soon
            </div>
          ) : (
            <img
              src={DIAGRAM_SRC}
              alt="SpaceBook architecture: requestors and CEC staff use the web app on AWS Amplify, which logs in with Amazon Cognito, loads room photos from Amazon S3, and calls API Gateway. API Gateway invokes AWS Lambda, which reads and writes DynamoDB and sends emails through Amazon SES."
              className="h-auto w-full rounded-lg bg-white"
              onError={() => setMissing(true)}
            />
          )}
        </Reveal>
      </div>
    </section>
  );
}
