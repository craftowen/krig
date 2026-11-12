#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isCliMain, parseCliFlags } from './lib/cli.mjs';

const JS_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
const CODE_EXTS = new Set([...JS_EXTS, '.py', '.rs', '.go']);
const BUILD_OR_VCS_DIRS = new Set([
  '.git', '.krig', 'node_modules', 'target', 'dist', 'build', 'coverage', '.venv', 'venv', '__pycache__'
]);
const TEST_DIRS = new Set(['test', 'tests', '__tests__', '__mocks__', 'fixtures', 'testdata']);
const PROJECT_ROOT_MARKERS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', '.git'];
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'throw', 'case', 'typeof', 'void', 'delete', 'in', 'of', 'instanceof', 'new', 'await', 'yield'
]);

function isProjectBoundary(dir) {
  const resolved = path.resolve(dir);
  if (
    resolved === path.parse(resolved).root
    || resolved === path.resolve(os.tmpdir())
    || resolved === path.resolve(os.homedir())
  ) {
    return true;
  }
  return PROJECT_ROOT_MARKERS.some((marker) => fs.existsSync(path.join(resolved, marker)));
}

export function isTestPath(absFileOrDir, scanRoot = null) {
  const abs = path.resolve(absFileOrDir);
  const base = path.basename(abs);
  if (
    /\.(test|spec)\.[a-z0-9]+$/i.test(base)
    || /^test_.*\.py$/i.test(base)
    || /_test\.(py|go|rs)$/i.test(base)
    || base === 'conftest.py'
  ) {
    return true;
  }

  let cur = abs;
  const stopAt = scanRoot ? path.resolve(scanRoot) : null;
  while (true) {
    const seg = path.basename(cur);
    if (TEST_DIRS.has(seg) || BUILD_OR_VCS_DIRS.has(seg)) return true;
    if (stopAt && cur === stopAt) {
      if (isProjectBoundary(cur)) break;
    }
    if (isProjectBoundary(cur)) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return false;
}

function collectProductionFiles(targetPath) {
  const abs = path.resolve(targetPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`스캔 대상 경로가 존재하지 않습니다: ${targetPath}`);
  }
  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    if (!CODE_EXTS.has(path.extname(abs)) || isTestPath(abs)) return [];
    return [{ root: path.dirname(abs), abs }];
  }

  if (isTestPath(abs)) return [];

  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (BUILD_OR_VCS_DIRS.has(entry.name) || TEST_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && CODE_EXTS.has(path.extname(entry.name)) && !isTestPath(full, abs)) {
        out.push({ root: abs, abs: full });
      }
    }
  }
  walk(abs);
  return out.sort((a, b) => a.abs.localeCompare(b.abs));
}

function canStartJsRegex(prevTokenChar, prevWord) {
  if (!prevTokenChar) return true;
  if (prevTokenChar === '<') return false;
  if ('(,=:[!&|?{};~^+-*%<>'.includes(prevTokenChar)) return true;
  return REGEX_PRECEDING_KEYWORDS.has(prevWord);
}

