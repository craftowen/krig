# krig Blinded Quantitative A/B Benchmark Suite

This directory holds a reproducible, zero-dependency, blinded A/B evaluation harness ([harness.mjs](harness.mjs) and [tasks.mjs](tasks.mjs)) built to measure the empirical difference between running an agent **without skills (`no-skill`)** and running the exact same model **with `/krig` (`with-krig`)**.

## 1. Methodology & Anti-Leakage Controls

The suite enforces the rules in [eval.md](../skills/krig/playbooks/eval.md) and [leakage-8.md](../skills/krig/references/leakage-8.md):

1. **Identical Starting Conditions**: Each task seeds two clean git repositories (`ws-alpha/<task>` and `ws-beta/<task>`) with identical files, commit history, and timestamps.
2. **Strict Blinding (`checkBlinding`)**: Workspace paths, seeded files, and prompts are checked by [ab-eval.mjs](../skills/krig/scripts/ab-eval.mjs) to ensure zero meta-evaluation vocabulary (`eval`, `benchmark`, `rubric`, `judge`, `candidate`, `treatment`, `control`).
3. **Physical Oracle Isolation**: During live runs, `harness.mjs` stages only `.claude-plugin`, `plugin.json`, `GLOSSARY.md`, and `skills/` into an ephemeral directory outside the repository. `benchmarks/tasks.mjs` is physically absent from both candidate workspaces and `--plugin-dir`.
4. **Single Independent Variable**: Both arms run on the exact same CLI binary, model, timeout, and `--setting-sources ""` isolation. Control disables slash commands (`--disable-slash-commands`) and receives `<prompt>`; Treatment loads the isolated plugin stage and receives `/krig:krig <prompt>`.
5. **Deterministic Held-Out Oracles**: Zero LLM-as-a-judge scoring is used. Every task is graded out-of-process by 10 deterministic programmatic assertions (60 assertions per model run) plus structural defect escape counts (`defectEscapes`) and non-empty production code lines (`prodLoc`).

## 2. Benchmark Tasks (6 Tasks, 60 Held-Out Assertions)

| Task ID | Category | Primary `/krig` Route | Core Engineering Challenge | Assertions |
|---|---|---|---|---|
| `webhook-settlement` | `bugfix+demock` | `drive` (`drive`, `demock`, `verify`) | Fix duplicate webhook credits, retry-unsafe event recording, empty-secret HMAC bypass, short-hex `timingSafeEqual` crashes, zero-fee validation, swallowed compliance errors, and mock sink fallbacks across an 8-module `src/` package | 10 |
| `delivery-recovery` | `model+state` | `model` (`model`, `drive`, `demock`, `verify`) | Repair per-item crash checkpoint windows, ambiguous in-flight boot quarantine, partial attachment resume without duplicate sends, and retry-budget termination in `Dispatcher` | 10 |
| `bloated-ledger` | `slim+stdlib` | `slim` (`slim`, `drive`, `demock`, `verify`) | Prune unused npm packages while preserving script-referenced `schema-lint`, delete pure pass-through barrels and test-only legacy XML modules, replace custom UUID helpers with `node:crypto`, and clear rot-risk debt comments | 10 |
| `lineage-blast` | `recon:why+blast` | `recon` (`recon`) | Read-only investigation across a 24-commit history with a cosmetic reformat commit: trace true origin commits via pickaxe (`git log -S`), separate production callers from comment/string decoys and tests, list env/filesystem boundaries, and mark undocumented gateway behavior unknown | 10 |
| `lease-fencing-queue` | `model+concurrency` | `model` (`model`, `drive`, `demock`, `verify`) | Enforce strictly monotonic queue-wide fencing tokens, reject stale/zero/missing tokens even on same-worker re-acquisition, enforce strict pre-expiry heartbeats, dead-letter expired leases at budget, fence canceled in-flight leases, and prevent deadlocks across all outcome interleavings | 10 |
| `release-hygiene-service` | `demock+slim` | `slim` (`slim`, `drive`, `demock`, `verify`) | Pre-release cleanup of a 12-file payment gateway: remove `vi.fn` production fallbacks, swallowed audit errors, blank-key auth bypasses, `TODO` placeholders, unused dependencies (preserving `typescript` for `typecheck`), 2 pass-through barrels, and 3 retired legacy/mock modules | 10 |

## 3. Reproducing the Evaluation

Verify seed non-triviality, blinding, router mapping, and reference-solution satisfiability (`60/60`) offline:

```bash
npm test
```

