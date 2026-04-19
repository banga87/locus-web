import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkillPreviewView } from '../skill-preview-view';
import type { SkillPreview } from '@/lib/skills/github-import';

const basePreview: SkillPreview = {
  name: 'Brand Voice',
  description: 'Guidelines for how to write in the Tatara brand voice.',
  sha: 'abc123def456',
  skillMdBody: '# Brand Voice\n\nWrite like a human, not a robot.',
  resources: [
    { relative_path: 'references/tone.md', content: '# Tone\n', bytes: 9 },
    { relative_path: 'references/examples.md', content: '# Examples\n', bytes: 12 },
  ],
  totalBytes: 200,
  warnings: [],
};

const baseOrigin = {
  owner: 'tatara-ai',
  repo: 'skills',
  skillName: 'brand-voice',
  sha: 'abc123def456',
};

describe('SkillPreviewView', () => {
  it('renders the skill name', () => {
    render(<SkillPreviewView preview={basePreview} origin={baseOrigin} />);
    expect(screen.getByText('Brand Voice')).toBeInTheDocument();
  });

  it('renders the description', () => {
    render(<SkillPreviewView preview={basePreview} origin={baseOrigin} />);
    expect(
      screen.getByText('Guidelines for how to write in the Tatara brand voice.'),
    ).toBeInTheDocument();
  });

  it('renders all resource paths in the file tree', () => {
    render(<SkillPreviewView preview={basePreview} origin={baseOrigin} />);
    expect(screen.getByText('references/tone.md')).toBeInTheDocument();
    expect(screen.getByText('references/examples.md')).toBeInTheDocument();
  });

  it('renders the SKILL.md body', () => {
    render(<SkillPreviewView preview={basePreview} origin={baseOrigin} />);
    expect(screen.getByText(/write like a human/i)).toBeInTheDocument();
  });

  it('renders the origin pin (owner/repo)', () => {
    render(<SkillPreviewView preview={basePreview} origin={baseOrigin} />);
    expect(screen.getByText(/tatara-ai\/skills/i)).toBeInTheDocument();
  });

  it('renders the SHA pin', () => {
    render(<SkillPreviewView preview={basePreview} origin={baseOrigin} />);
    // SHA shown as short prefix
    expect(screen.getByText(/abc123d/i)).toBeInTheDocument();
  });

  it('renders the safety notice', () => {
    render(<SkillPreviewView preview={basePreview} origin={baseOrigin} />);
    expect(
      screen.getByText(/become part of your agents' instructions/i),
    ).toBeInTheDocument();
  });

  it('renders warnings when present', () => {
    const previewWithWarnings: SkillPreview = {
      ...basePreview,
      warnings: ['Skipped non-.md file: assets/logo.png'],
    };
    render(<SkillPreviewView preview={previewWithWarnings} origin={baseOrigin} />);
    expect(screen.getByText(/Skipped non-.md file/i)).toBeInTheDocument();
  });

  it('does not render warnings section when warnings is empty', () => {
    render(<SkillPreviewView preview={basePreview} origin={baseOrigin} />);
    expect(screen.queryByText(/warnings/i)).not.toBeInTheDocument();
  });

  it('renders SKILL.md in file list', () => {
    render(<SkillPreviewView preview={basePreview} origin={baseOrigin} />);
    // SKILL.md appears in the file list <ul> as an <li>
    const items = screen.getAllByText('SKILL.md');
    const listItem = items.find((el) => el.tagName === 'LI');
    expect(listItem).toBeInTheDocument();
  });
});
