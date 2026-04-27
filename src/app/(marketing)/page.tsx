// Tatara marketing home. Sections in order: Hero, HowItWorks (the three
// beats), AllYourSystems (across-the-business coverage), FinalCTA, Footer.
//
// Metadata inheritance: Next 16 merges route-level metadata over the root
// layout's defaults, so the fields exported here override the root layout
// title for `/` specifically.

import type { Metadata } from 'next';

import { AllYourSystems } from '@/components/marketing/all-your-systems';
import { FinalCTA } from '@/components/marketing/final-cta';
import { Footer } from '@/components/marketing/footer';
import { Hero } from '@/components/marketing/hero';
import { HowItWorks } from '@/components/marketing/how-it-works';

const TITLE = 'Tatara — The company brain your agents write to';
const DESCRIPTION =
  'Every conversation with every agent goes into one self-maintaining brain. Sales, marketing, product, ops, engineering. The next agent works from everything that came before. So does the next person.';
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
      <HowItWorks />
      <AllYourSystems />
      <FinalCTA />
      <Footer />
    </>
  );
}
