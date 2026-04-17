'use client';

import Image from 'next/image';
import { Plug } from 'lucide-react';

import type { ConnectorCatalogEntry } from '@/lib/connectors/catalog';

interface Props {
  entry: ConnectorCatalogEntry | 'custom';
  onClick: () => void;
}

export function ConnectorTile({ entry, onClick }: Props) {
  const isCustom = entry === 'custom';
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-4 text-left transition hover:border-primary/40 hover:bg-accent"
    >
      <div className="flex size-10 items-center justify-center rounded-md bg-muted">
        {isCustom ? (
          <Plug size={20} />
        ) : (
          <Image src={entry.iconUrl} alt="" width={24} height={24} />
        )}
      </div>
      <div className="font-medium">{isCustom ? 'Custom connector' : entry.name}</div>
      <div className="text-xs text-muted-foreground">
        {isCustom ? 'Point at any MCP endpoint.' : entry.description}
      </div>
    </button>
  );
}
