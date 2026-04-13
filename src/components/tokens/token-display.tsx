'use client';

// One-shot display for a freshly created raw token. The backend only
// returns the plaintext secret on POST — users must copy it now, so we
// make that as obvious as possible.

import { useState } from 'react';
import { CopyIcon, CheckIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface Props {
  token: string;
}

export function TokenDisplay({ token }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Graceful degradation: some browsers / contexts block clipboard.
      // The user can still select and copy manually.
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
        Copy this token now. You won&apos;t be able to see it again.
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
          {token}
        </code>
        <Button variant="outline" size="sm" onClick={copy} type="button">
          {copied ? (
            <>
              <CheckIcon className="size-3.5" />
              Copied
            </>
          ) : (
            <>
              <CopyIcon className="size-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
