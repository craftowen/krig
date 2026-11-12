import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { appendDecisionRow, verifyDecisionLog } from './decision-log.mjs';
import { readLedgerEvents, recordLedgerEvent, summarizeLedger } from './ledger.mjs';
import { classifyTask, hasTicketId } from './route.mjs';
import { scanTargets } from './scan.mjs';
import { reflowMarkdown, validateBackpropRule } from './unwrap.mjs';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '../../..');

test('route.mjs classifies core routes and handles Korean/English lexical boundary regressions', () => {
  const alignPlan = classifyTask('/krig 새 정산 파이프라인 요구사항 감량하고 티켓 등록해줘');
  assert.deepEqual(alignPlan.pipeline, ['align']);
  assert.equal(alignPlan.steps[0].gear, 'hitl');

  const implicitFull = classifyTask('결제 시스템 기획부터 끝까지 자율 실행해줘');
  assert.equal(implicitFull.primaryRoute, 'full');
  assert.deepEqual(implicitFull.pipeline, ['align', 'design', 'drive', 'demock', 'verify']);
  assert.equal(implicitFull.steps[0].gear, 'afk');

  const epicSplit = classifyTask('PROJ-100 에픽 티켓 쪼개줘');
  assert.deepEqual(epicSplit.pipeline, ['align']);

  const designPlan = classifyTask('결제 웹훅 어댑터 구조와 인터페이스 설계만 잡아줘');
  assert.deepEqual(designPlan.pipeline, ['design', 'verify']);

  const bugPlan = classifyTask('#42번 간헐적 타임아웃 버그 원인 찾아서 고쳐줘');
  assert.equal(hasTicketId('#42번 간헐적 타임아웃 버그'), true);
  assert.deepEqual(bugPlan.pipeline, ['drive', 'demock', 'verify']);
  assert.equal(bugPlan.driveMode, 'bugfix');

  const hillPlan = classifyTask('파서 처리량 30% 향상 성능 최적화 돌려줘');
  assert.deepEqual(hillPlan.pipeline, ['drive', 'demock', 'verify']);
  assert.equal(hillPlan.driveMode, 'hillclimb');

  const crashBeatsHillclimb = classifyTask('레이턴시 20% 개선하다 생긴 크래시 버그 고쳐줘');
  assert.equal(crashBeatsHillclimb.driveMode, 'bugfix');

  const demockPlan = classifyTask('방금 작성한 코드에 삼킨 예외나 가짜 성공 없는지 털어줘');
  assert.deepEqual(demockPlan.pipeline, ['demock', 'verify']);

  const verifyPlan = classifyTask('esbuild 설정 변경된 브랜치 콜드 리드 포함해서 코드 리뷰해줘');
  assert.deepEqual(verifyPlan.pipeline, ['verify']);

  const backpropPlan = classifyTask('오늘 발생한 실수 재발 방지 규칙으로 역전파해줘');
  assert.deepEqual(backpropPlan.pipeline, ['backprop']);

  // False-positive guardrails on Korean/English substrings
  assert.equal(classifyTask('중복 항목 제거해줘').primaryRoute, 'drive');
  assert.equal(classifyTask('검색창 플레이스홀더 추가해줘').primaryRoute, 'drive');
  assert.equal(classifyTask('테이블 날짜순 정렬해줘').primaryRoute, 'drive');
  assert.equal(classifyTask('요구사항대로 API 구현해줘').primaryRoute, 'drive');
  assert.equal(classifyTask('요구사항 문서 오타 고쳐줘').driveMode, 'bugfix');
  assert.equal(classifyTask('할인 규칙을 결제 모듈에 반영해줘').primaryRoute, 'drive');
  assert.equal(classifyTask('리뷰 작성 버튼이 안 돼').driveMode, 'bugfix');
  assert.equal(classifyTask('테스트 fixture 추가해줘').driveMode, 'feature');

  // English sentences starting with route-like words are NOT hijacked as overrides
  const engDesignImpl = classifyTask('Design and implement a webhook handler');
  assert.equal(engDesignImpl.explicitOverride, false);
  assert.deepEqual(engDesignImpl.pipeline, ['design', 'drive', 'demock', 'verify']);

  const engVerifyImpl = classifyTask('Verify JWT signature in middleware and add tests');
  assert.equal(engVerifyImpl.explicitOverride, false);
  assert.equal(engVerifyImpl.primaryRoute, 'drive');

  const engFullText = classifyTask('Full text search 구현해줘');
  assert.equal(engFullText.explicitOverride, false);
  assert.equal(engFullText.primaryRoute, 'drive');

  // Explicit overrides work via prefix or Korean/ticket/path target
  const explicitTicket = classifyTask('verify PROJ-120 구현 코드 검토');
  assert.equal(explicitTicket.explicitOverride, true);
  assert.deepEqual(explicitTicket.pipeline, ['verify']);

  const explicitPrefix = classifyTask('route:verify Review English diff');
  assert.equal(explicitPrefix.explicitOverride, true);
  assert.deepEqual(explicitPrefix.pipeline, ['verify']);
});

