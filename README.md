# dsh-task-progress

English | [中文](README.zh-CN.md)

Task progress for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web. A community plugin that shows the current turn, tool activity, and independent teammate progress, with optional AI observations.

This plugin does not add update or restart controls. Those remain in `dsh-base`; either plugin can be enabled independently.

## Requirements

| Component | Supported version |
| --- | --- |
| DeepSeek Harness | **`0.2.2-rc.1`**, Web profile |
| Node.js | **`>=24.9.0`** |
| Optional probe cost estimates | A compatible local installation of `dsh-cost-meter` |

The package declares the host version in `engines.dsh`. Other host versions, Desktop, and TUI are not supported by this release candidate. DSH is in developer preview; check compatibility before updating the host.

## Install

Install the release archive in the Web profile:

```sh
dsh plugin --profile web add "https://github.com/HimLeoing/dsh-task-progress/releases/download/v0.1.0-rc1/dsh-task-progress-0.1.0-rc1.tgz"
```

Or install the tagged source:

```sh
dsh plugin --profile web add "github:HimLeoing/dsh-task-progress#v0.1.0-rc1"
```

Enable the bundle in **Plugins**, restart the host, and reload the Web UI. The package ships its runtime files; no build, install script, or additional runtime dependency is required.

If an older combined `dsh-base` still draws a progress panel, update it to the controls-only version or disable it before enabling this plugin. The controls-only `dsh-base` and `dsh-task-progress` use separate routes, client styles, and data directories.

Repository topic: `dsh-plugin`. Topic discovery and a release do not by themselves mean a community market has approved or listed the plugin. Check the market entry before using a market installation route.

## Progress

The panel follows the **current turn**, not every task in a repository. A step is a completed agent execution boundary. It is not a known fraction of the total work.

| Evidence | Display |
| --- | --- |
| Complete checklist, AI disabled | Completed-item progress |
| No complete checklist, AI disabled | Current activity and elapsed time; percentage remains unknown |
| AI enabled with enough evidence | An approximate percentage, marked `≈` |
| Teammates running | Independent compact cards; open a card for that teammate's progress |
| Authoritative successful turn end | `100%` |
| Interruption, failure, or connection loss | An explicit state; never treated as successful completion |

The main turn includes the lead's integration, verification, and delivery. A delegated checklist or a group of completed teammates cannot establish that the main request is finished. The main percentage is not an average of teammate percentages.

For a complete checklist, AI observations can assign relative difficulty weights once and estimate progress inside active items. Pending items contribute nothing; an unfinished item cannot consume its full weight. Rework and scope changes can reduce or invalidate an estimate.

Verification, delivery, and teammate completion receive priority when supported by execution evidence. There is **no 90% ceiling**, no automatic climb through the nineties, and no project-wide countdown. A final step can still move an estimate directly to `100%` when the turn actually ends. The plugin does not invent intermediate values for a smoother curve.

The panel is draggable and collapsible. Task details show the checklist when available, probe diagnostics, and a horizontally scrollable trend. Hover or focus a point to inspect its progress and source teammate.

## Optional AI observations

AI assistance is **disabled by default**. Enable it in the panel header. An enabled button has an accent border and text.

Observations use the current session's selected provider and **Off reasoning**. Off is not free: requests still consume input, cached-input, and output tokens. A provider that does not advertise Off is not silently changed to another reasoning level.

Three observation modes are available:

- **Smart balanced:** merge ordinary boundaries; prioritize changes such as failures, rework, checklist changes, verification, and teammate lifecycle events.
- **Every other step:** merge ordinary boundaries in pairs, retaining critical-event priority.
- **Every step:** observe each eligible completed step for finer feedback.

No new boundary means no new automatic request. Reading the panel or waiting does not trigger a timed probe. There is no hourly request quota; requests are serialized and queues are bounded. More detailed observation can cost more.

Turning AI off removes unsent work. An already-sent request may still finish to collect usage, but a response from an old configuration cannot update current progress. Changing modes does not backfill old steps.

When a complete checklist exists, turning AI off can freeze the last valid AI estimate and the remaining item weights. Subsequent **actual item completions** advance the remaining portion locally. Scope changes, reopened work, or changed ownership invalidate this checkpoint. Without a complete checklist, the panel shows local activity and a gray historical AI reference. Re-enabling AI preserves the local checkpoint while awaiting a new valid observation.

**Estimate once** waits for an eligible execution boundary. With automatic AI disabled, it provides one diagnostic observation and does not replace local progress.

## Command progress

Tool activity is separate from overall task progress. A command can have a useful remaining-time estimate even when the turn's total work is unknown.

- Explicit counters, frame totals, supported FFmpeg progress, complete tqdm meters, and the native producer progress channel can provide measured progress.
- A standalone literal delay can use its declared duration. Historical timing requires enough samples for the same command and a sufficiently narrow distribution.
- Unknown or ambiguous commands use an activity bar. An expired timing estimate does not restart its countdown.
- Recognized long-running services display `∞`. A background job is not automatically a permanent service.
- Reaching a reported total is not proof of process success: finalization can remain, and exit status is authoritative.

The observer uses the native job registry's non-consuming output offsets. It does not advance the model's output cursor, stop processes, or send a model request to estimate command duration. Complex output formats and commands without an observable total remain unknown.

## Costs and local data

The **Probe cost ≈** tile sums progress-observation requests from the main turn and its teammates. It excludes the models' work on the project itself. A teammate detail shows that teammate's probe cost.

When available, the plugin reuses `dsh-cost-meter` pricing and billing functions, including separate cache buckets, historical prices, and exchange rates. It does not refresh balances or quotas. A `+` means some requests lack usage or pricing: the displayed amount is a known subtotal. `—` means no usable estimate is available. A failed or discarded request can still be billed.

Local state is stored below `$DSH_HOME/dsh-task-progress/`, or `~/.dsh/dsh-task-progress/` by default:

- `preferences.json`: AI settings and observation mode.
- `progress.json`: bounded turn snapshots and checklist summaries.
- `learning.json`: bounded local timing history.
- `probes.jsonl` and its rotated predecessor: request metadata, usage, and diagnostic outcomes.

The plugin does not persist probe prompts, full transcripts, file bodies, or reasoning in its probe log. Optional AI observations send a bounded summary of the current request and execution evidence to the selected provider.

On first use, eligible legacy progress files from `dsh-base` can be copied into the new directory. Existing destination files win; originals are not deleted. Browser panel position and collapse preferences also migrate when the new keys are absent.

## Development

Use a source checkout with the required Node.js version:

```sh
npm test
npm pack --dry-run
```

Tests use controlled clocks, providers, and host services. They check behavior and billing consistency; they do not prove that an LLM percentage matches true work remaining. Do not use real credentials, paid model requests, or personal project logs in tests.

See [CONTRIBUTING.md](https://github.com/HimLeoing/dsh-task-progress/blob/main/CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md), and the [MIT license](LICENSE).
