import fs from 'node:fs';
import path from 'node:path';
import { ROUTE_TABLE } from '../../skills/krig/scripts/route-table.mjs';
import { extractH2Sections, makeFinding, parseFrontmatter } from './model.mjs';

const REQUIRED_PLAYBOOK_SECTIONS = ['Trigger', 'Steps', 'Rules', 'Verification'];

function detectCycle(routeMap) {
  const state = new Map();
  const stack = [];

  function dfs(id) {
    state.set(id, 1);
    stack.push(id);
    const spec = routeMap.get(id);
    if (spec) {
      for (const nextId of spec.chain) {
        const nextState = state.get(nextId) ?? 0;
        if (nextState === 1) {
          const idx = stack.indexOf(nextId);
          return [...stack.slice(idx), nextId];
        }
        if (nextState === 0) {
          const found = dfs(nextId);
          if (found) return found;
        }
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  }

  for (const id of routeMap.keys()) {
    if ((state.get(id) ?? 0) === 0) {
      const cycle = dfs(id);
      if (cycle) return cycle;
    }
  }
  return null;
}

export function checkRouter(repoRoot, routeTable = ROUTE_TABLE) {
  const findings = [];
  const routeMap = new Map(routeTable.map((r) => [r.id, r]));

  for (const route of routeTable) {
    const sequence = [route.id, ...route.chain];
    for (let i = 1; i < sequence.length; i += 1) {
      const prevId = sequence[i - 1];
      const target = sequence[i];
      if (!routeMap.has(target)) {
        findings.push(makeFinding({
          gate: 'router',
          file: 'skills/krig/scripts/route-table.mjs',
          code: 'UNKNOWN_CHAIN_ROUTE',
          message: `${route.id}의 후속 라우트(${target})가 ROUTE_TABLE에 존재하지 않습니다.`,
          fix: `chain 배열에서 ${target}을 제거하거나 정식 라우트로 등록하세요.`
        }));
        continue;
      }
      const prevSpec = routeMap.get(prevId);
      const targetSpec = routeMap.get(target);
      if (prevSpec && prevSpec.gear === 'afk' && targetSpec.gear === 'hitl') {
        findings.push(makeFinding({
          gate: 'router',
          file: 'skills/krig/scripts/route-table.mjs',
          code: 'ILLEGAL_GEAR_TRANSITION',
          message: `자율 실행 라우트(${prevSpec.id}, afk)가 인간 개입 라우트(${targetSpec.id}, hitl)로 역전 전이합니다.`,
          fix: 'hitl 기어 라우트는 진입 단계에서만 실행되도록 chain에서 분리하세요.'
        }));
      }
    }
  }

  const cycle = detectCycle(routeMap);
  if (cycle) {
    findings.push(makeFinding({
      gate: 'router',
      file: 'skills/krig/scripts/route-table.mjs',
      code: 'ROUTE_CYCLE',
      message: `라우트 후속 체인에 순환 호출이 있습니다: ${cycle.join(' -> ')}`,
      fix: '라우트 체인이 단방향 비순환(DAG)이 되도록 끊으세요.'
    }));
  }

  const skillRoot = path.join(repoRoot, 'skills', 'krig');
  const skillMdPath = path.join(skillRoot, 'SKILL.md');
  const relSkillMd = path.relative(repoRoot, skillMdPath);

  if (!fs.existsSync(skillMdPath)) {
    return findings;
  }

  const { body } = parseFrontmatter(fs.readFileSync(skillMdPath, 'utf8'));
  const sections = extractH2Sections(body);
  const routingSection = sections.get('Routing Table') ?? '';

  const declaredPlaybooks = new Set();
  const declaredReferences = new Set();

  for (const route of routeTable) {
    declaredPlaybooks.add(route.playbook);
    for (const ref of route.references) declaredReferences.add(ref);

    if (!routingSection.includes(`\`${route.id}\``) || !routingSection.includes(route.playbook)) {
      findings.push(makeFinding({
        gate: 'router',
        file: relSkillMd,
        code: 'UNDOCUMENTED_ROUTE',
        message: `## Routing Table 섹션에 라우트 \`${route.id}\` 또는 ${route.playbook} 경로가 누락되었습니다.`,
        fix: `${relSkillMd}의 ## Routing Table에 \`${route.id}\`와 ${route.playbook} 링크를 추가하세요.`
      }));
    }

    const playbookAbs = path.join(skillRoot, route.playbook);
    const relPlaybook = path.relative(repoRoot, playbookAbs);
    if (!fs.existsSync(playbookAbs)) {
      findings.push(makeFinding({
        gate: 'router',
        file: relPlaybook,
        code: 'MISSING_PLAYBOOK',
        message: `${route.id} 라우트의 플레이북(${relPlaybook})이 없습니다.`,
        fix: `${relPlaybook} 파일을 작성하고 필수 섹션(${REQUIRED_PLAYBOOK_SECTIONS.join(', ')})을 채우세요.`
      }));
    } else {
      const pbRaw = fs.readFileSync(playbookAbs, 'utf8');
      const pbSections = extractH2Sections(pbRaw);
      for (const req of REQUIRED_PLAYBOOK_SECTIONS) {
        if (!pbSections.has(req) || !pbSections.get(req)) {
          findings.push(makeFinding({
            gate: 'router',
            file: relPlaybook,
            code: 'MISSING_PLAYBOOK_SECTION',
            message: `플레이북 필수 섹션(## ${req})이 누락되었습니다.`,
            fix: `${relPlaybook}에 ## ${req} 섹션을 작성하세요.`
          }));
        }
      }
    }

    for (const refRel of route.references) {
      const refAbs = path.join(skillRoot, refRel);
      if (!fs.existsSync(refAbs)) {
        findings.push(makeFinding({
          gate: 'router',
          file: path.relative(repoRoot, refAbs),
          code: 'MISSING_REFERENCE',
          message: `${route.id} 라우트가 참조하는 ${refRel} 파일이 없습니다.`,
          fix: `${path.relative(repoRoot, refAbs)} 문서를 생성하거나 ROUTE_TABLE에서 제거하세요.`
        }));
      }
    }

    for (const scriptRel of route.scripts) {
      const scriptAbs = path.join(skillRoot, scriptRel);
      if (!fs.existsSync(scriptAbs)) {
        findings.push(makeFinding({
          gate: 'router',
          file: path.relative(repoRoot, scriptAbs),
          code: 'MISSING_ROUTE_SCRIPT',
          message: `${route.id} 라우트가 사용하는 ${scriptRel} 스크립트가 없습니다.`,
          fix: `${path.relative(repoRoot, scriptAbs)} 스크립트를 구현하세요.`
        }));
      }
    }
  }

  const playbooksDir = path.join(skillRoot, 'playbooks');
  if (fs.existsSync(playbooksDir)) {
    for (const name of fs.readdirSync(playbooksDir)) {
      if (!name.endsWith('.md')) continue;
      const rel = `playbooks/${name}`;
      if (!declaredPlaybooks.has(rel)) {
        findings.push(makeFinding({
          gate: 'router',
          file: path.join('skills/krig', rel),
          code: 'ORPHAN_PLAYBOOK',
          message: `ROUTE_TABLE에 연결되지 않은 고아 플레이북(${rel})이 존재합니다.`,
          fix: 'route-table.mjs와 SKILL.md에 등록하거나 불필요한 플레이북을 삭제하세요.'
        }));
      }
    }
  }

  const refsDir = path.join(skillRoot, 'references');
  if (fs.existsSync(refsDir)) {
    for (const name of fs.readdirSync(refsDir)) {
      if (!name.endsWith('.md')) continue;
      const rel = `references/${name}`;
      if (!declaredReferences.has(rel)) {
        findings.push(makeFinding({
          gate: 'router',
          file: path.join('skills/krig', rel),
          code: 'ORPHAN_REFERENCE',
          message: `어느 라우트도 지연 로드하지 않는 고아 레퍼런스(${rel})가 존재합니다.`,
          fix: '소유 라우트의 references 배열에 연결하거나 파일을 삭제하세요.'
        }));
      }
    }
  }

  return findings;
}
