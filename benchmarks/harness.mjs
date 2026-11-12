#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBlinding, compareAbRuns, formatAbScoreboard } from '../skills/krig/scripts/ab-eval.mjs';
import { isCliMain, parseCliFlags } from '../skills/krig/scripts/lib/cli.mjs';
import { BENCHMARK_TASKS } from './tasks.mjs';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const KRIG_REPO_ROOT = path.resolve(BENCH_DIR, '..');

function listKrigArtifacts(workspaceDir) {
  const krigDir = path.join(workspaceDir, '.krig');
  if (!fs.existsSync(krigDir)) return [];
  const out = [];
  const stack = [krigDir];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        out.push(path.relative(krigDir, full).replace(/\\/g, '/'));
      }
    }
  }
  return out.sort();
}

export function selectBenchmarkTasks(taskFilterCsv = '') {
  if (!taskFilterCsv) return [...BENCHMARK_TASKS];
  const wanted = new Set(
    String(taskFilterCsv)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const selected = BENCHMARK_TASKS.filter((t) => wanted.has(t.id));
  if (selected.length !== wanted.size) {
    const known = BENCHMARK_TASKS.map((t) => t.id).join(', ');
    throw new Error(`알 수 없는 과제 ID가 포함되어 있습니다. 사용 가능 과제: ${known}`);
  }
  return selected;
}

export function seedWorkspaces({
  alphaRoot,
  betaRoot,
  metaPath,
  tasks = BENCHMARK_TASKS
}) {
  const absAlpha = path.resolve(alphaRoot);
  const absBeta = path.resolve(betaRoot);
  if (absAlpha === absBeta) {
    throw new Error('alphaRoot와 betaRoot는 서로 다른 격리 경로여야 합니다.');
  }

  fs.rmSync(absAlpha, { recursive: true, force: true });
  fs.rmSync(absBeta, { recursive: true, force: true });
  fs.mkdirSync(absAlpha, { recursive: true });
  fs.mkdirSync(absBeta, { recursive: true });

  const seedMetaByTask = {};
  const workspacePaths = [];

  for (const task of tasks) {
    const alphaDir = path.join(absAlpha, task.id);
    const betaDir = path.join(absBeta, task.id);
    fs.mkdirSync(alphaDir, { recursive: true });
    fs.mkdirSync(betaDir, { recursive: true });

    const alphaMeta = task.seed(alphaDir);
    const betaMeta = task.seed(betaDir);

    seedMetaByTask[task.id] = {
      alpha: alphaMeta,
      beta: betaMeta
    };
    workspacePaths.push(alphaDir, betaDir);

    const promptBlind = checkBlinding({
      workspacePaths: [alphaDir, betaDir],
      promptText: task.prompt
    });
    if (!promptBlind.ok) {
      const msg = promptBlind.leaks.map((l) => `[${l.surface}] ${l.detail}`).join('; ');
      throw new Error(`과제 '${task.id}' 블라인드 검증 실패: ${msg}`);
    }
  }

  if (metaPath) {
    const absMeta = path.resolve(metaPath);
    fs.mkdirSync(path.dirname(absMeta), { recursive: true });
    fs.writeFileSync(absMeta, JSON.stringify(seedMetaByTask, null, 2) + '\n', 'utf8');
  }

  return {
    alphaRoot: absAlpha,
    betaRoot: absBeta,
    workspacePaths,
    seedMetaByTask
  };
}

export async function gradeWorkspaces({
  alphaRoot,
  betaRoot,
  seedMetaByTask,
  model = 'unspecified',
  telemetryByKey = {},
  tasks = BENCHMARK_TASKS
}) {
  const absAlpha = path.resolve(alphaRoot);
  const absBeta = path.resolve(betaRoot);

  const control = [];
  const treatment = [];

  for (const task of tasks) {
    const alphaDir = path.join(absAlpha, task.id);
    const betaDir = path.join(absBeta, task.id);
    const meta = seedMetaByTask?.[task.id];
    if (!meta) {
      throw new Error(`과제 '${task.id}'의 시드 메타데이터가 없습니다.`);
    }

    const cEval = await task.evaluate(alphaDir, meta.alpha);
    const tEval = await task.evaluate(betaDir, meta.beta);

    const cTel = telemetryByKey[`control:${task.id}`] ?? {};
    const tTel = telemetryByKey[`treatment:${task.id}`] ?? {};

    control.push({
      ...cEval,
      krigArtifacts: listKrigArtifacts(alphaDir),
      durationMs: cTel.durationMs ?? null,
      numTurns: cTel.numTurns ?? null,
      infraError: Boolean(cTel.infraError)
    });

    treatment.push({
      ...tEval,
      krigArtifacts: listKrigArtifacts(betaDir),
      durationMs: tTel.durationMs ?? null,
      numTurns: tTel.numTurns ?? null,
      infraError: Boolean(tTel.infraError)
    });
  }

  const comparison = compareAbRuns({
    control,
    treatment,
    metadata: { model }
  });

  const infraErrorCount = [...control, ...treatment].filter((r) => r.infraError).length;

  return {
    infraErrorCount,
    control,
    treatment,
    comparison,
    scoreboard: formatAbScoreboard(comparison)
  };
}

function stageIsolatedPluginDir(stageDir) {
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });
  for (const rel of ['.claude-plugin', 'plugin.json', 'GLOSSARY.md', 'skills']) {
    const src = path.join(KRIG_REPO_ROOT, rel);
    const dst = path.join(stageDir, rel);
    fs.cpSync(src, dst, { recursive: true });
  }
  return stageDir;
}

