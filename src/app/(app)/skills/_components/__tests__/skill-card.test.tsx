import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkillCard } from '../skill-card';

const baseProps = {
  id: 'skill-1',
  title: 'Brand Voice',
  description: 'Guidelines for how to write in the Tatara brand voice.',
  resourceCount: 3,
  agentCount: 2,
  updatedAt: new Date('2026-04-01T00:00:00Z'),
};

describe('SkillCard', () => {
  it('renders "Installed from github.com/…" badge for installed origin', () => {
    render(
      <SkillCard
        {...baseProps}
        origin={{ kind: 'installed', owner: 'tatara-ai', repo: 'skills', skill: 'brand-voice' }}
      />,
    );
    expect(screen.getByText(/Installed from github\.com\/tatara-ai\/skills/i)).toBeInTheDocument();
  });

  it('renders "Installed from github.com/…" without skill suffix when skill is null', () => {
    render(
      <SkillCard
        {...baseProps}
        origin={{ kind: 'installed', owner: 'tatara-ai', repo: 'skills', skill: null }}
      />,
    );
    const badge = screen.getByText(/Installed from github\.com\/tatara-ai\/skills/i);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).not.toContain('/skills/');
  });

  it('renders "Authored" badge for authored origin', () => {
    render(
      <SkillCard
        {...baseProps}
        origin={{ kind: 'authored' }}
      />,
    );
    expect(screen.getByText('Authored')).toBeInTheDocument();
  });

  it('renders "Forked from …" badge for forked origin', () => {
    render(
      <SkillCard
        {...baseProps}
        origin={{ kind: 'forked', from: 'tatara-ai/skills/brand-voice' }}
      />,
    );
    expect(screen.getByText(/Forked from tatara-ai\/skills\/brand-voice/i)).toBeInTheDocument();
  });

  it('renders resource count in the footer', () => {
    render(
      <SkillCard
        {...baseProps}
        resourceCount={5}
        origin={{ kind: 'authored' }}
      />,
    );
    expect(screen.getByText(/5 resources/i)).toBeInTheDocument();
  });

  it('renders agent count in the footer', () => {
    render(
      <SkillCard
        {...baseProps}
        agentCount={4}
        origin={{ kind: 'authored' }}
      />,
    );
    expect(screen.getByText(/used by 4 agents/i)).toBeInTheDocument();
  });

  it('renders the skill title', () => {
    render(
      <SkillCard
        {...baseProps}
        origin={{ kind: 'authored' }}
      />,
    );
    expect(screen.getByRole('heading', { name: /brand voice/i })).toBeInTheDocument();
  });
});