function lexSource(content, ext) {
  const isPy = ext === '.py';
  const isJs = JS_EXTS.has(ext);
  const allowLines = new Set();

  const noCommentsOrStrings = [];
  const noCommentsOrRegex = [];

  let lineNo = 0;
  let i = 0;
  let prevTokenChar = '';
  let prevWord = '';

  function pushBoth(ch) {
    noCommentsOrStrings.push(ch);
    noCommentsOrRegex.push(ch);
    if (ch === '\n') {
      lineNo += 1;
    } else if (!/\s/.test(ch)) {
      prevTokenChar = ch;
    }
  }

  function recordCommentText(commentStr, startLine) {
    const parts = commentStr.split('\n');
    for (let offset = 0; offset < parts.length; offset += 1) {
      if (/demock:\s*allow/i.test(parts[offset])) {
        allowLines.add(startLine + offset);
      }
    }
  }

  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1] ?? '';
    const next2 = content[i + 2] ?? '';

    if (ch === '\r') {
      i += 1;
      continue;
    }

    if (ch === '\n') {
      pushBoth('\n');
      i += 1;
      continue;
    }

    // Python # line comment
    if (isPy && ch === '#') {
      const start = i;
      const startLine = lineNo;
      while (i < content.length && content[i] !== '\n' && content[i] !== '\r') i += 1;
      recordCommentText(content.slice(start, i), startLine);
      continue;
    }

    // C-style // line comment
    if (!isPy && ch === '/' && next === '/') {
      const start = i;
      const startLine = lineNo;
      while (i < content.length && content[i] !== '\n' && content[i] !== '\r') i += 1;
      recordCommentText(content.slice(start, i), startLine);
      continue;
    }

    // C-style /* ... */ block comment
    if (!isPy && ch === '/' && next === '*') {
      const start = i;
      const startLine = lineNo;
      i += 2;
      while (i < content.length && !(content[i] === '*' && content[i + 1] === '/')) {
        if (content[i] === '\n') {
          noCommentsOrStrings.push('\n');
          noCommentsOrRegex.push('\n');
          lineNo += 1;
        } else if (content[i] !== '\r') {
          noCommentsOrStrings.push(' ');
          noCommentsOrRegex.push(' ');
        }
        i += 1;
      }
      const end = Math.min(content.length, i + 2);
      recordCommentText(content.slice(start, end).replace(/\r/g, ''), startLine);
      i = end;
      continue;
    }

    // Python triple-quoted string / docstring
    if (isPy && ((ch === '"' && next === '"' && next2 === '"') || (ch === "'" && next === "'" && next2 === "'"))) {
      const quote = ch;
      noCommentsOrStrings.push(quote, quote);
      noCommentsOrRegex.push(quote, quote);
      i += 3;
      while (i < content.length && !(content[i] === quote && content[i + 1] === quote && content[i + 2] === quote)) {
        if (content[i] === '\\' && i + 1 < content.length && content[i + 1] !== '\n') {
          i += 2;
          continue;
        }
        if (content[i] === '\n') {
          noCommentsOrStrings.push('\n');
          noCommentsOrRegex.push('\n');
          lineNo += 1;
        }
        i += 1;
      }
      i = Math.min(content.length, i + 3);
      prevTokenChar = quote;
      prevWord = '';
      continue;
    }

    // Single, double, or backtick string literal
    if (ch === '"' || ch === "'" || (isJs && ch === '`')) {
      const quote = ch;
      noCommentsOrStrings.push(quote);
      noCommentsOrRegex.push(quote);
      i += 1;
      while (i < content.length && content[i] !== quote) {
        if (content[i] === '\\' && i + 1 < content.length) {
          const esc = content[i + 1];
          if (esc === '\n') {
            noCommentsOrStrings.push('\n');
            noCommentsOrRegex.push('\n');
            lineNo += 1;
          } else {
            noCommentsOrRegex.push(' ', ' ');
          }
          i += 2;
          continue;
        }
        if (content[i] === '\n') {
          if (quote !== '`') break;
          noCommentsOrStrings.push('\n');
          noCommentsOrRegex.push('\n');
          lineNo += 1;
        } else if (content[i] !== '\r') {
          noCommentsOrRegex.push(content[i]);
        }
        i += 1;
      }
      if (i < content.length && content[i] === quote) {
        noCommentsOrStrings.push(quote);
        noCommentsOrRegex.push(quote);
        i += 1;
      }
      prevTokenChar = quote;
      prevWord = '';
      continue;
    }

    // JS/TS regex literal /.../flags
    if (isJs && ch === '/' && next !== '/' && next !== '*' && canStartJsRegex(prevTokenChar, prevWord)) {
      let j = i + 1;
      let inCharClass = false;
      let validRegex = false;
      while (j < content.length) {
        const rc = content[j];
        if (rc === '\n' || rc === '\r') break;
        if (rc === '\\') {
          j += 2;
          continue;
        }
        if (rc === '[') inCharClass = true;
        else if (rc === ']') inCharClass = false;
        else if (rc === '/' && !inCharClass) {
          validRegex = true;
          j += 1;
          while (j < content.length && /[a-z]/i.test(content[j])) j += 1;
          break;
        }
        j += 1;
      }
      if (validRegex) {
        noCommentsOrStrings.push('/', ' ', '/');
        noCommentsOrRegex.push('/', ' ', '/');
        i = j;
        prevTokenChar = '/';
        prevWord = '';
        continue;
      }
    }

    // Identifier / keyword tracking for JS regex disambiguation
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < content.length && /[A-Za-z0-9_$]/.test(content[j])) j += 1;
      const word = content.slice(i, j);
      for (const wc of word) {
        noCommentsOrStrings.push(wc);
        noCommentsOrRegex.push(wc);
      }
      prevWord = word;
      prevTokenChar = word[word.length - 1];
      i = j;
      continue;
    }

    prevWord = '';
    pushBoth(ch);
    i += 1;
  }

  return {
    allowLines,
    cleanLines: noCommentsOrStrings.join('').split('\n'),
    stringKeptLines: noCommentsOrRegex.join('').split('\n')
  };
}

