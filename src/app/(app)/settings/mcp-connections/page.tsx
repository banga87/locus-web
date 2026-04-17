// Legacy MCP connections settings page. Superseded by `/connectors`.
// Task 18 deletes this file outright; until then it renders `notFound`
// so the route is effectively gone and we don't ship dead imports
// pointing at already-removed legacy components.

import { notFound } from 'next/navigation';

export default function LegacyMcpConnectionsPage() {
  notFound();
}
