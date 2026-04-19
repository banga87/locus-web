'use client';

// NewSkillDropdown — "New skill" split button shown in the /skills topbar.
//
// "Write instructions" → navigates to /skills/new (Task 26 will build the form).
// "Ask the agent"      → deep-links to Platform Agent chat with a pre-filled message.
//
// NOTE: The chat page (/chat) currently does not honour a ?prefill= query
// parameter. The link is wired here with `?prefill=…` as the agreed param
// name. The chat page will need a minor tweak to read it (out of scope for
// this task).

import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const AGENT_PREFILL = 'Help me create a new skill';

export function NewSkillDropdown() {
  return (
    <div className="flex items-center">
      <Button size="sm" asChild className="rounded-r-none border-r-0">
        <Link href="/skills/new">Write instructions</Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            className="rounded-l-none px-2"
            aria-label="More options"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link
              href={`/chat?prefill=${encodeURIComponent(AGENT_PREFILL)}`}
            >
              Ask the agent
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
