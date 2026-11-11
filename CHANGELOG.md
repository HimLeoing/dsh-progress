# Changelog

## 0.1.1-alpha3 — 2026-11-11

[中文](#中文) | [English](#english)

### 中文

新增功能：

- 阅读位置与右侧轮次导航可切换历史进度，主任务和子代理状态按轮次隔离保存。
- 增加开发者模式，可查看或导出探针的调用时间、完整服务输入、输出流和用量；默认关闭，日志仅保存在本机并按容量轮换。
- 任务详情右下角显示版本，标题栏提示更新的 RC。两次点击确认后核验安装包，通过官方安装器更新并重启。

体验优化：

- 完成证据充分且正在输出文字时，可进入可撤回的约 99% 收尾状态；新的工具调用或返工会恢复执行进度。
- 提供方未声明支持 Off 时，采用模型最低强度档位；无推理档控制的模型使用原生配置。
- 限制历史与日志存储，减少流式输出期间的轮次检测工作，完整日志按需渲染。

问题修复：

- 修复进度曲线悬停时同时出现两份提示。
- 修复同一任务范围内 AI 估计过期后切换本地曲线造成的突降；真实返工与新的较低评估仍可回退。
- 修复历史主任务误显示子代理续接后的轮次。
- 修复更新操作并发执行、RC 数字排序及部分系统证书环境无法检查更新的问题。

### English

New features:

- Follow the reading position and turn navigator to inspect earlier progress. Keep lead and teammate snapshots isolated by turn.
- Add an opt-in developer mode for local probe timestamps, complete service inputs, output streams, and usage. Logs rotate by size and can be exported.
- Show the loaded version in task details and offer newer RC releases in the header. Confirm twice to verify the archive, install through the official profile CLI, and restart.

Improvements:

- Show a reversible approximate 99% response-writing state when completed-work evidence supports it. New tool calls or rework restore execution progress.
- Prefer Off reasoning; otherwise use the model’s lowest advertised level, or its native configuration when no control exists.
- Bound history and diagnostic storage, reduce turn detection during token streaming, and render full records on demand.

Fixes:

- Remove duplicate trend hover tooltips.
- Retain a valid same-scope AI estimate while its replacement is pending, avoiding a discontinuity into the cold local curve. Real rework and lower fresh assessments can still reduce progress.
- Preserve the correct teammate turn when reviewing older lead turns.
- Serialize updates, order numeric RC versions correctly, and use system trust roots for GitHub checks without weakening TLS validation.

Host requirement: **DSH `0.2.2-rc.1`, Web profile, Node.js `>=24.9.0`**. The response-writing state is an estimate, not a host final-answer signal. Historical snapshots and raw diagnostic logs have bounded retention.

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
