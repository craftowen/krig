import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkBlinding, compareAbRuns, formatAbScoreboard } from './ab-eval.mjs';
import { inspectSessionState, saveCheckpoint } from './checkpoint.mjs';
import { appendDecisionRow, verifyDecisionLog } from './decision-log.mjs';
import { readLedgerEvents, recordLedgerEvent, summarizeLedger } from './ledger.mjs';
import { parseCliFlags } from './lib/cli.mjs';
import { extractJsModuleSpecifiers, isTestPath, lexSource } from './lib/source-lex.mjs';
import { analyzeRecon } from './recon.mjs';
import { classifyTask, hasTicketId } from './route.mjs';
import { scanTargets } from './scan.mjs';
import { stampVerification, validatePrBriefing, verifyShipReadiness } from './ship-check.mjs';
import { analyzeSlim } from './slim.mjs';
import { verifyStateModel } from './statecheck.mjs';
import { reflowMarkdown, validateBackpropRule } from './unwrap.mjs';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '../../..');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('route.mjs classifies all 11 routes, sub-modes, dynamic chains, and Korean/English lexical boundaries', () => {
  const alignPlan = classifyTask('/krig 새 정산 파이프라인 요구사항 감량하고 티켓 등록해줘');
  assert.deepEqual(alignPlan.pipeline, ['align']);
  assert.equal(alignPlan.steps[0].gear, 'hitl');

  const implicitFull = classifyTask('결제 시스템 기획부터 끝까지 자율 실행해줘');
  assert.equal(implicitFull.primaryRoute, 'full');
  assert.deepEqual(implicitFull.pipeline, ['align', 'design', 'drive', 'demock', 'verify']);
  assert.equal(implicitFull.steps[0].gear, 'afk');

  const epicSplit = classifyTask('PROJ-100 에픽 티켓 쪼개줘');
  assert.deepEqual(epicSplit.pipeline, ['align']);

  // recon: how / why / blast + blast-then-drive chain
  const reconHow = classifyTask('정산 라우터 모듈이 어떻게 동작하는지 내부 흐름 설명해줘');
  assert.deepEqual(reconHow.pipeline, ['recon']);
  assert.equal(reconHow.reconMode, 'how');

  const reconWhy = classifyTask('이 타임아웃 상수가 왜 15초로 설정되어 있는지 커밋 히스토리 찾아줘');
  assert.deepEqual(reconWhy.pipeline, ['recon']);
  assert.equal(reconWhy.reconMode, 'why');

  const reconBlast = classifyTask('parseCliFlags 시그니처 바꾸면 어디 깨지는지 영향도 분석해줘');
  assert.deepEqual(reconBlast.pipeline, ['recon']);
  assert.equal(reconBlast.reconMode, 'blast');

  const blastThenDrive = classifyTask('parseCliFlags 영향도 분석 먼저 하고 새 옵션 지원하도록 리팩터링해줘');
  assert.deepEqual(blastThenDrive.pipeline, ['recon', 'drive', 'demock', 'verify']);
  assert.equal(blastThenDrive.reconMode, 'blast');
  assert.equal(blastThenDrive.driveMode, 'feature');

  const designPlan = classifyTask('결제 웹훅 어댑터 구조와 인터페이스 설계만 잡아줘');
  assert.deepEqual(designPlan.pipeline, ['design', 'verify']);

  // model route vs domain model words
  const modelPlan = classifyTask('배달 체크포인트 재시도 상태 머신에 데드락이나 불변식 위반 없는지 모델 체킹해줘');
  assert.deepEqual(modelPlan.pipeline, ['model', 'verify']);
  assert.equal(classifyTask('데이터 모델과 어댑터 인터페이스 설계해줘').primaryRoute, 'design');
  assert.equal(classifyTask('Model 선택 드롭다운 버그 고쳐줘').primaryRoute, 'drive');

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

  // slim: audit / debt / apply chain
  const slimAudit = classifyTask('이 저장소 과잉 추상화랑 미사용 의존성 군살 감사해줘');
  assert.deepEqual(slimAudit.pipeline, ['slim']);
  assert.equal(slimAudit.slimMode, 'audit');

  const slimDebt = classifyTask('코드베이스 기술 부채 원장이랑 부패 위험 주석 수집해줘');
  assert.deepEqual(slimDebt.pipeline, ['slim']);
  assert.equal(slimDebt.slimMode, 'debt');

  const slimApply = classifyTask('안 쓰는 의존성과 패스스루 배럴 찾아서 실제로 걷어내고 반영해줘');
  assert.deepEqual(slimApply.pipeline, ['slim', 'drive', 'demock', 'verify']);

  // resume: status/pause vs continue-build vs domain false-positives
  const resumeStatus = classifyTask('이전 세션 작업 어디까지 됐는지 상태만 파악해줘');
  assert.deepEqual(resumeStatus.pipeline, ['resume']);

  const resumeFinish = classifyTask('어제 하던 작업 이어서 구현 마무리해줘');
  assert.deepEqual(resumeFinish.pipeline, ['resume', 'drive', 'demock', 'verify']);

  assert.equal(classifyTask('구독 재개 API 구현해줘').primaryRoute, 'drive');
  assert.equal(classifyTask('Resume 파일 업로드 구현해줘').primaryRoute, 'drive');

  // ship vs PR review vs shipping domain feature
  const shipPlan = classifyTask('머지 전 출하 점검 돌리고 PR 브리핑 작성해줘');
  assert.deepEqual(shipPlan.pipeline, ['ship']);
  assert.deepEqual(classifyTask('이 브랜치 PR 리뷰해줘').pipeline, ['verify']);
  assert.equal(classifyTask('Ship 상태 배지 추가해줘').primaryRoute, 'drive');

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

  const explicitPath = classifyTask('recon skills/krig/scripts/route.mjs');
  assert.equal(explicitPath.explicitOverride, true);
  assert.deepEqual(explicitPath.pipeline, ['recon']);

  const explicitPrefix = classifyTask('route:model Check payment state machine');
  assert.equal(explicitPrefix.explicitOverride, true);
  assert.deepEqual(explicitPrefix.pipeline, ['model', 'verify']);

  // 12th route (eval) + negated build clauses + extended chains + counterexamples
  const evalPlan = classifyTask('스킬 쓰고 안 쓰고의 결과물 차이를 A/B 정량 평가로 입증해줘');
  assert.deepEqual(evalPlan.pipeline, ['eval']);
  assert.equal(classifyTask('유저 평가 점수 계산 API 구현해줘').primaryRoute, 'drive');

  assert.deepEqual(
    classifyTask('코드는 수정하지 말고 왜 이 로직이 추가됐는지 히스토리만 조사해줘').pipeline,
    ['recon']
  );
  assert.deepEqual(
    classifyTask('모델 체킹으로 상태 전이 검증하고 디스패처 구현해줘').pipeline,
    ['model', 'drive', 'demock', 'verify']
  );
  assert.deepEqual(
    classifyTask('PROJ-120 구현하고 PR까지 올려줘').pipeline,
    ['drive', 'demock', 'verify', 'ship']
  );
  assert.equal(classifyTask('Ship the new webhook feature').primaryRoute, 'drive');
  assert.equal(classifyTask('Slim profile card component 추가해줘').primaryRoute, 'drive');
  assert.equal(classifyTask('인증 토큰 정리 로직 추가해줘').primaryRoute, 'drive');
  assert.equal(classifyTask('버튼 정렬 속도 개선해줘').driveMode, 'hillclimb');
  assert.equal(classifyTask('코드 구조 파악해서 정리해줘').primaryRoute, 'recon');
  assert.equal(classifyTask('검증 스탬프 상태 확인하고 출하 점검해줘').primaryRoute, 'ship');
});