test('route.mjs CLI supports --list --json in any order and --stdin input with shell metacharacters', () => {
  const routeCli = path.join(SCRIPTS_DIR, 'route.mjs');

  const listJson = spawnSync(process.execPath, [routeCli, '--list', '--json'], { encoding: 'utf8' });
  assert.equal(listJson.status, 0);
  const routes = JSON.parse(listJson.stdout);
  assert.equal(routes.length, 6);

  const stdinRun = spawnSync(
    process.execPath,
    [routeCli, '--json', '--stdin'],
    { input: '`$HOME` 경로 파싱 버그 고쳐줘\n', encoding: 'utf8' }
  );
  assert.equal(stdinRun.status, 0);
  const parsed = JSON.parse(stdinRun.stdout);
  assert.equal(parsed.primaryRoute, 'drive');
  assert.equal(parsed.driveMode, 'bugfix');
});

test('ledger.mjs trims inputs, enforces valid state transitions, and flags under-deletion', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-ledger-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ledgerFile = path.join(dir, 'ledger.jsonl');

  assert.throws(() => {
    recordLedgerEvent(ledgerFile, { kind: 'deleted', id: '   ', reason: '사유' });
  }, /필수/);

  assert.throws(() => {
    recordLedgerEvent(ledgerFile, { kind: 'restored', id: 'NEVER-DELETED', reason: '복구 시도' });
  }, /삭제된 이력이 없는 항목/);

  for (let i = 1; i <= 5; i += 1) {
    recordLedgerEvent(ledgerFile, {
      kind: 'deleted',
      id: `REQ-${i}`,
      title: `관성 기능 ${i}`,
      source: 'inertia',
      reason: '실명 오너 없음'
    });
  }

  const dupWithSpaces = recordLedgerEvent(ledgerFile, {
    kind: 'deleted',
    id: '  REQ-5  ',
    title: '관성 기능 5',
    source: 'inertia',
    reason: '  실명 오너 없음  '
  });
  assert.equal(dupWithSpaces.appended, false);
  assert.equal(dupWithSpaces.summary.underDeletionWarning, true);

  const restored = recordLedgerEvent(ledgerFile, {
    kind: 'restored',
    id: 'REQ-2',
    title: '관성 기능 2',
    source: '계약 조항 4조',
    reason: '외부 웹훅 필수 필드 확인'
  });
  assert.equal(restored.summary.restoredCount, 1);
  assert.equal(restored.summary.addBackRate, 0.2);
  assert.equal(restored.summary.underDeletionWarning, false);

  const reclassifiedKept = recordLedgerEvent(ledgerFile, {
    kind: 'kept',
    id: 'REQ-5',
    reason: '초기 필수 스펙으로 재분류'
  });
  assert.equal(reclassifiedKept.summary.deletedCount, 4);
  assert.equal(reclassifiedKept.summary.keptCount, 1);
  assert.equal(reclassifiedKept.summary.totalItems, 5);
  assert.equal(readLedgerEvents(ledgerFile).length, 7);
  assert.equal(summarizeLedger(readLedgerEvents(ledgerFile)).activeDeletedIds.length, 3);
});

test('decision-log.mjs rejects placeholder evidence on KEEP/VERIFIED, preserves empty trailing commit, and checks git repo', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-log-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tsvFile = path.join(dir, 'decisions.tsv');

  for (const badEvidence of ['', 'none', 'NONE', '-']) {
    assert.throws(() => {
      appendDecisionRow(tsvFile, {
        route: 'drive',
        step: 'exp-1',
        hypothesis: '캐시 적용 시 지연 감소',
        action: 'LRU 추가',
        evidence: badEvidence,
        verdict: 'KEEP'
      });
    }, /실행 근거/);
  }

  appendDecisionRow(tsvFile, {
    route: 'drive',
    step: 'exp-1',
    hypothesis: '캐시 적용 시 지연 감소',
    action: 'LRU 추가',
    evidence: 'p95 120ms to 78ms (n=200)',
    verdict: 'KEEP'
  });

  const checkOk = verifyDecisionLog(tsvFile);
  assert.equal(checkOk.ok, true);
  assert.equal(checkOk.rowCount, 1);

  const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-git-repo-'));
  t.after(() => fs.rmSync(nonGitDir, { recursive: true, force: true }));
  const checkInvalidRepo = verifyDecisionLog(tsvFile, { repo: nonGitDir });
  assert.equal(checkInvalidRepo.ok, false);
  assert.ok(checkInvalidRepo.errors.some((e) => e.includes('유효한 git 저장소가 아닙니다')));

  appendDecisionRow(tsvFile, {
    route: 'drive',
    step: 'exp-2',
    hypothesis: '가짜 커밋 검증',
    action: '커밋 기록',
    evidence: 'exit 0',
    verdict: 'VERIFIED',
    commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
  });

  const checkBadCommit = verifyDecisionLog(tsvFile, { repo: REPO_ROOT });
  assert.equal(checkBadCommit.ok, false);
  assert.ok(checkBadCommit.errors.some((e) => e.includes('존재하지 않는 git 커밋')));
});

