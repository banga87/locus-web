import { describe, it, expect } from 'vitest';
import { marked } from 'marked';
import TurndownService from 'turndown';

import { splitFrontmatter, joinFrontmatter } from '../markdown';
import { workflowSchema } from '../schemas/workflow';
import { extractDocumentTypeFromContent } from '@/lib/brain/save';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

describe('Tiptap round-trip regression', () => {
  const pristine =
    '---\ntype: workflow\noutput: document\noutput_category: null\nrequires_mcps: []\nschedule: null\n---\n\nDescribe the workflow here.\n';

  it('OLD (broken) path: marked+turndown destroys frontmatter', () => {
    // Prove the bug exists when we DON'T split first.
    const html = marked.parse(pristine, { async: false }) as string;
    const md = turndown.turndown(html);
    expect(extractDocumentTypeFromContent(md)).toBeNull();
  });

  it('NEW (split+join) path: frontmatter survives the same round-trip', () => {
    const { frontmatterText, body } = splitFrontmatter(pristine);
    expect(frontmatterText).not.toBeNull();

    // Simulate Tiptap: marked → edit body in HTML → turndown.
    const html = marked.parse(body, { async: false }) as string;
    const editedHtml = html + '<p>new paragraph</p>';
    const newBodyMd = turndown.turndown(editedHtml);

    const value = workflowSchema.defaults();
    const rejoined = joinFrontmatter(value, newBodyMd, workflowSchema);

    expect(extractDocumentTypeFromContent(rejoined)).toBe('workflow');
    expect(rejoined).toContain('new paragraph');
  });

  it('is byte-stable when nothing in the frontmatter changes', () => {
    const { frontmatterText, body } = splitFrontmatter(pristine);
    const rejoined = joinFrontmatter(workflowSchema.defaults(), body, workflowSchema);
    expect(rejoined).toBe(pristine);
    // extra sanity: the rejoined file also parses cleanly.
    expect(splitFrontmatter(rejoined).frontmatterText).toBe(frontmatterText);
  });
});