test('route.mjs CLI supports --list --json across 12 routes and --stdin input with shell metacharacters', () => {
  const routeCli = path.join(SCRIPTS_DIR, 'route.mjs');

  const listJson = spawnSync(process.execPath, [routeCli, '--list', '--json'], { encoding: 'utf8' });
  assert.equal(listJson.status, 0);
  const routes = JSON.parse(listJson.stdout);
  assert.equal(routes.length, 12);

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

test('recon.mjs extracts definitions, prod vs test callers, importers, boundary surfaces, and git pickaxe commits', () => {
  const report = analyzeRecon({
    repoDir: REPO_ROOT,
    symbol: 'classifyTask'
  });

  assert.equal(report.gitAvailable, true);
  assert.equal(report.definitions.length, 1);
  assert.equal(report.definitions[0].file, 'skills/krig/scripts/route.mjs');
  assert.equal(report.definitions[0].kind, 'function');
  assert.equal(report.definitions[0].exported, true);
  assert.ok(report.productionCallers.length >= 1);
  assert.ok(report.testCallers.length >= 20);
  assert.ok(report.importers.production.includes('skills/krig/scripts/unwrap.mjs'));
  assert.ok(report.blastSummary.boundaryKinds.includes('cli'));
  assert.ok(report.lineage.pickaxeCommits.length >= 1);
});

test('statecheck.mjs finds shortest counterexamples for invariants/deadlocks/unreachability and generates Mermaid', () => {
  const buggySpec = {
    initial: { phase: 'queued', delivered: 0, checkpointed: false, retries: 0 },
    terminal: { phase: 'done' },
    actions: [
      {
        name: 'send',
        when: { phase: 'queued' },
        branches: [
          { label: 'ack', set: { phase: 'done', delivered: { $inc: 1 }, checkpointed: true } },
          { label: 'crash_before_ckpt', set: { phase: 'crashed', delivered: { $inc: 1 } } }
        ]
      },
      {
        name: 'blind_retry',
        when: { phase: 'crashed', checkpointed: false, retries: { $lt: 1 } },
        set: { phase: 'queued', retries: { $inc: 1 } }
      }
    ],
    invariants: {
      AtMostOnceSend: { delivered: { $lte: 1 } }
    },
    mustReach: {
      CanFinish: { phase: 'done' }
    }
  };

  const failReport = verifyStateModel(buggySpec, { requireComplete: true });
  assert.equal(failReport.ok, false);
  assert.equal(failReport.complete, true);
  const violationKinds = failReport.violations.map((v) => `${v.kind}:${v.name}`).sort();
  assert.deepEqual(violationKinds, ['DEADLOCK:NoDeadlock', 'INVARIANT:AtMostOnceSend']);
  const dupViolation = failReport.violations.find((v) => v.name === 'AtMostOnceSend');
  assert.equal(dupViolation.depth, 3);
  assert.equal(dupViolation.trace.length, 4);
  assert.ok(failReport.mermaid.includes('VIOLATION INVARIANT:AtMostOnceSend'));

  const fixedSpec = {
    initial: { phase: 'queued', delivered: 0, intentSaved: false, checkpointed: false },
    terminal: [{ phase: 'done' }, { phase: 'manual_hold' }],
    actions: {
      save_intent: {
        when: { phase: 'queued', intentSaved: false },
        set: { intentSaved: true }
      },
      send: {
        when: { phase: 'queued', intentSaved: true },
        apply: (s) => [
          { ...s, phase: 'done', delivered: s.delivered + 1, checkpointed: true },
          { ...s, phase: 'crashed', delivered: s.delivered + 1 }
        ]
      },
      preserve_ambiguous: {
        when: { phase: 'crashed', intentSaved: true, checkpointed: false },
        set: { phase: 'manual_hold' }
      }
    },
    invariants: {
      AtMostOnceSend: (s) => s.delivered <= 1,
      DoneHasCheckpoint: { $implies: [{ phase: 'done' }, { checkpointed: true }] }
    },
    mustReach: {
      CleanDone: { phase: 'done' },
      AmbiguousHold: { phase: 'manual_hold' }
    }
  };

  const passReport = verifyStateModel(fixedSpec, { requireComplete: true });
  assert.equal(passReport.ok, true);
  assert.equal(passReport.complete, true);
  assert.equal(passReport.exploredStates, 5);
  assert.deepEqual(passReport.violations, []);

  // Truncation honesty + unreachable target check
  const truncated = verifyStateModel(fixedSpec, { maxStates: 2, requireComplete: true });
  assert.equal(truncated.complete, false);
  assert.equal(truncated.ok, false);
});

test('slim.mjs passes strict self-audit on krig and catches rot-risk debt, unused deps, barrels, and orphan modules', (t) => {
  const selfReport = analyzeSlim(REPO_ROOT);
  assert.equal(selfReport.summary.rotRiskDebtCount, 0);
  assert.equal(selfReport.summary.unusedDependencyCount, 0);
  assert.equal(selfReport.summary.passThroughCount, 0);
  assert.equal(selfReport.summary.unreferencedModuleCount, 0);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-slim-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'bloated-app',
    version: '1.0.0',
    main: 'src/cli.mjs',
    dependencies: {
      chalk: '^5.0.0',
      'left-pad': '^1.3.0'
    },
    devDependencies: {
      '@types/node': '^20.0.0'
    }
  }, null, 2));

  fs.writeFileSync(path.join(dir, 'src', 'core.mjs'), [
    "import chalk from 'chalk';",
    '// krig-debt: linear array scan -> switch to Map index when items > 5000',
    '// TODO: clean up legacy fallback someday',
    'const notAComment = "TODO: string literal must never be flagged";',
    'export function runCore() { return chalk.green(notAComment); }'
  ].join('\n'));

  fs.writeFileSync(path.join(dir, 'src', 'barrel.mjs'), "export { runCore } from './core.mjs';\n");
  fs.writeFileSync(path.join(dir, 'src', 'cli.mjs'), [
    '#!/usr/bin/env node',
    "import { runCore } from './barrel.mjs';",
    'console.log(runCore());'
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'src', 'dead-feature.mjs'), 'export function unusedProd() { return 42; }\n');
  fs.writeFileSync(path.join(dir, 'tests', 'dead.test.mjs'), [
    "import { unusedProd } from '../src/dead-feature.mjs';",
    'unusedProd();'
  ].join('\n'));

  const audit = analyzeSlim(dir);
  assert.deepEqual(audit.unusedDependencies.map((d) => d.name), ['left-pad']);
  assert.deepEqual(audit.passThroughModules.map((p) => p.file), ['src/barrel.mjs']);
  assert.equal(audit.unreferencedModules.length, 1);
  assert.equal(audit.unreferencedModules[0].file, 'src/dead-feature.mjs');
  assert.equal(audit.unreferencedModules[0].testImporterCount, 1);
  assert.equal(audit.debtLedger.length, 2);
  assert.equal(audit.summary.rotRiskDebtCount, 1);
});

