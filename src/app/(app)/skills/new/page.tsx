'use client';

// /skills/new — Quick-form skill creation (Path A).
//
// Three fields: name, description, instructions (plain markdown textarea).
// POSTs to /api/skills and redirects to /skills/[id] on success.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function NewSkillPage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    const trimmedInstructions = instructions.trim();

    if (!trimmedName) {
      setFormError('Skill name is required.');
      return;
    }
    if (!trimmedDescription) {
      setFormError('Description is required.');
      return;
    }
    if (!trimmedInstructions) {
      setFormError('Instructions are required.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          description: trimmedDescription,
          instructions: trimmedInstructions,
        }),
      });

      const payload = (await res.json().catch(() => null)) as
        | { data?: { skill_id?: string }; error?: { message?: string; code?: string } }
        | null;

      if (!res.ok) {
        const code = payload?.error?.code;
        if (code === 'slug_taken') {
          setFormError(
            `A skill named "${trimmedName}" already exists in this workspace. Choose a different name.`,
          );
        } else {
          setFormError(payload?.error?.message ?? `Failed to create skill (HTTP ${res.status}).`);
        }
        setSubmitting(false);
        return;
      }

      const skillId = payload?.data?.skill_id;
      if (!skillId) {
        setFormError('Skill created but no ID returned.');
        setSubmitting(false);
        return;
      }

      router.push(`/skills/${skillId}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create skill.');
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <nav className="crumbs" aria-label="Breadcrumb">
          <a href="/skills" className="crumb">Skills</a>
          <span className="cur">New skill</span>
        </nav>
      </div>

      <div className="article-wrap">
        <form
          onSubmit={handleSubmit}
          className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8"
        >
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">New skill</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Write a reusable instruction set for your agents. The instructions
              field becomes the body of the skill&apos;s{' '}
              <code className="text-xs font-mono">SKILL.md</code>.
            </p>
          </header>

          <div className="space-y-2">
            <Label htmlFor="skill-name">Skill name</Label>
            <Input
              id="skill-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Customer support tone"
              maxLength={200}
              autoFocus
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">Up to 200 characters.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="skill-description">Description</Label>
            <Textarea
              id="skill-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short summary of what this skill teaches agents."
              maxLength={1000}
              rows={3}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">Up to 1000 characters.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="skill-instructions">Instructions</Label>
            <Textarea
              id="skill-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Write the skill body in markdown. This becomes SKILL.md."
              rows={12}
              disabled={submitting}
              className="font-mono text-sm"
            />
          </div>

          {formError && (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" asChild>
              <Link href="/skills">Cancel</Link>
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create skill'}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
