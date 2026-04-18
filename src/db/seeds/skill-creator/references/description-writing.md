# Writing great skill descriptions

The `description` field is the most important part of a skill. It's the only thing the agent sees until the skill body is actually loaded, which means it carries the full weight of deciding when the skill triggers. A bad description makes a good skill useless; a good description makes even a simple skill reliable.

## The two failure modes

Skills fail in one of two ways:

1. **Undertriggering** — the skill should apply, but the agent doesn't load it. Usually caused by a narrow description that misses related phrasings.
2. **Overtriggering** — the agent loads the skill for prompts it shouldn't apply to. Usually caused by a vague description that sounds relevant to too many things.

Both hurt. Undertriggering is worse for MVP (the user wrote the skill for a reason), but overtriggering wastes tokens and confuses the agent about what tool to use.

## Structure

A good description answers two questions in order:

1. **What does this skill do?** One concrete sentence.
2. **When should the agent use it?** A second sentence that names specific triggers: topics, input shapes, user phrasings.

Example that undertriggers:

> Formats CSV files.

The agent only loads it when the user says "CSV" explicitly. A user who says "my data" or "the spreadsheet" gets nothing.

Better:

> Format tabular data — CSV, TSV, or Excel exports — into tidy, well-typed tables. Use whenever the user mentions spreadsheets, rows/columns, a data file, or wants to clean up a messy dataset.

Now the agent has hooks on "spreadsheet", "data file", "tidy", "columns" — all the ways a user might actually phrase the task.

## Be a little pushy

Agents today often **undertrigger** skills — they default to "I'll just do it myself" even when a skill would help. To counter this, descriptions can be mildly pushy:

- "Use whenever the user mentions X." (instead of "Use for X.")
- "Prefer this skill over default behaviour when Y."
- "Load this skill first if Z is involved, even if the user didn't explicitly ask for it."

This is fine in moderation. If every skill claims primacy, the agent learns to ignore the pushiness — so reserve it for real specificity.

## Avoid filler

- Don't repeat the skill name in the description. ("The brand-voice skill handles brand voice guidance" is 0% information.)
- Don't promise capabilities that aren't in the body.
- Don't list the file tree or resources in the description — those are visible through the detail page.

## Diagnosing a bad description

If a skill isn't triggering:

1. Read the description as if you'd never seen the skill. Would YOU know when to load it? If you're not sure, the agent isn't either.
2. Ask the user for 3 realistic prompts that SHOULD trigger it. Read them through your description — does each one contain a phrase that clearly maps?
3. Ask the user for 3 prompts that should NOT trigger it. Would your description accidentally catch any of them?

If the answers aren't clear and consistent, rewrite.

## The meta-trick

Imagine the agent has 50 skills available. Each one has a one-paragraph description. Your description is competing with 49 others for attention. The one that wins is:

- Specific enough that the agent can tell when to pick it
- Concrete enough that the agent doesn't have to guess at the intent
- Decisive — it tells the agent "use me" rather than "I'm one of many things you might consider"

Write like you're pitching in a room full of other skills. Earn the trigger.

---

Good descriptions are short (2–3 sentences), specific, and written with the agent's perspective in mind, not the user's.
