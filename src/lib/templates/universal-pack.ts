// Universal Base Pack — the seed content every new brain ships with.
//
// Four top-level folders (parentId: null), ten core documents. These are
// deliberately generic: every company has a brand, a product, a sales
// motion, and internal operations — the pack gives the founder somewhere
// to start writing instead of facing an empty brain on day one.
//
// Each document is stored as Markdown with H2 headings per section and an
// HTML-comment prompt beneath each heading. The prompts are intentionally
// written in founder voice: specific, opinionated, and concrete, so the
// user has a real sense of what a good answer looks like without us
// pre-filling the content for them.
//
// Shape note: every document here has `isCore: true`. Core documents
// anchor the brain — agents treat them as authoritative context even in
// `draft` status. When a founder completes setup we want the ten
// foundational docs immediately visible and draftable, not hidden.

export interface TemplateSection {
  heading: string;
  helperText: string;
}

export interface DocumentTemplate {
  slug: string;
  title: string;
  // The slug of the folder this document lives in. Matched to a
  // FolderTemplate at seed time.
  folder: string;
  summary: string;
  sections: TemplateSection[];
  isCore: true;
}

export interface FolderTemplate {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  // All universal-pack folders are top-level; we make that explicit so
  // the seed path doesn't have to special-case `undefined`.
  parentId: null;
}

