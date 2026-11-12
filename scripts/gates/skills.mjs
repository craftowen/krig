import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractH2Sections, makeFinding, parseFrontmatter, parseOpenAiYaml } from './model.mjs';

const REQUIRED_SKILL_SECTIONS = ['Goal', 'Routing Table', 'Workflow', 'Rules', 'Verification'];

function verifyCliSymlinkBehavior(scriptFile) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-symlink-check-'));
  const linkPath = path.join(tmpDir, `linked-${path.basename(scriptFile)}`);
  try {
    fs.symlinkSync(scriptFile, linkPath);
    const helpRun = spawnSync(process.execPath, [linkPath, '--help'], { encoding: 'utf8' });
    if (helpRun.status !== 0 || !helpRun.stdout.trim()) {
      return '심볼릭 링크 경로로 `--help` 실행 시 종료 코드 0과 사용법 출력이 나오지 않습니다.';
    }
    const importUrl = pathToFileURL(scriptFile).href;
    const importRun = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(importUrl)});`, 'non-existent-argv1'],
      { encoding: 'utf8' }
    );
    if (importRun.status !== 0 || importRun.stdout.trim() !== '') {
      return '모듈 import 시 부수효과 없이 로드되지 않거나 비파일 argv[1]에서 예외가 발생합니다.';
    }
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function checkSkills(repoRoot) {
  const findings = [];
  const skillsDir = path.join(repoRoot, 'skills');
  if (!fs.existsSync(skillsDir)) {
    findings.push(makeFinding({
      gate: 'skills',
      file: 'skills',
      code: 'MISSING_SKILLS_DIR',
      message: 'skills 디렉터리가 없습니다.',
      fix: 'skills/<이름>/SKILL.md 구조를 생성하세요.'
    }));
    return findings;
  }

  const skillEntries = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  if (skillEntries.length === 0) {
    findings.push(makeFinding({
      gate: 'skills',
      file: 'skills',
      code: 'EMPTY_SKILLS_DIR',
      message: '등록된 스킬 디렉터리가 없습니다.',
      fix: 'skills/krig/SKILL.md를 작성하세요.'
    }));
    return findings;
  }

  for (const dirEntry of skillEntries) {
    const skillName = dirEntry.name;
    const skillRoot = path.join(skillsDir, skillName);
    const skillMdPath = path.join(skillRoot, 'SKILL.md');
    const relSkillMd = path.relative(repoRoot, skillMdPath);

    if (!fs.existsSync(skillMdPath)) {
      findings.push(makeFinding({
        gate: 'skills',
        file: relSkillMd,
        code: 'MISSING_SKILL_MD',
        message: `${skillName} 스킬에 SKILL.md가 없습니다.`,
        fix: `${relSkillMd} 파일을 생성하고 frontmatter와 필수 섹션을 채우세요.`
      }));
      continue;
    }

    const rawSkill = fs.readFileSync(skillMdPath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(rawSkill);
    if (!frontmatter) {
      findings.push(makeFinding({
        gate: 'skills',
        file: relSkillMd,
        code: 'MISSING_FRONTMATTER',
        message: 'YAML frontmatter가 없습니다.',
        fix: '파일 상단에 --- 블록으로 name, description, disable-model-invocation을 선언하세요.'
      }));
      continue;
    }

    if (frontmatter.name !== skillName) {
      findings.push(makeFinding({
        gate: 'skills',
        file: relSkillMd,
        code: 'SKILL_NAME_MISMATCH',
        message: `frontmatter name(${frontmatter.name})이 디렉터리명(${skillName})과 다릅니다.`,
        fix: `name: ${skillName} 으로 일치시키세요.`
      }));
    }

    if (!frontmatter.description || String(frontmatter.description).trim().length < 20) {
      findings.push(makeFinding({
        gate: 'skills',
        file: relSkillMd,
        code: 'WEAK_DESCRIPTION',
        message: 'frontmatter description이 비어 있거나 너무 짧습니다.',
        fix: '언제 이 스킬을 호출해야 하는지 20자 이상의 명확한 설명을 적으세요.'
      }));
    }

    const sections = extractH2Sections(body);
    for (const req of REQUIRED_SKILL_SECTIONS) {
      if (!sections.has(req) || !sections.get(req)) {
        findings.push(makeFinding({
          gate: 'skills',
          file: relSkillMd,
          code: 'MISSING_SECTION',
          message: `필수 섹션(## ${req})이 비어 있거나 누락되었습니다.`,
          fix: `${relSkillMd}에 ## ${req} 섹션을 추가하세요.`
        }));
      }
    }

    const yamlPath = path.join(skillRoot, 'agents', 'openai.yaml');
    const relYaml = path.relative(repoRoot, yamlPath);
    if (!fs.existsSync(yamlPath)) {
      findings.push(makeFinding({
        gate: 'skills',
        file: relYaml,
        code: 'MISSING_OPENAI_YAML',
        message: 'Codex 호환용 agents/openai.yaml이 없습니다.',
        fix: `${relYaml} 파일을 생성하고 interface 및 policy.allow_implicit_invocation을 정의하세요.`
      }));
    } else {
      const yaml = parseOpenAiYaml(fs.readFileSync(yamlPath, 'utf8'));
      const rawDisable = frontmatter['disable-model-invocation'];
      const disableModel = rawDisable === true;
      const allowImplicit = yaml.policy?.allow_implicit_invocation;
      if (rawDisable !== undefined && typeof rawDisable !== 'boolean') {
        findings.push(makeFinding({
          gate: 'skills',
          file: relSkillMd,
          code: 'INVALID_DISABLE_FLAG',
          message: `disable-model-invocation 값(${rawDisable})이 불리언이 아닙니다.`,
          fix: 'disable-model-invocation: true 또는 false로 지정하세요.'
        }));
      }
      if (typeof allowImplicit !== 'boolean') {
        findings.push(makeFinding({
          gate: 'skills',
          file: relYaml,
          code: 'MISSING_IMPLICIT_POLICY',
          message: 'policy.allow_implicit_invocation 불리언 값이 없습니다.',
          fix: 'policy 섹션 아래 allow_implicit_invocation: true 또는 false를 명시하세요.'
        }));
      } else if (disableModel === allowImplicit) {
        findings.push(makeFinding({
          gate: 'skills',
          file: relYaml,
          code: 'INVOCATION_LANE_MISMATCH',
          message: `SKILL.md disable-model-invocation(${disableModel})과 openai.yaml allow_implicit_invocation(${allowImplicit})이 충돌합니다.`,
          fix: '사용자 전용 호출 스킬이면 disable-model-invocation: true 와 allow_implicit_invocation: false 로 맞추세요.'
        }));
      }
      if (!yaml.interface?.display_name || !yaml.interface?.default_prompt) {
        findings.push(makeFinding({
          gate: 'skills',
          file: relYaml,
          code: 'INCOMPLETE_OPENAI_INTERFACE',
          message: 'interface.display_name 또는 interface.default_prompt가 누락되었습니다.',
          fix: `${relYaml}의 interface 블록에 display_name과 default_prompt를 채우세요.`
        }));
      }
    }

    const scriptDir = path.join(skillRoot, 'scripts');
    if (fs.existsSync(scriptDir)) {
      const topEntries = fs.readdirSync(scriptDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.mjs') && !e.name.endsWith('.test.mjs') && e.name !== 'route-table.mjs');

      for (const entry of topEntries) {
        const scriptFile = path.join(scriptDir, entry.name);
        const relScript = path.relative(repoRoot, scriptFile);
        const failure = verifyCliSymlinkBehavior(scriptFile);
        if (failure) {
          findings.push(makeFinding({
            gate: 'skills',
            file: relScript,
            code: 'BROKEN_CLI_ENTRYPOINT',
            message: failure,
            fix: 'isCliMain(import.meta.url) 진입 가드와 `--help` 종료 코드 0 처리를 구현하세요.'
          }));
        }
      }
    }
  }

  const pkgPath = path.join(repoRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    let canonicalVersion = null;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      canonicalVersion = pkg.version;
    } catch (err) {
      findings.push(makeFinding({
        gate: 'skills',
        file: 'package.json',
        code: 'INVALID_MANIFEST_JSON',
        message: `매니페스트 JSON 파싱 실패: ${err.message}`,
        fix: '유효한 JSON 문법으로 수정하세요.'
      }));
    }

    if (canonicalVersion) {
      const manifestRels = [
        'plugin.json',
        '.claude-plugin/plugin.json',
        '.codex-plugin/plugin.json',
        '.cursor-plugin/plugin.json',
        'gemini-extension.json'
      ];
      for (const rel of manifestRels) {
        const abs = path.join(repoRoot, rel);
        if (!fs.existsSync(abs)) continue;
        try {
          const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
          if (data.version !== canonicalVersion) {
            findings.push(makeFinding({
              gate: 'skills',
              file: rel,
              code: 'MANIFEST_VERSION_MISMATCH',
              message: `${rel}의 version(${data.version})이 package.json(${canonicalVersion})과 일치하지 않습니다.`,
              fix: `${rel}의 version을 "${canonicalVersion}"으로 맞추세요.`
            }));
          }
        } catch (err) {
          findings.push(makeFinding({
            gate: 'skills',
            file: rel,
            code: 'INVALID_MANIFEST_JSON',
            message: `${rel} JSON 파싱 실패: ${err.message}`,
            fix: '유효한 JSON 문법으로 수정하세요.'
          }));
        }
      }
    }
  }

  return findings;
}
