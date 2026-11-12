#!/usr/bin/env node
import fs, { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliMain, parseCliFlags } from './lib/cli.mjs';
import { ROUTE_BY_ID, ROUTE_TABLE } from './route-table.mjs';

const SKILL_DIR = path.resolve(path.dirname(realpathSync(fileURLToPath(import.meta.url))), '..');

const TECH_SPEC_IDS = new Set([
  'UTF-8', 'UTF-16', 'UTF-32',
  'SHA-1', 'SHA-224', 'SHA-256', 'SHA-384', 'SHA-512',
  'AES-128', 'AES-192', 'AES-256',
  'RSA-2048', 'RSA-4096',
  'ISO-8601', 'ISO-3166',
  'HTTP-1', 'HTTP-2', 'HTTP-3',
  'ECMA-262', 'IEEE-754'
]);

const PATTERNS = Object.freeze({
  backprop: /(역전파|사후\s*회고|포스트모템|재발\s*방지|재발하지\s*않|교훈.*(반영|부호화|문서화|규칙)|실수.*(역전파|재발|가드레일|규칙화)|가드레일\s*(추가|강화|반영)|정본.*역전파|\b(?:backprop|postmortem|encode\s+lessons?)\b)/i,
  demock: /(가짜\s*성공|거짓\s*성공|삼킨\s*예외|예외\s*삼킴|프로덕션.*테스트\s*더블|테스트\s*더블\s*(제거|점검|스캔)|(?:^|[^가-힣a-zA-Z0-9_])목\s*제거|모킹\s*제거|미구현\s*(플레이스홀더|스텁)|플레이스홀더\s*(제거|점검|스캔)|\b(?:demock|unmock|fake[\s-]?success|swallowed[\s-]?errors?)\b)/i,
  verify: /(코드\s*리뷰|설계\s*리뷰|PR\s*리뷰|변경.*리뷰|리뷰해|검토해|검증해|검수해|콜드\s*리드|누수\s*감사|\b(?:code[\s-]?review|pr[\s-]?review|cold[\s-]?read|leakage[\s-]?audit|audit\s+the|review\s+(?:this|the|my|changes|pr|diff|code|design|branch))\b)/i,
  design: /(아키텍처|모듈\s*설계|인터페이스\s*설계|경계\s*설계|어댑터\s*구조|도메인\s*모델링|설계해|설계만|\b(?:architect|architecture|deep\s+modules?|design\s+(?:the|a|an|and|new|module|interface|api|adapter))\b)/i,
  align: /(기획부터|신규\s*기획|기능\s*기획|서비스\s*기획|프로젝트\s*기획|프론티어\s*인터뷰|인터뷰로\s*범위|요구사항\s*(감량|정리|정의|도출|확정|분석|점검)|스펙\s*(정리|확정|정의)|마일스톤\s*(수립|정리|생성|등록)|티켓\s*(쪼개|분해|나눠|발행|등록)|범위\s*(확정|정렬|산정|감량)|계획\s*세워|\b(?:scope\s+out|grill[\s-]?me|to[\s-]?tickets)\b)/i,
  epicSplit: /(티켓\s*(으로\s*)?(쪼개|분해|나눠)|에픽\s*(쪼개|분해)|이슈\s*(쪼개|분해)|하위\s*티켓\s*(발행|생성|등록)|\b(?:split\s+into\s+tickets|break\s+down.*into\s+tickets)\b)/i,
  hillclimb: /(속도\s*(개선|최적화|향상)|성능\s*(개선|최적화|향상)|메모리\s*(절감|최적화)|시간\s*단축|처리량|지연\s*시간|레이턴시|벤치마크.*개선|최적화\s*루프|\d+%\s*(줄여|개선|향상|단축)|\b(?:hillclimb|throughput|latency|speedup|benchmark)\b)/i,
  hardDefect: /(버그|오류|에러|크래시|안\s*돼|안\s*됨|깨져|깨짐|실패해|오작동|타임아웃|간헐적|재현|회귀|오타|\b(?:bug|bugs|regression|crash|crashes|crashing|broken|flaky|timeout)\b)/i,
  bugfix: /(버그|오류|에러|크래시|안\s*돼|안\s*됨|깨져|깨짐|실패해|오작동|고쳐|타임아웃|간헐적|재현|회귀|오타|\b(?:bug|bugs|fix|fixes|regression|crash|crashes|crashing|broken|flaky|error|timeout)\b)/i,
  fullAutonomy: /(끝까지\s*자율|전\s*주기|풀\s*오토|알아서\s*끝까지|\b(?:full[\s-]?cycle|run\s+until\s+done|autonomous)\b)/i,
  buildVerb: /(구현|개발해|만들어|작성해|추가해|리팩터링|적용해|반영해|고쳐|수정해|패치해|\b(?:implement|build|ship|refactor|write|add|create|patch)\b)/i
});