export const UNIVERSAL_PACK = {
  id: 'universal',
  name: 'Universal Base Pack',
  folders: [
    {
      slug: 'brand-identity',
      name: 'Brand & Identity',
      description:
        'Who you are and how you show up. Voice, positioning, and visual identity — the things every customer-facing asset has to be consistent with.',
      sortOrder: 10,
      parentId: null,
    },
    {
      slug: 'product-service',
      name: 'Product & Service',
      description:
        'What you sell and how it works. The source of truth agents reach for when describing what your product does, who it\'s for, and where it\'s going.',
      sortOrder: 20,
      parentId: null,
    },
    {
      slug: 'sales-revenue',
      name: 'Sales & Revenue',
      description:
        'How you turn interest into revenue. Pricing, ideal customer, and the patterns that separate buyers from browsers.',
      sortOrder: 30,
      parentId: null,
    },
    {
      slug: 'company-operations',
      name: 'Company & Operations',
      description:
        'How the company itself runs. Origin, team, and the tooling stack that holds it together — context agents need to give useful answers to internal questions.',
      sortOrder: 40,
      parentId: null,
    },
  ] satisfies FolderTemplate[],

  documents: [
    // ------------------------------------------------------------------
    // Brand & Identity (3 docs)
    // ------------------------------------------------------------------
    {
      slug: 'brand-voice-tone',
      title: 'Brand Voice & Tone',
      folder: 'brand-identity',
      summary:
        'How the brand sounds in writing and speech. Used by every agent that drafts customer-facing copy.',
      sections: [
        {
          heading: 'Voice Characteristics',
          helperText:
            'Describe how the brand sounds. Are you warm and conversational, direct and no-nonsense, playful, technical? Pick three to five adjectives that capture it, then explain what each means in practice. Show, don\'t tell — a short example sentence beats a long abstract definition.',
        },
        {
          heading: 'Tone Guidelines',
          helperText:
            'When should the tone shift? Celebratory when a customer hits a milestone. Calm and precise during an outage. Lightly self-deprecating in onboarding emails. Spell out the situations that call for a different register, and what that register sounds like.',
        },
        {
          heading: 'Do / Don\'t',
          helperText:
            'Concrete examples of the voice in action, side by side. Do: "We noticed your sync is stuck — here\'s what broke." Don\'t: "Per our records, an error has occurred." Six to ten pairs is enough to calibrate an agent.',
        },
      ],
      isCore: true,
    },
    {
      slug: 'mission-positioning',
      title: 'Mission & Positioning',
      folder: 'brand-identity',
      summary:
        'Why the company exists and how it\'s different. The document every pitch, landing page, and investor update traces back to.',
      sections: [
        {
          heading: 'Why We Exist',
          helperText:
            'The problem you\'re solving, who feels it, and why it matters. One paragraph — not a manifesto. If a new hire read this alone, would they understand what you\'re trying to change about the world?',
        },
        {
          heading: 'Positioning Statement',
          helperText:
            'Use the shape: "We help [who] do [what] by [how]. Unlike [alternative], we [differentiator]." Fill it in crisply. If the "unlike" clause isn\'t specific, your positioning isn\'t either.',
        },
        {
          heading: 'Outcome We Promise',
          helperText:
            'What\'s true for a customer after using you that wasn\'t true before? Describe the state change in concrete terms — time saved, risk reduced, a capability they didn\'t have. Avoid buzzwords; aim for something a customer would actually say out loud.',
        },
      ],
      isCore: true,
    },
    {
      slug: 'visual-identity',
      title: 'Visual Identity',
      folder: 'brand-identity',
      summary:
        'Logo, color, and typography rules. The reference for anything rendered — slides, web, social, print.',
      sections: [
        {
          heading: 'Logo Usage',
          helperText:
            'Primary logo, any secondary marks, and when to use which. Minimum size, required clearspace, approved backgrounds. One or two "never do this" examples (stretched, recoloured, drop-shadowed) save a lot of grief later.',
        },
        {
          heading: 'Color Palette',
          helperText:
            'Hex codes with names and usage notes. Call out primary, neutral, and accent colours. If specific pairings are required for contrast or brand reasons, spell those out — agents generating assets will default to whatever you document here.',
        },
        {
          heading: 'Typography',
          helperText:
            'Primary font for headings and body, weights in use, and web-safe fallbacks. If you use a paid font (e.g. GT America, Söhne), note the licence and where it lives. If you use a system font, say so — consistency matters more than the font itself.',
        },
      ],
      isCore: true,
    },

    // ------------------------------------------------------------------
    // Product & Service (2 docs)
    // ------------------------------------------------------------------
    {
      slug: 'product-overview',
      title: 'Product Overview',
      folder: 'product-service',
      summary:
        'What the product is, in plain language. The first document any new teammate or agent should read to understand what you sell.',
      sections: [
        {
          heading: 'What It Is',
          helperText:
            'One paragraph answering "what does your product do?" the way you\'d say it to a smart friend at dinner. No jargon, no feature list — just the shape of the thing and the job it does.',
        },
        {
          heading: 'Core Capabilities',
          helperText:
            'The three to five things the product genuinely does well. Not every feature — the capabilities that define it. For each, one sentence on the capability and one on why it matters to the customer.',
        },
        {
          heading: 'How People Use It',
          helperText:
            'A typical day or week in the life of a user. What do they open it to do? What do they do next? Where does it fit into their existing workflow? This is the context that makes every other answer more accurate.',
        },
      ],
      isCore: true,
    },
    {
      slug: 'feature-catalog',
      title: 'Feature Catalog',
      folder: 'product-service',
      summary:
        'An inventory of what the product does today and what\'s coming. Source of truth for "does Locus support X?" questions.',
      sections: [
        {
          heading: 'Flagship Features',
          helperText:
            'The features customers buy you for. Name each one, describe it in two to three sentences, and note which customer segment cares most. If a feature has a public name, use it — agents will echo whatever you write here verbatim.',
        },
        {
          heading: 'Supporting Features',
          helperText:
            'Everything else that\'s shipped and available — integrations, admin tools, exports, API endpoints. Bullet list is fine here; depth isn\'t the point, completeness is.',
        },
        {
          heading: 'Roadmap Signals',
          helperText:
            'What\'s coming in the next quarter or two, at a granularity you\'re comfortable sharing externally. Use language like "exploring", "building", "shipping soon" so the agent doesn\'t over-commit on your behalf.',
        },
      ],
      isCore: true,
    },

    // ------------------------------------------------------------------
    // Sales & Revenue (2 docs)
    // ------------------------------------------------------------------
    {
      slug: 'pricing-model',
      title: 'Pricing Model',
      folder: 'sales-revenue',
      summary:
        'How you charge and why. The document every quote, contract, and pricing-page change is reconciled against.',
      sections: [
        {
          heading: 'Plans & Tiers',
          helperText:
            'Each tier you offer, the price, and the headline difference between them. If pricing is usage-based, describe the meter and the unit cost. If it\'s contact-us above a certain size, say so — ambiguity here becomes lost deals.',
        },
        {
          heading: 'Discounting Rules',
          helperText:
            'When, how much, and who can approve. Annual pre-pay discount? Multi-year? Non-profit? Startup programme? If a salesperson can\'t tell the answer in five seconds they\'ll improvise — document the defaults.',
        },
        {
          heading: 'Value Drivers',
          helperText:
            'What does each tier actually give the customer — in business terms, not feature flags? "Pro tier pays for itself once you\'re sending more than X emails a month" is the shape. Customers buy tiers for outcomes, not checkboxes.',
        },
      ],
      isCore: true,
    },
    {
      slug: 'ideal-customer-profile',
      title: 'Ideal Customer Profile',
      folder: 'sales-revenue',
      summary:
        'Who you\'re built for. The ICP is the single strongest filter on where to spend marketing and sales time.',
      sections: [
        {
          heading: 'Firmographics',
          helperText:
            'Company size, industry, geography, technology profile. Be specific: "Seed to Series B B2B SaaS, 10–150 employees, US + EU" is far more useful than "SMB technology companies".',
        },
        {
          heading: 'Triggers To Buy',
          helperText:
            'The events that make a prospect suddenly in-market. Just raised a round, hired a VP of X, hit a compliance deadline, launched a new product line. These are the moments your outreach should ride.',
        },
        {
          heading: 'Disqualifiers',
          helperText:
            'The signals that make a deal more trouble than it\'s worth. Required on-prem deployment, a procurement process longer than your runway, a buyer who wants features you\'ve explicitly decided not to build. Write these down so the team can politely say no.',
        },
      ],
      isCore: true,
    },

    // ------------------------------------------------------------------
    // Company & Operations (3 docs)
    // ------------------------------------------------------------------
    {
      slug: 'company-overview',
      title: 'Company Overview',
      folder: 'company-operations',
      summary:
        'The short version of the company story — where it came from, where it is, and where it\'s heading.',
      sections: [
        {
          heading: 'Origin Story',
          helperText:
            'How the company started. The problem that bothered the founders enough to quit their jobs. Keep it human — the version you\'d tell over a beer, not the press release.',
        },
        {
          heading: 'Current State',
          helperText:
            'Where the company is today: approximate stage, customer count, team size, recent funding if public. Enough for an agent to answer "how big is this company?" without making something up.',
        },
        {
          heading: 'Horizon',
          helperText:
            'What success looks like over the next 12–24 months. Not a detailed roadmap — the shape of the ambition. Customers and candidates both want to know where they\'re signing on to.',
        },
      ],
      isCore: true,
    },
    {
      slug: 'team-roles',
      title: 'Team & Roles',
      folder: 'company-operations',
      summary:
        'Who does what, how decisions get made, and how the team works together day to day.',
      sections: [
        {
          heading: 'Current Team',
          helperText:
            'Each person (or role, if you\'re keeping it anonymous), what they own, and the shape of their week. Update this when the team changes — stale org data is worse than none.',
        },
        {
          heading: 'Decision Rights',
          helperText:
            'Who gets to decide what without a meeting. Hiring, pricing changes, roadmap re-ordering, public statements. A short decision-rights doc prevents most of the meetings a startup gets stuck in.',
        },
        {
          heading: 'How We Work',
          helperText:
            'Meeting cadence, where work gets tracked, how you write things down, and how disagreement is handled. Equal parts handbook and culture document — the things you\'d tell a new hire in their first week.',
        },
      ],
      isCore: true,
    },
    {
      slug: 'tooling-stack',
      title: 'Tooling Stack',
      folder: 'company-operations',
      summary:
        'The software the company runs on. Customer-facing, internal, and the glue between them.',
      sections: [
        {
          heading: 'Customer-Facing Stack',
          helperText:
            'Everything a customer touches: the product itself, the website, auth, billing, email, support. Name the vendor, the purpose, and the account owner. Useful when something breaks and someone needs to know who to call.',
        },
        {
          heading: 'Internal Stack',
          helperText:
            'What the team uses to operate internally: task tracking, docs, chat, calendar, code hosting, CI, analytics. Keep it tidy — this list tends to grow without anyone noticing.',
        },
        {
          heading: 'Data Flow',
          helperText:
            'A paragraph or a simple list describing how data moves between the tools above. Product emits X, which lands in Y, which triggers Z. Agents reasoning about "where does the signup event go?" need this map.',
        },
      ],
      isCore: true,
    },
  ] satisfies DocumentTemplate[],
} as const;
