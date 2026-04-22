# Agent Context Exploration: Knowledge Graphs for Locus

> Status: exploratory discussion notes, not a decision or plan.
> Date: 2026-04-22

## The problem being explored

Locus is a folder/file system for AI + humans — a version-controlled store of
business documentation (ICPs, pricing, processes, policies, playbooks) that
production agents (marketing, sales, ops, support) read from in order to make
grounded decisions about the current state of a business.

The structural problem this creates for live agents: **context window cost of
first-touch orientation**. To answer a task, an agent typically has to list
directories, open several files, discover more files, and continue walking
until it has enough context. Each hop consumes tokens, and large businesses
can have hundreds or thousands of documents.

Current mitigation is to have a parent agent spawn research sub-agents that
navigate the corpus and return compressed answers. This works but is
token-heavy, slow, and duplicates work across turns.

The question: is there a cheaper, more structured way to give agents an
"already navigated" view of a Locus tree?

## The candidate approach: graphify

Repo: https://github.com/safishamsi/graphify

Graphify builds a persistent, queryable knowledge graph over a corpus and
exposes it to AI assistants as a skill / pre-tool hook. Three extraction
passes:

1. **AST pass** — tree-sitter over 25 languages, deterministic, no LLM.
2. **Transcription pass** — faster-whisper for video/audio → text.
3. **Semantic pass** — Claude subagents extract concepts and typed
   relationships over docs, images, transcripts.

Output artifacts:

- `graph.json` — queryable graph (NetworkX + Leiden community detection).
- `GRAPH_REPORT.md` — god nodes, communities, "suggested questions" — a
  compressed navigation map.
- `cache/` — SHA256-based incremental rebuild.

Edges are typed: `EXTRACTED` (direct), `INFERRED` (reasoned, confidence
0.0–1.0), `AMBIGUOUS` (flagged). Hyperedges group 3+ related nodes.

Query surface:

- `graphify query <topic>` — subgraph extraction with a token budget.
- `graphify path <a> <b>` — shortest-path traversal.
- `graphify explain <node>` — node-specific context retrieval.

Claimed **71.5× token reduction** vs. reading source files — this is a
query-side number; the write path pays LLM extraction tokens.

## What genuinely applies to Locus

1. **Navigation map as first-touch context.** A per-branch
   `GRAPH_REPORT.md`-equivalent (≤3k tokens, enumerating god nodes and
   communities) replaces a lot of blind traversal. This is the single
   highest-ROI idea.
2. **Bounded subgraph queries as a tool primitive.** `locus.query(topic,
   token_budget=N)` returning a typed subgraph is a much better agent tool
   than `list_dir` + `read_file`. It ends random walks.
3. **Commit-triggered incremental rebuild.** Content-hash caching fits our
   commit/diff semantics cleanly. Graph rebuilds become commit side effects.
