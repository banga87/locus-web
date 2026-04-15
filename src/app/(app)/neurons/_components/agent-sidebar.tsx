import type { ActiveAgent, GraphMcpConnection } from '@/lib/brain-pulse/types';

interface Props {
  agents: ActiveAgent[];
  mcpConnections: GraphMcpConnection[];
  mcpCounts: Record<string, number>;
  selectedAgentId: string | null;
  onSelect: (agentId: string | null) => void;
}

export function AgentSidebar({
  agents,
  mcpConnections,
  mcpCounts,
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
                  onClick={() => onSelect(selectedAgentId === a.id ? null : a.id)}
                >
                  <span
                    className="neurons-sidebar__dot"
                    style={{ background: a.color.css }}
                    aria-hidden
                  />
                  <span className="neurons-sidebar__name">{a.name}</span>
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
