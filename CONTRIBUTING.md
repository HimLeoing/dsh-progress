# Contributing

Use DSH `>=0.2.2-rc.1` (currently tested on `0.2.2-rc.2`) with the Web profile and Node.js `>=24.9.0`. The package has no build step or additional runtime dependencies.

```sh
npm test
npm pack --dry-run
```

## Changes

Keep changes scoped to task progress.

For a bug fix, add a deterministic regression at the seam that exhibits the problem. Use fake providers and controlled clocks instead of paid model calls. Cover main-turn and teammate behavior when the change affects shared state. Keep resources bounded, and test settings changes while a request is queued or in flight.

Progress must retain its source and scope. A tool completion, checklist completion, teammate completion, and successful turn end are different events. Local percentages with unknown work totals must be marked approximate and backed by bounded execution evidence; elapsed time alone cannot advance them. Do not smooth a curve by inventing observations, apply stale responses to a new turn, or silently report missing billing data as zero.

Follow the host's native read-only contracts. In particular, progress observers must not consume the model's job-output cursor or change a running process. Preserve loopback and same-origin checks on state-changing routes.

Keep English and Chinese user documentation aligned. Use the host terms **turn**, **step**, and **teammate** consistently. State the tested host requirement in release notes and package metadata.

## Reports

Include the plugin version, host version, Node.js version, profile, AI state, observation mode, and a minimal sequence that reproduces the issue. A small synthetic trace or screenshot is preferable to a full project transcript.

Remove credentials, provider keys, private prompts, file bodies, account data, and personal paths before posting. Do not commit local state, probe logs, real project fixtures, or screenshots containing private work. Do not paste secrets into an issue; revoke exposed credentials through the provider if necessary.

## Releases

Release candidates use a matching package version and Git tag, for example package `0.1.0-rc1` and tag `v0.1.0-rc1`. Publish the packed runtime archive with its checksum after source and unpacked-package tests pass. Repository topic discovery is separate from market review; do not claim a market listing before it exists.

Changes are contributed under the [MIT license](LICENSE).
