# Skills

Tatara implements Anthropic-style progressive-disclosure skills. The runtime
model is:

1. Every skill's `name` + `description` is injected into the agent's system
   prompt via `<available-skills>` (see `src/lib/agent/system-prompt.ts`).
2. The agent calls `load_skill(id)` when a description matches the task.
3. The agent optionally calls `read_skill_file(skill_id, relative_path)` to
   follow references inside the SKILL.md body.

Authoritative storage: `documents` rows with `type='skill'` (roots) and
`type='skill-resource'` (nested files; `parent_skill_id` + `relative_path`).

See `docs/superpowers/specs/2026-04-18-skills-progressive-disclosure-design.md`.