function spawnClaudeCandidate({
  arm,
  taskId,
  cwd,
  prompt,
  model,
  slashPrefix,
  pluginStageDir,
  timeoutMs,
  logDir
}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const args = [
      '-p',
      '--no-session-persistence',
      '--dangerously-skip-permissions',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--output-format',
      'json',
      '--model',
      model
    ];

    let fullPrompt = prompt;
    if (arm === 'control') {
      args.push('--disable-slash-commands');
    } else {
      args.push('--plugin-dir', pluginStageDir, '--add-dir', pluginStageDir);
      fullPrompt = `${slashPrefix} ${prompt}`;
    }
    args.push('--', fullPrompt);

    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const child = spawn('claude', args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      let parsed = null;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        parsed = null;
      }

      const infraError = timedOut || code !== 0 || !parsed || parsed.is_error === true;
      const record = {
        arm,
        taskId,
        cwd,
        exitCode: code,
        timedOut,
        durationMs: parsed?.duration_ms ?? durationMs,
        wallDurationMs: durationMs,
        numTurns: parsed?.num_turns ?? null,
        infraError,
        resultPreview: typeof parsed?.result === 'string' ? parsed.result.slice(0, 600) : null,
        stderrPreview: stderr.slice(0, 600)
      };

      if (logDir) {
        fs.mkdirSync(logDir, { recursive: true });
        fs.writeFileSync(
          path.join(logDir, `${arm}-${taskId}.json`),
          JSON.stringify({ ...record, rawResponse: parsed, rawStderr: stderr }, null, 2) + '\n',
          'utf8'
        );
      }

      resolve(record);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        arm,
        taskId,
        cwd,
        exitCode: -1,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        numTurns: null,
        infraError: true,
        stderrPreview: err.message
      });
    });
  });
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      results[idx] = await worker(items[idx], idx);
    }
  }

  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => next());
  await Promise.all(runners);
  return results;
}

export async function runLiveAbSuite({
  alphaRoot = path.join(os.tmpdir(), 'ws-alpha'),
  betaRoot = path.join(os.tmpdir(), 'ws-beta'),
  logDir = path.join(os.tmpdir(), 'krig-run-logs'),
  model = 'sonnet',
  slashPrefix = '/krig:krig',
  concurrency = 4,
  timeoutMs = 480000,
  tasks = BENCHMARK_TASKS
} = {}) {
  fs.rmSync(logDir, { recursive: true, force: true });
  fs.mkdirSync(logDir, { recursive: true });

  const metaPath = path.join(logDir, 'seed-meta.json');
  const { seedMetaByTask } = seedWorkspaces({
    alphaRoot,
    betaRoot,
    metaPath,
    tasks
  });

  const jobs = [];
  // Interleave control and treatment across tasks to neutralize temporal API variance
  for (const task of tasks) {
    jobs.push({
      arm: 'control',
      taskId: task.id,
      cwd: path.join(path.resolve(alphaRoot), task.id),
      prompt: task.prompt
    });
    jobs.push({
      arm: 'treatment',
      taskId: task.id,
      cwd: path.join(path.resolve(betaRoot), task.id),
      prompt: task.prompt
    });
  }

  const pluginStageDir = stageIsolatedPluginDir(
    fs.mkdtempSync(path.join(os.tmpdir(), 'krig-runtime-pkg-'))
  );

  let runRecords;
  try {
    runRecords = await runPool(jobs, concurrency, (job) => spawnClaudeCandidate({
      ...job,
      model,
      slashPrefix,
      pluginStageDir,
      timeoutMs,
      logDir
    }));
  } finally {
    fs.rmSync(pluginStageDir, { recursive: true, force: true });
  }

  const telemetryByKey = {};
  for (const rec of runRecords) {
    telemetryByKey[`${rec.arm}:${rec.taskId}`] = rec;
  }

  const graded = await gradeWorkspaces({
    alphaRoot,
    betaRoot,
    seedMetaByTask,
    model,
    telemetryByKey,
    tasks
  });

  const fullReport = {
    ...graded,
    runRecords
  };

  fs.writeFileSync(
    path.join(logDir, 'ab-report.json'),
    JSON.stringify(fullReport, null, 2) + '\n',
    'utf8'
  );

  return fullReport;
}

