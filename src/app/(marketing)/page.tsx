// Tatara marketing home. Task 4 wires in the hero (Variation A, full-bleed)
// which owns the nav + image band + copy deck. Task 5 appends the three
// middle sections — HowItWorks / Features / Positioning. Task 6 appends
// PricingTeaser + Footer. Task 7 will slot FinalCTA between them.
//
// `authed` detection is deferred to a later task — for now `Hero` defaults
// `authed={false}` and renders the Sign in / Request access CTAs.

import { Features } from '@/components/marketing/features';
import { Footer } from '@/components/marketing/footer';
import { Hero } from '@/components/marketing/hero';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { Positioning } from '@/components/marketing/positioning';
import { PricingTeaser } from '@/components/marketing/pricing-teaser';

export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Features />
      <Positioning />
      <PricingTeaser />
      <Footer />
    </>
  );
}
