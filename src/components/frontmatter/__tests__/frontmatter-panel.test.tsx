import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FrontmatterPanel } from '../frontmatter-panel';
import { workflowSchema } from '@/lib/frontmatter/schemas/workflow';

function baseValue() {
  return {
    output: 'document',
    output_category: null,
    requires_mcps: [],
    schedule: null,
  } as Record<string, unknown>;
}

describe('FrontmatterPanel', () => {
  it('renders the schema label in the header', () => {
    render(
      <FrontmatterPanel
        schema={workflowSchema}
        value={baseValue()}
        rawYaml={null}
        mode="fields"
        canEdit
        onFieldsChange={() => {}}
        onRawChange={() => {}}
        onModeChange={() => {}}
        error={null}
      />,
    );
    expect(screen.getByRole('heading', { name: /workflow/i })).toBeInTheDocument();
  });

  it('renders one control per schema field in fields mode', () => {
    render(
      <FrontmatterPanel
        schema={workflowSchema}
        value={baseValue()}
        rawYaml={null}
        mode="fields"
        canEdit
        onFieldsChange={() => {}}
        onRawChange={() => {}}
        onModeChange={() => {}}
        error={null}
      />,
    );
    expect(screen.getByLabelText(/output/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/required mcps/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/schedule/i)).toBeInTheDocument();
  });

  it('emits a partial patch on enum change', () => {
    const onFieldsChange = vi.fn();
    render(
      <FrontmatterPanel
        schema={workflowSchema}
        value={baseValue()}
        rawYaml={null}
        mode="fields"
        canEdit
        onFieldsChange={onFieldsChange}
        onRawChange={() => {}}
        onModeChange={() => {}}
        error={null}
      />,
    );
    fireEvent.change(screen.getByLabelText(/output/i), { target: { value: 'message' } });
    expect(onFieldsChange).toHaveBeenCalledWith({ output: 'message' });
  });

  it('emits a raw-mode toggle via onModeChange', () => {
    const onModeChange = vi.fn();
    render(
      <FrontmatterPanel
        schema={workflowSchema}
        value={baseValue()}
        rawYaml={null}
        mode="fields"
        canEdit
        onFieldsChange={() => {}}
        onRawChange={() => {}}
        onModeChange={onModeChange}
        error={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /view raw yaml/i }));
    expect(onModeChange).toHaveBeenCalledWith('raw');
  });

  it('renders a textarea with rawYaml contents in raw mode', () => {
    const raw = 'type: workflow\noutput: document';
    render(
      <FrontmatterPanel
        schema={workflowSchema}
        value={baseValue()}
        rawYaml={raw}
        mode="raw"
        canEdit
        onFieldsChange={() => {}}
        onRawChange={() => {}}
        onModeChange={() => {}}
        error={null}
      />,
    );
    const area = screen.getByRole('textbox', { name: /yaml/i }) as HTMLTextAreaElement;
    expect(area.value).toBe(raw);
  });

  it('shows an error banner when error is provided', () => {
    render(
      <FrontmatterPanel
        schema={workflowSchema}
        value={baseValue()}
        rawYaml={'oops'}
        mode="raw"
        canEdit
        onFieldsChange={() => {}}
        onRawChange={() => {}}
        onModeChange={() => {}}
        error={'YAML parse error: …'}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/yaml parse error/i);
  });

  it('forces raw mode and disables fields toggle when schema is null', () => {
    render(
      <FrontmatterPanel
        schema={null}
        value={{}}
        rawYaml="custom: value"
        mode="raw"
        canEdit
        onFieldsChange={() => {}}
        onRawChange={() => {}}
        onModeChange={() => {}}
        error={null}
      />,
    );
    const toggle = screen.queryByRole('button', { name: /view fields/i });
    // Either not rendered at all, or present-but-disabled — both are acceptable.
    if (toggle) expect(toggle).toBeDisabled();
  });

  it('disables all inputs when canEdit is false', () => {
    render(
      <FrontmatterPanel
        schema={workflowSchema}
        value={baseValue()}
        rawYaml={null}
        mode="fields"
        canEdit={false}
        onFieldsChange={() => {}}
        onRawChange={() => {}}
        onModeChange={() => {}}
        error={null}
      />,
    );
    expect(screen.getByLabelText(/output/i)).toBeDisabled();
  });
});