export function hasTicketId(text) {
  const re = /(?:^|[\s([{'"])([A-Z]{2,10}-\d+|#\d+)(?=$|[\s)\]}'",.:;!?]|[가-힣])/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const token = match[1];
    if (token.startsWith('#')) return true;
    if (/^RFC-\d+$/i.test(token)) continue;
    if (TECH_SPEC_IDS.has(token.toUpperCase())) continue;
    return true;
  }
  return false;
}

function isValidRouteName(candidate) {
  return candidate === 'full' || ROUTE_BY_ID.has(candidate);
}

function parseExplicitRoute(cleanedInput) {
  const tokens = cleanedInput.split(/\s+/);
  const rawFirst = tokens[0];
  const restJoined = tokens.slice(1).join(' ').trim();

  const prefixedMatch = /^(?:route:([a-z]+)|([a-z]+):|\[([a-z]+)\])$/i.exec(rawFirst);
  if (prefixedMatch) {
    const id = (prefixedMatch[1] || prefixedMatch[2] || prefixedMatch[3]).toLowerCase();
    if (isValidRouteName(id)) {
      return { primaryId: id, restText: restJoined || cleanedInput };
    }
  }

  const lowerFirst = rawFirst.toLowerCase();
  if (!isValidRouteName(lowerFirst)) return null;

  if (tokens.length === 1) {
    return { primaryId: lowerFirst, restText: cleanedInput };
  }

  const second = tokens[1];
  const looksLikeRouteTarget = /[가-힣]/.test(second)
    || hasTicketId(second)
    || /[./\\]/.test(second);

  if (looksLikeRouteTarget) {
    return { primaryId: lowerFirst, restText: restJoined };
  }

  return null;
}

export function classifyTask(rawInput) {
  const strippedSlash = String(rawInput ?? '')
    .trim()
    .replace(/^(?:\/krig(?::krig)?|\$krig)(?=\s|$)\s*/i, '')
    .trim();

  if (!strippedSlash) {
    throw new Error('요청 문장이 비어 있습니다. 예: node route.mjs -- "PROJ-120 구현해줘"');
  }

  const explicit = parseExplicitRoute(strippedSlash);
  const explicitOverride = Boolean(explicit);
  let primaryId = explicit ? explicit.primaryId : null;
  const restText = explicit ? explicit.restText : strippedSlash;

  let driveMode = null;
  const reasons = [];

  if (!primaryId) {
    const ticketPresent = hasTicketId(restText);
    if (PATTERNS.fullAutonomy.test(restText) && PATTERNS.align.test(restText)) {
      primaryId = 'full';
      reasons.push('전 주기 자율 실행 및 기획 신호 감지');
    } else if (PATTERNS.backprop.test(restText)) {
      primaryId = 'backprop';
      reasons.push('교훈 역전파/재발 방지 신호 감지');
    } else if (PATTERNS.demock.test(restText)) {
      primaryId = 'demock';
      reasons.push('프로덕션 가짜 성공/삼킨 예외 점검 신호 감지');
    } else if (PATTERNS.verify.test(restText) && !PATTERNS.buildVerb.test(restText)) {
      primaryId = 'verify';
      reasons.push('독립 리뷰/검증 전용 요청 신호 감지');
    } else if (
      PATTERNS.epicSplit.test(restText)
      || (PATTERNS.align.test(restText) && !ticketPresent && !PATTERNS.hardDefect.test(restText))
    ) {
      primaryId = 'align';
      reasons.push('신규 범위 정렬/요구사항 감량/티켓화 신호 감지');
    } else if (PATTERNS.design.test(restText) && !PATTERNS.buildVerb.test(restText) && !PATTERNS.hardDefect.test(restText)) {
      primaryId = 'design';
      reasons.push('모듈 경계 및 인터페이스 설계 전용 신호 감지');
    } else {
      primaryId = 'drive';
      reasons.push('구체적 실행/수정 요청 기본 라우트');
    }
  } else {
    reasons.push(`명시적 라우트 지정(${primaryId})`);
  }

  const driveChain = ROUTE_BY_ID.get('drive').chain;
  let pipelineIds;
  if (primaryId === 'full') {
    pipelineIds = [...new Set(['align', 'design', 'drive', ...driveChain])];
  } else {
    const spec = ROUTE_BY_ID.get(primaryId);
    pipelineIds = [spec.id, ...spec.chain];
    if (primaryId === 'drive' && PATTERNS.design.test(restText)) {
      pipelineIds = [...new Set(['design', 'drive', ...driveChain])];
      reasons.push('경계 설계 신호가 함께 있어 design 선행 결합');
    }
  }

  if (pipelineIds.includes('drive')) {
    if (PATTERNS.hardDefect.test(restText) || (!PATTERNS.hillclimb.test(restText) && PATTERNS.bugfix.test(restText))) {
      driveMode = 'bugfix';
      reasons.push('런타임 재현 및 이진 탐색 버그 수정(bugfix) 모드');
    } else if (PATTERNS.hillclimb.test(restText)) {
      driveMode = 'hillclimb';
      reasons.push('정량 지표 반복 개선(hillclimb) 모드');
    } else {
      driveMode = 'feature';
      reasons.push('수직 슬라이스 기능/리팩터링(feature) 모드');
    }
  }

  const steps = pipelineIds.map((id) => {
    const spec = ROUTE_BY_ID.get(id);
    return {
      id: spec.id,
      gear: primaryId === 'full' ? 'afk' : spec.gear,
      playbookPath: path.join(SKILL_DIR, spec.playbook),
      scriptPaths: spec.scripts.map((rel) => path.join(SKILL_DIR, rel)),
      lazyReferences: spec.references.map((rel) => path.join(SKILL_DIR, rel)),
      summary: spec.summary
    };
  });

  return {
    request: strippedSlash,
    explicitOverride,
    primaryRoute: primaryId,
    driveMode,
    reasons,
    pipeline: pipelineIds,
    steps
  };
}

function printHelp() {
  console.log('사용법: node route.mjs [--json] [--cwd <dir>] [--list] [--stdin] [-- "<요청 문장>"]');
}

function main() {
  let parsed;
  try {
    parsed = parseCliFlags(process.argv.slice(2), {
      booleans: ['json', 'help', 'list', 'stdin'],
      allowedFlags: ['json', 'list', 'stdin', 'cwd'],
      allowSingleDashPositional: true
    });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  if (parsed.flags.help) {
    printHelp();
    process.exit(0);
  }

  if (parsed.flags.list) {
    if (parsed.flags.json) {
      console.log(JSON.stringify(ROUTE_TABLE, null, 2));
    } else {
      for (const r of ROUTE_TABLE) {
        console.log(`${r.id}\tgear=${r.gear}\tplaybook=${r.playbook}\tchain=${r.chain.join(',') || 'none'}`);
      }
    }
    process.exit(0);
  }

  const text = parsed.flags.stdin
    ? fs.readFileSync(0, 'utf8').trim()
    : parsed.positional.join(' ').trim();

  if (!text) {
    printHelp();
    process.exit(2);
  }

  try {
    const plan = classifyTask(text);
    if (parsed.flags.json) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }

    console.log(`라우트 파이프라인: ${plan.pipeline.join(' / ')}`);
    if (plan.driveMode) {
      console.log(`실행 세부 모드: ${plan.driveMode}`);
    }
    console.log(`판별 근거: ${plan.reasons.join(', ')}`);
    for (const step of plan.steps) {
      console.log(`- [${step.id}] (gear=${step.gear}) ${step.playbookPath}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}

if (isCliMain(import.meta.url)) {
  main();
}
