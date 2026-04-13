// Tiptap Callout extension — a stylable block node for info/warn callouts.
// Minimal implementation: carries a `variant` attribute; renders as a <div>
// tagged `data-type="callout"`. CSS in globals.css handles visual style.

import { Node, mergeAttributes } from '@tiptap/core';

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (el) => el.getAttribute('data-variant'),
        renderHTML: (attrs) => ({ 'data-variant': attrs.variant }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes({ 'data-type': 'callout' }, HTMLAttributes),
      0,
    ];
  },
});
