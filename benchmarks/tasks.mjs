import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanTargets } from '../skills/krig/scripts/scan.mjs';
import { analyzeSlim } from '../skills/krig/scripts/slim.mjs';

function writeFiles(rootDir, fileMap) {
  for (const [relPath, content] of Object.entries(fileMap)) {
    const abs = path.join(rootDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
}

function runGit(cwd, args, envExtra = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Dev Team',
      GIT_AUTHOR_EMAIL: 'dev@example.com',
      GIT_COMMITTER_NAME: 'Dev Team',
      GIT_COMMITTER_EMAIL: 'dev@example.com',
      ...envExtra
    }
  }).trim();
}

function initGitRepo(cwd) {
  runGit(cwd, ['init', '-b', 'main']);
  runGit(cwd, ['config', 'user.name', 'Dev Team']);
  runGit(cwd, ['config', 'user.email', 'dev@example.com']);
}

function commitAll(cwd, message, isoDate) {
  runGit(cwd, ['add', '-A']);
  runGit(cwd, ['commit', '-m', message], {
    GIT_AUTHOR_DATE: isoDate,
    GIT_COMMITTER_DATE: isoDate
  });
  return runGit(cwd, ['rev-parse', 'HEAD']);
}

function countNonEmptyLines(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  const stack = [dirPath];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (/\.(?:mjs|js|cjs|ts)$/.test(entry.name)) {
        const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
        total += lines.filter((l) => l.trim().length > 0).length;
      }
    }
  }
  return total;
}

const SNAP_DIRS_TO_CLEAN = [];
process.once('exit', () => {
  for (const dir of SNAP_DIRS_TO_CLEAN) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      void err;
    }
  }
});

async function importCandidateModule(absPath) {
  const workspaceDir = path.resolve(path.dirname(absPath), '..');
  const relFromWorkspace = path.relative(workspaceDir, absPath);
  const snapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-esm-snap-'));
  SNAP_DIRS_TO_CLEAN.push(snapDir);
  const pkgFile = path.join(workspaceDir, 'package.json');
  if (fs.existsSync(pkgFile)) {
    fs.copyFileSync(pkgFile, path.join(snapDir, 'package.json'));
  }
  const srcDir = path.join(workspaceDir, 'src');
  if (fs.existsSync(srcDir)) {
    fs.cpSync(srcDir, path.join(snapDir, 'src'), { recursive: true });
  }
  return import(pathToFileURL(path.join(snapDir, relFromWorkspace)).href);
}