test('scan.mjs self-scans krig cleanly and accurately handles multiline, abstract-method, and test-path cases', (t) => {
  const selfScan = scanTargets([REPO_ROOT]);
  assert.ok(selfScan.scannedFiles >= 10);
  assert.deepEqual(selfScan.findings, []);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-scan-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'src', 'auth.js'), [
    'export function verifyWebhook(payload, signature, webhookSecret) {',
    '  if (!webhookSecret) {',
    '    return true;',
    '  }',
    '  try {',
    '    return checkHmac(payload, signature, webhookSecret);',
    '  } catch (err) {',
    '    // comment inside swallowed catch',
    '  }',
    '}',
    'export const fakeClient = jest.fn();',
    'export const regexInProd = /\\bjest\\.fn\\b/;',
    'export function allowedMultiline() {',
    '  // demock: allow optional cache warmup failure is non-fatal',
    '  try {',
    '    warmup();',
    '  } catch (e) {',
    '  }',
    '}'
  ].join('\n'));

  fs.writeFileSync(path.join(dir, 'src', 'worker.py'), [
    'class BaseEngine:',
    '    def argv(self, prompt: str):',
    '        """Abstract method contract."""',
    '        raise NotImplementedError',
    '',
    'def run_job():',
    '    try:',
    '        execute()',
    '    except Exception: pass',
    '    raise NotImplementedError("pending")'
  ].join('\n'));

  const testFile = path.join(dir, 'tests', 'auth.test.js');
  fs.writeFileSync(testFile, [
    'const mockFn = jest.fn();',
    'try { bad(); } catch {}'
  ].join('\n'));

  assert.equal(scanTargets([testFile]).scannedFiles, 0);
  assert.equal(scanTargets([path.join(dir, 'tests')]).scannedFiles, 0);

  const res = scanTargets([dir]);
  assert.equal(res.scannedFiles, 2);
  const categories = res.findings.map((f) => f.category).sort();
  assert.deepEqual(categories, [
    'permissive-guard',
    'placeholder',
    'swallowed-error',
    'swallowed-error',
    'test-double-in-prod'
  ]);

  const symlinkScan = path.join(dir, 'scan-link.mjs');
  fs.symlinkSync(path.join(SCRIPTS_DIR, 'scan.mjs'), symlinkScan);
  const proc = spawnSync(process.execPath, [symlinkScan, '--json', dir], { encoding: 'utf8' });
  assert.equal(proc.status, 3);
  const parsed = JSON.parse(proc.stdout);
  assert.equal(parsed.findings.length, 5);
});

test('unwrap.mjs distinguishes technical specs from tickets, blocks symlink/coupled rules, and reflows nested fences losslessly', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-unwrap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const canonical = path.join(dir, 'AGENTS.md');
  const mirror = path.join(dir, 'CLAUDE.md');
  fs.writeFileSync(canonical, '# Rules\n');
  fs.symlinkSync(canonical, mirror);

  const badDoc = validateBackpropRule({
    level: 'doc',
    text: '추가: 2026-11-11 Claude Code에서 PROJ-142 작업 중 이번 세션에 지적된 예외 규칙을 지킨다.',
    targetPath: mirror
  });
  assert.equal(badDoc.ok, false);
  assert.ok(badDoc.issues.length >= 4);

  const cleanWithSpecs = validateBackpropRule({
    level: 'doc',
    text: 'UTF-8 입력과 SHA-256 해시 및 ISO-8601 타임스탬프를 allowEntry 경계 파서에서 검증한다.',
    targetPath: canonical
  });
  assert.equal(cleanWithSpecs.ok, true);
  assert.equal(cleanWithSpecs.rank, 5);

  const hostAdapterRule = validateBackpropRule({
    level: 'doc',
    text: 'Antigravity 호스트에서는 모든 서브에이전트 호출에 inherit 모델을 지정한다.',
    targetPath: canonical,
    allowHostSpecific: true
  });
  assert.equal(hostAdapterRule.ok, true);

  const sampleMd = [
    '---',
    'name: sample',
    '---',
    '',
    '# 제목',
    '',
    '첫 번째 줄 문장이고',
    '두 번째 줄로 나뉜 단락이다.',
    '',
    '- 목록 첫 줄',
    '  목록 들여쓰기 연속 줄은 유지한다.',
    '',
    '~~~~markdown',
    '```js',
    'const x = 1;',
    'const y = 2;',
    '```',
    '~~~~'
  ].join('\n');

  const reflowed = reflowMarkdown(sampleMd);
  assert.ok(reflowed.includes('첫 번째 줄 문장이고 두 번째 줄로 나뉜 단락이다.'));
  assert.ok(reflowed.includes('- 목록 첫 줄\n  목록 들여쓰기 연속 줄은 유지한다.'));
  assert.ok(reflowed.includes('```js\nconst x = 1;\nconst y = 2;\n```'));
});
