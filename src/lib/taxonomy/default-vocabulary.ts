// The 33-term default vocabulary defined by
// docs/superpowers/specs/refined-focus/2026-04-25-tatara-default-topic-vocabulary.md.
//
// Order matches the spec's clustering, which also matches the order
// `get_taxonomy` returns terms in for deterministic display.

import type { Vocabulary } from './types';

export const DEFAULT_TERMS = [
  // Brand & identity (4)
  'brand',
  'voice',
  'design',
  'positioning',
  // Market (3)
  'market',
  'competitor',
  'icp',
  // Customer (3)
  'customer',
  'feedback',
  'support',
  // Product (4)
  'product',
  'pricing',
  'feature',
  'roadmap',
  // Marketing (3)
  'campaign',
  'content',
  'event',
  // Sales (2)
  'sales',
  'partnership',
  // People & operations (5)
  'team',
  'hiring',
  'finance',
  'legal',
  'vendor',
  // Strategy (1)
  'strategy',
  // Engineering & software (8)
  'engineering',
  'architecture',
  'bug',
  'incident',
  'infra',
  'security',
  'release',
  'api',
] as const;

export const TERM_DESCRIPTIONS: Record<(typeof DEFAULT_TERMS)[number], string> =
  {
    brand: 'Overall brand.',
    voice: 'Brand voice, tone of voice, copy style.',
    design: 'Visual identity, design system, brand assets.',
    positioning: 'How the company positions itself in the market.',
    market: 'Market analysis, market sizing, trends.',
    competitor: 'Competitive landscape, individual competitors.',
    icp: 'Ideal customer profile, target audience definitions.',
    customer: 'Customer accounts, customer-specific context.',
    feedback: 'Feedback, complaints, requests, testimonials.',
    support: 'Support workflows, ticket patterns, customer service.',
    product: 'Products, product strategy.',
    pricing: 'Pricing structure, plans, discounts, billing.',
    feature: 'Specific features, feature requests.',
    roadmap: 'Roadmap items, planned work, sequencing.',
    campaign: 'Marketing campaigns.',
    content: 'Content marketing, blog, copy assets, social posts.',
    event: 'Events, conferences, webinars, trade shows.',
    sales: 'Sales process, deals, pipeline.',
    partnership: 'Partner relationships, channel deals.',
    team: 'Internal team, roles, responsibilities.',
    hiring: 'Open roles, recruiting, candidate pipeline.',
    finance: 'Finance, budgeting, cash flow, expenses.',
    legal: 'Legal matters, contracts, IP, regulation.',
    vendor: 'Third-party vendors, tools, services.',
    strategy: 'Company strategy, OKRs, goals, planning.',
    engineering: 'Engineering team, culture, process, practices.',
    architecture: 'System architecture, ADRs, technical design decisions.',
    bug: 'Defects, regressions, customer-reported issues.',
    incident: 'Outages, postmortems, near-misses, on-call events.',
    infra: 'Infrastructure, hosting, platform, cloud, devops.',
    security: 'Vulnerabilities, audits, security policies.',
    release: 'Versioned shipping events, release notes.',
    api: 'API contracts, integrations, webhooks, third-party APIs.',
  };

/**
 * Alias → canonical term. Drawn from the spec's "synonym handling"
 * table. Lowercase keys; agents normalise their input before the
 * lookup.
 */
export const DEFAULT_SYNONYMS: Record<string, (typeof DEFAULT_TERMS)[number]> =
  {
    users: 'customer',
    clients: 'customer',
    accounts: 'customer',
    prospect: 'sales',
    lead: 'sales',
    competition: 'competitor',
    competitive: 'competitor',
    'target audience': 'icp',
    personas: 'icp',
    audience: 'icp',
    ux: 'design',
    ui: 'design',
    visual: 'design',
    tone: 'voice',
    'copy-style': 'voice',
    okr: 'strategy',
    kpi: 'strategy',
    goals: 'strategy',
    objectives: 'strategy',
    partner: 'partnership',
    affiliate: 'partnership',
    reseller: 'partnership',
    subscription: 'pricing',
    plans: 'pricing',
    billing: 'pricing',
    defect: 'bug',
    issue: 'bug',
    regression: 'bug',
    outage: 'incident',
    postmortem: 'incident',
    'incident-report': 'incident',
    'on-call': 'incident',
    infrastructure: 'infra',
    cloud: 'infra',
    hosting: 'infra',
    devops: 'infra',
    platform: 'infra',
    'system-design': 'architecture',
    adr: 'architecture',
    'technical-design': 'architecture',
    vulnerability: 'security',
    cve: 'security',
    pentest: 'security',
    audit: 'security',
    endpoint: 'api',
    webhook: 'api',
    integration: 'api',
    'third-party': 'api',
    version: 'release',
    'release-notes': 'release',
  };

export const DEFAULT_VOCABULARY: Vocabulary = {
  terms: [...DEFAULT_TERMS],
  synonyms: { ...DEFAULT_SYNONYMS },
  version: 1,
};
