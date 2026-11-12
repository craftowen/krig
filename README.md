<h1 align="center">
  <img src="assets/icon.png" alt="krig" width="56" valign="middle" /> krig
</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3b82f6?style=flat-square" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-10b981?style=flat-square" alt="Node >= 20" />
  <img src="https://img.shields.io/badge/hosts-Claude%20Code%20%7C%20Codex%20%7C%20Antigravity-0f172a?style=flat-square" alt="Supported hosts" />
</p>

<p align="center">
  English | <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <strong>One command (`/krig`). Six lazy-loaded engineering playbooks. Zero-dependency verification gates.</strong>
</p>

`krig` (`Krill` + `Rig`) is a single-entrypoint, auto-routing engineering workflow plugin and skill for **Claude Code**, **Codex CLI**, and **Antigravity (`agy`)**. Instead of cluttering your slash menu with half a dozen commands or bloating always-on context with heavy coding rubrics, `/krig` classifies your request deterministically via [route.mjs](skills/krig/scripts/route.mjs) and loads only the exact playbook and CLI levers needed for the task.

## Install

Requires Node.js 20 or later (zero npm runtime dependencies).

### Claude Code (`claude`)

Inside an interactive Claude Code session:

```text
/plugin install krig --marketplace craftowen/krig
```

Or from your terminal:

```bash
claude plugin marketplace add craftowen/krig
claude plugin install krig@krig
```

### Codex CLI (`codex`)

```bash
codex plugin marketplace add craftowen/krig
codex plugin add krig@krig
```

### Antigravity CLI (`agy`)

```bash
agy plugin install https://github.com/craftowen/krig
```

### Symlink Install Across All Three CLIs (Single Checkout)

If you want one local checkout wired directly into `~/.claude/skills/krig`, `~/.codex/skills/krig`, `~/.agents/skills/krig`, and `~/.gemini/antigravity-cli/skills/krig` simultaneously:

```bash
git clone https://github.com/craftowen/krig.git
cd krig
./scripts/install.sh
./scripts/install.sh --check
```

## Usage

Invoke `/krig` in Claude Code and Antigravity (`/krig:krig` when plugin-namespaced), or `$krig` / `/krig` in Codex CLI:

```text
/krig Scope out a new webhook settlement pipeline, trim speculative requirements, and split into vertical slices
/krig Design the payment adapter boundary and module interface
/krig Implement PROJ-120 end-to-end and verify
/krig Reproduce and fix the intermittent timeout bug via binary search instrumentation
/krig Improve parser throughput by 25% using a locked single-variable benchmark loop
/krig Scan modified production code for swallowed errors, permissive guards, or test doubles
/krig Encode the root cause from this session into a structural gate so it never recurs
```

Force a specific route with the `route:<name>` prefix (for example `/krig route:align ...`, `/krig route:verify ...`, or `/krig route:full ...`).

## Auto-Routing Architecture

The entry router ([SKILL.md](skills/krig/SKILL.md) + [route.mjs](skills/krig/scripts/route.mjs)) maps each prompt onto a DAG of six playbooks and separates human-in-the-loop scope alignment (`hitl` gear) from autonomous execution (`afk` gear):

| Route | Gear | Playbook | Follow-on Chain | Bundled CLI Lever |
|---|---|---|---|---|
| `align` | `hitl` | [align.md](skills/krig/playbooks/align.md) | none | [ledger.mjs](skills/krig/scripts/ledger.mjs) (requirement deletion ledger + <10% add-back warning) |
| `design` | `afk` | [design.md](skills/krig/playbooks/design.md) | `verify` | [deepening.md](skills/krig/references/deepening.md) (deep modules, 2-adapter seam, 4-tier dependency model) |
| `drive` | `afk` | [drive.md](skills/krig/playbooks/drive.md) | `demock`, `verify` | [decision-log.mjs](skills/krig/scripts/decision-log.mjs) (`feature`, `bugfix`, `hillclimb` TSV audit trail) |
| `demock` | `afk` | [demock.md](skills/krig/playbooks/demock.md) | `verify` | [scan.mjs](skills/krig/scripts/scan.mjs) (lexical production scanner for mocks, swallowed errors, permissive guards) |
| `verify` | `afk` | [verify.md](skills/krig/playbooks/verify.md) | none | [standards-baseline.md](skills/krig/references/standards-baseline.md), [leakage-8.md](skills/krig/references/leakage-8.md) (dual-axis Standards/Spec review + cold-read) |
| `backprop` | `afk` | [backprop.md](skills/krig/playbooks/backprop.md) | none | [unwrap.mjs](skills/krig/scripts/unwrap.mjs) (5-tier enforcement pyramid + lossless `v0` markdown reflow) |

See [GLOSSARY.md](GLOSSARY.md) for canonical domain terms and [CONTRIBUTING.md](docs/CONTRIBUTING.md) for static gate and authoring rules.

## Development & Verification

```bash
npm run check
npm test
```

## License

[MIT](LICENSE)
