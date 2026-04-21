'use client';

// Thin Tiptap wrapper. Exposes only what the app needs for Phase 0:
// StarterKit + Placeholder + the Callout extension. Content is HTML (tiptap
// native); the document editor handles markdown <-> HTML conversion at the
// boundary.

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';

import { Callout } from './callout-extension';

interface Props {
  initialContent?: string;
  placeholder?: string;
  onUpdate?: (html: string) => void;
}

export function TiptapEditor({ initialContent, placeholder, onUpdate }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
      }),
      Placeholder.configure({ placeholder: placeholder ?? 'Start writing…' }),
      Callout,
    ],
    content: initialContent ?? '',
    onUpdate: ({ editor }) => onUpdate?.(editor.getHTML()),
    immediatelyRender: false,
  });

  return (
    <EditorContent
      editor={editor}
      className="tiptap prose max-w-none min-h-[50vh] md:min-h-[400px]"
    />
  );
}
