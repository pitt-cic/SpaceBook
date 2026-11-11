import { Reveal, SectionHeading } from '../ui';

const technologies = [
  { name: 'AWS CDK', category: 'IaC' },
  { name: 'AWS Lambda', category: 'Compute' },
  { name: 'Amazon API Gateway', category: 'API' },
  { name: 'AWS WAF', category: 'Security' },
  { name: 'Amazon DynamoDB', category: 'Database' },
  { name: 'Amazon Cognito', category: 'Auth' },
  { name: 'Amazon SES', category: 'Email' },
  { name: 'Amazon S3 + CloudFront', category: 'Photos' },
  { name: 'AWS Amplify', category: 'Hosting' },
  { name: 'React', category: 'Frontend' },
  { name: 'TypeScript', category: 'Language' },
  { name: 'Python 3.13', category: 'Language' },
  { name: 'Vite', category: 'Build' },
  { name: 'Tailwind CSS', category: 'Styling' },
];

export function TechStack() {
  return (
    <section id="tech-stack" className="py-22">
      <div className="mx-auto max-w-[1120px] px-6">
        <SectionHeading eyebrow="Tech stack" title="Built" highlight="Serverless">
          Managed AWS services only. Nothing runs between requests.
        </SectionHeading>
        <Reveal>
          <ul className="mx-auto flex max-w-[860px] list-none flex-wrap justify-center gap-2.5 p-0">
            {technologies.map((tech) => (
              <li key={tech.name} className="rounded-[10px] border border-line bg-card px-[15px] py-2 text-sm font-medium transition-colors hover:border-gold/50">
                {tech.name}
                <span className="ml-1.5 text-xs text-text-3">{tech.category}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
