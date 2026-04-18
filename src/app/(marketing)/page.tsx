// Tatara marketing home. Task 4 wires in the hero (Variation A, full-bleed)
// which owns the nav + image band + copy deck. Later tasks (5–7) will append
// HowItWorks / Features / Pricing / Footer sections below.
//
// `authed` detection is deferred to a later task — for now `Hero` defaults
// `authed={false}` and renders the Sign in / Request access CTAs.

import { Hero } from '@/components/marketing/hero';

export default function HomePage() {
  return <Hero />;
}
