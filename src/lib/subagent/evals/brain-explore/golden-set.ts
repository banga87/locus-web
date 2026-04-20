// 15-20 brain-navigation queries with expected document slugs.
// Starting stub — expand to 15-20 before running the first real eval.
// See README.md for format + rationale.

export interface GoldenQuery {
  id: string;
  prompt: string;
  expectedSlugs: string[];
  thoroughness?: 'quick' | 'medium' | 'very thorough';
  notes?: string;
}

export const GOLDEN_SET: GoldenQuery[] = [
  {
    id: 'pricing-basics',
    prompt: 'What is our pricing model? Cite the relevant document.',
    expectedSlugs: ['pricing-runbook', 'adr-003'],
    thoroughness: 'quick',
  },
  {
    id: 'onboarding-flow',
    prompt:
      'How do new customers onboard? Which docs cover the first-30-day playbook?',
    expectedSlugs: ['onboarding-checklist', 'day-zero-setup'],
    thoroughness: 'medium',
  },
  {
    id: 'architecture-overview',
    prompt:
      'Summarise the subagent harness architecture, citing all design docs we have on it.',
    expectedSlugs: ['subagent-harness-pilot-design', 'agent-harness'],
    thoroughness: 'very thorough',
  },
  // TODO(Phase 2): expand to 15-20 queries. Categorise by thoroughness
  // (5 quick, 7 medium, 5 very-thorough) for balanced signal.
];
