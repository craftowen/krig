#!/usr/bin/env node
import fs, { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliMain, parseCliFlags } from '../../skills/krig/scripts/lib/cli.mjs';
import { checkProseAndLinks } from './prose.mjs';
import { checkRouter } from './router.mjs';
import { checkSkills } from './skills.mjs';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(realpathSync(fileURLToPath(import.meta.url))), '../..');

export function runAllGates(repoRoot = DEFAULT_REPO_ROOT, options = {}) {
  return [
    ...checkSkills(repoRoot),
    ...checkRouter(repoRoot, options.routeTable),
    ...checkProseAndLinks(repoRoot)
  ];
}

function printHelp() {
  console.log('사용법: node scripts/gates/check.mjs [--json] [--root <저장소_루트>]');
}

function main() {
  let parsed;
  try {
    parsed = parseCliFlags(process.argv.slice(2), {
      booleans: ['json', 'help'],
      allowedFlags: ['json', 'root']
    });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  if (parsed.flags.help) {
    printHelp();
    process.exit(0);
  }

  if (parsed.positional.length > 0) {
    console.error(`허용되지 않은 위치 인자입니다: ${parsed.positional.join(' ')}`);
    process.exit(2);
  }

  const repoRoot = parsed.flags.root
    ? path.resolve(parsed.flags.root)
    : DEFAULT_REPO_ROOT;

  if (!fs.existsSync(repoRoot) || !fs.statSync(repoRoot).isDirectory()) {
    console.error(`검증 대상 루트 디렉터리가 존재하지 않습니다: ${repoRoot}`);
    process.exit(2);
  }

  const findings = runAllGates(repoRoot);
  if (parsed.flags.json) {
    console.log(JSON.stringify({ ok: findings.length === 0, count: findings.length, findings }, null, 2));
  } else if (findings.length === 0) {
    console.log('OK: 모든 정적 게이트(skills, router, links, prose)를 통과했습니다.');
  } else {
    for (const f of findings) {
      console.error(`[${f.gate}:${f.code}] ${f.file}:${f.line} - ${f.message}\n  해결: ${f.fix}`);
    }
    console.error(`실패: 총 ${findings.length}건의 게이트 위반이 발견되었습니다.`);
  }

  process.exit(findings.length === 0 ? 0 : 1);
}

if (isCliMain(import.meta.url)) {
  main();
}