4. **Community detection → implicit business taxonomy.** Leiden on
   document-level nodes could surface structure ("everything connected to
   Enterprise pricing") without hand-curated tags.
5. **Harness boundary is respected.** Per `AGENTS.md`, the retrieval tool
   sits behind the tool bridge in `src/lib/agent/`. Graphify's data model
   has no Next.js/Vercel coupling, so this slots in without violating the
   platform-agnostic rule.

## Where graphify is a poor fit for Locus as-is

1. **~⅓ of graphify's value is the AST pass. We are not code.** Strip that
   out and we're effectively evaluating a concept-extraction pipeline. At
   that point the real comparison is GraphRAG / LightRAG / Microsoft's
   reference GraphRAG implementation, not this specific repo.
2. **Write amplification is the real cost in a *living* KB.** Graphify
   targets a codebase where most files are stable. Locus is multi-writer,
   edited by humans **and** agents. Every edit → LLM extraction calls. The
   read savings can be eaten by extraction costs if doc churn is high. The
   deciding ratio is:

   ```
   (tokens saved per read) × (reads per doc per period)
   vs.
   (tokens spent per extraction) × (edits per doc per period)
   ```

   This is workload-specific. We would need to instrument it.
3. **`INFERRED` edges are a liability in production ops.** In code, a
   hallucinated edge gets caught by tests. In a live sales agent, an
   inferred "refund policy applies to enterprise" edge ships a wrong
   promise to a customer. Confidence scores do not save us — agents do not
   reliably gate on them. Any graph we build must make `EXTRACTED` vs
   `INFERRED` brutally visible, and probably forbid inferred edges from
   authoritative answers.
4. **Permissions / tenancy.** Graphify is single-tenant. Our graph has to
   respect per-user/per-role visibility. Edge *existence* can leak facts
   even when endpoints are gated (e.g. "there is an edge between Customer X
   and Churn Risk" reveals the fact without reading either node).
   Retrofitting ACLs onto a knowledge graph is non-trivial and is the risk
   item I would weight highest.
5. **Version / branch semantics.** Graphify treats the graph as a build
   artifact. Locus has branches and commits as first-class objects. We
   would have to decide: graph-per-commit (expensive, precise),
   graph-per-branch-HEAD (cheap, loses "what did the agent see at commit
   X?"), or live-computed delta over a base snapshot. Graphify punts on all
   of these.
6. **Integration surface is CLI + PreToolUse hooks.** That is
   Claude-Code-ergonomics. Our consumers are production agents hitting an
   API. We would keep the data model and throw away the integration layer.
7. **Scale ceiling.** NetworkX + Leiden is fine at org scale but may not
   hold at very large enterprises with 100k+ documents. Not a dealbreaker,
   worth a load test if we go that way.

## Recommendation

**Steal the pattern, not the repo.** Three things worth prototyping, in
order of ROI:

### 1. Per-branch `OVERVIEW.md` equivalent (cheapest, highest ROI)

Auto-generated, commit-triggered, ≤3k tokens, produced by rolling up folder
summaries bottom-up. Hierarchical summarization, not concept extraction.
This captures ~80% of the first-touch-context win and requires no graph
infrastructure. It is also naturally versioned — it lives in the tree like
any other file.

### 2. Bounded semantic retrieval tool

`locus.retrieve(query, budget)` returning ranked document *chunks* with
their path and most-recent commit. Boring, cheap, works. Covers "agent
needs a specific fact" without any graph.

### 3. Only then, a concept graph layer on top

And only if #1 + #2 leave a measurable gap. If we build it:

- Treat `INFERRED` edges as non-existent for any agent that writes to
  customers or external systems. Expose them only to research sub-agents
  whose outputs must cite source docs.
- Design ACLs into the graph from day one — do not retrofit.
- Pick the branch-versioning model explicitly before shipping.
- Own the eval harness for extraction quality. Without that, drift is
  invisible.

## Reframe

The framing "context window is the problem" is a symptom. The real problem
is **agents do not know where to look first**. A graph is one answer.
Hierarchical summary + decent retrieval is a cheaper answer that ships
sooner. Build the cheap one, measure residual pain, then decide whether to
own a knowledge-graph pipeline — because if we build it, we own the whole
surface: extraction evals, ACL propagation, branch semantics, rebuild
economics.

## Open questions for later

- What is the actual read-to-edit ratio per document in a representative
  Locus tenant? (Determines whether graph extraction amortizes.)
- Do we have a latency budget for retrieval at agent turn start? (Rules in
  or out live-computed vs. pre-built indices.)
- How do we want branches and commits to interact with any index —
  snapshot per commit, HEAD-only, or delta?
- How do we surface `EXTRACTED` vs `INFERRED` provenance to a consuming
  agent in a way it cannot ignore?
- Where does access control live — source doc only, or re-enforced on the
  graph? (Almost certainly both; the question is enforcement order.)
- What is our eval story for extraction correctness over time?

## Related constraints to remember

- `src/lib/agent/` must stay platform-agnostic. Any retrieval tool lives
  behind the tool bridge; route-layer code translates HTTP ↔ context.
- Any index / graph artifact should be reachable from both Next.js route
  handlers today and long-running worker surfaces (WDK, autonomous loop)
  tomorrow without a rewrite.
