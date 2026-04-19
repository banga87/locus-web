'use client';

// InstallButton — thin client wrapper that holds open state for the
// InstallModal. Rendered by the server-component /skills page.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { InstallModal } from './install-modal';

export function InstallButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        data-test="install-button"
        onClick={() => setOpen(true)}
      >
        Install from GitHub
      </Button>
      <InstallModal open={open} onOpenChange={setOpen} />
    </>
  );
}
