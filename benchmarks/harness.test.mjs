import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyTask } from '../skills/krig/scripts/route.mjs';
import { gradeWorkspaces, seedWorkspaces } from './harness.mjs';
import { BENCHMARK_TASKS } from './tasks.mjs';

test('benchmark suite has 6 tasks, 60 held-out assertions, zero blinding leaks, and routes cleanly via /krig', async (t) => {
  assert.equal(BENCHMARK_TASKS.length, 6);

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-suite-'));
  t.after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  // Note: candidate workspace directory names intentionally avoid forbidden meta words ("eval", "bench", "candidate")
  const alphaRoot = path.join(tmpBase, 'ws-alpha');
  const betaRoot = path.join(tmpBase, 'ws-beta');
  const metaPath = path.join(tmpBase, 'logs', 'seed-meta.json');

  const seeded = seedWorkspaces({ alphaRoot, betaRoot, metaPath });
  assert.equal(seeded.workspacePaths.length, 12);

  // Verify /krig router maps each organic task prompt to the intended primary route
  assert.equal(classifyTask(BENCHMARK_TASKS[0].prompt).primaryRoute, 'drive');
  assert.equal(classifyTask(BENCHMARK_TASKS[1].prompt).primaryRoute, 'model');
  assert.equal(classifyTask(BENCHMARK_TASKS[2].prompt).primaryRoute, 'slim');
  assert.equal(classifyTask(BENCHMARK_TASKS[3].prompt).primaryRoute, 'recon');
  assert.deepEqual(classifyTask(BENCHMARK_TASKS[3].prompt).pipeline, ['recon']);
  assert.equal(classifyTask(BENCHMARK_TASKS[4].prompt).primaryRoute, 'model');
  assert.equal(classifyTask(BENCHMARK_TASKS[5].prompt).primaryRoute, 'slim');

  // Baseline unmodified repos must fail the planted traps (non-triviality proof)
  const baseline = await gradeWorkspaces({
    alphaRoot,
    betaRoot,
    seedMetaByTask: seeded.seedMetaByTask,
    model: 'seed-baseline'
  });

  assert.equal(baseline.comparison.metadata.totalOracleAssertions, 60);
  assert.ok(baseline.comparison.aggregate.controlPassed <= 24);
  assert.ok(baseline.comparison.aggregate.controlDefectEscapes >= 25);

  // Apply reference solutions to betaRoot to prove all 40/40 assertions are satisfiable & consistent
  // 1. webhook-settlement reference solution
  fs.writeFileSync(path.join(betaRoot, 'webhook-settlement/src/hmac.mjs'), [
    "import crypto from 'node:crypto';",
    '',
    'export function verifyWebhookSignature(rawBody, signatureHeader, secret) {',
    "  if (typeof secret !== 'string' || secret.length === 0) return false;",
    "  if (typeof rawBody !== 'string' || typeof signatureHeader !== 'string') return false;",
    "  const cleaned = signatureHeader.replace(/^sha256=/, '');",
    '  if (!/^[0-9a-f]{64}$/i.test(cleaned)) return false;',
    "  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');",
    "  return crypto.timingSafeEqual(Buffer.from(cleaned, 'hex'), Buffer.from(expected, 'hex'));",
    '}',
    ''
  ].join('\n'));

  fs.writeFileSync(path.join(betaRoot, 'webhook-settlement/src/fee-validator.mjs'), [
    'export function isValidSettlementEvent(event) {',
    '  if (!event || typeof event !== "object") return false;',
    '  if (typeof event.id !== "string" || event.id.trim() === "") return false;',
    '  if (typeof event.accountId !== "string" || event.accountId.trim() === "") return false;',
    '  if (!Number.isSafeInteger(event.amount) || event.amount < 0) return false;',
    '  return true;',
    '}',
    ''
  ].join('\n'));

  fs.writeFileSync(path.join(betaRoot, 'webhook-settlement/src/compliance-hook.mjs'), [
    'export async function dispatchHighValueAlert(event, store) {',
    "  if (event.amount < 100000 || typeof store?.notifyHighValue !== 'function') {",
    '    return;',
    '  }',
    '  await store.notifyHighValue({',
    '    id: event.id,',
    '    accountId: event.accountId,',
    '    amount: event.amount',
    '  });',
    '}',
    ''
  ].join('\n'));

  fs.writeFileSync(path.join(betaRoot, 'webhook-settlement/src/reconcile-sink.mjs'), [
    'export async function flushReconcileBatch(batch, sink) {',
    '  if (typeof sink?.sendBatch !== "function") {',
    "    throw new Error('Explicit reconcile sink with sendBatch() is required');",
    '  }',
    '  if (!Array.isArray(batch) || batch.length === 0) return { flushed: 0 };',
    '  return sink.sendBatch(batch);',
    '}',
    ''
  ].join('\n'));

  fs.writeFileSync(path.join(betaRoot, 'webhook-settlement/src/settlement.mjs'), [
    "import { dispatchHighValueAlert } from './compliance-hook.mjs';",
    "import { isValidSettlementEvent } from './fee-validator.mjs';",
    "import { verifyWebhookSignature } from './hmac.mjs';",
    '',
    'export async function processSettlementWebhook(rawBody, signatureHeader, secret, store) {',
    '  if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) {',
    "    return { ok: false, status: 401, error: 'INVALID_SIGNATURE' };",
    '  }',
    '',
    '  let event;',
    '  try {',
    '    event = JSON.parse(rawBody);',
    '  } catch {',
    "    return { ok: false, status: 400, error: 'INVALID_PAYLOAD' };",
    '  }',
    '',
    '  if (!isValidSettlementEvent(event)) {',
    "    return { ok: false, status: 400, error: 'INVALID_PAYLOAD' };",
    '  }',
    '',
    '  if (await store.hasEvent(event.id)) {',
    '    return { ok: true, status: 200, duplicate: true };',
    '  }',
    '',
    '  try {',
    '    await store.creditAccount(event.accountId, event.amount, event.id);',
    '    await dispatchHighValueAlert(event, store);',
    '  } catch (err) {',
    "    return { ok: false, status: 500, error: err?.message || 'STORE_ERROR' };",
    '  }',
    '',
    '  await store.recordEvent(event.id);',
    '  return { ok: true, status: 200, duplicate: false };',
    '}',
    ''
  ].join('\n'));

  // 2. delivery-recovery reference solution
  fs.writeFileSync(path.join(betaRoot, 'delivery-recovery/src/dispatcher.mjs'), [
    "const TERMINAL = new Set(['delivered', 'failed_permanent', 'quarantined']);",
    '',
    'export class Dispatcher {',
    '  recoverOnBoot(record) {',
    '    if (record.inFlight) {',
    "      record.phase = 'quarantined';",
    '      record.ambiguous = true;',
    '      record.inFlight = false;',
    '    }',
    '    return record;',
    '  }',
    '',
    '  async step(record, transport, store) {',
    '    if (TERMINAL.has(record.phase)) {',
    '      return record;',
    '    }',
    '    if (record.attempts >= record.maxAttempts) {',
    '      record.inFlight = false;',
    "      record.phase = 'failed_permanent';",
    '      await store.save(record);',
    '      return record;',
    '    }',
    '',
    '    try {',
    '      if (!record.bodyConfirmed) {',
    '        record.inFlight = true;',
    '        await store.save(record);',
    '        await transport.sendBody(record.id, record.body);',
    '        record.bodyConfirmed = true;',
    '        record.inFlight = false;',
    '        await store.save(record);',
    '      }',
    '',
    '      const confirmedSet = new Set(record.confirmedAttachments);',
    '      for (let i = 0; i < record.attachments.length; i += 1) {',
    '        if (confirmedSet.has(i)) continue;',
    '        record.inFlight = true;',
    '        await store.save(record);',
    '        await transport.sendAttachment(record.id, i, record.attachments[i]);',
    '        record.confirmedAttachments.push(i);',
    '        confirmedSet.add(i);',
    '        record.inFlight = false;',
    '        await store.save(record);',
    '      }',
    '',
    '      record.inFlight = false;',
    "      record.phase = 'delivered';",
    '      await store.save(record);',
    '    } catch {',
    '      record.inFlight = false;',
    '      record.attempts += 1;',
    "      record.phase = record.attempts >= record.maxAttempts ? 'failed_permanent' : 'retrying';",
    '      await store.save(record);',
    '    }',
    '    return record;',
    '  }',
    '}',
    ''
  ].join('\n'));

  // 3. bloated-ledger reference solution
  const bloatedDir = path.join(betaRoot, 'bloated-ledger');
  fs.rmSync(path.join(bloatedDir, 'src/helpers'), { recursive: true, force: true });
  fs.rmSync(path.join(bloatedDir, 'src/legacy'), { recursive: true, force: true });
  fs.rmSync(path.join(bloatedDir, 'test/legacy-xml.test.mjs'), { force: true });
  fs.writeFileSync(path.join(bloatedDir, 'package.json'), JSON.stringify({
    name: 'invoice-ledger',
    version: '0.1.0',
    type: 'module',
    scripts: {
      test: 'node --test test/*.test.mjs',
      'lint:schema': 'schema-lint src'
    },
    devDependencies: {
      'schema-lint': '^2.0.0'
    }
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(bloatedDir, 'src/ledger.mjs'), [
    "import crypto from 'node:crypto';",
    '',
    'export function createInvoice({ customer, currency = "KRW", items = [] }) {',
    '  if (!customer || typeof customer !== "string") {',
    "    throw new Error('customer is required');",
    '  }',
    '  const clonedItems = structuredClone(items).map((item) => ({',
    '    name: item.name,',
    '    qty: item.qty,',
    '    unitPrice: item.unitPrice,',
    '    lineTotal: item.qty * item.unitPrice',
    '  }));',
    '  const subtotal = clonedItems.reduce((sum, it) => sum + it.lineTotal, 0);',
    '  return {',
    '    id: `inv_${crypto.randomUUID()}`,',
    '    customer,',
    '    currency,',
    '    items: clonedItems,',
    '    subtotal',
    '  };',
    '}',
    '',
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
  ].join('\n'));

  // 4. lineage-blast reference report
  const lineageMeta = seeded.seedMetaByTask['lineage-blast'].beta;
  fs.writeFileSync(path.join(betaRoot, 'lineage-blast/REPORT.md'), [
    '# parseTokenHeader 영향도 및 설계 계보 보고서',
    '',
    '## 1. 설계 유래 (Git 커밋 계보)',
    `- \`ALLOW_LEGACY_COLON\`: 커밋 \`${lineageMeta.legacyColonSha.slice(0, 8)}\` 에서 v1iot 임베디드 펌웨어(firmware 1.x) 기기 하위 호환을 위해 도입되었다.`,
    `- \`TOKEN_TTL_SEC = 900\`: 커밋 \`${lineageMeta.ttl900Sha.slice(0, 8)}\` 에서 토큰 폐기 동기화 지연(revocation sync lag) 노출 창을 900초로 제한하기 위해 하향되었다.`,
    '',
    '## 2. 호출부 영향 범위',
    '- 실제 프로덕션 호출 파일: `src/router.mjs`, `src/ws-handshake.mjs`, `src/cli-verify.mjs`',
    '- 비호출 파일(주석 및 문자열 리터럴 언급): `src/health.mjs`(주석에서 우회 명시), `src/error-catalog.mjs`(오류 메시지 문자열 리터럴)는 실제 호출하지 않는다.',
    '- 테스트 호출 파일: `test/token.test.mjs`, `test/ws.test.mjs`',
    '',
    '## 3. 외부 입출력 경계',
    '- 환경변수 경계: `process.env.ALLOW_LEGACY_COLON`, `process.env.TOKEN_AUDIT_LOG`',
    '- 파일시스템 경계: `fs.appendFileSync`를 통한 감사 로그 파일 기록',
    '',
    '## 4. 외부 게이트웨이 X-Forwarded-Proto 정책',
    '- `X-Forwarded-Proto` 헤더 제거 여부는 현재 저장소 코드나 커밋 이력에 기록되어 있지 않아 **미확인**이다.',
    ''
  ].join('\n'));

  // 5. lease-fencing-queue reference solution
  fs.writeFileSync(path.join(betaRoot, 'lease-fencing-queue/src/lease-queue.mjs'), [
    "const TERMINAL = new Set(['completed', 'dead_letter', 'canceled']);",
    '',
    'export class LeaseQueue {',
    '  constructor() {',
    '    this.jobs = new Map();',
    '    this.seq = 0;',
    '    this.nextFence = 0;',
    '  }',
    '',
    '  enqueue({ id, payload, maxAttempts = 3, priority = 0 } = {}, nowMs = 0) {',
    '    if (typeof id !== "string" || id.trim() === "" || this.jobs.has(id)) {',
    "      throw new Error('Invalid or duplicate job id');",
    '    }',
    '    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {',
    "      throw new Error('maxAttempts must be a positive integer');",
    '    }',
    '    this.seq += 1;',
    '    const job = {',
    '      id,',
    '      payload: structuredClone(payload),',
    "      state: 'queued',",
    '      priority,',
    '      maxAttempts,',
    '      attempts: 0,',
    '      workerId: null,',
    '      fenceToken: null,',
    '      leaseExpiresAt: null,',
    '      result: undefined,',
    '      lastError: null,',
    '      createdAt: nowMs,',
    '      _seq: this.seq',
    '    };',
    '    this.jobs.set(id, job);',
    '    return this._clonePublic(job);',
    '  }',
    '',
    '  _clonePublic(job) {',
    '    const { _seq, ...rest } = job;',
    '    void _seq;',
    '    return structuredClone(rest);',
    '  }',
    '',
    '  acquire(workerId, ttlMs, nowMs) {',
    '    if (typeof workerId !== "string" || workerId.trim() === "") {',
    "      throw new Error('workerId is required');",
    '    }',
    '    if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {',
    "      throw new Error('ttlMs must be positive');",
    '    }',
    '    let best = null;',
    '    for (const job of this.jobs.values()) {',
    "      if (job.state !== 'queued') continue;",
    '      if (!best || job.priority > best.priority || (job.priority === best.priority && job._seq < best._seq)) {',
    '        best = job;',
    '      }',
    '    }',
    '    if (!best) return null;',
    '    this.nextFence += 1;',
    "    best.state = 'leased';",
    '    best.workerId = workerId;',
    '    best.attempts += 1;',
    '    best.fenceToken = this.nextFence;',
    '    best.leaseExpiresAt = nowMs + ttlMs;',
    '    return this._clonePublic(best);',
    '  }',
    '',
    '  heartbeat(id, fenceToken, ttlMs, nowMs) {',
    '    const job = this.jobs.get(id);',
    "    if (!job) return { ok: false, code: 'NOT_FOUND' };",
    "    if (job.state !== 'leased') return { ok: false, code: 'NOT_LEASED' };",
    '    if (!Number.isInteger(fenceToken) || fenceToken < 1 || job.fenceToken !== fenceToken) {',
    "      return { ok: false, code: 'STALE_FENCE' };",
    '    }',
    '    if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {',
    "      return { ok: false, code: 'INVALID_TTL' };",
    '    }',
    '    if (nowMs >= job.leaseExpiresAt) {',
    "      return { ok: false, code: 'LEASE_EXPIRED' };",
    '    }',
    '    job.leaseExpiresAt = nowMs + ttlMs;',
    '    return { ok: true, leaseExpiresAt: job.leaseExpiresAt };',
    '  }',
    '',
    '  complete(id, fenceToken, result) {',
    '    const job = this.jobs.get(id);',
    "    if (!job) return { ok: false, code: 'NOT_FOUND' };",
    "    if (job.state !== 'leased') return { ok: false, code: 'NOT_LEASED' };",
    '    if (!Number.isInteger(fenceToken) || fenceToken < 1 || job.fenceToken !== fenceToken) {',
    "      return { ok: false, code: 'STALE_FENCE' };",
    '    }',
    "    job.state = 'completed';",
    '    job.result = structuredClone(result);',
    '    job.workerId = null;',
    '    job.fenceToken = null;',
    '    job.leaseExpiresAt = null;',
    "    return { ok: true, state: 'completed' };",
    '  }',
    '',
    '  fail(id, fenceToken, errorMessage) {',
    '    const job = this.jobs.get(id);',
    "    if (!job) return { ok: false, code: 'NOT_FOUND' };",
    "    if (job.state !== 'leased') return { ok: false, code: 'NOT_LEASED' };",
    '    if (!Number.isInteger(fenceToken) || fenceToken < 1 || job.fenceToken !== fenceToken) {',
    "      return { ok: false, code: 'STALE_FENCE' };",
    '    }',
    '    job.lastError = String(errorMessage ?? "");',
    '    job.workerId = null;',
    '    job.fenceToken = null;',
    '    job.leaseExpiresAt = null;',
    "    job.state = job.attempts >= job.maxAttempts ? 'dead_letter' : 'queued';",
    '    return { ok: true, state: job.state };',
    '  }',
    '',
    '  reclaimExpired(nowMs) {',
    '    const reclaimedIds = [];',
    '    const deadLetterIds = [];',
    '    for (const job of this.jobs.values()) {',
    "      if (job.state === 'leased' && nowMs >= job.leaseExpiresAt) {",
    '        job.workerId = null;',
    '        job.fenceToken = null;',
    '        job.leaseExpiresAt = null;',
    '        if (job.attempts >= job.maxAttempts) {',
    "          job.state = 'dead_letter';",
    "          job.lastError = job.lastError ?? 'LEASE_EXPIRED';",
    '          deadLetterIds.push(job.id);',
    '        } else {',
    "          job.state = 'queued';",
    '          reclaimedIds.push(job.id);',
    '        }',
    '      }',
    '    }',
    '    return { reclaimedIds, deadLetterIds };',
    '  }',
    '',
    '  cancel(id) {',
    '    const job = this.jobs.get(id);',
    "    if (!job) return { ok: false, code: 'NOT_FOUND' };",
    '    if (TERMINAL.has(job.state)) {',
    "      return { ok: false, code: 'ALREADY_TERMINAL' };",
    '    }',
    "    job.state = 'canceled';",
    '    job.workerId = null;',
    '    job.fenceToken = null;',
    '    job.leaseExpiresAt = null;',
    "    return { ok: true, state: 'canceled' };",
    '  }',
    '',
    '  getJob(id) {',
    '    const job = this.jobs.get(id);',
    '    return job ? this._clonePublic(job) : null;',
    '  }',
    '}',
    ''
  ].join('\n'));

  // 6. release-hygiene-service reference solution
  const hygieneDir = path.join(betaRoot, 'release-hygiene-service');
  fs.rmSync(path.join(hygieneDir, 'src/billing/index.mjs'), { force: true });
  fs.rmSync(path.join(hygieneDir, 'src/utils/index.mjs'), { force: true });
  fs.rmSync(path.join(hygieneDir, 'src/webhooks'), { recursive: true, force: true });
  fs.rmSync(path.join(hygieneDir, 'src/legacy'), { recursive: true, force: true });
  fs.rmSync(path.join(hygieneDir, 'test/soap-client.test.mjs'), { force: true });

  fs.writeFileSync(path.join(hygieneDir, 'package.json'), JSON.stringify({
    name: 'payment-gateway-core',
    version: '0.2.0',
    type: 'module',
    exports: './src/index.mjs',
    scripts: {
      test: 'node --test test/*.test.mjs',
      typecheck: 'tsc --noEmit'
    },
    devDependencies: {
      typescript: '^5.6.0'
    }
  }, null, 2) + '\n');

  fs.writeFileSync(path.join(hygieneDir, 'src/index.mjs'), [
    "export { authorizeAndCharge } from './billing/charge.mjs';",
    "export { issueRefund } from './billing/refund.mjs';",
    "export { warmPricingCache } from './cache/warmer.mjs';",
    ''
  ].join('\n'));

  fs.writeFileSync(path.join(hygieneDir, 'src/auth/api-key.mjs'), [
    'export function verifyMerchantApiKey(providedKey, expectedKey) {',
    '  if (typeof expectedKey !== "string" || expectedKey.length === 0) return false;',
    '  return typeof providedKey === "string" && providedKey === expectedKey;',
    '}',
    ''
  ].join('\n'));

  fs.writeFileSync(path.join(hygieneDir, 'src/utils/money.mjs'), [
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
  ].join('\n'));

  fs.writeFileSync(path.join(hygieneDir, 'src/billing/charge.mjs'), [
    "import { verifyMerchantApiKey } from '../auth/api-key.mjs';",
    "import { assertPositiveMinorUnits, formatMinorUnits } from '../utils/money.mjs';",
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
    '    await auditLogger.record({',
    '      chargeId: receipt.chargeId,',
    '      merchantId: request.merchantId,',
    '      formatted: formatMinorUnits(request.amountMinor, currency)',
    '    });',
    '  }',
    '  return {',
    '    ok: true,',
    '    chargeId: receipt.chargeId,',
    '    formattedAmount: formatMinorUnits(request.amountMinor, currency)',
    '  };',
    '}',
    ''
  ].join('\n'));

  fs.writeFileSync(path.join(hygieneDir, 'src/billing/refund.mjs'), [
    "import { assertPositiveMinorUnits } from '../utils/money.mjs';",
    '',
    'export async function issueRefund({ chargeId, amountMinor } = {}, gateway) {',
    '  if (typeof gateway?.refund !== "function") {',
    "    throw new Error('Explicit gateway with refund() is required');",
    '  }',
    '  if (!chargeId || typeof chargeId !== "string") {',
    "    throw new Error('chargeId is required');",
    '  }',
    '  assertPositiveMinorUnits(amountMinor);',
    '  return gateway.refund({ chargeId, amountMinor });',
    '}',
    ''
  ].join('\n'));

  fs.writeFileSync(path.join(hygieneDir, 'src/cache/warmer.mjs'), [
    'export async function warmPricingCache(loader, cache) {',
    '  if (typeof loader?.fetchRates !== "function" || typeof cache?.set !== "function") {',
    "    throw new Error('loader.fetchRates and cache.set are required');",
    '  }',
    '  const rates = await loader.fetchRates();',
    '  let loadedCount = 0;',
    '  for (const [code, rate] of Object.entries(rates ?? {})) {',
    '    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {',
    '      throw new Error(`Invalid rate for ${code}`);',
    '    }',
    '    cache.set(code.trim().toUpperCase(), rate);',
    '    loadedCount += 1;',
    '  }',
    '  return { loadedCount };',
    '}',
    ''
  ].join('\n'));

  const solved = await gradeWorkspaces({
    alphaRoot,
    betaRoot,
    seedMetaByTask: seeded.seedMetaByTask,
    model: 'reference-oracle-check'
  });

  assert.equal(solved.comparison.aggregate.treatmentPassed, 60);
  assert.equal(solved.comparison.aggregate.treatmentPassRatePct, 100);
  assert.equal(solved.comparison.aggregate.treatmentDefectEscapes, 0);
  assert.equal(solved.comparison.aggregate.treatmentWins, 6);
});
