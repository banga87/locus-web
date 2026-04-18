import Link from 'next/link';
import type { NarrativeLine } from '@/lib/brain-pulse/event-formatters';

interface Props {
  lines: NarrativeLine[];
  agentColors?: Record<string, string>;
}

export function NarrativeStrip({ lines, agentColors = {} }: Props) {
  return (
    <div
      className="neurons-narrative"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      <h2 className="neurons-narrative__label">Activity</h2>
      {lines.length === 0 && (
        <p className="neurons-narrative__empty">Waiting for agent activity...</p>
      )}
      {lines.map((line) => {
        const color = line.actorId ? agentColors[line.actorId] : undefined;
        return (
          <div key={line.id} className="neurons-narrative__line" data-type={line.type}>
            <div className="neurons-narrative__text">
              {renderLineBody(line, color)}
            </div>
            <time className="neurons-narrative__time" dateTime={new Date(line.createdAt).toISOString()}>
              {formatTime(line.createdAt)}
            </time>
          </div>
        );
      })}
    </div>
  );
}

function renderLineBody(line: NarrativeLine, color: string | undefined) {
  const { actorName, text, docPath } = line;

  // Find where the actor name is in the text so we can color it separately.
  const nameEnd = actorName && text.startsWith(actorName) ? actorName.length : 0;
  const rest = nameEnd > 0 ? text.slice(nameEnd) : text;

  const actorSpan = nameEnd > 0 && actorName
    ? (
        <span
          className="neurons-narrative__actor"
          style={color ? { color } : undefined}
        >
          {actorName}
        </span>
      )
    : null;

  // If we have a docPath, render the part of `rest` that contains the path as an italic link.
  if (docPath) {
    const idx = rest.indexOf(docPath);
    if (idx >= 0) {
      return (
        <>
          {actorSpan}
          <span>{rest.slice(0, idx)}</span>
          <Link href={docPath} className="neurons-narrative__path">
            {docPath}
          </Link>
          <span>{rest.slice(idx + docPath.length)}</span>
        </>
      );
    }
  }
  return (
    <>
      {actorSpan}
      <span>{rest}</span>
    </>
  );
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
