import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileTree } from '../file-tree';

const ROOT_FILE = { id: 'root', name: 'SKILL.md', relativePath: null };

const RESOURCES = [
  { id: 'res-1', name: 'overview', relativePath: 'overview.md' },
  { id: 'res-2', name: 'interview', relativePath: 'references/interview.md' },
  { id: 'res-3', name: 'pricing', relativePath: 'references/pricing.md' },
];

describe('FileTree', () => {
  it('renders SKILL.md root entry', () => {
    render(
      <FileTree
        rootFile={ROOT_FILE}
        resources={[]}
        selectedId="root"
        onSelect={vi.fn()}
        canEdit={false}
      />,
    );
    expect(screen.getByText('SKILL.md')).toBeInTheDocument();
  });

  it('renders flat resource entries directly', () => {
    render(
      <FileTree
        rootFile={ROOT_FILE}
        resources={[{ id: 'res-1', name: 'overview', relativePath: 'overview.md' }]}
        selectedId="root"
        onSelect={vi.fn()}
        canEdit={false}
      />,
    );
    expect(screen.getByText('overview.md')).toBeInTheDocument();
  });

  it('renders a nested resource under a collapsible group', () => {
    render(
      <FileTree
        rootFile={ROOT_FILE}
        resources={[{ id: 'res-2', name: 'interview', relativePath: 'references/interview.md' }]}
        selectedId="root"
        onSelect={vi.fn()}
        canEdit={false}
      />,
    );
    // Group header rendered
    expect(screen.getByText('references')).toBeInTheDocument();
    // Leaf file rendered inside the group
    expect(screen.getByText('interview.md')).toBeInTheDocument();
  });

  it('groups multiple resources under the same folder directory', () => {
    render(
      <FileTree
        rootFile={ROOT_FILE}
        resources={RESOURCES}
        selectedId="root"
        onSelect={vi.fn()}
        canEdit={false}
      />,
    );
    // Only one "references" group header
    expect(screen.getAllByText('references')).toHaveLength(1);
    expect(screen.getByText('interview.md')).toBeInTheDocument();
    expect(screen.getByText('pricing.md')).toBeInTheDocument();
  });

  it('calls onSelect when a file is clicked', () => {
    const onSelect = vi.fn();
    render(
      <FileTree
        rootFile={ROOT_FILE}
        resources={[{ id: 'res-1', name: 'overview', relativePath: 'overview.md' }]}
        selectedId="root"
        onSelect={onSelect}
        canEdit={false}
      />,
    );
    fireEvent.click(screen.getByText('overview.md'));
    expect(onSelect).toHaveBeenCalledWith('res-1');
  });

  it('calls onSelect with root id when SKILL.md is clicked', () => {
    const onSelect = vi.fn();
    render(
      <FileTree
        rootFile={ROOT_FILE}
        resources={[]}
        selectedId="root"
        onSelect={onSelect}
        canEdit={false}
      />,
    );
    fireEvent.click(screen.getByText('SKILL.md'));
    expect(onSelect).toHaveBeenCalledWith('root');
  });

  it('renders "+ Add file" button when canEdit is true', () => {
    render(
      <FileTree
        rootFile={ROOT_FILE}
        resources={[]}
        selectedId="root"
        onSelect={vi.fn()}
        canEdit={true}
      />,
    );
    expect(screen.getByText('+ Add file')).toBeInTheDocument();
  });

  it('does not render "+ Add file" button when canEdit is false', () => {
    render(
      <FileTree
        rootFile={ROOT_FILE}
        resources={[]}
        selectedId="root"
        onSelect={vi.fn()}
        canEdit={false}
      />,
    );
    expect(screen.queryByText('+ Add file')).not.toBeInTheDocument();
  });
});
