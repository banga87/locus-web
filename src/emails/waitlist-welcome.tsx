// Waitlist welcome email — sent once when a new contact joins the Resend
// audience via the /#invitation form. Re-submits (409 from the audiences
// endpoint) deliberately do NOT trigger a resend.
//
// Brand notes:
//   - Cream background, indigo body type, brass accents — matches the
//     marketing site's light surfaces, NOT the dark hero overlay.
//   - EB Garamond display headline with Georgia fallback (Outlook will get
//     Georgia; Apple Mail / Gmail webmail load EB Garamond from Google
//     Fonts via the <Head> link).
//   - Inline styles only. No CSS variables, no className. Email clients
//     strip stylesheets — colors are duplicated as hex literals here on
//     purpose, kept in a `colors` const for one-place edits.
//
// To preview locally:  npm run email:dev  (opens http://localhost:3001)

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export interface WaitlistWelcomeEmailProps {
  email: string;
}

const colors = {
  cream: '#F2EAD8',
  paperRule: '#D7C9A8',
  brass: '#B8863A',
  brassDeep: '#8B6425',
  indigo: '#2E3E5C',
  ink2: '#3A4A68',
  ink3: '#5A6B88',
};

const fonts = {
  display: '"EB Garamond", "Hoefler Text", Georgia, serif',
  body:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
};

export default function WaitlistWelcomeEmail({
  email = 'you@workshop.com',
}: WaitlistWelcomeEmailProps) {
  return (
    <Html>
      <Head>
        {/* The <link> below is loaded by webmail clients that support web
            fonts (Apple Mail, Gmail web). Outlook + most native clients
            fall back to Georgia. The Next.js font lint rule fires here
            because this looks like a page, but it's a React Email template
            shipped over SMTP — disable for this block. */}
        {/* eslint-disable @next/next/no-page-custom-font */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&display=swap"
          rel="stylesheet"
        />
        {/* eslint-enable @next/next/no-page-custom-font */}
      </Head>
      <Preview>A small private beta. Real attention from our side.</Preview>
      <Body
        style={{
          backgroundColor: colors.cream,
          fontFamily: fonts.body,
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            maxWidth: '560px',
            margin: '0 auto',
            padding: '64px 32px 48px',
            backgroundColor: colors.cream,
          }}
        >
          {/* Brass top accent rule */}
          <Section
            style={{
              height: '2px',
              lineHeight: '2px',
              fontSize: '2px',
              backgroundColor: colors.brass,
              marginBottom: '32px',
            }}
          >
            &nbsp;
          </Section>

          {/* Eyebrow — mirrors the site's section labels */}
          <Text
            style={{
              margin: 0,
              fontFamily: fonts.mono,
              fontSize: '11px',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: colors.brassDeep,
            }}
          >
            01 &nbsp;/&nbsp; The Invitation
          </Text>

          {/* Headline */}
          <Heading
            as="h1"
            style={{
              margin: '24px 0 0',
              fontFamily: fonts.display,
              fontWeight: 400,
              fontSize: '40px',
              lineHeight: 1.15,
              color: colors.indigo,
            }}
          >
            On the{' '}
            <em
              style={{
                fontStyle: 'italic',
                color: colors.brassDeep,
              }}
            >
              list.
            </em>
          </Heading>

          {/* Body */}
          <Text
            style={{
              margin: '32px 0 0',
              fontSize: '16px',
              lineHeight: 1.65,
              color: colors.indigo,
            }}
          >
            Thanks for requesting an invitation to Tatara.
          </Text>

          <Text
            style={{
              margin: '16px 0 0',
              fontSize: '16px',
              lineHeight: 1.65,
              color: colors.indigo,
            }}
          >
            We&rsquo;re letting people in a few teams at a time, on purpose. The
            machinery stays warm and we get to look every team in the eye when they
            arrive. That&rsquo;s the whole point of the slow open.
          </Text>

          <Text
            style={{
              margin: '16px 0 0',
              fontSize: '16px',
              lineHeight: 1.65,
              color: colors.indigo,
            }}
          >
            <strong style={{ fontWeight: 600, color: colors.ink2 }}>
              What happens next:
            </strong>{' '}
            when there&rsquo;s room for you, you&rsquo;ll get a short note from me
            with a link, a 20-minute call slot, and a way to bring your stack with
            you. Usually a few weeks out, not months.
          </Text>

          <Text
            style={{
              margin: '16px 0 0',
              fontSize: '16px',
              lineHeight: 1.65,
              color: colors.indigo,
            }}
          >
            If you&rsquo;d like to skip the queue, hit reply and tell me what
            you&rsquo;re trying to put under one roof: agents, knowledge, contacts,
            whatever it is. The teams who arrive with a real picture of the mess
            they&rsquo;re solving go first.
          </Text>

          {/* Signature */}
          <Text
            style={{
              margin: '40px 0 0',
              fontFamily: fonts.display,
              fontStyle: 'italic',
              fontSize: '20px',
              lineHeight: 1.2,
              color: colors.indigo,
            }}
          >
            Angus
          </Text>
          <Text
            style={{
              margin: '6px 0 0',
              fontFamily: fonts.mono,
              fontSize: '11px',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: colors.ink3,
            }}
          >
            Founder, Tatara
          </Text>

          {/* Hairline rule */}
          <Hr
            style={{
              border: 'none',
              borderTop: `1px solid ${colors.paperRule}`,
              margin: '48px 0 24px',
            }}
          />

          {/* Footer — kept minimal on purpose. The List-Unsubscribe header
              (set on the send call, not here) is what Gmail's one-click
              unsub button reads. */}
          <Text
            style={{
              margin: 0,
              fontFamily: fonts.mono,
              fontSize: '11px',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: colors.ink3,
              lineHeight: 1.7,
            }}
          >
            Sent to {email} because you signed up at{' '}
            <Link
              href="https://tatara.app"
              style={{ color: colors.brassDeep, textDecoration: 'none' }}
            >
              tatara.app
            </Link>
            <br />
            Don&rsquo;t want these? Just reply.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
