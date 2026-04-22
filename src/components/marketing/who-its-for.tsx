// Section 06 — "Who it's for". Three persona cards in place of testimonials
// (testimonials return post-beta once real design partners exist). Server
// Component.
//
// Layout mirrors the prototype's replacement for SocialProof: headline + lede
// row at the top, then a 3-up card grid. Uses FrameCard for the cards so they
// share the letterpress paper-rule treatment used elsewhere on the page.

import { SectionFrame } from '@/components/marketing/section-frame';
import { FrameCard } from '@/components/tatara';

interface Persona {
  role: string;
  body: string;
}

const PERSONAS: readonly Persona[] = [
  {
    role: 'The Agent Director.',
    body: "You've built agents across the business. Now you're the one keeping them honest. Tatara gives you a single place where every agent pulls its context from. And a single place where you can see what they know, what they don't, and where they're wrong.",
  },
  {
    role: 'The Operations Lead.',
    body: "Your AI was supposed to save your team time. Instead you're spending an afternoon a week correcting it. Tatara keeps the knowledge your agents read from current across every tool you use, so the AI you already have starts answering like someone who actually works here.",
  },
  {
    role: 'The Founder.',
    body: "You shouldn't need to be technical to run a business on modern tools. Tatara is the place where everything your AI needs to know lives, without you having to think about the plumbing underneath.",
  },
];

export function WhoItsFor() {
  return (
    <SectionFrame id="who-its-for" number="06" kicker="Who it's for">
      {/* Heading + lede — 1 col mobile, 1fr / 1.4fr from `lg:` up. */}
      <div className="mb-14 grid grid-cols-1 items-start gap-10 lg:grid-cols-[1fr_1.4fr] lg:gap-[72px]">
        <h2 className="t-h2">
          For the person
          <br />
          <span style={{ fontStyle: 'italic', fontWeight: 300 }}>running AI at your company.</span>
        </h2>
        <p className="t-body max-w-[520px] [text-wrap:pretty]" style={{ color: 'var(--ink-2)' }}>
          A new kind of role is forming at growing businesses: the person responsible for agents
          that work, agents that don&rsquo;t drift, agents that earn their place. Whatever that
          role is called on your org chart, this is the console for it.
        </p>
      </div>

      {/* Persona grid. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
        {PERSONAS.map((p, i) => (
          <FrameCard key={p.role} className="px-8 py-9">
            <div className="t-mono-label" style={{ color: 'var(--ember)' }}>
              № 0{i + 1}
            </div>
            <h3 className="t-h3 mt-3">{p.role}</h3>
            <p className="t-body mt-4 [text-wrap:pretty]" style={{ color: 'var(--ink-2)' }}>
              {p.body}
            </p>
          </FrameCard>
        ))}
      </div>
    </SectionFrame>
  );
}
