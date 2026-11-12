import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runAllGates } from './check.mjs';

const CHECK_CLI = fileURLToPath(new URL('./check.mjs', import.meta.url));

const MINI_ROUTES = Object.freeze([
  Object.freeze({
    id: 'align',
    gear: 'hitl',
    playbook: 'playbooks/align.md',
    references: Object.freeze([]),
    scripts: Object.freeze(['scripts/tool.mjs']),
    chain: Object.freeze([]),
    summary: 'align'
  }),
  Object.freeze({
    id: 'drive',
    gear: 'afk',
    playbook: 'playbooks/drive.md',
    references: Object.freeze(['references/guide.md']),
    scripts: Object.freeze([]),
    chain: Object.freeze(['verify']),
    summary: 'drive'
  }),
  Object.freeze({
    id: 'verify',
    gear: 'afk',
    playbook: 'playbooks/verify.md',
    references: Object.freeze([]),
    scripts: Object.freeze([]),
    chain: Object.freeze([]),
    summary: 'verify'
  })
]);

function makeValidRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-gate-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const skillDir = path.join(root, 'skills', 'krig');
  fs.mkdirSync(path.join(skillDir, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'playbooks'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });

  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '---',
    'name: krig # inline yaml comment',
    'description: >',
    '  Single entrypoint router skill for',
    '  automated workflow execution.',
    'disable-model-invocation: true # explicit user-only invocation',
    '---',
    '',
    '# krig',
    '',
    '## Goal',
    '단일 진입점으로 요청을 분류해 실행한다.',
    '',
    '## Routing Table',
    '- `align`: [align.md](playbooks/align.md "Align Playbook")',
    '- `drive`: [drive.md](<playbooks/drive.md>)',
    '- `verify`: [verify.md](playbooks/verify.md)',
    '',
    '## Workflow',
    '요청을 분류하고 선택된 플레이북을 연다. 인라인 코드 `TODO:` 예시와 `` `a -> b` `` 표기는 허용된다.',
    '',
    '~~~~markdown',
    '```',
    '[TODO: 코드 펜스 내부 예시] — →',
    '```',
    '~~~~',
    '',
    '## Rules',
    '단일 변인을 유지한다.',
    '',
    '## Verification',
    '게이트를 실행해 종료 코드 0을 확인한다.'
  ].join('\n'));

  fs.writeFileSync(path.join(skillDir, 'agents', 'openai.yaml'), [
    'interface:',
    '  display_name: "Krig"',
    '  default_prompt: "Run /krig on this task"',
    'policy:',
    '  allow_implicit_invocation: false # match disable-model-invocation'
  ].join('\n'));

  for (const name of ['align', 'drive', 'verify']) {
    fs.writeFileSync(path.join(skillDir, 'playbooks', `${name}.md`), [
      `# ${name}`,
      '## Trigger',
      '해당 신호 발생 시 진입한다.',
      '## Steps',
      '단계를 순서대로 실행한다.',
      '## Rules',
      '정해진 경계를 지킨다.',
      '## Verification',
      '실제 명령 출력을 확인한다.'
    ].join('\n'));
  }

  fs.writeFileSync(path.join(skillDir, 'references', 'guide.md'), '# Guide\n정리된 기준서다.\n');
  fs.writeFileSync(path.join(skillDir, 'scripts', 'tool.mjs'), [
    "import { realpathSync } from 'node:fs';",
    "import { fileURLToPath } from 'node:url';",
    'function isMain() {',
    '  if (!process.argv[1]) return false;',
    '  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }',
    '}',
    'if (isMain()) console.log("사용법: node tool.mjs [--help]");'
  ].join('\n'));

  return root;
}

test('valid minimal repository with YAML comments, folded scalars, link titles, and tilde fences passes all gates', (t) => {
  const root = makeValidRepo(t);
  const findings = runAllGates(root, { routeTable: MINI_ROUTES });
  assert.deepEqual(findings, []);
});

test('detects invocation lane mismatch between SKILL.md and openai.yaml', (t) => {
  const root = makeValidRepo(t);
  fs.writeFileSync(path.join(root, 'skills/krig/agents/openai.yaml'), [
    'interface:',
    '  display_name: "Krig"',
    '  default_prompt: "Run /krig"',
    'policy:',
    '  allow_implicit_invocation: true'
  ].join('\n'));
  const codes = runAllGates(root, { routeTable: MINI_ROUTES }).map((f) => f.code);
  assert.ok(codes.includes('INVOCATION_LANE_MISMATCH'));
});

