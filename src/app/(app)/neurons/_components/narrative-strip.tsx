import Link from 'next/link';
import type { NarrativeLine } from '@/lib/brain-pulse/event-formatters';

interface Props {
  lines: NarrativeLine[];
}

export function NarrativeStrip({ lines }: Props) {
  return (
    <div
      className="neurons-narrative"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      {lines.length === 0 && (
        <p className="neurons-narrative__empty">Waiting for agent activity...</p>
      )}
      {lines.map((line) => (
        <div key={line.id} className="neurons-narrative__line" data-type={line.type}>
          {line.docPath ? renderWithLink(line.text, line.docPath) : <span>{line.text}</span>}
        </div>
      ))}
    </div>
  );
}

function renderWithLink(text: string, docPath: string) {
  const idx = text.indexOf(docPath);
  if (idx < 0) return <span>{text}</span>;
  return (
    <>
      <span>{text.slice(0, idx)}</span>
      <Link href={docPath}>{docPath}</Link>
      <span>{text.slice(idx + docPath.length)}</span>
    </>
  );
}
