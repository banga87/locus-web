// Tatara marketing hero — restyled onto HeroPlate + canonical voice.
// Server Component. The embedded <Nav /> is a Client Component, which is
// fine: Server → Client import is allowed in Next 16. The hero itself owns
// no state.
//
// Structure:
//   <section>
//     <HeroPlate image={...}>
//       <Nav />            ← rendered inside z-10 layer, absolute positioning
//                             still works because HeroPlate's section is relative
//       <spacer>            ← holds the image band open to a readable height
//     </HeroPlate>
//     <copy deck>           ← cream plate below, h1 + lede + CTAs
//     <PlateCaption />      ← engine-hall caption, below hero
//   </section>
//
// HeroPlate owns the image + top/bottom scrims internally, so we don't
// duplicate those concerns here.

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { HeroPlate, PlateCaption } from '@/components/tatara';
import { Nav } from '@/components/marketing/nav';

export interface HeroProps {
  authed?: boolean;
}

export function Hero({ authed = false }: HeroProps) {
  return (
    <section id="the-promise" className="relative w-full">
      <HeroPlate
        image="/images/hero-2400.jpg"
        alt="The engine hall, at working temperature"
        className="min-h-[48vh] lg:min-h-[55vh] xl:min-h-[62vh]"
      >
        <Nav authed={authed} />
        {/* Spacer — holds the image band open to HeroPlate's min-height so
            the photo reads as a full-bleed plate before the copy deck. */}
        <div className="min-h-[48vh] lg:min-h-[55vh] xl:min-h-[62vh]" />
      </HeroPlate>

      {/* Copy deck on cream. */}
      <div className="flex flex-col items-center px-6 pb-[88px] pt-10 text-center lg:px-12 lg:pb-[112px] lg:pt-12">
        <h1 className="t-h1">The operator&rsquo;s console for AI labor.</h1>

        <p className="t-lede mx-auto mt-6 max-w-[640px]">
          Hire AI employees and feel every turn of the crank.
        </p>

        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Button variant="default" size="lg" asChild>
            <Link href="#invitation">Get started</Link>
          </Button>
          <Button variant="accent" size="lg" asChild>
            <Link href="#how-it-works">Come and stoke the fire.</Link>
          </Button>
        </div>
      </div>

      <div className="flex justify-center pb-10">
        <PlateCaption plateNumber={1}>
          The engine hall, at working temperature.
        </PlateCaption>
      </div>
    </section>
  );
}
