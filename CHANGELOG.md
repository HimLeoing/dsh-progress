# Changelog

## 0.1.1-rc2

### English

#### dsh-progress

Task progress for DeepSeek Harness Web. This release renames the plugin and repository to **dsh-progress**.

- Keep progress data and panel preferences when moving from the previous plugin. Existing destination data takes precedence; original files are preserved.
- Check newer RC releases in normal mode, and include newer Alpha releases in developer mode. The circular update button sits beside the version in task details. Installing an update requires a host restart.
- Move recent observations, assessment cadence, and AI scope into developer mode.
- Provide dedicated English and Chinese descriptions for the host's plugin details view.
- Use real task screenshots in the documentation, including dark and light appearances, task stages, and independent teammate details. The architecture diagram is separate from product screenshots.
- Correct scoped client-module registration and respect configured HTTPS proxies for GitHub update requests while retaining TLS verification.

**Requirements:** DeepSeek Harness **>=0.2.2-rc.1**, Web profile, and Node.js **>=24.9.0**. Later host releases satisfy the declared minimum; future breaking APIs can still require an update.

AI assistance is off by default. Local estimates require no extra model requests. Optional AI observations can incur provider charges.

Install the attached `dsh-progress-0.1.1-rc2.tgz` using the official plugin installer. The checksum is published in `SHA256SUMS`.

### 中文

#### dsh-progress

DeepSeek Harness 网页版任务进度。本次更新将插件和仓库统一更名为 **dsh-progress**。

- 从旧版迁移任务进度和面板偏好。目标已有数据优先，原文件保留。
- 普通模式检查新版 RC；开发者模式同时检查新版 Alpha。圆形更新按钮位于任务详情底部版本号旁，安装更新需要重启宿主。
- 最近观察、评估节奏和辅助范围移入开发者模式。
- 为宿主插件详情提供独立的中文、英文说明。
- 文档使用真实任务截图，展示深浅色外观、任务阶段和独立队友详情；结构示意图与产品截图分开。
- 修复 scoped 包的网页模块注册，并让 GitHub 更新请求沿用已配置的 HTTPS 代理，保持 TLS 校验。

**使用要求：** DeepSeek Harness **>=0.2.2-rc.1**、Web profile，以及 Node.js **>=24.9.0**。后续宿主版本满足声明的最低版本要求；未来宿主 API 发生破坏性变更时仍可能需要适配。

AI 辅助默认关闭，本地估算不产生额外模型请求。开启 AI 评估后可能产生提供方费用。

通过官方插件安装器安装附件 `dsh-progress-0.1.1-rc2.tgz`，校验值见 `SHA256SUMS`。

## 0.1.1-rc1 — 2026-11-12

### What's changed

- Declare Harness `>=0.2.2-rc.1` and validate the Web profile on `0.2.2-rc.2`. Later prereleases pass the minimum-version gate. The in-panel RC installer now validates ranges as well as exact host versions.
- Improve local estimates without AI or previous history: distinguish narrow work from full projects, use bounded material-size evidence, deduplicate identical observed writes, and preserve separate checklist-item accounting.
- Separate syntax checks from substantive tests. A preview alone cannot establish delivery, new work invalidates old verification, and successful rechecks clear outstanding rework debt while preserving failure diagnostics.
- Exclude background sessions created after a parent turn has ended; retain real delegated teammates. Bind unnamed delegation to its active checklist item so the same child is not counted in later items. Measure nested tool material before transcript compaction.
- Retain numeric local progress, checklist weights, independent teammate progress, mode-switch checkpoints, and the existing remaining-time display. Polling and permanent services do not advance overall progress.
- Add verified tag releases with a packaged archive and SHA-256 checksum. No additional runtime dependencies or local-estimation model requests.

**Requirements:** Harness `>=0.2.2-rc.1`, Web profile; Node.js `>=24.9.0`. Tested on Harness `0.2.2-rc.2`. Future breaking host APIs may require another plugin update. Percentages and remaining time are estimates; only a successful turn end establishes `100%`.

Install `dsh-task-progress-0.1.1-rc1.tgz` from the assets below. This is a prerelease. The community market pins prerelease archives, so its existing entry must be updated separately from GitHub Releases.

### 更新内容

- 宿主要求改为 Harness `>=0.2.2-rc.1`，并适配验证 `0.2.2-rc.2` 的 Web profile。后续预发布版本可通过最低版本检查；面板内 RC 更新器同步支持版本范围校验。
- 升级无 AI 本地估算：无需历史记录，区分小范围工作与完整项目，按实际产出量计入有上限的证据，去重已观测到的相同写入，并保留每项任务独立计分。
- 区分语法检查与实质测试。草稿预览不再直接表示接近交付；新增修改使旧验证失效，通过重新测试后解除待修复扣分，同时保留失败记录。
- 排除主轮次结束后才创建的后台维护会话，保留真实协作队友；无显式负责人的委派绑定派出时的清单项，避免对子项漏算或跨项重复计入。在转录压缩前提取嵌套工具的产出证据。
- 保留确定的本地估计百分比、清单权重、独立队友进度、模式切换衔接及剩余时间显示。轮询与常驻服务不会推进总进度。
- 增加经过测试的 tag 自动发布流程，附安装包与 SHA-256 校验。无新增运行时依赖，本地估算不会请求模型。

**宿主要求：** Harness `>=0.2.2-rc.1`，仅 Web profile；Node.js `>=24.9.0`。已验证 Harness `0.2.2-rc.2`。未来宿主若出现破坏性接口变更，插件仍可能需要适配。百分比与剩余时间均为估计，只有本轮真实成功结束才显示 `100%`。

请安装下方的 `dsh-task-progress-0.1.1-rc1.tgz`。此版本为候选版本。社区市场对预发布安装包使用固定链接，需要更新原条目，发布 GitHub Release 本身不会替换市场安装链接。


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
- 开发者模式按钮与版本同处详情底栏，开启时突出显示；日志使用固定高度的紧凑滚动框。

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
- Place the developer-mode button beside the version in the details footer, with an accented enabled state and a compact fixed-height log viewer.

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
