import type { ActiveAgent, GraphMcpConnection } from '@/lib/brain-pulse/types';

interface Props {
  agents: ActiveAgent[];
  mcpConnections: GraphMcpConnection[];
  mcpCounts: Record<string, number>;
  agentSparklines?: Record<string, number[]>;
  selectedAgentId: string | null;
  onSelect: (agentId: string | null) => void;
}

export function AgentSidebar({
  agents,
  mcpConnections,
  mcpCounts,
  agentSparklines = {},
  selectedAgentId,
  onSelect,
}: Props) {
  return (
    <aside className="neurons-sidebar" aria-label="Active agents and MCP connections">
      <section>
        <h2 className="neurons-sidebar__label">Agents</h2>
        {agents.length === 0 ? (
          <p className="neurons-sidebar__empty">No agents active yet.</p>
        ) : (
          <ul className="neurons-sidebar__list">
            {agents.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="neurons-sidebar__row"
                  data-selected={selectedAgentId === a.id}
                  style={{ ['--agent-color' as string]: a.color.canvas }}
                  onClick={() => onSelect(selectedAgentId === a.id ? null : a.id)}
                >
                  <span
                    className="neurons-sidebar__dot"
                    style={{ background: a.color.canvas }}
                    aria-hidden
                  />
                  <span className="neurons-sidebar__name">{a.name}</span>
                  <Sparkline values={agentSparklines[a.id] ?? []} color={a.color.canvas} />
                  <span className="neurons-sidebar__count">{a.countLast60s}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selectedAgentId && (
          <button
            type="button"
            className="neurons-sidebar__view-all"
            onClick={() => onSelect(null)}
          >
            View All
          </button>
        )}
      </section>

      <section>
        <h2 className="neurons-sidebar__label">External MCP</h2>
        {mcpConnections.length === 0 ? (
          <p className="neurons-sidebar__empty">No MCP connections.</p>
        ) : (
          <ul className="neurons-sidebar__list">
            {mcpConnections.map((m) => (
              <li
                key={m.id}
                data-testid={`mcp-row-${m.id}`}
                data-status={m.status}
                className="neurons-sidebar__mcp-row"
              >
                <span
                  className={`neurons-sidebar__health neurons-sidebar__health--${m.status}`}
                  aria-label={`status ${m.status}`}
                />
                <span className="neurons-sidebar__name">{m.name}</span>
                <span className="neurons-sidebar__count">{mcpCounts[m.id] ?? 0}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

const SPARK_BARS = 8;

function Sparkline({ values, color }: { values: number[]; color: string }) {
  // Pad/trim to exactly SPARK_BARS buckets, oldest→newest.
  const slice = values.slice(-SPARK_BARS);
  const padded: number[] = Array(SPARK_BARS - slice.length).fill(0).concat(slice);
  const max = Math.max(1, ...padded);

  return (
    <span
      className="neurons-sidebar__spark"
      aria-hidden
      style={{ ['--spark-color' as string]: color }}
    >
      {padded.map((v, i) => {
        const h = v === 0 ? 14 : 22 + Math.round((v / max) * 78);
        return (
          <span
            key={i}
            className="neurons-sidebar__spark-bar"
            data-empty={v === 0}
            style={{ height: `${h}%` }}
          />
        );
      })}
    </span>
  );
}
