---
type: skill
name: skill-creator
description: Create new skills or improve existing ones. Use when the user wants to codify a repeatable workflow, author a new skill from scratch, or refine an existing skill's description/instructions for better triggering and more reliable outputs.
---

# Skill Creator

A skill for helping users create new skills and iteratively improve them.

At a high level, the process of creating a skill goes like this:

- Decide what the skill should do and roughly how it should do it
- Write a draft of the skill
- Try it on a few realistic prompts
- Rewrite the skill based on what worked and what didn't
- When the skill is solid, optimise the description for reliable triggering

Your job when using this skill is to figure out where the user is in this process and help them progress. For instance, if a user says "I want to make a skill for X", help them narrow down what they mean, draft it, and try it on a realistic prompt. If they already have a draft, jump straight to refinement.

Be flexible. If the user just wants to vibe through it without formal evaluation, do that.

## Communicating with the user

Skill authors range widely in coding familiarity. Pay attention to context cues. In the default case:

- "description" and "frontmatter" are fine
- briefly explain YAML if you're unsure
- skip jargon when simpler words work

When in doubt, define a term in a short parenthetical rather than assuming.

---

## Creating a skill

### Capture Intent

Start by understanding what the user wants. The current conversation may already contain a workflow they want to capture (e.g., "turn this into a skill"). If so, extract answers from the conversation first — the steps they took, the corrections they made, the input/output formats. Fill gaps by asking, and confirm before proceeding.

Key questions:

1. What should this skill enable the agent to do?
2. When should it trigger? (What phrases or contexts would lead a user to need this?)
3. What's the expected output format?
4. What's different about this skill vs. the agent's baseline behaviour? If the answer is "nothing specific", the skill may not be needed.

### Interview and Research

Proactively ask about edge cases, input/output examples, success criteria, and dependencies. Wait to draft the skill until you've got a concrete picture.

If there are existing docs, examples, or similar skills in the brain, reference them — reducing the burden on the user by pulling context in.

### Write the SKILL.md

Based on the interview, fill in these components:

- **name**: A short, lowercase, hyphenated identifier.
- **description**: When to trigger and what the skill does. This is the single most important field — it's the **only** thing the agent sees until the skill body is loaded. Include both WHAT the skill does AND WHEN to use it. See `references/description-writing.md` for the full guide.
- **Body**: The actual instructions the agent follows when the skill is loaded.

---

## Skill Writing Guide

### Anatomy of a Skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (type, name, description required)
│   └── Markdown instructions
└── Bundled files (optional)
    └── references/   - Additional docs the agent can load on demand
```

### Progressive Disclosure

Tatara skills use a two-level loading system:

1. **Metadata** (name + description) — always visible to every turn (~100 words)
2. **SKILL.md body** — loaded when the agent decides the skill applies
3. **Bundled files** — loaded one at a time via `read_skill_file` when the agent needs deeper reference material

Keep SKILL.md under ~500 lines. If it's growing past that, split detailed content into `references/*.md` and point to it from the body. Example: a skill that handles three output formats can put the common workflow in SKILL.md and put `references/pdf.md`, `references/docx.md`, `references/html.md` as sibling files the agent loads on demand.

### The principle of lack of surprise

A skill's behaviour should not surprise the user given its description. Don't write skills that exfiltrate data, bypass safety checks, or do anything the user didn't clearly opt into. Role-play skills are fine; deception-by-default isn't.

### Writing Patterns

Prefer imperative form in instructions.

**Defining output formats** looks like this:

```markdown
## Report structure
Use this template:
# [Title]
## Executive summary
## Key findings
## Recommendations
```

**Examples pattern** — give 1–3 concrete, runnable examples rather than long abstract descriptions:

```markdown
## Commit message format
**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

### Writing Style

Explain WHY things matter rather than stacking "MUST" / "NEVER" keywords. Modern LLMs are smart; they follow reasoning better than rigid rules. If you find yourself writing ALWAYS in all caps, that's usually a signal to reframe — explain the reason and let the model decide.

Write a draft. Put it down. Come back to it with fresh eyes. Trim what isn't pulling its weight.

---

## Iterate on the skill

Once the user has tried the skill on a realistic prompt, ask:

- Did the agent trigger the skill when it should have?
- Did the output match what the user wanted?
- Were there places the skill got in the way?

Based on what comes back, improve the skill. Rules of thumb:

1. **Generalise from the feedback.** A skill that only works for the one example the user tested is useless. If there's a stubborn issue on one prompt, consider that the framing or metaphor might be wrong — try a different approach instead of layering more specific rules.

2. **Keep the prompt lean.** Remove things that aren't helping. Content you add because "it might help" usually doesn't — and it competes with the parts that do.

3. **Explain the why.** When asking the agent to do something unusual, explain the reasoning. The model extends reasoning better than it follows rote rules.

4. **Look for repeated work.** If every run of the skill independently reinvents the same helper or approach, bundle it. Either codify it in the skill body or add a reference file the skill points to.

Repeat until the skill is solid and the user is happy.

---

## Description Optimisation

After the skill's body is in good shape, optimise the description. The description is the primary mechanism that determines whether the agent will load the skill, so it deserves deliberate attention.

See `references/description-writing.md` for the full guide, including examples of undertriggered and overtriggered skills and how to diagnose each.

---

## Updating an existing skill

The user may be asking you to modify an existing installed or authored skill rather than create a new one. A few specific things:

- **Preserve the name** in the frontmatter. Changing the name breaks any agent-definition that listed the old name.
- **Installed skills are read-only.** If the user wants to change an installed skill, fork it first (from the skill's detail page), then edit the fork.
- **When the description changes, re-read the description guide.** A bad description is the most common failure mode.

---

That's it. Good luck. Skills get better through iteration, not through one heroic draft.
