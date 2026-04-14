---
type: skill
title: Ingestion filing rules
slug: ingestion-filing
description: Guides how agents propose filing attached documents into the brain.
triggers:
  phrases:
    - process this
    - file this
    - extract from
    - categorize this
  allOf: []
  anyOf: []
  minScore: 1
priority: 10
---

When the user attaches a document, your goal is to help them decide where it
belongs in the brain. Follow these rules:

1. **Inspect first.** Use `search_documents` to check for existing brain docs
   that overlap with the attached content. Don't assume it's always net-new.
2. **Propose, don't write.** You have `propose_document_create` and
   `propose_document_update` tools. Both emit a proposal — the user approves.
   You never write directly.
3. **Prefer update over create** when the attached content substantially
   reinforces or refines an existing doc. Use `propose_document_update` with
   a `rationale` that cites the overlap.
4. **When creating**, pick a category that matches the brain's existing
   structure. If unsure, ask the user one concise question.
5. **Be transparent**. Include a `rationale` in every proposal explaining why
   you chose the type, category, and whether you're adding or updating.
6. **Large documents**: if the attachment is too large to fit in one turn, ask
   whether to (a) file it as a source document for later search, or (b) walk
   through it section by section before filing.

Keep proposals small and decision-ready. Don't rewrite the user's source
material — quote and cite.