Run a full live blinded A/B evaluation across all 6 tasks (12 isolated Claude Code sessions):

```bash
node benchmarks/harness.mjs run \
  --alpha-root /tmp/ws-alpha \
  --beta-root /tmp/ws-beta \
  --log-dir /tmp/krig-ab-logs \
  --model sonnet \
  --concurrency 4
```

You can also run seeding and grading as separate phases (`node benchmarks/harness.mjs --help`).

## 4. Measured Results (v0.2.0, Zero Infrastructure Errors)

### Run A: `claude-sonnet-5-5` (6 Tasks, 60 Held-Out Assertions per Arm, `infraErrorCount = 0`)

| Metric | `no-skill` (Control) | `with-krig` (Treatment) | Delta |
|---|---|---|---|
| Oracle Assertions Passed | `57 / 60` (`95.0%`) | `60 / 60` (`100.0%`) | **`+5.0%p`** (`+3` assertions) |
| Critical / Structural Defect Escapes | `2` | `0` | **`-100.0%`** (`0` escapes) |
| Paired Task Outcomes | `0` wins, `4` ties, `2` losses | `2` wins, `4` ties, `0` losses | **`+2` net task wins** |
| Total Production LOC (`src/`) | `418` lines | `399` lines | **`-19` lines (`-4.5%`)** |

Per-task breakdown (`claude-sonnet-5-5`):
- `webhook-settlement`: `no-skill` `10/10` (`defects=0`, `96` LOC) vs `with-krig` `10/10` (`defects=0`, `95` LOC), tie.
- `delivery-recovery`: `no-skill` `9/10` (`defects=1`, `53` LOC, left an empty `catch {}` block) vs `with-krig` `10/10` (`defects=0`, `47` LOC), **`with-krig` win (`+10%p`)**.
- `bloated-ledger`: `no-skill` `8/10` (`defects=1`, `37` LOC, missed orphan `src/legacy/xml-exporter.mjs` referenced only by its own legacy test) vs `with-krig` `10/10` (`defects=0`, `31` LOC, detected via `slim.mjs --strict`), **`with-krig` win (`+20%p`)**.
- `lineage-blast`: `no-skill` `10/10` (`defects=0`) vs `with-krig` `10/10` (`defects=0`), tie.
- `lease-fencing-queue`: `no-skill` `10/10` (`defects=0`, `122` LOC) vs `with-krig` `10/10` (`defects=0`, `116` LOC), tie.
- `release-hygiene-service`: `no-skill` `10/10` (`defects=0`, `68` LOC) vs `with-krig` `10/10` (`defects=0`, `68` LOC), tie.

### Run B: `claude-haiku-5-5` (6 Tasks, 60 Held-Out Assertions per Arm, `infraErrorCount = 0`)

| Metric | `no-skill` (Control) | `with-krig` (Treatment) | Delta |
|---|---|---|---|
| Oracle Assertions Passed | `56 / 60` (`93.3%`) | `58 / 60` (`96.7%`) | **`+3.4%p`** (`+2` assertions) |
| Critical / Structural Defect Escapes | `2` | `1` | **`-50.0%`** |
| Paired Task Outcomes | `1` win, `4` ties, `1` loss | `1` win, `4` ties, `1` loss | **`+3.4%p` aggregate pass rate** |

Per-task breakdown (`claude-haiku-5-5`):
- `bloated-ledger`: `no-skill` `6/10` (`defects=2`, mistakenly deleted script-used `schema-lint` and missed test-only legacy XML code) vs `with-krig` `9/10` (`defects=0`), **`with-krig` win (`+30%p`)**.
- `release-hygiene-service`: `no-skill` `10/10` (`defects=0`) vs `with-krig` `9/10` (`defects=1`, rejected optional 3rd argument in `warmPricingCache` via `arguments.length > 2`), **`no-skill` win (`-10%p`)**.
- `webhook-settlement`, `delivery-recovery`, `lineage-blast`, `lease-fencing-queue`: all `10/10` vs `10/10` ties.

### Combined Summary Across Both Models (12 Paired Tasks, 120 Assertions per Arm)

Across all 24 isolated runs (`claude-sonnet-5-5` and `claude-haiku-5-5` combined), `with-krig` raised held-out oracle pass rate from **`94.2%` (`113/120`)** to **`98.3%` (`118/120`, `+4.1%p`)** and cut defect escapes from **`4` to `1` (`-75.0%`)** with `3` task wins, `8` ties, `1` loss, and `0` infrastructure errors. These numbers apply strictly to this 6-task suite and the stated models.
