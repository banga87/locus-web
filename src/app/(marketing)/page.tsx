// Tatara marketing home. Task 4 wires in the hero (Variation A, full-bleed)
// which owns the nav + image band + copy deck. Task 5 appends the three
// middle sections — HowItWorks / Features / Positioning. Task 6 appends
// PricingTeaser + Footer. Task 7 slots FinalCTA (Section 07 — The
// Invitation) between PricingTeaser and Footer. Task 8 finalizes the page
// with SEO/OG metadata and the pre-optimized hero image variants.
//
// Metadata inheritance: Next 16 merges route-level metadata over the root
// layout's defaults, so the `title` / `description` / `openGraph` /
// `twitter` fields exported here override `{ title: 'Locus', ... }` from
// `src/app/layout.tsx` for `/` specifically. Other routes (e.g. /login,
// /home) continue to inherit the root layout title.
//
// `authed` detection is deferred to a later task — for now `Hero` defaults
// `authed={false}` and renders the Sign in / Request access CTAs.

import type { Metadata } from 'next';

import { AllYourSystems } from '@/components/marketing/all-your-systems';
import { Features } from '@/components/marketing/features';
import { FinalCTA } from '@/components/marketing/final-cta';
import { Footer } from '@/components/marketing/footer';
import { Hero } from '@/components/marketing/hero';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { Positioning } from '@/components/marketing/positioning';
import { PricingTeaser } from '@/components/marketing/pricing-teaser';
import { WhoItsFor } from '@/components/marketing/who-its-for';

const TITLE = "Tatara: The operator's console for AI labor";
const DESCRIPTION =
  'The operating knowledge behind every agent you run. Always current across your CRM, inbox, leads, and SOPs, so your AI works from the same picture you do, and you stay on the controls.';
const OG_IMAGE = '/images/hero-og.jpg';
const OG_ALT = 'A Victorian engine hall at working temperature.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: OG_ALT }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <AllYourSystems />
      <HowItWorks />
      <Features />
      <Positioning />
      <WhoItsFor />
      <PricingTeaser />
      <FinalCTA />
      <Footer />
    </>
  );
}
