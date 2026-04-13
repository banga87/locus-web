'use client';

// Right-rail metadata editor. Emits a partial change object for any field
// the user touches; the parent editor batches these into a debounced PATCH.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface FrontmatterValue {
  title: string;
  status: 'draft' | 'active' | 'archived';
  confidenceLevel: 'high' | 'medium' | 'low';
  ownerId: string | null;
}

interface UserOption {
  id: string;
  label: string;
}

interface Props {
  value: FrontmatterValue;
  owners: UserOption[];
  onChange: (patch: Partial<FrontmatterValue>) => void;
}

export function FrontmatterSidebar({ value, owners, onChange }: Props) {
  return (
    <aside className="w-full space-y-5 rounded-lg border border-border bg-card p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Document
      </h2>

      <div className="space-y-2">
        <Label htmlFor="fm-title">Title</Label>
        <Input
          id="fm-title"
          value={value.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>Status</Label>
        <Select
          value={value.status}
          onValueChange={(v) => {
            if (v) onChange({ status: v as FrontmatterValue['status'] });
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Confidence</Label>
        <Select
          value={value.confidenceLevel}
          onValueChange={(v) => {
            if (v)
              onChange({
                confidenceLevel: v as FrontmatterValue['confidenceLevel'],
              });
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Owner</Label>
        <Select
          value={value.ownerId ?? ''}
          onValueChange={(v) => onChange({ ownerId: v ? v : null })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Unassigned" />
          </SelectTrigger>
          <SelectContent>
            {owners.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </aside>
  );
}