function runNpmTest(cwd) {
  const res = spawnSync('npm', ['test'], {
    cwd,
    encoding: 'utf8',
    timeout: 20000
  });
  return {
    ok: res.status === 0,
    status: res.status,
    output: `${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim()
  };
}

function makeAssertionRecorder() {
  const assertions = [];
  return {
    assertions,
    async check(id, isCriticalDefect, fn) {
      try {
        const ok = Boolean(await fn());
        assertions.push({ id, passed: ok, criticalDefect: isCriticalDefect && !ok });
      } catch (err) {
        assertions.push({
          id,
          passed: false,
          criticalDefect: isCriticalDefect,
          error: err?.message ?? String(err)
        });
      }
    }
  };
}

function summarizeTaskEvaluation(taskId, category, workspaceDir, assertions, extraDefects = 0) {
  const passedAssertions = assertions.filter((a) => a.passed).length;
  const criticalAssertionFailures = assertions.filter((a) => a.criticalDefect).length;
  const prodLoc = countNonEmptyLines(path.join(workspaceDir, 'src'));
  const hasKrigDir = fs.existsSync(path.join(workspaceDir, '.krig'));
  return {
    taskId,
    category,
    passedAssertions,
    totalAssertions: assertions.length,
    defectEscapes: criticalAssertionFailures + extraDefects,
    prodLoc,
    hasKrigArtifacts: hasKrigDir,
    assertions
  };
}

function signPayload(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

export const BENCHMARK_TASKS = Object.freeze([
  {
    id: 'webhook-settlement',
    category: 'bugfix+demock',
    prompt: [
      '웹훅 정산 패키지에서 동일 이벤트 재전송 시 적립이 중복 발생하는 장애가 보고되었습니다.',
      '패키지 명세(docs/SPEC.md)와 src/ 아래 프로덕션 모듈 전반을 점검해 명세 위반과 운영 결함을 모두 수정하고 테스트를 보강해주세요.',
      '공개 함수 processSettlementWebhook(rawBody, signatureHeader, secret, store) 및 flushReconcileBatch(batch, sink)의 시그니처와 반환 형태는 유지해야 합니다.'
    ].join(' '),
    seed(workspaceDir) {
      writeFiles(workspaceDir, {
        '.gitignore': 'node_modules/\n.krig/\n',
        'package.json': JSON.stringify({
          name: 'settlement-service',
          version: '0.1.0',
          type: 'module',
          exports: './src/index.mjs',
          scripts: {
            test: 'node --test test/*.test.mjs'
          }
        }, null, 2) + '\n',
        'README.md': [
          '# Settlement Service',
          '',
          'Incoming settlement webhook processor and batch reconciliation package. See `docs/SPEC.md` for API contracts.',
          ''
        ].join('\n'),
        'docs/SPEC.md': [
          '# Settlement Service Specification',
          '',
          '## 1. Webhook Handler (`processSettlementWebhook(rawBody, signatureHeader, secret, store)`)',
          '- **Signature Authentication**: Verify HMAC-SHA256 of `rawBody` using a non-empty `secret` string. Accept raw 64-character hex digests or `sha256=<hex>`. Empty/missing secrets, malformed or wrong-length hex headers, or mismatched digests must return `{ ok: false, status: 401, error: "INVALID_SIGNATURE" }` without throwing.',
          '- **Payload Contract**: Body must parse as a JSON object `{ id: non-empty string, accountId: non-empty string, amount: safe integer >= 0 }` (optional `currency` defaults to `"KRW"`). Zero-amount adjustments (`amount === 0`) are valid. Malformed JSON, negative values, floats, or non-integer amounts must return `{ ok: false, status: 400, error: "INVALID_PAYLOAD" }`.',
          '- **Idempotency & Retry Safety**: Check `await store.hasEvent(id)` before crediting; already recorded events return `{ ok: true, status: 200, duplicate: true }` without re-crediting. Persist via `await store.creditAccount(accountId, amount, id)` and mark processed via `await store.recordEvent(id)` only after crediting and required hooks succeed. If storage fails, return `{ ok: false, status: 500, error: "STORE_ERROR" }` (or rethrow) without leaving `id` marked processed so a subsequent retry succeeds.',
          '- **High-Value Compliance Notification**: Whenever `amount >= 100000` and `typeof store.notifyHighValue === "function"`, invoke `await store.notifyHighValue({ id, accountId, amount })` after crediting. Never swallow compliance notification errors or leave unimplemented stubs in production paths (propagate the failure or return status `>= 500`).',
          '',
          '## 2. Batch Reconciliation (`flushReconcileBatch(batch, sink)`)',
          '- Requires an explicit `sink` object implementing `sendBatch(batch)` (throw an `Error` if `sink` is omitted or lacks `sendBatch`; never fall back to a mock or stub transport).',
          '- When `batch` is empty, return `{ flushed: 0 }`. When `batch` has items, return `await sink.sendBatch(batch)` and allow sink errors to propagate to the caller.',
          ''
        ].join('\n'),
        'src/index.mjs': [
          "export { normalizeSettlementCurrency } from './currency-rates.mjs';",
          "export { formatReceiptId } from './id-format.mjs';",
          "export { flushReconcileBatch } from './reconcile-sink.mjs';",
          "export { processSettlementWebhook } from './settlement.mjs';",
          "export { extractSignatureHeader } from './webhook-headers.mjs';",
          ''
        ].join('\n'),
        'src/currency-rates.mjs': [
          "const SUPPORTED = new Set(['KRW', 'USD', 'JPY', 'EUR']);",
          '',
          'export function normalizeSettlementCurrency(code = "KRW") {',
          '  const upper = String(code || "KRW").trim().toUpperCase();',
          '  return SUPPORTED.has(upper) ? upper : null;',
          '}',
          ''
        ].join('\n'),
        'src/id-format.mjs': [
          'export function isNonEmptyIdentifier(value) {',
          '  return typeof value === "string" && value.trim().length > 0;',
          '}',
          '',
          'export function formatReceiptId(eventId) {',
          '  return `rcpt_${String(eventId).trim()}`;',
          '}',
          ''
        ].join('\n'),
        'src/webhook-headers.mjs': [
          'export function extractSignatureHeader(headers = {}) {',
          '  if (!headers || typeof headers !== "object") return "";',
          '  return String(headers["x-settlement-signature"] ?? headers["X-Settlement-Signature"] ?? "");',
          '}',
          ''
        ].join('\n'),
        'src/hmac.mjs': [
          "import crypto from 'node:crypto';",
          '',
          'export function verifyWebhookSignature(rawBody, signatureHeader, secret) {',
          '  if (!secret) return true;',
          "  const cleaned = String(signatureHeader || '').replace(/^sha256=/, '');",
          "  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');",
          '  return crypto.timingSafeEqual(Buffer.from(cleaned), Buffer.from(expected));',
          '}',
          ''
        ].join('\n'),
        'src/fee-validator.mjs': [
          "import { normalizeSettlementCurrency } from './currency-rates.mjs';",
          "import { isNonEmptyIdentifier } from './id-format.mjs';",
          '',
          'export function isValidSettlementEvent(event) {',
          '  if (!event || typeof event !== "object") return false;',
          '  if (!isNonEmptyIdentifier(event.id) || !isNonEmptyIdentifier(event.accountId)) return false;',
          '  if (event.currency !== undefined && !normalizeSettlementCurrency(event.currency)) return false;',
          '  if (!event.amount || event.amount < 0) return false;',
          '  return true;',
          '}',
          ''
        ].join('\n'),
        'src/compliance-hook.mjs': [
          'export async function dispatchHighValueAlert(event, store) {',
          "  if (event.amount < 100000 || typeof store?.notifyHighValue !== 'function') {",
          '    return;',
          '  }',
          '  try {',
          `    throw new Error('${'TO' + 'DO'}: connect compliance alert transport');`,
          '  } catch (err) {',
          '    return true;',
          '  }',
          '}',
          ''
        ].join('\n'),
        'src/reconcile-sink.mjs': [
          'const fallbackMockSink = {',
          '  sendBatch: typeof jest !== "undefined" ? jest.fn() : async () => ({ ok: true, mocked: true })',
          '};',
          '',
          'export async function flushReconcileBatch(batch, sink = fallbackMockSink) {',
          '  if (!Array.isArray(batch) || batch.length === 0) return { flushed: 0 };',
          '  try {',
          '    return await sink.sendBatch(batch);',
          '  } catch (err) {',
          '    return {};',
          '  }',
          '}',
          ''
        ].join('\n'),
        'src/settlement.mjs': [
          "import { dispatchHighValueAlert } from './compliance-hook.mjs';",
          "import { isValidSettlementEvent } from './fee-validator.mjs';",
          "import { verifyWebhookSignature } from './hmac.mjs';",
          '',
          'export async function processSettlementWebhook(rawBody, signatureHeader, secret, store) {',
          '  if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) {',
          "    return { ok: false, status: 401, error: 'INVALID_SIGNATURE' };",
          '  }',
          '',
          '  const event = JSON.parse(rawBody);',
          '  if (!isValidSettlementEvent(event)) {',
          "    return { ok: false, status: 400, error: 'INVALID_PAYLOAD' };",
          '  }',
          '',
          '  await store.recordEvent(event.id);',
          '',
          '  try {',
          '    await store.creditAccount(event.accountId, event.amount, event.id);',
          '    await dispatchHighValueAlert(event, store);',
          '  } catch (err) {',
          '    // transient failure',
          '  }',
          '',
          '  return { ok: true, status: 200, duplicate: false };',
          '}',
          ''
        ].join('\n'),
        'test/settlement.test.mjs': [
          "import assert from 'node:assert/strict';",
          "import crypto from 'node:crypto';",
          "import test from 'node:test';",
          "import { processSettlementWebhook } from '../src/settlement.mjs';",
          '',
          "test('credits valid webhook payload', async () => {",
          "  const secret = 'whsec_test_key';",
          '  const seen = new Set();',
          '  const credits = [];',
          '  const store = {',
          '    async hasEvent(id) { return seen.has(id); },',
          '    async recordEvent(id) { seen.add(id); },',
          '    async creditAccount(accountId, amount, id) { credits.push({ accountId, amount, id }); }',
          '  };',
          "  const body = JSON.stringify({ id: 'evt_1', accountId: 'acc_1', amount: 1500 });",
          "  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');",
          '  const res = await processSettlementWebhook(body, sig, secret, store);',
          '  assert.equal(res.ok, true);',
          '  assert.equal(credits.length, 1);',
          '});',
          ''
        ].join('\n')
      });
      initGitRepo(workspaceDir);
      const head = commitAll(workspaceDir, 'feat: initial settlement webhook handler', '2026-03-01T09:00:00Z');
      return { initialHead: head };
    },
    async evaluate(workspaceDir) {
      const rec = makeAssertionRecorder();
      const secret = 'whsec_live_998877';

      function makeStore({ failCreditTimes = 0, failCompliance = false } = {}) {
        const seen = new Set();
        const credits = [];
        const alerts = [];
        let failuresLeft = failCreditTimes;
        return {
          seen,
          credits,
          alerts,
          async hasEvent(id) { return seen.has(id); },
          async recordEvent(id) { seen.add(id); },
          async removeEvent(id) { seen.delete(id); },
          async creditAccount(accountId, amount, id) {
            if (failuresLeft > 0) {
              failuresLeft -= 1;
              throw new Error('STORE_UNAVAILABLE');
            }
            credits.push({ accountId, amount, id });
          },
          async notifyHighValue(payload) {
            if (failCompliance) {
              throw new Error('COMPLIANCE_DOWN');
            }
            alerts.push(payload);
          }
        };
      }

      let fn = null;
      let flushFn = null;
      try {
        const idxMod = await importCandidateModule(path.join(workspaceDir, 'src/index.mjs'));
        fn = idxMod.processSettlementWebhook ?? null;
        flushFn = idxMod.flushReconcileBatch ?? null;
      } catch (err) {
        void err;
      }
      if (typeof fn !== 'function') {
        try {
          const mod = await importCandidateModule(path.join(workspaceDir, 'src/settlement.mjs'));
          fn = mod.processSettlementWebhook ?? null;
        } catch (err) {
          void err;
        }
      }
      if (typeof flushFn !== 'function') {
        try {
          const sinkMod = await importCandidateModule(path.join(workspaceDir, 'src/reconcile-sink.mjs'));
          flushFn = sinkMod.flushReconcileBatch ?? null;
        } catch (err) {
          void err;
        }
      }

      await rec.check('valid_credit_once', false, async () => {
        const store = makeStore();
        const body = JSON.stringify({ id: 'evt_100', accountId: 'acc_9', amount: 2500 });
        const res = await fn(body, `sha256=${signPayload(body, secret)}`, secret, store);
        return res?.ok === true && res?.status === 200 && store.credits.length === 1 && store.credits[0].amount === 2500 && store.alerts.length === 0;
      });

      await rec.check('idempotent_duplicate_skip', true, async () => {
        const store = makeStore();
        const body = JSON.stringify({ id: 'evt_dup', accountId: 'acc_9', amount: 4000 });
        const sig = signPayload(body, secret);
        const first = await fn(body, sig, secret, store);
        const second = await fn(body, sig, secret, store);
        return first?.ok === true && second?.ok === true && second?.duplicate === true && store.credits.length === 1;
      });

      await rec.check('reject_empty_secret', true, async () => {
        const store = makeStore();
        const body = JSON.stringify({ id: 'evt_nosec', accountId: 'acc_9', amount: 1000 });
        const resEmpty = await fn(body, '', '', store);
        const resUndef = await fn(body, undefined, undefined, store);
        return resEmpty?.ok === false && resUndef?.ok === false && store.credits.length === 0;
      });

      await rec.check('reject_short_and_forged_signature_cleanly', true, async () => {
        const store = makeStore();
        const body = JSON.stringify({ id: 'evt_forged', accountId: 'acc_9', amount: 1000 });
        const shortSig = await fn(body, 'deadbeef', secret, store);
        const nonHex = await fn(body, 'z'.repeat(64), secret, store);
        return shortSig?.ok === false && shortSig?.status === 401
          && nonHex?.ok === false && nonHex?.status === 401
          && store.credits.length === 0;
      });

      await rec.check('allow_zero_integer_amount', false, async () => {
        const store = makeStore();
        const body = JSON.stringify({ id: 'evt_zero', accountId: 'acc_9', amount: 0 });
        const res = await fn(body, signPayload(body, secret), secret, store);
        return res?.ok === true && store.credits.length === 1 && store.credits[0].amount === 0;
      });

      await rec.check('reject_invalid_amounts_and_malformed_json', true, async () => {
        const store = makeStore();
        const negBody = JSON.stringify({ id: 'evt_neg', accountId: 'acc_9', amount: -10 });
        const strBody = JSON.stringify({ id: 'evt_str', accountId: 'acc_9', amount: '100' });
        const floatBody = JSON.stringify({ id: 'evt_flt', accountId: 'acc_9', amount: 12.5 });
        const rawBadJson = '{"id":"evt_bad"';
        const r1 = await fn(negBody, signPayload(negBody, secret), secret, store);
        const r2 = await fn(strBody, signPayload(strBody, secret), secret, store);
        const r3 = await fn(floatBody, signPayload(floatBody, secret), secret, store);
        const r4 = await fn(rawBadJson, signPayload(rawBadJson, secret), secret, store);
        return r1?.ok === false && r1?.status === 400
          && r2?.ok === false && r2?.status === 400
          && r3?.ok === false && r3?.status === 400
          && r4?.ok === false && r4?.status === 400
          && store.credits.length === 0;
      });

      await rec.check('high_value_compliance_hook_wired_and_unswallowed', true, async () => {
        const okStore = makeStore();
        const hvBody = JSON.stringify({ id: 'evt_hv_1', accountId: 'acc_vip', amount: 150000 });
        const okRes = await fn(hvBody, signPayload(hvBody, secret), secret, okStore);
        if (!okRes?.ok || okStore.alerts.length !== 1 || okStore.alerts[0].amount !== 150000) {
          return false;
        }
        const failStore = makeStore({ failCompliance: true });
        const failBody = JSON.stringify({ id: 'evt_hv_2', accountId: 'acc_vip', amount: 200000 });
        let threw = false;
        let failRes = null;
        try {
          failRes = await fn(failBody, signPayload(failBody, secret), secret, failStore);
        } catch (err) {
          threw = Boolean(err);
        }
        return threw || (failRes?.ok === false && Number(failRes?.status) >= 500);
      });

      await rec.check('reconcile_sink_no_mock_fallback_or_swallow', true, async () => {
        if (typeof flushFn !== 'function') return false;
        let missingSinkThrew = false;
        try {
          await flushFn([{ id: 'b1' }]);
        } catch (err) {
          missingSinkThrew = Boolean(err);
        }
        let sinkErrThrew = false;
        try {
          await flushFn([{ id: 'b1' }], { async sendBatch() { throw new Error('SINK_FAIL'); } });
        } catch (err) {
          sinkErrThrew = Boolean(err);
        }
        return missingSinkThrew && sinkErrThrew;
      });

      await rec.check('retry_succeeds_after_transient_store_failure', true, async () => {
        const store = makeStore({ failCreditTimes: 1 });
        const body = JSON.stringify({ id: 'evt_retry_ok', accountId: 'acc_9', amount: 750 });
        const sig = signPayload(body, secret);
        let firstAttemptFailed = false;
        try {
          const firstRes = await fn(body, sig, secret, store);
          firstAttemptFailed = firstRes?.ok === false && Number(firstRes?.status) >= 500;
        } catch (err) {
          firstAttemptFailed = Boolean(err);
        }
        const retryRes = await fn(body, sig, secret, store);
        return firstAttemptFailed && retryRes?.ok === true && retryRes?.duplicate !== true && store.credits.length === 1;
      });

      const { findings: scanFindings } = scanTargets([path.join(workspaceDir, 'src')]);
      const testRun = runNpmTest(workspaceDir);
      await rec.check('zero_scan_findings_and_tests_pass', false, () => scanFindings.length === 0 && testRun.ok);

      return summarizeTaskEvaluation(
        'webhook-settlement',
        'bugfix+demock',
        workspaceDir,
        rec.assertions,
        scanFindings.length
      );
    }
  },

  {
    id: 'delivery-recovery',
    category: 'model+state',
    prompt: [
      '메시지 본문과 첨부파일을 전송하고 프로세스 재시작 시 복구하는 src/dispatcher.mjs 상태 기계에서 재시도나 크래시 복구 때 중복 발송 또는 비종단 교착 상태가 발생하는 문제가 있습니다.',
      'README.md의 전달 상태 명세를 모두 만족하도록 Dispatcher 클래스(recoverOnBoot, step)를 수정하고 테스트를 보강해주세요.'
    ].join(' '),
    seed(workspaceDir) {
      writeFiles(workspaceDir, {
        '.gitignore': 'node_modules/\n.krig/\n',
        'package.json': JSON.stringify({
          name: 'message-dispatcher',
          version: '0.1.0',
          type: 'module',
          scripts: {
            test: 'node --test test/*.test.mjs'
          }
        }, null, 2) + '\n',
        'README.md': [
          '# Message Dispatcher',
          '',
          '## State Machine Contract (`Dispatcher`)',
          '',
          'Each delivery record tracks:',
          '`{ id, phase, body, attachments, bodyConfirmed, confirmedAttachments, inFlight, ambiguous, attempts, maxAttempts }`.',
          '',
          '- **Phases**: Active phases are `queued` and `retrying`. Terminal phases are `delivered`, `failed_permanent`, and `quarantined` (`step()` on any terminal phase must be a no-op).',
          '- **At-Most-Once Confirmed Delivery**: Once `bodyConfirmed === true` or an attachment index is recorded in `confirmedAttachments`, retries must skip those confirmed items and send only remaining items.',
          '- **Crash Checkpoint Window**: Persist `inFlight = true` via `await store.save(record)` immediately before each individual `transport.sendBody` or `transport.sendAttachment` call, and persist confirmation + `inFlight = false` immediately after that call resolves.',
          '- **Boot Recovery (`recoverOnBoot(record)`)**: If a saved snapshot has `inFlight === true`, network receipt is ambiguous; move immediately to `phase = "quarantined"`, `ambiguous = true`, `inFlight = false` without resending. Otherwise preserve confirmed progress so `step()` can resume.',
          '- **Retry Budget**: When a transport call throws a transient error, clear `inFlight = false` and increment `attempts`. Transition to `failed_permanent` once `attempts >= maxAttempts`, otherwise `retrying` so subsequent `step()` calls advance toward termination.',
          ''
        ].join('\n'),
        'src/dispatcher.mjs': [
          'export class Dispatcher {',
          '  recoverOnBoot(record) {',
          '    if (record.inFlight) {',
          "      record.phase = 'queued';",
          '      record.inFlight = false;',
          '    }',
          '    return record;',
          '  }',
          '',
          '  async step(record, transport, store) {',
          "    if (record.phase === 'delivered' || record.phase === 'failed_permanent') {",
          '      return record;',
          '    }',
          "    if (record.phase === 'retrying' && record.attempts >= record.maxAttempts) {",
          '      return record;',
          '    }',
          '',
          '    try {',
          '      record.inFlight = true;',
          '      await store.save(record);',
          '      await transport.sendBody(record.id, record.body);',
          '      record.bodyConfirmed = true;',
          '',
          '      for (let i = 0; i < record.attachments.length; i += 1) {',
          '        await transport.sendAttachment(record.id, i, record.attachments[i]);',
          '        record.confirmedAttachments.push(i);',
          '      }',
          '',
          '      record.inFlight = false;',
          "      record.phase = 'delivered';",
          '      await store.save(record);',
          '    } catch (err) {',
          '      record.attempts += 1;',
          "      record.phase = 'retrying';",
          '      await store.save(record);',
          '    }',
          '    return record;',
          '  }',
          '}',
          ''
        ].join('\n'),
        'test/dispatcher.test.mjs': [
          "import assert from 'node:assert/strict';",
          "import test from 'node:test';",
          "import { Dispatcher } from '../src/dispatcher.mjs';",
          '',
          "test('delivers simple message on happy path', async () => {",
          '  const dispatcher = new Dispatcher();',
          '  const rec = {',
          "    id: 'm1',",
          "    phase: 'queued',",
          "    body: 'hello',",
          "    attachments: ['a.pdf'],",
          '    bodyConfirmed: false,',
          '    confirmedAttachments: [],',
          '    inFlight: false,',
          '    ambiguous: false,',
          '    attempts: 0,',
          '    maxAttempts: 3',
          '  };',
          '  const sent = [];',
          '  const transport = {',
          "    async sendBody(id, body) { sent.push(['body', id, body]); },",
          "    async sendAttachment(id, idx, name) { sent.push(['att', idx, name]); }",
          '  };',
          '  const store = { async save() {} };',
          '  await dispatcher.step(rec, transport, store);',
          "  assert.equal(rec.phase, 'delivered');",
          '  assert.equal(sent.length, 2);',
          '});',
          ''
        ].join('\n')
      });
      initGitRepo(workspaceDir);
      const head = commitAll(workspaceDir, 'feat: initial message dispatcher', '2026-03-02T09:00:00Z');
      return { initialHead: head };
    },
    async evaluate(workspaceDir) {
      const rec = makeAssertionRecorder();
      const TERMINAL = new Set(['delivered', 'failed_permanent', 'quarantined']);

      function makeRecord(overrides = {}) {
        return {
          id: 'msg_1',
          phase: 'queued',
          body: 'report body',
          attachments: ['a.txt', 'b.txt'],
          bodyConfirmed: false,
          confirmedAttachments: [],
          inFlight: false,
          ambiguous: false,
          attempts: 0,
          maxAttempts: 3,
          ...overrides
        };
      }

      let Dispatcher = null;
      try {
        const mod = await importCandidateModule(path.join(workspaceDir, 'src/dispatcher.mjs'));
        Dispatcher = mod.Dispatcher;
      } catch {
        Dispatcher = null;
      }

      await rec.check('happy_path_delivery', false, async () => {
        const d = new Dispatcher();
        const r = makeRecord();
        let bodyCalls = 0;
        const attCalls = [0, 0];
        const store = { async save() {} };
        const transport = {
          async sendBody() { bodyCalls += 1; },
          async sendAttachment(_id, idx) { attCalls[idx] += 1; }
        };
        await d.step(r, transport, store);
        return r.phase === 'delivered' && r.inFlight === false && bodyCalls === 1 && attCalls[0] === 1 && attCalls[1] === 1;
      });

      await rec.check('partial_attachment_retry_skips_confirmed_body_and_att0', true, async () => {
        const d = new Dispatcher();
        const r = makeRecord();
        let bodyCalls = 0;
        const attCalls = [0, 0];
        let failAtt1Once = true;
        const store = { async save() {} };
        const transport = {
          async sendBody() { bodyCalls += 1; },
          async sendAttachment(_id, idx) {
            attCalls[idx] += 1;
            if (idx === 1 && failAtt1Once) {
              failAtt1Once = false;
              throw new Error('TIMEOUT_BEFORE_SEND');
            }
          }
        };
        await d.step(r, transport, store);
        await d.step(r, transport, store);
        return r.phase === 'delivered' && bodyCalls === 1 && attCalls[0] === 1 && attCalls[1] === 2;
      });

      await rec.check('crash_in_flight_body_quarantines_without_duplicate', true, async () => {
        const d = new Dispatcher();
        let crashedSnapshot = null;
        let bodyCalls = 0;
        const r = makeRecord();
        const store = {
          async save(state) {
            crashedSnapshot = structuredClone(state);
          }
        };
        let crashedMidFlight = false;
        try {
          await new Promise((resolve, reject) => {
            const customTransport = {
              async sendBody() {
                bodyCalls += 1;
                reject(new Error('HARD_CRASH'));
                return new Promise(() => {});
              },
              async sendAttachment() {}
            };
            d.step(r, customTransport, store).then(resolve, reject);
          });
        } catch (err) {
          crashedMidFlight = Boolean(err);
        }
        if (!crashedMidFlight || !crashedSnapshot || crashedSnapshot.inFlight !== true) {
          return false;
        }
        const rebooted = await d.recoverOnBoot(crashedSnapshot);
        if (store.save) await store.save(rebooted);
        let postBootCalls = 0;
        await d.step(
          rebooted,
          { async sendBody() { postBootCalls += 1; }, async sendAttachment() { postBootCalls += 1; } },
          { async save() {} }
        );
        return rebooted.phase === 'quarantined' && rebooted.ambiguous === true && rebooted.inFlight === false && bodyCalls === 1 && postBootCalls === 0;
      });

      await rec.check('crash_in_flight_attachment_quarantines', true, async () => {
        const d = new Dispatcher();
        const disk = makeRecord({
          phase: 'retrying',
          bodyConfirmed: true,
          confirmedAttachments: [0],
          inFlight: true,
          ambiguous: false,
          attempts: 1
        });
        const recovered = await d.recoverOnBoot(disk);
        let networkCalls = 0;
        await d.step(
          recovered,
          { async sendBody() { networkCalls += 1; }, async sendAttachment() { networkCalls += 1; } },
          { async save() {} }
        );
        return recovered.phase === 'quarantined' && recovered.ambiguous === true && recovered.inFlight === false && networkCalls === 0;
      });

      await rec.check('clean_reboot_between_steps_resumes_remaining_attachment', false, async () => {
        const d = new Dispatcher();
        const disk = makeRecord({
          phase: 'retrying',
          bodyConfirmed: true,
          confirmedAttachments: [0],
          inFlight: false,
          ambiguous: false,
          attempts: 1
        });
        const recovered = await d.recoverOnBoot(disk);
        let bodyCalls = 0;
        const attCalls = [0, 0];
        await d.step(
          recovered,
          {
            async sendBody() { bodyCalls += 1; },
            async sendAttachment(_id, idx) { attCalls[idx] += 1; }
          },
          { async save() {} }
        );
        return recovered.phase === 'delivered' && bodyCalls === 0 && attCalls[0] === 0 && attCalls[1] === 1;
      });

      await rec.check('exhausted_retries_reaches_failed_permanent', true, async () => {
        const d = new Dispatcher();
        const r = makeRecord({ maxAttempts: 3 });
        const failTransport = {
          async sendBody() { throw new Error('CONN_REFUSED'); },
          async sendAttachment() { throw new Error('CONN_REFUSED'); }
        };
        const store = { async save() {} };
        await d.step(r, failTransport, store);
        await d.step(r, failTransport, store);
        await d.step(r, failTransport, store);
        return r.phase === 'failed_permanent' && r.inFlight === false && r.attempts === 3;
      });

      await rec.check('terminal_states_are_idempotent_noops', false, async () => {
        const d = new Dispatcher();
        let calls = 0;
        const transport = {
          async sendBody() { calls += 1; },
          async sendAttachment() { calls += 1; }
        };
        const store = { async save() {} };
        for (const phase of ['delivered', 'failed_permanent', 'quarantined']) {
          const r = makeRecord({ phase });
          await d.step(r, transport, store);
          if (r.phase !== phase) return false;
        }
        return calls === 0;
      });

      let exhaustiveDeadlocks = 0;
      let exhaustiveDuplicates = 0;

      await rec.check('exhaustive_schedule_reachability_no_deadlock', true, async () => {
        const outcomes = ['ok', 'err', 'crash'];
        for (const s1 of outcomes) {
          for (const s2 of outcomes) {
            for (const s3 of outcomes) {
              const schedule = [s1, s2, s3, 'ok', 'ok', 'ok'];
              let cursor = 0;
              const d = new Dispatcher();
              let state = makeRecord({ attachments: ['a.txt'], maxAttempts: 2 });
              let lastSaved = structuredClone(state);
              const store = {
                async save(s) { lastSaved = structuredClone(s); }
              };

              for (let guard = 0; guard < 8 && !TERMINAL.has(state.phase); guard += 1) {
                const mode = schedule[Math.min(cursor, schedule.length - 1)];
                cursor += 1;
                if (mode === 'crash') {
                  try {
                    await new Promise((resolve, reject) => {
                      const t = {
                        async sendBody() { reject(new Error('KILL')); return new Promise(() => {}); },
                        async sendAttachment() { reject(new Error('KILL')); return new Promise(() => {}); }
                      };
                      d.step(state, t, store).then(resolve, reject);
                    });
                  } catch {
                    state = await d.recoverOnBoot(structuredClone(lastSaved));
                  }
                } else {
                  const t = {
                    async sendBody() { if (mode === 'err') throw new Error('NET_ERR'); },
                    async sendAttachment() { if (mode === 'err') throw new Error('NET_ERR'); }
                  };
                  await d.step(state, t, store);
                }
              }

              if (!TERMINAL.has(state.phase)) {
                exhaustiveDeadlocks += 1;
              }
            }
          }
        }
        return exhaustiveDeadlocks === 0;
      });

      await rec.check('exhaustive_schedule_zero_confirmed_resends', true, async () => {
        const outcomes = ['ok', 'err'];
        for (const b1 of outcomes) {
          for (const a0 of outcomes) {
            for (const a1 of outcomes) {
              const d = new Dispatcher();
              const state = makeRecord({ attachments: ['x', 'y'], maxAttempts: 3 });
              let bodySuccessCount = 0;
              const attSuccessCount = [0, 0];
              let stepIdx = 0;
              const seq = [b1, a0, a1, 'ok', 'ok', 'ok'];
              const store = { async save() {} };
              for (let guard = 0; guard < 6 && !TERMINAL.has(state.phase); guard += 1) {
                await d.step(state, {
                  async sendBody() {
                    const m = seq[Math.min(stepIdx++, seq.length - 1)];
                    if (m === 'err') throw new Error('ERR');
                    bodySuccessCount += 1;
                  },
                  async sendAttachment(_id, idx) {
                    const m = seq[Math.min(stepIdx++, seq.length - 1)];
                    if (m === 'err') throw new Error('ERR');
                    attSuccessCount[idx] += 1;
                  }
                }, store);
              }
              if (bodySuccessCount > 1 || attSuccessCount[0] > 1 || attSuccessCount[1] > 1) {
                exhaustiveDuplicates += 1;
              }
            }
          }
        }
        return exhaustiveDuplicates === 0;
      });

      const { findings: scanFindings } = scanTargets([path.join(workspaceDir, 'src')]);
      const testRun = runNpmTest(workspaceDir);
      await rec.check('zero_scan_findings_and_tests_pass', false, () => scanFindings.length === 0 && testRun.ok);

      return summarizeTaskEvaluation(
        'delivery-recovery',
        'model+state',
        workspaceDir,
        rec.assertions,
        scanFindings.length
      );
    }
  },

  {
    id: 'bloated-ledger',
    category: 'slim+stdlib',
    prompt: [
      '이 청구서 원장 패키지에 누적된 과잉 추상화, 불필요한 의존성, 미사용 코드, 방치된 주석 부채를 정리해 슬림하게 걷어내고 테스트가 통과하는지 확인해주세요.',
      '공개 엔트리 src/index.mjs의 export 계약(createInvoice, summarizeLedger)과 동작은 그대로 유지해야 합니다.'
    ].join(' '),
    seed(workspaceDir) {
      writeFiles(workspaceDir, {
        '.gitignore': 'node_modules/\n.krig/\n',
        'package.json': JSON.stringify({
          name: 'invoice-ledger',
          version: '0.1.0',
          type: 'module',
          scripts: {
            test: 'node --test test/*.test.mjs',
            'lint:schema': 'schema-lint src'
          },
          dependencies: {
            'left-pad': '^1.3.0',
            'is-odd': '^3.0.1'
          },
          devDependencies: {
            'tap-reporter': '^1.0.0',
            'schema-lint': '^2.0.0'
          }
        }, null, 2) + '\n',
        'src/index.mjs': [
          "export { createInvoice, summarizeLedger } from './ledger.mjs';",
          ''
        ].join('\n'),
        'src/helpers/index.mjs': [
          "export { deepCopyValue } from './clone.mjs';",
          "export { generateInvoiceId } from './uuid.mjs';",
          ''
        ].join('\n'),
        'src/helpers/clone.mjs': [
          'export function deepCopyValue(input) {',
          '  if (input === null || typeof input !== "object") {',
          '    return input;',
          '  }',
          '  if (input instanceof Date) {',
          '    return new Date(input.getTime());',
          '  }',
          '  if (Array.isArray(input)) {',
          '    const arr = [];',
          '    for (let i = 0; i < input.length; i += 1) {',
          '      arr.push(deepCopyValue(input[i]));',
          '    }',
          '    return arr;',
          '  }',
          '  const out = {};',
          '  for (const key of Object.keys(input)) {',
          '    out[key] = deepCopyValue(input[key]);',
          '  }',
          '  return out;',
          '}',
          ''
        ].join('\n'),
        'src/helpers/uuid.mjs': [
          'export function generateInvoiceId() {',
          "  const hex = '0123456789abcdef';",
          '  const sections = [8, 4, 4, 4, 12];',
          '  const parts = [];',
          '  for (const len of sections) {',
          "    let chunk = '';",
          '    for (let i = 0; i < len; i += 1) {',
          '      chunk += hex[Math.floor(Math.random() * 16)];',
          '    }',
          '    parts.push(chunk);',
          '  }',
          "  return `inv_${parts.join('-')}`;",
          '}',
          ''
        ].join('\n'),
        'src/legacy/xml-exporter.mjs': [
          'export function renderLegacyXml(invoice) {',
          '  const rows = (invoice.items || [])',
          '    .map((it) => `<item name="${it.name}" total="${it.unitPrice * it.qty}" />`)',
          "    .join('');",
          '  return `<invoice id="${invoice.id}" customer="${invoice.customer}">${rows}</invoice>`;',
          '}',
          ''
        ].join('\n'),
        'src/ledger.mjs': [
          "import { deepCopyValue, generateInvoiceId } from './helpers/index.mjs';",
          '',
          '// TODO: maybe add redis caching someday',
          'export function createInvoice({ customer, currency = "KRW", items = [] }) {',
          '  if (!customer || typeof customer !== "string") {',
          "    throw new Error('customer is required');",
          '  }',
          '  const clonedItems = deepCopyValue(items).map((item) => ({',
          '    name: item.name,',
          '    qty: item.qty,',
          '    unitPrice: item.unitPrice,',
          '    lineTotal: item.qty * item.unitPrice',
          '  }));',
          '  const subtotal = clonedItems.reduce((sum, it) => sum + it.lineTotal, 0);',
          '  return {',
          '    id: generateInvoiceId(),',
          '    customer,',
          '    currency,',
          '    items: clonedItems,',
          '    subtotal',
          '  };',
          '}',
          '',
          '// FIXME: revisit multi-currency formatting later',
          'export function summarizeLedger(invoices = []) {',
          '  const totalsByCurrency = {};',
          '  for (const inv of invoices) {',
          '    totalsByCurrency[inv.currency] = (totalsByCurrency[inv.currency] || 0) + inv.subtotal;',
          '  }',
          '  return {',
          '    invoiceCount: invoices.length,',
          '    totalsByCurrency',
          '  };',
          '}',
          ''
        ].join('\n'),
        'test/ledger.test.mjs': [
          "import assert from 'node:assert/strict';",
          "import test from 'node:test';",
          "import { createInvoice, summarizeLedger } from '../src/index.mjs';",
          '',
          "test('creates invoice and summarizes totals', () => {",
          "  const rawItems = [{ name: 'Seat', qty: 2, unitPrice: 5000 }];",
          "  const inv = createInvoice({ customer: 'Acme', currency: 'KRW', items: rawItems });",
          '  rawItems[0].qty = 99;',
          '  assert.ok(inv.id.startsWith("inv_"));',
          '  assert.equal(inv.subtotal, 10000);',
          '  const summary = summarizeLedger([inv]);',
          '  assert.equal(summary.invoiceCount, 1);',
          '  assert.deepEqual(summary.totalsByCurrency, { KRW: 10000 });',
          '});',
          ''
        ].join('\n'),
        'test/legacy-xml.test.mjs': [
          "import assert from 'node:assert/strict';",
          "import test from 'node:test';",
          "import { renderLegacyXml } from '../src/legacy/xml-exporter.mjs';",
          '',
          "test('renders legacy xml', () => {",
          "  const xml = renderLegacyXml({ id: 'inv_1', customer: 'Beta', items: [] });",
          '  assert.ok(xml.includes("Beta"));',
          '});',
          ''
        ].join('\n')
      });
      initGitRepo(workspaceDir);
      const head = commitAll(workspaceDir, 'feat: initial invoice ledger package', '2026-03-03T09:00:00Z');
      const initialLoc = countNonEmptyLines(path.join(workspaceDir, 'src'));
      return { initialHead: head, initialLoc };
    },
    async evaluate(workspaceDir, seedMeta) {
      const rec = makeAssertionRecorder();
      let pubMod = null;
      try {
        pubMod = await importCandidateModule(path.join(workspaceDir, 'src/index.mjs'));
      } catch {
        pubMod = null;
      }

      await rec.check('public_api_createInvoice_preserved', true, () => {
        const sourceItems = [{ name: 'Plan', qty: 3, unitPrice: 1200, meta: { tier: 'pro' } }];
        const inv = pubMod.createInvoice({ customer: 'Orbit', currency: 'USD', items: sourceItems });
        sourceItems[0].meta.tier = 'mutated';
        return inv.customer === 'Orbit'
          && inv.currency === 'USD'
          && inv.subtotal === 3600
          && /^inv_[0-9a-f-]{36}$/i.test(inv.id)
          && (inv.items[0].meta === undefined || inv.items[0].meta.tier === 'pro');
      });

      await rec.check('public_api_summarizeLedger_preserved', true, () => {
        const a = pubMod.createInvoice({ customer: 'A', currency: 'KRW', items: [{ name: 'X', qty: 2, unitPrice: 1000 }] });
        const b = pubMod.createInvoice({ customer: 'B', currency: 'USD', items: [{ name: 'Y', qty: 1, unitPrice: 50 }] });
        const s = pubMod.summarizeLedger([a, b]);
        const empty = pubMod.summarizeLedger();
        return s.invoiceCount === 2
          && s.totalsByCurrency.KRW === 2000
          && s.totalsByCurrency.USD === 50
          && empty.invoiceCount === 0;
      });

      const pkg = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'package.json'), 'utf8'));
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      await rec.check('unused_deps_removed', true, () => (
        !('left-pad' in allDeps) && !('is-odd' in allDeps) && !('tap-reporter' in allDeps)
      ));

      await rec.check('used_script_dep_preserved', true, () => (
        'schema-lint' in allDeps
      ));

      await rec.check('pure_barrel_helper_index_removed', true, () => (
        !fs.existsSync(path.join(workspaceDir, 'src/helpers/index.mjs'))
      ));

      await rec.check('orphan_legacy_xml_module_removed', true, () => (
        !fs.existsSync(path.join(workspaceDir, 'src/legacy/xml-exporter.mjs'))
      ));

      const currentLoc = countNonEmptyLines(path.join(workspaceDir, 'src'));
      await rec.check('stdlib_adoption_and_loc_reduction', false, () => {
        const cloneGone = !fs.existsSync(path.join(workspaceDir, 'src/helpers/clone.mjs'));
        const uuidGone = !fs.existsSync(path.join(workspaceDir, 'src/helpers/uuid.mjs'));
        return cloneGone && uuidGone && currentLoc <= Math.floor(seedMeta.initialLoc * 0.65);
      });

      const slimReport = analyzeSlim(workspaceDir);
      await rec.check('rot_risk_debt_comments_cleared', true, () => (
        slimReport.debtLedger.filter((d) => d.file.startsWith('src/') && d.rotRisk === true).length === 0
      ));

      await rec.check('slim_audit_zero_structural_bloat', false, () => (
        slimReport.summary.unusedDependencyCount === 0
          && slimReport.summary.passThroughCount === 0
          && slimReport.summary.unreferencedModuleCount === 0
      ));

      const testRun = runNpmTest(workspaceDir);
      await rec.check('workspace_tests_pass', true, () => testRun.ok);

      return summarizeTaskEvaluation(
        'bloated-ledger',
        'slim+stdlib',
        workspaceDir,
        rec.assertions,
        0
      );
    }
  },

  {
    id: 'lineage-blast',
    category: 'recon:why+blast',
    prompt: [
      '소스 파일은 수정하지 말고 parseTokenHeader 함수의 변경 영향도와 설계 유래를 조사해 저장소 최상위 REPORT.md 파일에 정리해주세요.',
      '(1) ALLOW_LEGACY_COLON 분기와 TOKEN_TTL_SEC = 900 설정이 각각 처음 도입된 정확한 커밋 해시(최소 7자리)와 도입 배경,',
      '(2) parseTokenHeader를 실제로 호출하는 프로덕션 파일 목록과 테스트 전용 호출 파일 목록의 구분,',
      '(3) src/token.mjs가 접하는 외부 입출력 경계,',
      '(4) 외부 API 게이트웨이의 X-Forwarded-Proto 헤더 제거 정책 여부를 포함해야 합니다.'
    ].join(' '),
    seed(workspaceDir) {
      initGitRepo(workspaceDir);

      // Commit 1: base implementation + 3 prod callers + comment/string decoys + 2 tests
      writeFiles(workspaceDir, {
        '.gitignore': 'node_modules/\n.krig/\n',
        'package.json': JSON.stringify({
          name: 'token-gateway',
          version: '0.1.0',
          type: 'module',
          scripts: { test: 'node --test test/*.test.mjs' }
        }, null, 2) + '\n',
        'src/token.mjs': [
          'export const TOKEN_TTL_SEC = 3600;',
          '',
          'export function parseTokenHeader(rawHeader) {',
          "  if (typeof rawHeader !== 'string') return null;",
          "  if (rawHeader.startsWith('Bearer ')) {",
          '    return { token: rawHeader.slice(7).trim(), ttlSec: TOKEN_TTL_SEC };',
          '  }',
          '  return null;',
          '}',
          ''
        ].join('\n'),
        'src/router.mjs': [
          "import { parseTokenHeader } from './token.mjs';",
          '',
          'export function authenticateRequest(req) {',
          '  return parseTokenHeader(req.headers?.authorization);',
          '}',
          ''
        ].join('\n'),
        'src/ws-handshake.mjs': [
          "import { parseTokenHeader } from './token.mjs';",
          '',
          'export function verifyUpgradeSocket(headers) {',
          '  return parseTokenHeader(headers["sec-websocket-protocol"]);',
          '}',
          ''
        ].join('\n'),
        'src/cli-verify.mjs': [
          "import { parseTokenHeader } from './token.mjs';",
          '',
          'export function inspectHeaderArg(raw) {',
          '  return parseTokenHeader(raw);',
          '}',
          ''
        ].join('\n'),
        'src/health.mjs': [
          '// Health probe intentionally bypasses parseTokenHeader(req.headers.authorization) to stay unauthenticated.',
          'export function getHealthStatus() {',
          "  return { status: 'ok' };",
          '}',
          ''
        ].join('\n'),
        'src/error-catalog.mjs': [
          'export const AUTH_ERRORS = Object.freeze({',
          '  INVALID_HEADER: "parseTokenHeader(header) rejected malformed credential"',
          '});',
          ''
        ].join('\n'),
        'test/token.test.mjs': [
          "import assert from 'node:assert/strict';",
          "import test from 'node:test';",
          "import { parseTokenHeader } from '../src/token.mjs';",
          '',
          "test('parses bearer header', () => {",
          "  assert.equal(parseTokenHeader('Bearer abc')?.token, 'abc');",
          '});',
          ''
        ].join('\n'),
        'test/ws.test.mjs': [
          "import assert from 'node:assert/strict';",
          "import test from 'node:test';",
          "import { parseTokenHeader } from '../src/token.mjs';",
          '',
          "test('rejects empty header', () => {",
          '  assert.equal(parseTokenHeader(null), null);',
          '});',
          ''
        ].join('\n')
      });
      commitAll(workspaceDir, 'feat(auth): initial bearer token parser and callers', '2026-02-01T10:00:00Z');

      // Commit 2: introduce ALLOW_LEGACY_COLON for v1iot embedded firmware
      writeFiles(workspaceDir, {
        'src/token.mjs': [
          'export const TOKEN_TTL_SEC = 3600;',
          '',
          'export function parseTokenHeader(rawHeader) {',
          "  if (typeof rawHeader !== 'string') return null;",
          "  if (rawHeader.startsWith('Bearer ')) {",
          '    return { token: rawHeader.slice(7).trim(), ttlSec: TOKEN_TTL_SEC };',
          '  }',
          "  if (process.env.ALLOW_LEGACY_COLON === '1' && rawHeader.startsWith('Token:')) {",
          '    return { token: rawHeader.slice(6).trim(), ttlSec: TOKEN_TTL_SEC, legacy: true };',
          '  }',
          '  return null;',
          '}',
          ''
        ].join('\n')
      });
      const legacyColonSha = commitAll(
        workspaceDir,
        'fix(auth): add ALLOW_LEGACY_COLON fallback for v1iot embedded firmware 1.x devices',
        '2026-02-10T11:30:00Z'
      );

      for (let step = 1; step <= 4; step += 1) {
        writeFiles(workspaceDir, {
          'src/rate-limit.mjs': `export const MAX_REQ_PER_MIN = ${60 + step * 10};\n`
        });
        commitAll(workspaceDir, `chore(rate-limit): tune bucket step ${step}`, `2026-02-1${step}T09:00:00Z`);
      }

      // Introduce TOKEN_TTL_SEC = 900 due to revocation cache lag
      writeFiles(workspaceDir, {
        'src/token.mjs': [
          'export const TOKEN_TTL_SEC = 900;',
          '',
          'export function parseTokenHeader(rawHeader) {',
          "  if (typeof rawHeader !== 'string') return null;",
          "  if (rawHeader.startsWith('Bearer ')) {",
          '    return { token: rawHeader.slice(7).trim(), ttlSec: TOKEN_TTL_SEC };',
          '  }',
          "  if (process.env.ALLOW_LEGACY_COLON === '1' && rawHeader.startsWith('Token:')) {",
          '    return { token: rawHeader.slice(6).trim(), ttlSec: TOKEN_TTL_SEC, legacy: true };',
          '  }',
          '  return null;',
          '}',
          ''
        ].join('\n')
      });
      const ttl900Sha = commitAll(
        workspaceDir,
        'security(auth): cap TOKEN_TTL_SEC to 900s to bound revocation sync lag window',
        '2026-02-18T14:15:00Z'
      );

      for (let step = 1; step <= 14; step += 1) {
        const day = String(Math.min(28, 18 + Math.floor(step / 2))).padStart(2, '0');
        writeFiles(workspaceDir, {
          'src/metrics.mjs': `export const METRIC_SCHEMA_VERSION = ${step};\n`
        });
        commitAll(workspaceDir, `feat(metrics): bump telemetry schema v${step}`, `2026-02-${day}T15:${String(step).padStart(2, '0')}:00Z`);
      }

      // Add filesystem audit logging boundary
      writeFiles(workspaceDir, {
        'src/token.mjs': [
          "import fs from 'node:fs';",
          '',
          'export const TOKEN_TTL_SEC = 900;',
          '',
          'export function parseTokenHeader(rawHeader) {',
          "  if (typeof rawHeader !== 'string') return null;",
          "  if (rawHeader.startsWith('Bearer ')) {",
          '    return { token: rawHeader.slice(7).trim(), ttlSec: TOKEN_TTL_SEC };',
          '  }',
          "  if (process.env.ALLOW_LEGACY_COLON === '1' && rawHeader.startsWith('Token:')) {",
          '    return { token: rawHeader.slice(6).trim(), ttlSec: TOKEN_TTL_SEC, legacy: true };',
          '  }',
          '  if (process.env.TOKEN_AUDIT_LOG) {',
          "    fs.appendFileSync(process.env.TOKEN_AUDIT_LOG, 'REJECTED_HEADER\\n');",
          '  }',
          '  return null;',
          '}',
          ''
        ].join('\n')
      });
      commitAll(workspaceDir, 'feat(audit): record rejected headers when TOKEN_AUDIT_LOG is set', '2026-02-25T16:00:00Z');

      // Release notes commit mentioning the symbols in docs (decoy for naive git log --grep / recent log)
      writeFiles(workspaceDir, {
        'CHANGELOG.md': [
          '# Changelog',
          '',
          '## 0.1.0',
          '- Includes `ALLOW_LEGACY_COLON` toggle and `TOKEN_TTL_SEC = 900` configuration.',
          ''
        ].join('\n')
      });
      commitAll(workspaceDir, 'docs(changelog): summarize ALLOW_LEGACY_COLON and TOKEN_TTL_SEC', '2026-02-26T06:00:00Z');

      // Commit 5: cosmetic reformat touching every line so naive git blame points here instead of commits 2 & 3
      const styleSha = (() => {
        writeFiles(workspaceDir, {
          'src/token.mjs': [
            "import fs from 'node:fs';",
            '',
            '// Token parser module',
            'export const TOKEN_TTL_SEC = 900;',
            '',
            'export function parseTokenHeader(rawHeader) {',
            "  if (typeof rawHeader !== 'string') {",
            '    return null;',
            '  }',
            '',
            "  if (rawHeader.startsWith('Bearer ')) {",
            '    const token = rawHeader.slice(7).trim();',
            '    return { token, ttlSec: TOKEN_TTL_SEC };',
            '  }',
            '',
            "  const allowLegacy = process.env.ALLOW_LEGACY_COLON === '1';",
            "  if (allowLegacy && rawHeader.startsWith('Token:')) {",
            '    const token = rawHeader.slice(6).trim();',
            '    return { token, ttlSec: TOKEN_TTL_SEC, legacy: true };',
            '  }',
            '',
            '  if (process.env.TOKEN_AUDIT_LOG) {',
            "    fs.appendFileSync(process.env.TOKEN_AUDIT_LOG, 'REJECTED_HEADER\\n');",
            '  }',
            '',
            '  return null;',
            '}',
            ''
          ].join('\n')
        });
        return commitAll(workspaceDir, 'style(token): normalize block braces and local variables', '2026-02-26T08:00:00Z');
      })();

      // Commit 6: minimal README with no mention of X-Forwarded-Proto
      writeFiles(workspaceDir, {
        'README.md': '# token-gateway\n\nInternal token header parser.\n'
      });
      const head = commitAll(workspaceDir, 'docs: add minimal package readme', '2026-02-28T12:00:00Z');

      return {
        initialHead: head,
        legacyColonSha,
        ttl900Sha,
        styleSha
      };
    },
    async evaluate(workspaceDir, seedMeta) {
      const rec = makeAssertionRecorder();
      const reportPath = path.join(workspaceDir, 'REPORT.md');
      const reportText = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';

      await rec.check('tracked_source_files_unmodified', true, () => {
        const trackedDiff = runGit(workspaceDir, ['diff', seedMeta.initialHead, '--', 'src', 'test', 'package.json']);
        return trackedDiff === '';
      });

      await rec.check('report_md_created', false, () => reportText.trim().length >= 80);

      await rec.check('origin_sha_and_reason_for_legacy_colon', true, () => {
        const short7 = seedMeta.legacyColonSha.slice(0, 7);
        return reportText.includes(short7) && /v1iot|firmware|펌웨어/i.test(reportText);
      });

      await rec.check('origin_sha_and_reason_for_ttl_900', true, () => {
        const short7 = seedMeta.ttl900Sha.slice(0, 7);
        return reportText.includes(short7) && /revocation|폐기|동기화|sync\s*lag/i.test(reportText);
      });

      await rec.check('all_three_prod_callers_identified', false, () => (
        reportText.includes('router.mjs')
          && reportText.includes('ws-handshake.mjs')
          && reportText.includes('cli-verify.mjs')
      ));

      await rec.check('comment_and_string_decoys_not_claimed_as_callers', true, () => {
        const mentionsHealth = reportText.includes('health.mjs');
        const mentionsCatalog = reportText.includes('error-catalog.mjs');
        if (!mentionsHealth && !mentionsCatalog) return true;
        const nonCallerNote = /주석|문자열|리터럴|호출하지\s*않|비호출|우회|제외|comment|string|literal|bypass|not\s+call|non-caller/i;
        return nonCallerNote.test(reportText);
      });

      await rec.check('test_callers_separated', false, () => (
        reportText.includes('token.test.mjs') && reportText.includes('ws.test.mjs')
      ));

      await rec.check('env_boundary_identified', false, () => (
        reportText.includes('ALLOW_LEGACY_COLON') && reportText.includes('TOKEN_AUDIT_LOG')
      ));

      await rec.check('filesystem_boundary_identified', false, () => (
        /appendFileSync|파일\s*시스템|filesystem|fs\b/i.test(reportText)
      ));

      await rec.check('unrecorded_gateway_policy_marked_unknown', true, () => (
        reportText.includes('X-Forwarded-Proto')
          && /미확인|기록되어\s*있지\s*않|저장소.*없|확인\s*불가|unverified|not\s+documented|unknown/i.test(reportText)
      ));

      return summarizeTaskEvaluation(
        'lineage-blast',
        'recon:why+blast',
        workspaceDir,
        rec.assertions,
        0
      );
    }
  },

  {
    id: 'lease-fencing-queue',
    category: 'model+concurrency',
    prompt: [
      '워커 임대(lease)와 펜싱 토큰으로 작업을 분배하는 src/lease-queue.mjs 모듈에서 임대 만료 회수, 재시도, 취소, 동일 워커 재임대가 겹칠 때 이전 실행자의 뒤늦은 완료나 하트비트가 상태를 덮어쓰거나 비종단 교착 상태가 발생하는 결함이 있습니다.',
      'README.md의 상태 전이 및 불변식 명세를 모두 만족하도록 LeaseQueue 클래스를 수정하고 테스트를 보강해주세요.'
    ].join(' '),
    seed(workspaceDir) {
      writeFiles(workspaceDir, {
        '.gitignore': 'node_modules/\n.krig/\n',
        'package.json': JSON.stringify({
          name: 'lease-fencing-queue',
          version: '0.1.0',
          type: 'module',
          scripts: {
            test: 'node --test test/*.test.mjs'
          }
        }, null, 2) + '\n',
        'README.md': [
          '# Lease Fencing Queue',
          '',
          '## State Machine & Fencing Invariants (`LeaseQueue` in `src/lease-queue.mjs`)',
          '',
          'Each job transitions across active states `queued` and `leased`, and terminal states `completed`, `dead_letter`, and `canceled`.',
          '',
          '- **`enqueue({ id, payload, maxAttempts = 3, priority = 0 }, nowMs = 0)`**:',
          '  - Throws an `Error` if `id` is empty/non-string, already registered, or `maxAttempts` is not a positive integer (`>= 1`).',
          '  - Stores a defensive clone of `payload` with `{ id, payload, state: "queued", priority, maxAttempts, attempts: 0, workerId: null, fenceToken: null, leaseExpiresAt: null, result: undefined, lastError: null, createdAt: nowMs }`.',
          '- **`acquire(workerId, ttlMs, nowMs)`**:',
          '  - Throws an `Error` if `workerId` is empty/non-string or `ttlMs` is not a positive finite number (`> 0`).',
          '  - Selects the `queued` job with highest `priority` (breaking ties by FIFO enqueue order). Returns `null` if none is `queued`.',
          '  - Increments `attempts += 1`, issues a strictly monotonic queue-wide integer `fenceToken` (`1, 2, 3, ...`), sets `state = "leased"`, `workerId`, `leaseExpiresAt = nowMs + ttlMs`, and returns a defensive clone of the job.',
          '- **`heartbeat(id, fenceToken, ttlMs, nowMs)`**:',
          '  - Succeeds (`{ ok: true, leaseExpiresAt: nowMs + ttlMs }`) ONLY when the job exists, `state === "leased"`, `job.fenceToken === fenceToken` (strict positive integer match), `nowMs < job.leaseExpiresAt` (strictly before expiry), and `ttlMs > 0`.',
          '  - Otherwise leaves the job unchanged and returns `{ ok: false, code }`.',
          '- **`complete(id, fenceToken, result)`**:',
          '  - Succeeds (`{ ok: true, state: "completed" }`) ONLY when `state === "leased"` and `job.fenceToken === fenceToken` (strict integer match; missing/zero/stale tokens must never pass).',
          '  - Stores a defensive clone of `result`, transitions `state = "completed"`, and clears `workerId = null, fenceToken = null, leaseExpiresAt = null`. Otherwise returns `{ ok: false, code }` without mutating the job.',
          '- **`fail(id, fenceToken, errorMessage)`**:',
          '  - Succeeds ONLY when `state === "leased"` and `job.fenceToken === fenceToken`.',
          '  - Sets `lastError = String(errorMessage ?? "")`, clears `workerId = null, fenceToken = null, leaseExpiresAt = null`, and transitions to `"dead_letter"` if `job.attempts >= job.maxAttempts`, otherwise `"queued"`. Returns `{ ok: true, state: job.state }`.',
          '- **`reclaimExpired(nowMs)`**:',
          '  - Inspects all jobs in `"leased"` where `nowMs >= job.leaseExpiresAt`.',
          '  - Clears `workerId = null, fenceToken = null, leaseExpiresAt = null`. If `job.attempts >= job.maxAttempts`, transitions directly to `"dead_letter"` (setting `lastError = job.lastError ?? "LEASE_EXPIRED"` and recording `id` in `deadLetterIds`); otherwise transitions to `"queued"` (recording `id` in `reclaimedIds`).',
          '  - Returns `{ reclaimedIds, deadLetterIds }`.',
          '- **`cancel(id)`**:',
          '  - If `state === "queued"` or `state === "leased"`, transitions immediately to terminal `"canceled"`, clears `workerId = null, fenceToken = null, leaseExpiresAt = null`, and returns `{ ok: true, state: "canceled" }` so any in-flight worker token can no longer complete or fail it.',
          '  - If unknown returns `{ ok: false, code: "NOT_FOUND" }`; if already terminal (`completed`, `dead_letter`, `canceled`) returns `{ ok: false, code: "ALREADY_TERMINAL" }` without altering existing `state`, `result`, or `lastError`.',
          '- **`getJob(id)`**:',
          '  - Returns a defensive clone of the job, or `null` if unknown.',
          ''
        ].join('\n'),
        'src/lease-queue.mjs': [
          'export class LeaseQueue {',
          '  constructor() {',
          '    this.jobs = new Map();',
          '  }',
          '',
          '  enqueue({ id, payload, maxAttempts = 3, priority = 0 }, nowMs = 0) {',
          '    if (!id || this.jobs.has(id)) {',
          "      throw new Error('Invalid or duplicate job id');",
          '    }',
          '    const job = {',
          '      id,',
          '      payload,',
          "      state: 'queued',",
          '      priority,',
          '      maxAttempts,',
          '      attempts: 0,',
          '      workerId: null,',
          '      fenceToken: null,',
          '      leaseExpiresAt: null,',
          '      result: undefined,',
          '      lastError: null,',
          '      createdAt: nowMs',
          '    };',
          '    this.jobs.set(id, job);',
          '    return job;',
          '  }',
          '',
          '  acquire(workerId, ttlMs, nowMs) {',
          '    for (const job of this.jobs.values()) {',
          "      if (job.state === 'queued' && job.attempts < job.maxAttempts) {",
          "        job.state = 'leased';",
          '        job.workerId = workerId;',
          '        job.attempts += 1;',
          '        job.fenceToken = 1;',
          '        job.leaseExpiresAt = nowMs + ttlMs;',
          '        return job;',
          '      }',
          '    }',
          '    return null;',
          '  }',
          '',
          '  heartbeat(id, fenceToken, ttlMs, nowMs) {',
          '    const job = this.jobs.get(id);',
          "    if (!job || job.state !== 'leased') return { ok: false, code: 'NOT_LEASED' };",
          "    if (fenceToken && job.fenceToken !== fenceToken) return { ok: false, code: 'STALE_FENCE' };",
          '    job.leaseExpiresAt = nowMs + ttlMs;',
          '    return { ok: true, leaseExpiresAt: job.leaseExpiresAt };',
          '  }',
          '',
          '  complete(id, fenceToken, result) {',
          '    const job = this.jobs.get(id);',
          '    if (!job) return { ok: false, code: "NOT_FOUND" };',
          '    if (fenceToken && job.fenceToken !== fenceToken) {',
          "      return { ok: false, code: 'STALE_FENCE' };",
          '    }',
          "    job.state = 'completed';",
          '    job.result = result;',
          "    return { ok: true, state: 'completed' };",
          '  }',
          '',
          '  fail(id, fenceToken, errorMessage) {',
          '    const job = this.jobs.get(id);',
          "    if (!job || job.state !== 'leased') return { ok: false, code: 'NOT_LEASED' };",
          '    if (fenceToken && job.fenceToken !== fenceToken) {',
          "      return { ok: false, code: 'STALE_FENCE' };",
          '    }',
          '    job.lastError = String(errorMessage ?? "");',
          "    job.state = job.attempts >= job.maxAttempts ? 'dead_letter' : 'queued';",
          '    return { ok: true, state: job.state };',
          '  }',
          '',
          '  reclaimExpired(nowMs) {',
          '    const reclaimedIds = [];',
          '    for (const job of this.jobs.values()) {',
          "      if (job.state === 'leased' && nowMs >= job.leaseExpiresAt) {",
          "        job.state = 'queued';",
          '        reclaimedIds.push(job.id);',
          '      }',
          '    }',
          '    return { reclaimedIds, deadLetterIds: [] };',
          '  }',
          '',
          '  cancel(id) {',
          '    const job = this.jobs.get(id);',
          "    if (!job) return { ok: false, code: 'NOT_FOUND' };",
          "    if (job.state !== 'queued') return { ok: false, code: 'CANNOT_CANCEL' };",
          "    job.state = 'canceled';",
          "    return { ok: true, state: 'canceled' };",
          '  }',
          '',
          '  getJob(id) {',
          '    return this.jobs.get(id) ?? null;',
          '  }',
          '}',
          ''
        ].join('\n'),
        'test/lease-queue.test.mjs': [
          "import assert from 'node:assert/strict';",
          "import test from 'node:test';",
          "import { LeaseQueue } from '../src/lease-queue.mjs';",
          '',
          "test('leases and completes a queued job', () => {",
          '  const q = new LeaseQueue();',
          "  q.enqueue({ id: 'j1', payload: { task: 'sync' } }, 1000);",
          "  const leased = q.acquire('worker-a', 5000, 1000);",
          "  assert.equal(leased.id, 'j1');",
          '  const res = q.complete(leased.id, leased.fenceToken, { synced: 3 });',
          '  assert.equal(res.ok, true);',
          "  assert.equal(q.getJob('j1').state, 'completed');",
          '});',
          ''
        ].join('\n')
      });
      initGitRepo(workspaceDir);
      const head = commitAll(workspaceDir, 'feat: initial worker lease queue', '2026-03-04T09:00:00Z');
      return { initialHead: head };
    },
    async evaluate(workspaceDir) {
      const rec = makeAssertionRecorder();
      const TERMINAL = new Set(['completed', 'dead_letter', 'canceled']);

      let LeaseQueue = null;
      try {
        const mod = await importCandidateModule(path.join(workspaceDir, 'src/lease-queue.mjs'));
        LeaseQueue = mod.LeaseQueue ?? null;
      } catch (err) {
        LeaseQueue = err ? null : null;
      }

      await rec.check('priority_and_fifo_tiebreak_order', false, () => {
        const q = new LeaseQueue();
        q.enqueue({ id: 'low_1', payload: {}, priority: 1 }, 10);
        q.enqueue({ id: 'high_1', payload: {}, priority: 10 }, 20);
        q.enqueue({ id: 'high_2', payload: {}, priority: 10 }, 30);
        q.enqueue({ id: 'mid_1', payload: {}, priority: 5 }, 40);
        const a1 = q.acquire('w1', 100, 50);
        const a2 = q.acquire('w1', 100, 50);
        const a3 = q.acquire('w1', 100, 50);
        const a4 = q.acquire('w1', 100, 50);
        return a1?.id === 'high_1' && a2?.id === 'high_2' && a3?.id === 'mid_1' && a4?.id === 'low_1';
      });

      await rec.check('strictly_monotonic_fencing_tokens_across_jobs_and_reclaims', true, () => {
        const q = new LeaseQueue();
        q.enqueue({ id: 'j1', payload: {}, maxAttempts: 3 }, 0);
        q.enqueue({ id: 'j2', payload: {}, maxAttempts: 3 }, 0);
        const l1 = q.acquire('w1', 50, 100);
        const l2 = q.acquire('w2', 50, 100);
        q.reclaimExpired(150);
        const l3 = q.acquire('w1', 50, 150);
        return Number.isInteger(l1?.fenceToken) && l1.fenceToken >= 1
          && Number.isInteger(l2?.fenceToken) && l2.fenceToken > l1.fenceToken
          && Number.isInteger(l3?.fenceToken) && l3.fenceToken > l2.fenceToken;
      });

      await rec.check('stale_fence_complete_and_fail_rejected_even_same_worker', true, () => {
        const q = new LeaseQueue();
        q.enqueue({ id: 'j_race', payload: {}, maxAttempts: 3 }, 0);
        const first = q.acquire('worker-same', 100, 1000);
        q.reclaimExpired(1100);
        const second = q.acquire('worker-same', 100, 1100);
        const staleComplete = q.complete('j_race', first.fenceToken, { winner: 'stale' });
        const staleFail = q.fail('j_race', first.fenceToken, 'stale boom');
        const stillLeased = q.getJob('j_race');
        const validComplete = q.complete('j_race', second.fenceToken, { winner: 'fresh' });
        const finalJob = q.getJob('j_race');
        return staleComplete?.ok === false
          && staleFail?.ok === false
          && stillLeased?.state === 'leased'
          && validComplete?.ok === true
          && finalJob?.state === 'completed'
          && finalJob?.result?.winner === 'fresh';
      });

      await rec.check('missing_or_invalid_fence_token_never_bypasses_check', true, () => {
        const q = new LeaseQueue();
        q.enqueue({ id: 'j_undef', payload: {}, maxAttempts: 2 }, 0);
        q.acquire('w1', 100, 0);
        const rUndef = q.complete('j_undef', undefined, 'bad');
        const rZero = q.complete('j_undef', 0, 'bad');
        const rNull = q.fail('j_undef', null, 'bad');
        const snap = q.getJob('j_undef');
        return rUndef?.ok === false && rZero?.ok === false && rNull?.ok === false && snap?.state === 'leased';
      });

      await rec.check('heartbeat_requires_strict_pre_expiry_and_positive_ttl', true, () => {
        const q = new LeaseQueue();
        q.enqueue({ id: 'j_hb', payload: {}, maxAttempts: 3 }, 0);
        const leased = q.acquire('w1', 100, 1000);
        const okHb = q.heartbeat('j_hb', leased.fenceToken, 80, 1099);
        const zeroTtl = q.heartbeat('j_hb', leased.fenceToken, 0, 1120);
        const atExpiry = q.heartbeat('j_hb', leased.fenceToken, 100, 1179);
        return okHb?.ok === true && okHb.leaseExpiresAt === 1179
          && zeroTtl?.ok === false
          && atExpiry?.ok === false
          && q.getJob('j_hb')?.leaseExpiresAt === 1179;
      });

      await rec.check('reclaim_expired_dead_letters_when_max_attempts_exhausted', true, () => {
        const q = new LeaseQueue();
        q.enqueue({ id: 'j_exp', payload: {}, maxAttempts: 2 }, 0);
        q.acquire('w1', 50, 0);
        const r1 = q.reclaimExpired(50);
        const second = q.acquire('w2', 50, 50);
        const r2 = q.reclaimExpired(100);
        const afterExhaust = q.acquire('w3', 50, 100);
        const snap = q.getJob('j_exp');
        return r1?.reclaimedIds?.includes('j_exp')
          && second?.attempts === 2
          && r2?.deadLetterIds?.includes('j_exp')
          && afterExhaust === null
          && snap?.state === 'dead_letter'
          && snap?.fenceToken === null
          && snap?.workerId === null;
      });

      await rec.check('fail_retries_then_dead_letters_at_budget', true, () => {
        const q = new LeaseQueue();
        q.enqueue({ id: 'j_fail', payload: {}, maxAttempts: 2 }, 0);
        const l1 = q.acquire('w1', 50, 0);
        const f1 = q.fail('j_fail', l1.fenceToken, 'net_1');
        const l2 = q.acquire('w2', 50, 10);
        const f2 = q.fail('j_fail', l2.fenceToken, 'net_2');
        const snap = q.getJob('j_fail');
        return f1?.ok === true && f1.state === 'queued'
          && f2?.ok === true && f2.state === 'dead_letter'
          && snap?.state === 'dead_letter'
          && snap?.lastError === 'net_2'
          && snap?.fenceToken === null;
      });

      await rec.check('cancel_leased_fences_inflight_worker_and_preserves_terminals', true, () => {
        const q = new LeaseQueue();
        q.enqueue({ id: 'j_can', payload: {}, maxAttempts: 3 }, 0);
        const leased = q.acquire('w1', 100, 0);
        const c1 = q.cancel('j_can');
        const lateComplete = q.complete('j_can', leased.fenceToken, { ok: 1 });
        const cAgain = q.cancel('j_can');

        q.enqueue({ id: 'j_done', payload: {}, maxAttempts: 3 }, 0);
        const lDone = q.acquire('w1', 100, 0);
        q.complete('j_done', lDone.fenceToken, { saved: 42 });
        const cancelCompleted = q.cancel('j_done');

        return c1?.ok === true && c1.state === 'canceled'
          && lateComplete?.ok === false
          && q.getJob('j_can')?.state === 'canceled'
          && cAgain?.ok === false
          && cancelCompleted?.ok === false
          && q.getJob('j_done')?.state === 'completed'
          && q.getJob('j_done')?.result?.saved === 42;
      });

      await rec.check('defensive_clone_isolation_on_enqueue_acquire_get', false, () => {
        const q = new LeaseQueue();
        const input = { nested: { count: 1 } };
        q.enqueue({ id: 'j_iso', payload: input, maxAttempts: 3 }, 0);
        input.nested.count = 999;
        const leased = q.acquire('w1', 100, 0);
        const origFence = leased.fenceToken;
        leased.fenceToken = 99999;
        leased.payload.nested.count = 888;
        const snap = q.getJob('j_iso');
        snap.state = 'completed';
        const real = q.getJob('j_iso');
        return real?.state === 'leased'
          && real?.fenceToken === origFence
          && real?.payload?.nested?.count === 1;
      });

      const testRun = runNpmTest(workspaceDir);
      await rec.check('bounded_interleaving_no_deadlock_and_tests_pass', true, () => {
        if (!testRun.ok) return false;
        // Explore all 3^3 outcome sequences (complete / fail / expire) on maxAttempts=2
        const outcomes = ['complete', 'fail', 'expire'];
        for (const a of outcomes) {
          for (const b of outcomes) {
            for (const c of outcomes) {
              const q = new LeaseQueue();
              q.enqueue({ id: 'm', payload: {}, maxAttempts: 2 }, 0);
              let now = 0;
              for (const step of [a, b, c]) {
                const cur = q.getJob('m');
                if (TERMINAL.has(cur.state)) break;
                const leased = q.acquire('w', 10, now);
                if (!leased) return false;
                if (step === 'complete') {
                  q.complete('m', leased.fenceToken, 'done');
                } else if (step === 'fail') {
                  q.fail('m', leased.fenceToken, 'err');
                } else {
                  now += 15;
                  q.reclaimExpired(now);
                }
              }
              const end = q.getJob('m');
              if (!TERMINAL.has(end.state)) return false;
              if (end.workerId !== null || end.fenceToken !== null || end.leaseExpiresAt !== null) {
                return false;
              }
            }
          }
        }
        return true;
      });

      return summarizeTaskEvaluation(
        'lease-fencing-queue',
        'model+concurrency',
        workspaceDir,
        rec.assertions,
        0
      );
    }
  },

  {
    id: 'release-hygiene-service',
    category: 'demock+slim',
    prompt: [
      '프로덕션 릴리스 직전인 결제 게이트웨이 패키지입니다.',
      'README.md에 명시된 공개 엔트리포인트(src/index.mjs의 authorizeAndCharge, issueRefund, warmPricingCache)의 계약과 타입 검사 스크립트는 유지하면서,',
      '패키지 전반의 프로덕션 테스트 더블 잔재, 삼킨 예외, 느슨한 인증 가드, 미구현 플레이스홀더, 미사용 의존성, 순수 패스스루 배럴 모듈, 미참조 레거시 모듈과 부패 위험 기술부채 주석을 모두 정리하고 테스트를 보강해주세요.'
    ].join(' '),
    seed(workspaceDir) {
      writeFiles(workspaceDir, {
        '.gitignore': 'node_modules/\n.krig/\n',
        'package.json': JSON.stringify({
          name: 'payment-gateway-core',
          version: '0.2.0',
          type: 'module',
          exports: './src/index.mjs',
          scripts: {
            test: 'node --test test/*.test.mjs',
            typecheck: 'tsc --noEmit'
          },
          dependencies: {
            axios: '^1.7.0',
            lodash: '^4.17.21',
            uuid: '^10.0.0'
          },
          devDependencies: {
            sinon: '^18.0.0',
            typescript: '^5.6.0'
          }
        }, null, 2) + '\n',
        'README.md': [
          '# Payment Gateway Core',
          '',
          '`src/index.mjs` is the sole public entrypoint of this package. Legacy v0/SOAP adapters and internal barrel wrappers are retired.',
          '',
          '## Public API Contracts (`src/index.mjs`)',
          '',
          '### 1. `authorizeAndCharge(request, gateway, auditLogger)`',
          '- `request`: `{ merchantId, apiKey, expectedApiKey, amountMinor, currency }`',
          '- **Authentication**: Both `expectedApiKey` and `apiKey` must be non-empty strings that match exactly. Missing/empty `expectedApiKey` or mismatched `apiKey` must return `{ ok: false, code: "UNAUTHORIZED" }` without calling `gateway.capture`.',
          '- **Amount Validation**: `amountMinor` must be a positive safe integer (`> 0`); otherwise throw an `Error` or return `{ ok: false, code: "INVALID_AMOUNT" }`.',
          '- **Capture & Audit**: Calls `const receipt = await gateway.capture({ merchantId, amountMinor, currency })`. When `auditLogger` with `typeof auditLogger.record === "function"` is provided, awaits `auditLogger.record({ chargeId: receipt.chargeId, merchantId, formatted: formatMinorUnits(amountMinor, currency) })` — audit failures MUST propagate to the caller (never swallow errors).',
          '- Returns `{ ok: true, chargeId: receipt.chargeId, formattedAmount: formatMinorUnits(amountMinor, currency) }`.',
          '',
          '### 2. `issueRefund({ chargeId, amountMinor }, gateway)`',
          '- Requires an explicit `gateway` object with `typeof gateway?.refund === "function"` (throw an `Error` if omitted; never fall back to a mock/stub gateway).',
          '- Validates non-empty `chargeId` and positive safe integer `amountMinor > 0` (throw an `Error` if invalid).',
          '- Awaits and returns `gateway.refund({ chargeId, amountMinor })`, propagating gateway errors.',
          '',
          '### 3. `warmPricingCache(loader, cache)`',
          '- Requires `loader.fetchRates()` returning `{ [currencyCode]: number }` and `cache.set(code, rate)`.',
          '- Validates every rate is a finite positive number (`> 0`; throw an `Error` otherwise), writes each normalized uppercase currency entry to `cache.set(code, rate)`, and returns `{ loadedCount }` with no unimplemented placeholder branches.',
          ''
        ].join('\n'),
        'src/index.mjs': [
          "export { authorizeAndCharge, issueRefund } from './billing/index.mjs';",
          "export { warmPricingCache } from './cache/warmer.mjs';",
          ''
        ].join('\n'),
        'src/auth/api-key.mjs': [
          `// ${'HA' + 'CK'}: allow blank merchant key in local dev`,
          'export function verifyMerchantApiKey(providedKey, expectedKey) {',
          '  if (!expectedKey) return true;',
          '  return typeof providedKey === "string" && providedKey === expectedKey;',
          '}',
          ''
        ].join('\n'),
        'src/billing/index.mjs': [
          "export * from './charge.mjs';",
          "export * from './refund.mjs';",
          ''
        ].join('\n'),
        'src/billing/charge.mjs': [
          "import { verifyMerchantApiKey } from '../auth/api-key.mjs';",
          "import { assertPositiveMinorUnits, formatMinorUnits } from '../utils/index.mjs';",
          '',
          'export async function authorizeAndCharge(request, gateway, auditLogger) {',
          '  if (!verifyMerchantApiKey(request?.apiKey, request?.expectedApiKey)) {',
          "    return { ok: false, code: 'UNAUTHORIZED' };",
          '  }',
          '  assertPositiveMinorUnits(request?.amountMinor);',
          '  const currency = String(request?.currency || "USD").toUpperCase();',
          '  const receipt = await gateway.capture({',
          '    merchantId: request.merchantId,',
          '    amountMinor: request.amountMinor,',
          '    currency',
          '  });',
          '  if (typeof auditLogger?.record === "function") {',
          '    try {',
          '      await auditLogger.record({',
          '        chargeId: receipt.chargeId,',
          '        merchantId: request.merchantId,',
          '        formatted: formatMinorUnits(request.amountMinor, currency)',
          '      });',
          '    } catch (err) {',
          '      // ignore audit failure',
          '    }',
          '  }',
          '  return {',
          '    ok: true,',
          '    chargeId: receipt.chargeId,',
          '    formattedAmount: formatMinorUnits(request.amountMinor, currency)',
          '  };',
          '}',
          ''
        ].join('\n'),
        'src/billing/refund.mjs': [
          "import { assertPositiveMinorUnits } from '../utils/index.mjs';",
          '',
          'const defaultMockGateway = {',
          `  refund: typeof vi !== 'undefined' ? ${'vi' + '.fn()'} : async ({ chargeId, amountMinor }) => ({ refunded: true, chargeId, amountMinor, mocked: true })`,
          '};',
          '',
          'export async function issueRefund({ chargeId, amountMinor } = {}, gateway = defaultMockGateway) {',
          '  if (!chargeId || typeof chargeId !== "string") {',
          "    throw new Error('chargeId is required');",
          '  }',
          '  assertPositiveMinorUnits(amountMinor);',
          '  return gateway.refund({ chargeId, amountMinor });',
          '}',
          ''
        ].join('\n'),
        'src/cache/warmer.mjs': [
          'export async function warmPricingCache(loader, cache, options = {}) {',
          '  if (options.refreshTiers) {',
          `    throw new Error('${'TO' + 'DO'}: wire tiered pricing refresh');`,
          '  }',
          '  const rates = await loader.fetchRates();',
          '  let loadedCount = 0;',
          '  for (const [code, rate] of Object.entries(rates ?? {})) {',
          '    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {',
          "      throw new Error(`Invalid rate for ${code}`);",
          '    }',
          '    cache.set(code.trim().toUpperCase(), rate);',
          '    loadedCount += 1;',
          '  }',
          '  return { loadedCount };',
          '}',
          ''
        ].join('\n'),
        'src/utils/index.mjs': [
          "export { assertPositiveMinorUnits, formatMinorUnits } from './money.mjs';",
          ''
        ].join('\n'),
        'src/utils/money.mjs': [
          `// ${'FIX' + 'ME'}: clean up legacy formatting note`,
          'export function assertPositiveMinorUnits(amountMinor) {',
          '  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {',
          "    throw new Error('amountMinor must be a positive safe integer');",
          '  }',
          '}',
          '',
          'export function formatMinorUnits(amountMinor, currency = "USD") {',
          '  return `${String(currency).toUpperCase()} ${amountMinor}`;',
          '}',
          ''
        ].join('\n'),
        'src/webhooks/mock-transport.mjs': [
          'export function createFakeWebhookClient() {',
          '  return { async post() { return { status: 200 }; } };',
          '}',
          ''
        ].join('\n'),
        'src/legacy/v0-xml.mjs': [
          'export function toLegacyChargeXml(chargeId, amount) {',
          '  return `<charge id="${chargeId}">${amount}</charge>`;',
          '}',
          ''
        ].join('\n'),
        'src/legacy/soap-client.mjs': [
          'export function buildSoapEnvelope(action, bodyXml) {',
          '  return `<soap:Envelope action="${action}">${bodyXml}</soap:Envelope>`;',
          '}',
          ''
        ].join('\n'),
        'test/gateway.test.mjs': [
          "import assert from 'node:assert/strict';",
          "import test from 'node:test';",
          "import { authorizeAndCharge } from '../src/index.mjs';",
          '',
          "test('authorizes and captures valid charge', async () => {",
          '  const res = await authorizeAndCharge(',
          "    { merchantId: 'm_1', apiKey: 'k_live', expectedApiKey: 'k_live', amountMinor: 2500, currency: 'usd' },",
          "    { async capture() { return { chargeId: 'ch_101' }; } }",
          '  );',
          '  assert.equal(res.ok, true);',
          "  assert.equal(res.chargeId, 'ch_101');",
          "  assert.equal(res.formattedAmount, 'USD 2500');",
          '});',
          ''
        ].join('\n'),
        'test/soap-client.test.mjs': [
          "import assert from 'node:assert/strict';",
          "import test from 'node:test';",
          "import { buildSoapEnvelope } from '../src/legacy/soap-client.mjs';",
          '',
          "test('builds legacy soap envelope', () => {",
          "  assert.match(buildSoapEnvelope('Capture', '<ok/>'), /soap:Envelope/);",
          '});',
          ''
        ].join('\n')
      });
      initGitRepo(workspaceDir);
      const head = commitAll(workspaceDir, 'chore: pre-release payment gateway snapshot', '2026-03-05T09:00:00Z');
      return { initialHead: head };
    },
    async evaluate(workspaceDir) {
      const rec = makeAssertionRecorder();

      let api = null;
      try {
        api = await importCandidateModule(path.join(workspaceDir, 'src/index.mjs'));
      } catch (err) {
        api = err ? null : null;
      }

      await rec.check('authorize_and_charge_happy_path_and_formatting', false, async () => {
        const audited = [];
        const res = await api.authorizeAndCharge(
          { merchantId: 'm_9', apiKey: 'sec_1', expectedApiKey: 'sec_1', amountMinor: 4900, currency: 'krw' },
          { async capture(p) { return { chargeId: `ch_${p.merchantId}` }; } },
          { async record(entry) { audited.push(entry); } }
        );
        return res?.ok === true
          && res?.chargeId === 'ch_m_9'
          && res?.formattedAmount === 'KRW 4900'
          && audited.length === 1;
      });

      await rec.check('reject_empty_or_mismatched_merchant_api_key', true, async () => {
        let captures = 0;
        const gw = { async capture() { captures += 1; return { chargeId: 'ch_bad' }; } };
        const rEmptyExpected = await api.authorizeAndCharge(
          { merchantId: 'm_9', apiKey: '', expectedApiKey: '', amountMinor: 1000, currency: 'USD' },
          gw
        );
        const rUndefExpected = await api.authorizeAndCharge(
          { merchantId: 'm_9', apiKey: 'any', expectedApiKey: undefined, amountMinor: 1000, currency: 'USD' },
          gw
        );
        const rMismatch = await api.authorizeAndCharge(
          { merchantId: 'm_9', apiKey: 'wrong', expectedApiKey: 'right', amountMinor: 1000, currency: 'USD' },
          gw
        );
        return rEmptyExpected?.ok === false
          && rUndefExpected?.ok === false
          && rMismatch?.ok === false
          && captures === 0;
      });

      await rec.check('propagate_audit_logger_failure_on_charge', true, async () => {
        let threw = false;
        try {
          await api.authorizeAndCharge(
            { merchantId: 'm_9', apiKey: 'sec_1', expectedApiKey: 'sec_1', amountMinor: 1500, currency: 'USD' },
            { async capture() { return { chargeId: 'ch_1' }; } },
            { async record() { throw new Error('AUDIT_DOWN'); } }
          );
        } catch (err) {
          threw = Boolean(err);
        }
        return threw;
      });

      await rec.check('refund_requires_explicit_gateway_and_valid_amount', true, async () => {
        let noGwThrew = false;
        try {
          await api.issueRefund({ chargeId: 'ch_1', amountMinor: 500 });
        } catch (err) {
          noGwThrew = Boolean(err);
        }
        let zeroAmtThrew = false;
        try {
          await api.issueRefund(
            { chargeId: 'ch_1', amountMinor: 0 },
            { async refund() { return { refunded: true }; } }
          );
        } catch (err) {
          zeroAmtThrew = Boolean(err);
        }
        const validRefund = await api.issueRefund(
          { chargeId: 'ch_1', amountMinor: 500 },
          { async refund(p) { return { refunded: true, amountMinor: p.amountMinor }; } }
        );
        return noGwThrew && zeroAmtThrew && validRefund?.refunded === true && validRefund?.amountMinor === 500;
      });

      await rec.check('warm_pricing_cache_loads_rates_without_placeholder_stub', true, async () => {
        const map = new Map();
        const res = await api.warmPricingCache(
          { async fetchRates() { return { usd: 1, krw: 1380.5 }; } },
          map,
          { refreshTiers: true }
        );
        let badRateThrew = false;
        try {
          await api.warmPricingCache(
            { async fetchRates() { return { usd: -5 }; } },
            new Map()
          );
        } catch (err) {
          badRateThrew = Boolean(err);
        }
        return res?.loadedCount === 2 && map.get('USD') === 1 && map.get('KRW') === 1380.5 && badRateThrew;
      });

      const { findings: scanFindings } = scanTargets([path.join(workspaceDir, 'src')]);
      const slimReport = analyzeSlim(workspaceDir);
      const pkg = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'package.json'), 'utf8'));
      const testRun = runNpmTest(workspaceDir);

      await rec.check('zero_scan_hazards_in_production_modules', false, () => scanFindings.length === 0);

      await rec.check('unused_dependencies_pruned_and_typescript_preserved', false, () => {
        const hasTypescript = Boolean(pkg.devDependencies?.typescript || pkg.dependencies?.typescript);
        const hasTypecheckScript = typeof pkg.scripts?.typecheck === 'string' && pkg.scripts.typecheck.includes('tsc');
        return slimReport.summary.unusedDependencyCount === 0 && hasTypescript && hasTypecheckScript;
      });

      await rec.check('pure_passthrough_barrels_eliminated', false, () => slimReport.summary.passThroughCount === 0);

      await rec.check('orphan_legacy_and_mock_modules_eliminated', false, () => slimReport.summary.unreferencedModuleCount === 0);

      await rec.check('zero_rot_risk_debt_and_tests_pass', false, () => (
        slimReport.summary.rotRiskDebtCount === 0 && testRun.ok
      ));

      return summarizeTaskEvaluation(
        'release-hygiene-service',
        'demock+slim',
        workspaceDir,
        rec.assertions,
        scanFindings.length
      );
    }
  }
]);