function hasRangeAllow(allowLines, startLine, endLine) {
  const from = Math.max(0, startLine - 1);
  for (let idx = from; idx <= endLine; idx += 1) {
    if (allowLines.has(idx)) return true;
  }
  return false;
}

function findEnclosingTryAllow(cleanLines, allowLines, catchLine) {
  for (let k = catchLine; k >= Math.max(0, catchLine - 15); k -= 1) {
    if (/\btry\b/.test(cleanLines[k])) {
      if (allowLines.has(k) || (k > 0 && allowLines.has(k - 1))) {
        return true;
      }
      break;
    }
  }
  return false;
}

function isPythonAbstractMethodRaise(rawLines, cleanLines, raiseIdx) {
  const raiseRaw = rawLines[raiseIdx] ?? '';
  if (/\b(todo|fixme|pending|wip)\b/i.test(raiseRaw)) return false;

  const raiseIndent = (raiseRaw.match(/^\s*/)?.[0] ?? '').length;
  if (raiseIndent === 0) return false;

  let defIdx = -1;
  let defIndent = -1;
  for (let k = raiseIdx - 1; k >= 0; k -= 1) {
    const cleanTrim = cleanLines[k].trim();
    if (!cleanTrim || cleanTrim === '""""""' || cleanTrim === "''''''" || cleanTrim === '""' || cleanTrim === "''") {
      continue;
    }
    const ind = (rawLines[k].match(/^\s*/)?.[0] ?? '').length;
    if (ind < raiseIndent && /^(?:async\s+)?def\s+\w+\s*\(/.test(cleanTrim)) {
      defIdx = k;
      defIndent = ind;
      break;
    }
    return false;
  }

  if (defIdx === -1) return false;

  // Check there are no executable statements after raise inside the same def
  for (let k = raiseIdx + 1; k < cleanLines.length; k += 1) {
    const cleanTrim = cleanLines[k].trim();
    if (!cleanTrim) continue;
    const ind = (rawLines[k].match(/^\s*/)?.[0] ?? '').length;
    if (ind <= defIndent) break;
    return false;
  }

  // Either decorated with @abstractmethod or indented inside a class definition
  if (defIndent > 0) return true;
  for (let k = defIdx - 1; k >= Math.max(0, defIdx - 5); k -= 1) {
    const cleanTrim = cleanLines[k].trim();
    if (!cleanTrim) continue;
    if (/^@(?:abc\.)?abstractmethod\b/.test(cleanTrim)) return true;
    if (!cleanTrim.startsWith('@')) break;
  }
  return false;
}

function extractJsCatchBlock(cleanLines, startIdx) {
  let braceDepth = 0;
  let started = false;
  let collected = '';
  const maxIdx = Math.min(cleanLines.length - 1, startIdx + 12);

  const firstLine = cleanLines[startIdx];
  const catchPos = firstLine.search(/\bcatch\b/);
  if (catchPos === -1) return null;

  for (let idx = startIdx; idx <= maxIdx; idx += 1) {
    const segment = idx === startIdx ? cleanLines[idx].slice(catchPos) : cleanLines[idx];
    for (let c = 0; c < segment.length; c += 1) {
      const ch = segment[c];
      if (ch === '{') {
        if (started) collected += ch;
        braceDepth += 1;
        started = true;
      } else if (ch === '}') {
        braceDepth -= 1;
        if (started && braceDepth === 0) {
          return { body: collected.trim(), endIdx: idx };
        }
        if (started) collected += ch;
      } else if (started) {
        collected += ch;
      }
    }
    if (started) collected += ' ';
  }
  return null;
}

export function scanFileContent(relFile, content) {
  const findings = [];
  const rawLines = content.split(/\r?\n/);
  const ext = path.extname(relFile).toLowerCase();
  const { allowLines, cleanLines, stringKeptLines } = lexSource(content, ext);

  for (let i = 0; i < cleanLines.length; i += 1) {
    const rawTrimmed = rawLines[i].trim();
    const clean = cleanLines[i];
    const cleanTrimmed = clean.trim();
    const withStrings = stringKeptLines[i];

    if (!cleanTrimmed) continue;
    if (hasRangeAllow(allowLines, i, i)) continue;

    if (
      /\b(jest\.fn|vi\.fn|sinon\.(stub|spy|mock)|MagicMock|AsyncMock|monkeypatch\.setattr)\b/.test(clean)
      || (ext === '.py' && /^\s*(?:from\s+unittest\s+import\s+mock|import\s+unittest\.mock|from\s+unittest\.mock\s+import)\b/.test(clean))
    ) {
      findings.push({
        file: relFile,
        line: i + 1,
        category: 'test-double-in-prod',
        confidence: 'high',
        snippet: rawTrimmed.slice(0, 140),
        remediation: '프로덕션 경로에서 테스트 더블을 제거하고 생성자/어댑터 주입 경계로 옮기세요.'
      });
    }

    const hasNotImpl = /\bNotImplementedError\b/.test(clean);
    const hasRustTodo = /\b(todo|unimplemented)!\s*\(/.test(clean);
    const hasJsTodoThrow = /\bthrow\s+new\s+Error\(\s*['"`](?:TODO|FIXME|not\s+implemented)\b/i.test(withStrings);

    if (hasRustTodo || hasJsTodoThrow || (hasNotImpl && !(ext === '.py' && isPythonAbstractMethodRaise(rawLines, cleanLines, i)))) {
      findings.push({
        file: relFile,
        line: i + 1,
        category: 'placeholder',
        confidence: 'high',
        snippet: rawTrimmed.slice(0, 140),
        remediation: '미구현 플레이스홀더를 실제 동작으로 구현하거나 지원하지 않는 진입점을 제거하세요.'
      });
    }

    // Single-line and multi-line permissive-guard
    let nextNonEmptyIdx = i + 1;
    while (nextNonEmptyIdx < cleanLines.length && !cleanLines[nextNonEmptyIdx].trim()) {
      nextNonEmptyIdx += 1;
    }
    const twoLineWindow = `${cleanTrimmed} ${(cleanLines[nextNonEmptyIdx] ?? '').trim()}`;

    if (
      (JS_EXTS.has(ext) && /\bif\s*\(\s*!\s*(?:secret|token|apiKey|signature|webhookSecret)\s*\)\s*\{?\s*return\s+true\b/i.test(twoLineWindow))
      || (ext === '.py' && /^if\s+not\s+(?:secret|token|api_key|signature|webhook_secret)\s*:\s*return\s+True\b/.test(twoLineWindow))
    ) {
      if (!hasRangeAllow(allowLines, i, Math.min(cleanLines.length - 1, nextNonEmptyIdx))) {
        findings.push({
          file: relFile,
          line: i + 1,
          category: 'permissive-guard',
          confidence: 'high',
          snippet: rawTrimmed.slice(0, 140),
          remediation: '시크릿이나 서명이 누락되면 통과(true)시키지 말고 즉시 거부 예외를 던지세요.'
        });
      }
    }

    if (JS_EXTS.has(ext) && /\bcatch\b/.test(clean)) {
      const catchBlock = extractJsCatchBlock(cleanLines, i);
      if (catchBlock && !hasRangeAllow(allowLines, i, catchBlock.endIdx) && !findEnclosingTryAllow(cleanLines, allowLines, i)) {
        if (catchBlock.body === '') {
          findings.push({
            file: relFile,
            line: i + 1,
            category: 'swallowed-error',
            confidence: 'high',
            snippet: rawTrimmed.slice(0, 140),
            remediation: '빈 catch 블록으로 예외를 삼키지 말고 상위로 전파하거나 의도된 사유(demock: allow <사유>)를 명시하세요.'
          });
        } else if (/^return\s+(?:true|\{\s*\}|\[\s*\])\s*;?$/.test(catchBlock.body)) {
          findings.push({
            file: relFile,
            line: i + 1,
            category: 'swallowed-error',
            confidence: 'high',
            snippet: rawTrimmed.slice(0, 140),
            remediation: '예외 발생 시 정상 성공값(true, 빈 객체/배열)으로 위장하지 말고 실패를 드러내세요.'
          });
        }
      }
    }

    if (ext === '.py' && /^except(?:\s+[^:]+)?\s*:/.test(cleanTrimmed)) {
      const colonIdx = cleanTrimmed.indexOf(':');
      const headerPart = cleanTrimmed.slice(0, colonIdx).trim();
      const inlineBody = cleanTrimmed.slice(colonIdx + 1).trim();
      const isBroad = headerPart === 'except' || /^except\s+(?:Exception|BaseException)\b/.test(headerPart);

      let bodyStmt = inlineBody;
      let bodyLineIdx = i;

      if (!bodyStmt) {
        const exceptIndent = (rawLines[i].match(/^\s*/)?.[0] ?? '').length;
        const bodyLines = [];
        for (let k = i + 1; k < cleanLines.length; k += 1) {
          const ct = cleanLines[k].trim();
          if (!ct) continue;
          const ind = (rawLines[k].match(/^\s*/)?.[0] ?? '').length;
          if (ind <= exceptIndent) break;
          bodyLines.push({ idx: k, text: ct });
        }
        if (bodyLines.length === 1) {
          bodyStmt = bodyLines[0].text;
          bodyLineIdx = bodyLines[0].idx;
        }
      }

      if (
        bodyStmt
        && !hasRangeAllow(allowLines, i, bodyLineIdx)
        && !findEnclosingTryAllow(cleanLines, allowLines, i)
      ) {
        if (bodyStmt === 'pass' && isBroad) {
          findings.push({
            file: relFile,
            line: i + 1,
            category: 'swallowed-error',
            confidence: headerPart === 'except' ? 'high' : 'medium',
            snippet: `${headerPart}: ${bodyStmt}`.slice(0, 140),
            remediation: '광범위 예외(except/Exception)를 pass로 삼키지 말고 구체적 예외만 잡거나 에러를 기록/전파하세요.'
          });
        } else if (/^return\s+(?:True|\{\s*\}|\[\s*\])(?:\s*;)?$/.test(bodyStmt)) {
          findings.push({
            file: relFile,
            line: i + 1,
            category: 'swallowed-error',
            confidence: 'high',
            snippet: `${headerPart}: ${bodyStmt}`.slice(0, 140),
            remediation: '예외 블록에서 True나 빈 컨테이너를 반환해 가짜 성공을 만들지 마세요.'
          });
        }
      }
    }
  }

  return findings;
}

export function scanTargets(targets) {
  const allFindings = [];
  const seenFiles = new Set();

  for (const target of targets) {
    const files = collectProductionFiles(target);
    for (const { root, abs } of files) {
      if (seenFiles.has(abs)) continue;
      seenFiles.add(abs);
      const rel = path.relative(root, abs) || path.basename(abs);
      const content = fs.readFileSync(abs, 'utf8');
      allFindings.push(...scanFileContent(rel, content));
    }
  }

  return { scannedFiles: seenFiles.size, findings: allFindings };
}

function printHelp() {
  console.log('사용법: node scan.mjs [--json] [<경로...>] (종료 코드: 0=후보 없음, 3=후보 발견, 2=실행 오류)');
}

function main() {
  let parsed;
  try {
    parsed = parseCliFlags(process.argv.slice(2), {
      booleans: ['json', 'help'],
      allowedFlags: ['json']
    });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  if (parsed.flags.help) {
    printHelp();
    process.exit(0);
  }

  const effectiveTargets = parsed.positional.length > 0 ? parsed.positional : [process.cwd()];

  try {
    const result = scanTargets(effectiveTargets);
    if (parsed.flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.findings.length === 0) {
      console.log(`OK: 프로덕션 파일 ${result.scannedFiles}개를 스캔했으며 가짜 성공/더블 후보가 없습니다.`);
    } else {
      for (const f of result.findings) {
        console.log(`${f.file}:${f.line} [${f.category}/${f.confidence}] ${f.snippet}\n  권고: ${f.remediation}`);
      }
      console.log(`발견: 프로덕션 파일 ${result.scannedFiles}개 중 후보 ${result.findings.length}건`);
    }
    process.exit(result.findings.length === 0 ? 0 : 3);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}

if (isCliMain(import.meta.url)) {
  main();
}
