// Server-safe markdown renderer. `marked` is framework-agnostic and runs
// fine in a Server Component — we parse once on the server and send HTML
// to the client.

import { marked } from 'marked';

interface Props {
  markdown: string;
}

export function DocumentRenderer({ markdown }: Props) {
  // `marked.parse` is synchronous when given a string (the async signature
  // kicks in only when you register async extensions, which we don't).
  const html = marked.parse(markdown, { async: false }) as string;
  return (
    <article
      className="prose prose-zinc max-w-none dark:prose-invert"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