test('ship-check.mjs and checkpoint.mjs preserve patch-id across commit/rebase and block unverified drift or leaks', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-ship-repo-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));

  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test Runner']);

  fs.writeFileSync(path.join(repo, '.gitignore'), '.krig/\n');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'app.js'), 'export const v = 1;\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'chore: initial']);

  git(repo, ['checkout', '-q', '-b', 'feat/widget']);
  const baseMain = git(repo, ['rev-parse', 'HEAD']);
  fs.mkdirSync(path.join(repo, '.krig'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.krig', 'base-sha'), `${baseMain}\n`);

  // Modify tracked file + add untracked file, then stamp BEFORE committing
  fs.writeFileSync(path.join(repo, 'src', 'app.js'), 'export const v = 2;\n');
  fs.writeFileSync(path.join(repo, 'src', 'widget.js'), 'export function widget() { return "ok"; }\n');

  const stamped = stampVerification({
    repoDir: repo,
    evidence: 'node --test passed (2/2)'
  });
  assert.equal(stamped.ok, true);

  // Commit exact verified files without editing them -> patch-id stays identical!
  git(repo, ['add', 'src/app.js', 'src/widget.js']);
  git(repo, ['commit', '-q', '-m', 'feat(widget): add widget']);

  const afterCommit = verifyShipReadiness({
    repoDir: repo,
    requireClean: true,
    requireVerified: true
  });
  assert.equal(afterCommit.ok, true);
  assert.equal(afterCommit.verificationFresh, true);
  assert.equal(afterCommit.currentPatchId, stamped.record.patchId);

  // Save checkpoint at verified commit
  saveCheckpoint({
    repoDir: repo,
    route: 'drive',
    summary: 'widget 구현 완료',
    done: 'src/widget.js 구현'
  });
  const cleanPickup = inspectSessionState({ repoDir: repo });
  assert.equal(cleanPickup.recommendedAction, 'READY_TO_SHIP');
  assert.deepEqual(cleanPickup.driftFlags, []);

  // Advance main with unrelated file and rebase feat/widget onto new main -> patch-id STILL matches!
  git(repo, ['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# Upstream update\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-q', '-m', 'docs: upstream readme']);
  const newMain = git(repo, ['rev-parse', 'HEAD']);

  git(repo, ['checkout', '-q', 'feat/widget']);
  git(repo, ['rebase', '-q', 'main']);

  const afterRebase = verifyShipReadiness({
    repoDir: repo,
    base: newMain,
    requireClean: true,
    requireVerified: true
  });
  assert.equal(afterRebase.ok, true);
  assert.equal(afterRebase.verificationFresh, true);

  // Now sneak in an unverified edit + secret + staged .krig file -> blocked immediately!
  const fakeSecret = `${'sk'}-${'1234567890abcdefghijklmno'}`;
  fs.writeFileSync(path.join(repo, 'src', 'widget.js'), `export const leaked = "${fakeSecret}";\n`);
  fs.writeFileSync(path.join(repo, '.krig', 'accidental.txt'), 'temp\n');
  git(repo, ['add', '-f', '.krig/accidental.txt']);

  const drifted = verifyShipReadiness({
    repoDir: repo,
    base: newMain,
    requireClean: true,
    requireVerified: true
  });
  assert.equal(drifted.ok, false);
  const issueCodes = drifted.issues.map((i) => i.code);
  assert.ok(issueCodes.includes('STAGED_KRIG_ARTIFACT'));
  assert.ok(issueCodes.includes('UNCOMMITTED_CHANGES'));
  assert.ok(issueCodes.includes('SECRET_PATTERN_LEAK'));
  assert.ok(issueCodes.includes('STALE_VERIFICATION'));

  // Validate PR briefing rules
  const goodBrief = validatePrBriefing({
    title: 'feat(ship): verify patch-id freshness before landing',
    body: [
      '## Why',
      'Post-review edits previously bypassed stale verification verdicts.',
      '## What changed',
      '- Added `ship-check.mjs` patch-id stamp and verification gate.',
      '## Scope',
      '- Covers git worktree hygiene and PR briefing validation; leaves CI polling out.',
      '## Blast Radius',
      'Touches only `.krig/verified.json` and read-only git diff commands.',
      '## Verification',
      '- `npm test`: 10/10 passed.'
    ].join('\n')
  });
  assert.equal(goodBrief.ok, true);

  const badBrief = validatePrBriefing({
    title: 'Added stuff.',
    body: '## Why\nBad em-dash \u2014 and raw sha c23a081a48f9c23a081a48f9c23a081a48f9c23a'
  });
  assert.equal(badBrief.ok, false);
  const briefCodes = badBrief.issues.map((i) => i.code);
  assert.ok(briefCodes.includes('INVALID_CONVENTIONAL_TITLE'));
  assert.ok(briefCodes.includes('TITLE_TRAILING_PERIOD'));
  assert.ok(briefCodes.includes('FORBIDDEN_BRIEF_PUNCTUATION'));
  assert.ok(briefCodes.includes('RAW_FULL_SHA_IN_BODY'));
  assert.ok(briefCodes.includes('MISSING_PR_SECTION'));
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

test('scan.mjs self-scans krig cleanly and catches swallowed errors even inside nested template expressions', (t) => {
  const selfScan = scanTargets([REPO_ROOT]);
  assert.ok(selfScan.scannedFiles >= 18);
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
    'export const inTemplate = `result=${(() => { try { work(); } catch (e) {} })()}`;',
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
    'swallowed-error',
    'test-double-in-prod'
  ]);

  const symlinkScan = path.join(dir, 'scan-link.mjs');
  fs.symlinkSync(path.join(SCRIPTS_DIR, 'scan.mjs'), symlinkScan);
  const proc = spawnSync(process.execPath, [symlinkScan, '--json', dir], { encoding: 'utf8' });
  assert.equal(proc.status, 3);
  const parsed = JSON.parse(proc.stdout);
  assert.equal(parsed.findings.length, 6);
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

test('regression: cli, source-lex, statecheck, git-state/ship-check, and ab-eval edge cases', (t) => {
  // 1. parseCliFlags accepts dash-prefixed values while rejecting missing value before known flags
  const dashVal = parseCliFlags(['--text', '- 모든 입력은 파싱한다', '--json'], {
    booleans: ['json'],
    allowedFlags: ['text', 'json']
  });
  assert.equal(dashVal.flags.text, '- 모든 입력은 파싱한다');
  assert.equal(dashVal.flags.json, true);

  assert.throws(() => {
    parseCliFlags(['--text', '--json'], {
      booleans: ['json'],
      allowedFlags: ['text', 'json']
    });
  }, /값이 필요합니다/);

  // 2. source-lex: project root named '.../test', Rust lifetimes, Go raw strings, multiline JS exports
  const parentTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-projroot-'));
  t.after(() => fs.rmSync(parentTmp, { recursive: true, force: true }));
  const testNamedProj = path.join(parentTmp, 'test');
  fs.mkdirSync(path.join(testNamedProj, 'src'), { recursive: true });
  fs.mkdirSync(path.join(testNamedProj, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(testNamedProj, 'package.json'), '{"name":"proj-in-test-dir"}\n');
  assert.equal(isTestPath(path.join(testNamedProj, 'src', 'app.mjs'), testNamedProj), false);
  assert.equal(isTestPath(path.join(testNamedProj, 'tests', 'app.mjs'), testNamedProj), true);

  const rustLex = lexSource("pub fn borrow<'a>(s: &'a str) -> &'a str { s } // TODO: trim\n", '.rs');
  assert.equal(rustLex.comments.length, 1);
  assert.ok(rustLex.comments[0].body.includes('TODO: trim'));

  const goLex = lexSource('package p\nconst raw = `/* not a comment */`\n// FIXME: real comment\n', '.go');
  assert.equal(goLex.comments.length, 1);
  assert.ok(goLex.comments[0].body.includes('FIXME: real comment'));

  const specs = extractJsModuleSpecifiers([
    'const fake = "import \\"shadow-pkg\\"";',
    'export {',
    '  alpha,',
    '  beta',
    "} from './real-target.mjs';"
  ].join('\n'));
  assert.deepEqual(specs, ['./real-target.mjs']);

  // 3. statecheck: undefined property distinction, array path preservation, strict ordering, maxDepth=0, empty terminal
  const arrayAndNullModel = {
    initial: { items: ['a', 'b'], count: null },
    terminal: { done: true },
    actions: {
      bad_null_cmp: {
        when: { count: { $gte: 0 } },
        set: { done: true }
      },
      update_arr: {
        when: { 'items.0': 'a' },
        set: { 'items.0': 'z', done: true }
      }
    },
    invariants: {
      ItemsRemainsArray: (s) => Array.isArray(s.items),
      NullNeverCompared: (s) => !(s.done && s.items[0] === 'a')
    }
  };
  const arrCheck = verifyStateModel(arrayAndNullModel, { requireComplete: true });
  assert.equal(arrCheck.ok, true);
  assert.equal(arrCheck.exploredStates, 2);

  const depthZero = verifyStateModel(arrayAndNullModel, { maxDepth: 0 });
  assert.equal(depthZero.exploredStates, 1);
  assert.equal(depthZero.complete, false);

  assert.throws(() => {
    verifyStateModel({ ...arrayAndNullModel, terminal: [] });
  }, /terminal/);

  // 4. ship-check: empty-diff stamp blocked, Unicode filenames, binary digest invalidation, Setext H1, ancestor rebase
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-edge-git-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));

  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test Runner']);
  fs.writeFileSync(path.join(repo, '.gitignore'), '.krig/\n');
  fs.writeFileSync(path.join(repo, 'README.md'), 'Title Heading\n=============\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'chore: init']);

  // Empty diff cannot be stamped
  assert.throws(() => {
    stampVerification({ repoDir: repo, evidence: 'noop' });
  }, /비어 있어 검증 스탬프를 발급할 수 없습니다/);

  git(repo, ['checkout', '-q', '-b', 'feat/unicode-bin']);
  const baseSha = git(repo, ['rev-parse', 'HEAD']);
  fs.mkdirSync(path.join(repo, '.krig'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.krig', 'base-sha'), `${baseSha}\n`);

  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', '한글 모듈.mjs'), 'export const ok = true;\n');
  fs.writeFileSync(path.join(repo, 'src', 'icon.bin'), Buffer.from([0x00, 0x89, 0x50, 0x4e]));

  const binStamp = stampVerification({ repoDir: repo, evidence: 'binary+unicode ok' });
  assert.equal(binStamp.ok, true);

  git(repo, ['add', 'src']);
  git(repo, ['commit', '-q', '-m', 'feat: add unicode and binary asset']);

  // Rebase onto advanced main WITHOUT passing --base explicitly -> ancestor walk keeps stamp fresh!
  git(repo, ['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '# v0.2\n');
  git(repo, ['add', 'CHANGELOG.md']);
  git(repo, ['commit', '-q', '-m', 'docs: changelog']);

  git(repo, ['checkout', '-q', 'feat/unicode-bin']);
  git(repo, ['rebase', '-q', 'main']);

  const rebasedNoBaseArg = verifyShipReadiness({
    repoDir: repo,
    requireClean: true,
    requireVerified: true
  });
  assert.equal(rebasedNoBaseArg.ok, true);
  assert.equal(rebasedNoBaseArg.verificationFresh, true);

  // Mutating only the binary file invalidates verification stamp immediately!
  fs.writeFileSync(path.join(repo, 'src', 'icon.bin'), Buffer.from([0x00, 0xff, 0xaa, 0x11]));
  const afterBinEdit = verifyShipReadiness({
    repoDir: repo,
    requireVerified: true
  });
  assert.equal(afterBinEdit.ok, false);
  assert.equal(afterBinEdit.verificationFresh, false);

  // 5. ab-eval: blinding detector + paired lift computation
  const leakRes = checkBlinding({
    workspacePaths: ['/tmp/benchmark-arm/app'],
    promptText: 'Run rubric evaluation on this repo'
  });
  assert.equal(leakRes.ok, false);
  assert.equal(leakRes.leaks.length, 2);

  const cleanBlind = checkBlinding({
    workspacePaths: ['/tmp/ws-alpha/settlement', '/tmp/ws-beta/settlement'],
    promptText: '웹훅 정산 중복 적립 버그를 수정해주세요.'
  });
  assert.equal(cleanBlind.ok, true);

  const abSummary = compareAbRuns({
    control: [
      { taskId: 't1', passedAssertions: 5, totalAssertions: 10, defectEscapes: 3 },
      { taskId: 't2', passedAssertions: 7, totalAssertions: 10, defectEscapes: 1 }
    ],
    treatment: [
      { taskId: 't1', passedAssertions: 10, totalAssertions: 10, defectEscapes: 0 },
      { taskId: 't2', passedAssertions: 9, totalAssertions: 10, defectEscapes: 0 }
    ],
    metadata: { model: 'sonnet' }
  });
  assert.equal(abSummary.aggregate.controlPassRatePct, 60);
  assert.equal(abSummary.aggregate.treatmentPassRatePct, 95);
  assert.equal(abSummary.aggregate.passRateLiftPctPoints, 35);
  assert.equal(abSummary.aggregate.defectReductionPct, 100);
  assert.equal(abSummary.aggregate.treatmentWins, 2);
  assert.ok(formatAbScoreboard(abSummary).includes('+35%p'));
});
