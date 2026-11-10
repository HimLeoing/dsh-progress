# Changelog

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