function printHelp() {
  console.log([
    '사용법:',
    '  node benchmarks/harness.mjs seed [--alpha-root /tmp/ws-alpha] [--beta-root /tmp/ws-beta] [--meta /tmp/krig-run-logs/seed-meta.json] [--tasks id1,id2]',
    '  node benchmarks/harness.mjs grade [--alpha-root /tmp/ws-alpha] [--beta-root /tmp/ws-beta] --meta /tmp/krig-run-logs/seed-meta.json [--model sonnet] [--out report.json] [--json]',
    '  node benchmarks/harness.mjs run [--alpha-root /tmp/ws-alpha] [--beta-root /tmp/ws-beta] [--log-dir /tmp/krig-run-logs] [--model sonnet] [--slash-prefix /krig:krig] [--concurrency 4] [--timeout-ms 480000] [--tasks id1,id2] [--json]'
  ].join('\n'));
}

async function main() {
  let parsed;
  try {
    parsed = parseCliFlags(process.argv.slice(2), {
      booleans: ['json', 'help'],
      allowedFlags: [
        'json',
        'alpha-root',
        'beta-root',
        'meta',
        'log-dir',
        'model',
        'slash-prefix',
        'concurrency',
        'timeout-ms',
        'tasks',
        'out'
      ]
    });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  const sub = parsed.positional[0];
  if (!sub || parsed.flags.help) {
    printHelp();
    process.exit(0);
  }

  const alphaRoot = parsed.flags['alpha-root'] ?? path.join(os.tmpdir(), 'ws-alpha');
  const betaRoot = parsed.flags['beta-root'] ?? path.join(os.tmpdir(), 'ws-beta');
  const logDir = parsed.flags['log-dir'] ?? path.join(os.tmpdir(), 'krig-run-logs');
  const metaPath = parsed.flags.meta ?? path.join(logDir, 'seed-meta.json');
  const tasks = selectBenchmarkTasks(parsed.flags.tasks ?? '');

  try {
    if (sub === 'seed') {
      const seeded = seedWorkspaces({ alphaRoot, betaRoot, metaPath, tasks });
      if (parsed.flags.json) {
        console.log(JSON.stringify(seeded, null, 2));
      } else {
        console.log(`OK: seeded ${tasks.length} tasks into ${seeded.alphaRoot} and ${seeded.betaRoot} (0 blinding leaks)`);
      }
      process.exit(0);
    }

    if (sub === 'grade') {
      if (!fs.existsSync(metaPath)) {
        console.error(`시드 메타 파일을 찾을 수 없습니다: ${metaPath}`);
        process.exit(2);
      }
      const seedMetaByTask = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const graded = await gradeWorkspaces({
        alphaRoot,
        betaRoot,
        seedMetaByTask,
        model: parsed.flags.model ?? 'unspecified',
        tasks
      });
      if (parsed.flags.out) {
        fs.writeFileSync(path.resolve(parsed.flags.out), JSON.stringify(graded, null, 2) + '\n', 'utf8');
      }
      if (parsed.flags.json) {
        console.log(JSON.stringify(graded, null, 2));
      } else {
        console.log(graded.scoreboard);
      }
      process.exit(graded.infraErrorCount === 0 ? 0 : 1);
    }

    if (sub === 'run') {
      const concurrency = parsed.flags.concurrency ? Number(parsed.flags.concurrency) : 4;
      const timeoutMs = parsed.flags['timeout-ms'] ? Number(parsed.flags['timeout-ms']) : 480000;
      const report = await runLiveAbSuite({
        alphaRoot,
        betaRoot,
        logDir,
        model: parsed.flags.model ?? 'sonnet',
        slashPrefix: parsed.flags['slash-prefix'] ?? '/krig:krig',
        concurrency,
        timeoutMs,
        tasks
      });
      if (parsed.flags.out) {
        fs.writeFileSync(path.resolve(parsed.flags.out), JSON.stringify(report, null, 2) + '\n', 'utf8');
      }
      if (parsed.flags.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(report.scoreboard);
      }
      process.exit(report.infraErrorCount === 0 ? 0 : 1);
    }

    printHelp();
    process.exit(2);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}

if (isCliMain(import.meta.url)) {
  main();
}
