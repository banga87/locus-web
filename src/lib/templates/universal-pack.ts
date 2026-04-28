// Universal Base Pack — the seed layout every new brain ships with.
//
// v1 (refined-focus): seven top-level folders matching the Tatara
// Document Standard v1 spec. No seeded documents — the founder
// authors content via MCP, and the document-standard validator
// requires every committed doc to have valid universal + per-type
// frontmatter, which a generic pre-seed cannot satisfy.
//
// The TEMPLATE-AS-MARKDOWN approach used in the prior pack (10 H2
// "fill me in" stubs) is incompatible with the new doc standard: the
// validator would reject them as missing required type-specific
// fields. Better to ship clean and let the founder fill the brain in
// their own voice from the first MCP write.

export interface FolderTemplate {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  parentId: null;
  /** Full-ancestor path. Top-level folders: path = slug. */
  path: string;
}

export const UNIVERSAL_PACK = {
  id: 'universal',
  name: 'Universal Base Pack v1',
  folders: [
    {
      slug: 'company',
      name: 'Company',
      description:
        'Brand voice, brand/design, mission, values, internal team, roles, structure.',
      sortOrder: 10,
      parentId: null,
      path: 'company',
    },
    {
      slug: 'customers',
      name: 'Customers',
      description:
        'Customer accounts, contacts, conversations, feedback, account-level pricing.',
      sortOrder: 20,
      parentId: null,
      path: 'customers',
    },
    {
      slug: 'market',
      name: 'Market',
      description:
        'ICPs, competitive landscape, positioning, market research.',
      sortOrder: 30,
      parentId: null,
      path: 'market',
    },
    {
      slug: 'product',
      name: 'Product',
      description:
        'Products, pricing, roadmap, technical architecture, product research.',
      sortOrder: 40,
      parentId: null,
      path: 'product',
    },
    {
      slug: 'marketing',
      name: 'Marketing',
      description:
        'Campaigns, email sequences, website copy, social content, events.',
      sortOrder: 50,
      parentId: null,
      path: 'marketing',
    },
    {
      slug: 'operations',
      name: 'Operations',
      description: 'Procedures, policies, tools, vendors.',
      sortOrder: 60,
      parentId: null,
      path: 'operations',
    },
    {
      slug: 'signals',
      name: 'Signals',
      description:
        'Time-stamped raw input: rambles, meeting notes, slack captures, in-flight thoughts.',
      sortOrder: 70,
      parentId: null,
      path: 'signals',
    },
  ] satisfies FolderTemplate[],

  // No seed documents in v1 — see header comment.
  documents: [] as const,
} as const;
