# Changelog

## 0.1.1-alpha2 — 2026-11-11

- Show numeric local progress on fresh installations, including tasks without a checklist. Use task priors and execution evidence as the primary signals; history remains a small optional refinement.
- Let evidence-driven progress continue beyond a fixed single-stage budget while preserving independent weighted checklist items.
- Add estimated remaining time from progress and elapsed time, with stable anchors, second-level AI display, minute-level local display, and a positive running floor.
- Keep resumed teammate timing separate from cumulative card time, and hide remaining time after completion or interruption.
- Detect browser/backend version mismatches in task details; retain a conservative numeric fallback until the host is restarted.
- Recover previously unpriced probe usage without duplicating new fees or discarding frozen known amounts.
- Keep stale or unsupported AI responses out of AI observation history when local fallback is displayed.

Host requirement: **DSH `0.2.2-rc.1`, Web profile, Node.js `>=24.9.0`**. Percentages and remaining time are estimates.

## 0.1.1-alpha1 — 2026-11-11

- Add local approximate percentages without AI, including independent weighted checklist items and teammate contributions.
- Combine execution evidence, task-type priors, and bounded comparable-work history; exclude waiting, repeated polls, and persistent services from work credit.
- Preserve task ownership across parallel dispatch, mode changes, interruption, and cold recovery.
- Keep overall task summaries distinct from the current command.
- Include probe-only pricing without requiring another plugin, with separate cache buckets, price history, peak schedules, and configurable overrides.
- Fix trend tooltips hidden by the floating panel’s positioning and clipping.

Host requirement: **DSH `0.2.2-rc.1`, Web profile, Node.js `>=24.9.0`**. Local percentages remain estimates; only a successful turn end establishes `100%`.

## 0.1.0-rc1 — 2026-11-10

First standalone community release of task progress for DeepSeek Harness Web.

- Add a task progress panel for DeepSeek Harness Web.
- Use independent routes, browser keys, styles, and local data, with non-destructive migration of eligible legacy progress data.
- Show the current turn, recent operation, tool activity, checklists, and independent teammate details.
- Identify teammate sources in trend-point details; support horizontal scrolling and keyboard focus.
- Keep AI observations optional and disabled by default. Use explicit Off reasoning, bounded event-driven queues, and three observation modes.
- Prioritize supported verification and delivery evidence without fabricating intermediate percentages or delaying an authoritative completion event.
- Preserve local checklist checkpoints when AI is disabled; isolate old responses during setting changes.
- Show command progress from supported native counters, frame/FPS output, FFmpeg, and tqdm signals. Use activity bars when evidence is insufficient and `∞` for recognized persistent services.
- Estimate main and teammate probe costs separately from project execution costs. Preserve unknown usage or pricing rather than treating it as zero.

Host requirement: **DSH `0.2.2-rc.1`, Web profile, Node.js `>=24.9.0`**. Other host versions and profiles are not supported in this release candidate.
