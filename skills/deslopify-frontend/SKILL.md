---
name: deslopify-frontend
description: Use before changing Exograph onboarding, settings, AgentCommand config, mention confirmation, graph context, or diff/attribution UI to keep screens dense, scannable, and low-prose.
---

# Deslopify Frontend

Use this before changing Exograph UI that configures or reviews the product: onboarding, settings, Agent Config as instruction-files/context/agent-commands, mention confirmation, graph context, terminal setup, and invocation diff/attribution.

## Standard

Exo UI should feel like a precise workstation, not a technical plan review. Screens should show the user's next decision as a control, not as a paragraph.

## Rules

- Cut copy to the minimum words needed to make the next action safe.
- Prefer direct controls: toggles, checkboxes, segmented controls, icon buttons, menus, and status pills.
- Put the most concrete choices first. In setup flows, show choices the user can understand now before abstract concepts or future permissions.
- Use width before vertical scrolling on desktop. Avoid narrow tall modals for setup reviews.
- Make unavailable choices visibly unavailable and non-selectable. Do not preselect a command, provider, or terminal dependency that Exo cannot detect as usable.
- Keep core features out of optional setup choice lists. Core can be summarized, but it should not look like something the user must enable.
- Prefer explicit review later over silent apply now.
- Verify the changed UI with screenshots or app QA, not just tests.

## Checklist

- [ ] Can the user understand the primary decision in five seconds?
- [ ] Are core, optional provider/command, local configuration, and unavailable states visually distinct?
- [ ] Are unavailable options disabled?
- [ ] Is the screen using available desktop width?
- [ ] Did you remove prose that duplicates labels, status pills, or controls?
- [ ] Did tests or QA cover the exact user-facing regression?

-- Exo | 2026-07-08
