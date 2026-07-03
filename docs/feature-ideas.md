# Exo Feature Ideas

Last updated: 2026-07-03

This file captures product ideas that are not yet ready for implementation planning. Keep entries concrete enough to preserve the idea, but avoid turning them into active commitments until they graduate into `tasks.md`, `roadmap.md`, or an implementation spec.

## Personal AI Feeds

Status: idea capture

### Problem

AI agents can call MCP servers and other data-source tools, but those calls are usually transient. The agent sees the result, answers the user, and the source material often disappears from the user's durable workspace unless the agent manually writes notes. That makes external context hard to curate, search, revisit, and connect to the exograph.

Exo should support configurable personal feeds: streams of incoming or generated context that can be tailored by AI, reviewed by the user, and selectively promoted into the searchable exograph.

### Core Idea

A feed is a personalized, queryable stream over connected sources. Sources can include RSS feeds, newsletters, email, Discord messages, web clips, bookmarks, MCP tool results, agent outputs, project events, git events, eval artifacts, voice transcripts, and future plugin-owned data sources.

Each feed item should preserve provenance and enough source metadata to be inspectable later, while allowing AI to tailor how it appears: summaries, topic clustering, ranking, deduplication, source comparison, follow-up questions, or relevance explanations.

The feed should not assume that every item becomes durable memory. Some feeds may auto-index everything. Others may stay ephemeral until the user acts on an item. Some may index only summaries, metadata, or selected excerpts.

### Product Principles

- Feeds are broader than an inbox. Inbox workflows can be built on top, but Exo should not require a fixed `/inbox/` folder or a single processing ritual.
- Feed items are reviewable inputs, not automatically approved graph facts.
- Source connectors should be plugin-shaped where possible. Core should own the minimal feed item, provenance, review, indexing-policy, and action contracts.
- AI tailoring should be visible and reversible. The user should be able to inspect source material, generated summaries, and why an item appeared.
- Feed indexing policy should be explicit per source and per feed. Sensitive sources such as email or private messages may need conservative defaults.
- Human actions on feed items should become useful preference signals without silently rewriting durable notes.

### Feed Item Model

A feed item probably needs:

- stable id, source id, source type, source URL or local reference when available
- observed timestamp, source timestamp, and ingestion timestamp
- title, author/sender, channel/list/feed name, tags/topics, and source-specific metadata
- raw content pointer or excerpt, generated summary, and optional AI rationale
- provenance references to connector runs, MCP calls, agent sessions, or imported files
- indexing state: not indexed, metadata indexed, summary indexed, full content indexed, promoted to note, or excluded
- review state: unseen, seen, liked, dismissed, archived, muted, promoted, researched, or linked
- sensitivity/privacy flags and retention policy

The raw body does not always need to live in the main notes index. For private or high-volume feeds, Exo may store source artifacts under `.exo/` and index only summaries or metadata until the user promotes the item.

### Source Configuration

Each source should let the user configure:

- ingestion cadence: manual, on app start, scheduled, webhook/push, or plugin-triggered
- selection rules: include/exclude channels, labels, authors, domains, folders, keywords, or saved queries
- AI tailoring rules: summarize, cluster, rank, dedupe, explain relevance, extract tasks, or compare against existing notes
- indexing policy: auto-index, never-index, action-gated indexing, summary-only indexing, metadata-only indexing, or explicit per-item choice
- retention policy: keep raw, keep summary only, expire after N days, archive after review, or preserve only promoted items
- permission scope: read-only source access, network access, local artifact storage, model calls, note proposals, or direct note writes

### Item Actions

Initial actions to consider:

- Like: records a preference signal for ranking, topic modeling, and future tailoring.
- Add note / create page: promotes the item into a user-owned Markdown note or creates a proposed note.
- Link to existing node: connects the item to an existing project, entity, source, task, or concept.
- Research: launches one or more supervised subagents or routines to investigate the topic, returning an artifact or proposal.
- Summarize differently: asks AI to rewrite for a different lens, level of detail, or project context.
- Extract tasks: proposes tasks without directly mutating `tasks.md` unless approved.
- Archive / dismiss: removes the item from active review without necessarily deleting the source artifact.
- Mute source/topic/author: updates feed selection or ranking rules.

### Query And Index Relationship

Feeds should be queryable even when they are not fully promoted into notes. The likely split:

- Feed store: source artifacts, item metadata, review state, action history, retention, and provenance under `.exo/`.
- Search provider index: selected fields according to source/feed policy.
- Exograph links: approved or proposed relationships from feed items to notes, entities, projects, tasks, sources, activities, and artifacts.
- Markdown notes: durable user-owned synthesis only after promotion, creation, or approved proposal.

This lets Exo answer questions like "show me recent Discord messages about terminal bugs", "what feed items did I like about personal AI?", or "which newsletter items became notes?" without forcing all external content into permanent Markdown.

### Open Questions

- What is the smallest useful feed UI: one global feed, per-source feeds, saved feed queries, or project-scoped feeds?
- Should feed personalization be mostly local ranking metadata, generated summaries, or a user-editable profile?
- Which sources deserve first-party connectors versus plugin examples?
- How should Exo handle private-message and email retention by default?
- Should "research" create a Routine run, an activity record, a workcell, or a specialized research artifact?
- How should feed likes influence retrieval and ranking without becoming opaque or hard to reset?
- What MCP surface should agents get: read-only feed search, item promotion proposals, research launch, or no feed access until explicit permission?

### Graduation Criteria

Promote this idea into a real design/spec when one of these becomes true:

- a real Exo-on-Exo workflow needs feed-like review of agent outputs, MCP messages, or project events
- a connector such as RSS, email, or Discord becomes important enough to dogfood
- the exograph profile model needs explicit feed promotion rules
- search/index policy needs to cover non-Markdown source artifacts

Until then, keep implementation pressure on daily-use reliability, plugin architecture, CLI/MCP orientation, and the minimal activity substrate.
