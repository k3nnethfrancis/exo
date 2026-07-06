---
name: deslopify-frontend
description: Use before changing Exo setup, settings, manager, or onboarding UI to keep screens dense, scannable, and low-prose.
---

# Deslopify Frontend

Use this before changing Exo UI that configures the product: onboarding, settings, Plugin Manager, Agent Config Editor, profile setup, terminal setup, or other setup/management surfaces.

## Standard

Exo UI should feel like a precise workstation, not a technical plan review. Screens should show the user's next decision as a control, not as a paragraph.

## Rules

- Cut copy to the minimum words needed to make the next action safe.
- Prefer direct controls: toggles, checkboxes, segmented controls, icon buttons, menus, and status pills.
- Put the most concrete choices first. In setup flows, show choices the user can understand now before abstract concepts such as profiles, routines, or future permissions.
- Use width before vertical scrolling on desktop. Avoid narrow tall modals for setup reviews.
- Make unavailable choices visibly unavailable and non-selectable. Do not preselect a tool, harness, provider, or plugin that Exo cannot detect as usable.
- Keep core features out of optional plugin choice lists. Core can be summarized, but it should not look like something the user must enable.
- Do not expose a profile/routine choice until the screen can explain the effect and conflict behavior clearly.
- For plugin/profile disagreements, prefer explicit review later over silent apply now.
- Verify the changed UI with screenshots or app QA, not just tests.

## Checklist

- [ ] Can the user understand the primary decision in five seconds?
- [ ] Are core, official plugin, local plugin, and unavailable states visually distinct?
- [ ] Are unavailable options disabled?
- [ ] Is the screen using available desktop width?
- [ ] Did you remove prose that duplicates labels, status pills, or controls?
- [ ] Did tests or QA cover the exact user-facing regression?

-- Exo | 2026-07-05