test('detects broken CLI entrypoint behavior on symlink --help or side-effecting import', (t) => {
  const root = makeValidRepo(t);
  fs.writeFileSync(path.join(root, 'skills/krig/scripts/tool.mjs'), 'console.log("unconditional side effect");\n');
  const codes = runAllGates(root, { routeTable: MINI_ROUTES }).map((f) => f.code);
  assert.ok(codes.includes('BROKEN_CLI_ENTRYPOINT'));
});

test('detects route cycles and pairwise afk-to-hitl gear transitions even inside hitl entry chains', (t) => {
  const root = makeValidRepo(t);
  const badRoutes = [
    { ...MINI_ROUTES[0], chain: ['drive', 'align2'] },
    { ...MINI_ROUTES[0], id: 'align2' },
    { ...MINI_ROUTES[1], chain: ['verify'] },
    { ...MINI_ROUTES[2], chain: ['drive'] }
  ];
  const codes = runAllGates(root, { routeTable: badRoutes }).map((f) => f.code);
  assert.ok(codes.includes('ROUTE_CYCLE'));
  assert.ok(codes.includes('ILLEGAL_GEAR_TRANSITION'));
});

test('detects orphan playbooks and orphan references', (t) => {
  const root = makeValidRepo(t);
  fs.writeFileSync(path.join(root, 'skills/krig/playbooks/extra.md'), '# Extra\n');
  fs.writeFileSync(path.join(root, 'skills/krig/references/unused.md'), '# Unused\n');
  const codes = runAllGates(root, { routeTable: MINI_ROUTES }).map((f) => f.code);
  assert.ok(codes.includes('ORPHAN_PLAYBOOK'));
  assert.ok(codes.includes('ORPHAN_REFERENCE'));
});

test('detects broken markdown symlinks, broken links, emoji bullets, forbidden punctuation, and unfinished TODOs', (t) => {
  const root = makeValidRepo(t);
  fs.symlinkSync(path.join(root, 'nonexistent-target.md'), path.join(root, 'CLAUDE.md'));
  fs.writeFileSync(
    path.join(root, 'README.md'),
    [
      '# 안내',
      '- 🚀 장식 이모지 글머리표',
      '문장에 가운뎃점\u00b7기호와 긴 대시\u2014기호와 [깨진링크](missing.md) 및 [TODO: 채우기]가 있다.'
    ].join('\n')
  );
  const codes = runAllGates(root, { routeTable: MINI_ROUTES }).map((f) => f.code);
  assert.ok(codes.includes('BROKEN_SYMLINK'));
  assert.ok(codes.includes('EMOJI_BULLET'));
  assert.ok(codes.includes('FORBIDDEN_PUNCTUATION'));
  assert.ok(codes.includes('BROKEN_LINK'));
  assert.ok(codes.includes('UNFINISHED_TODO'));
});

test('detects manifest version mismatch and malformed JSON across plugin manifests', (t) => {
  const root = makeValidRepo(t);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'krig', version: '0.2.0' }));
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name: 'krig', version: '0.2.0' }));
  fs.writeFileSync(path.join(root, 'gemini-extension.json'), JSON.stringify({ name: 'krig', version: '0.1.0' }));
  const codes = runAllGates(root, { routeTable: MINI_ROUTES }).map((f) => f.code);
  assert.ok(codes.includes('MANIFEST_VERSION_MISMATCH'));

  fs.writeFileSync(path.join(root, 'plugin.json'), '{ broken json ');
  const badJsonCodes = runAllGates(root, { routeTable: MINI_ROUTES }).map((f) => f.code);
  assert.ok(badJsonCodes.includes('INVALID_MANIFEST_JSON'));
});

test('krig repository itself passes runAllGates with zero findings across all 12 routes and manifests', () => {
  const repoRoot = path.resolve(path.dirname(CHECK_CLI), '../..');
  assert.deepEqual(runAllGates(repoRoot), []);
});

test('check.mjs CLI exits 2 on unknown flag or missing --root directory', () => {
  const badFlag = spawnSync(process.execPath, [CHECK_CLI, '--unknown-flag'], { encoding: 'utf8' });
  assert.equal(badFlag.status, 2);

  const badRoot = spawnSync(process.execPath, [CHECK_CLI, '--root', '/nonexistent/krig/path/xyz'], { encoding: 'utf8' });
  assert.equal(badRoot.status, 2);
});
