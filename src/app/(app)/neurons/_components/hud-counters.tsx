interface Props {
  activeAgentCount: number;
  eventRate60s: number;
  totalDocs: number;
}

export function HudCounters({ activeAgentCount, eventRate60s, totalDocs }: Props) {
  return (
    <div className="neurons-hud" aria-hidden="true">
      <span className="neurons-hud__pill">{activeAgentCount} agents</span>
      <span className="neurons-hud__pill">
        {eventRate60s > 0 && <span className="neurons-hud__led" />}
        {eventRate60s} events · 60s
      </span>
      <span className="neurons-hud__pill">{totalDocs} docs</span>
    </div>
  );
}
