'use client';

// ForkButton — POSTs /api/skills/[id]/fork and navigates to the new skill.
// Only rendered for installed skills (origin.kind === 'installed').

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GitForkIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface ForkButtonProps {
  skillId: string;
}

export function ForkButton({ skillId }: ForkButtonProps) {
  const router = useRouter();
  const [forking, setForking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFork() {
    setForking(true);
    setError(null);

    try {
      const res = await fetch(`/api/skills/${skillId}/fork`, { method: 'POST' });
      const body: { success: boolean; data?: { skill_id: string }; error?: { code: string; message: string } } =
        await res.json();

      if (!body.success || !body.data) {
        const msg = body.error?.message ?? 'Fork failed. Please try again.';
        setError(msg);
        return;
      }

      router.push(`/skills/${body.data.skill_id}`);
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setForking(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={handleFork} disabled={forking}>
        <GitForkIcon className="mr-1.5 size-3.5" />
        {forking ? 'Forking…' : 'Fork'}
      </Button>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
