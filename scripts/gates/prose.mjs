import fs from 'node:fs';
import path from 'node:path';
import { stripInlineCode, updateFenceState } from '../../skills/krig/scripts/lib/markdown.mjs';
import { makeFinding, walkFiles } from './model.mjs';

const FORBIDDEN_CHARS = [
  { char: '\u2014', name: '긴 대시(em-dash)' },
  { char: '\u2013', name: '짧은 대시(en-dash)' },
  { char: '\u00b7', name: '가운뎃점(middle dot)' },
  { char: '\u2192', name: '장식 화살표(right arrow)' },
  { char: '\u2194', name: '양방향 화살표(left-right arrow)' }
];

const EMOJI_BULLET_RE = /^\s*(?:[-*+]\s+|\d+\.\s+|#{1,6}\s+)\p{Extended_Pictographic}/u;

function extractMarkdownLinks(text) {
  const targets = [];
  const labelRe = /\[[^\]]+\]\(/g;
  let match;

  while ((match = labelRe.exec(text)) !== null) {
    let idx = match.index + match[0].length;
    while (idx < text.length && /\s/.test(text[idx])) idx += 1;

    if (text[idx] === '<') {
      const closeAngle = text.indexOf('>', idx + 1);
      const closeParen = closeAngle !== -1 ? text.indexOf(')', closeAngle + 1) : -1;
      if (closeAngle !== -1 && closeParen !== -1) {
        targets.push(text.slice(idx + 1, closeAngle).trim());
        labelRe.lastIndex = closeParen + 1;
      }
      continue;
    }

    let depth = 1;
    let end = idx;
    while (end < text.length && depth > 0) {
      if (text[end] === '(') depth += 1;
      else if (text[end] === ')') depth -= 1;
      if (depth > 0) end += 1;
    }
    if (depth === 0) {
      const inner = text.slice(idx, end).trim();
      const withoutTitle = inner.replace(/\s+(?:"[^"]*"|'[^']*')\s*$/, '').trim();
      targets.push(withoutTitle);
      labelRe.lastIndex = end + 1;
    }
  }

  return targets;
}

export function checkProseAndLinks(repoRoot) {
  const findings = [];
  const mdFiles = walkFiles(repoRoot, (f) => f.endsWith('.md'));

  for (const absFile of mdFiles) {
    if (fs.lstatSync(absFile).isSymbolicLink()) {
      const target = path.resolve(path.dirname(absFile), fs.readlinkSync(absFile));
      if (!fs.existsSync(target)) {
        findings.push(makeFinding({
          gate: 'links',
          file: path.relative(repoRoot, absFile),
          code: 'BROKEN_SYMLINK',
          message: '깨진 마크다운 심볼릭 링크입니다.',
          fix: '심볼릭 링크 대상 경로를 복구하거나 링크를 제거하세요.'
        }));
      }
      continue;
    }

    const relFile = path.relative(repoRoot, absFile);
    const lines = fs.readFileSync(absFile, 'utf8').split(/\r?\n/);
    let fence = null;

    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      const lineNo = idx + 1;

      const step = updateFenceState(fence, line);
      if (step.toggled) {
        fence = step.nextState;
        continue;
      }
      if (fence) continue;

      const withoutInlineCode = stripInlineCode(line);

      if (/\[TODO\b|TODO:/i.test(withoutInlineCode)) {
        findings.push(makeFinding({
          gate: 'prose',
          file: relFile,
          line: lineNo,
          code: 'UNFINISHED_TODO',
          message: '문서 산문에 미완성 TODO 플레이스홀더가 남아 있습니다.',
          fix: '실제 규칙이나 경로로 확정해 작성하고 TODO 표기를 지우세요.'
        }));
      }

      if (EMOJI_BULLET_RE.test(withoutInlineCode)) {
        findings.push(makeFinding({
          gate: 'prose',
          file: relFile,
          line: lineNo,
          code: 'EMOJI_BULLET',
          message: '제목이나 글머리표에 장식용 이모지가 포함되어 있습니다.',
          fix: '제목과 목록에서 장식 이모지를 제거하고 평문으로 작성하세요.'
        }));
      }

      for (const rule of FORBIDDEN_CHARS) {
        if (withoutInlineCode.includes(rule.char)) {
          findings.push(makeFinding({
            gate: 'prose',
            file: relFile,
            line: lineNo,
            code: 'FORBIDDEN_PUNCTUATION',
            message: `산문에 금지된 기호(${rule.name})가 포함되어 있습니다.`,
            fix: '쉼표, 마침표, 콜론, 슬래시, 줄바꿈으로 바꾸세요.'
          }));
        }
      }

      for (const rawTarget of extractMarkdownLinks(withoutInlineCode)) {
        if (
          !rawTarget
          || rawTarget.startsWith('http://')
          || rawTarget.startsWith('https://')
          || rawTarget.startsWith('mailto:')
          || rawTarget.startsWith('#')
          || rawTarget.startsWith('file://')
          || rawTarget.startsWith('conversation://')
        ) {
          continue;
        }
        const cleanRel = rawTarget.split('#')[0].split('?')[0];
        if (!cleanRel) continue;
        const resolved = path.resolve(path.dirname(absFile), cleanRel);
        if (!fs.existsSync(resolved)) {
          findings.push(makeFinding({
            gate: 'links',
            file: relFile,
            line: lineNo,
            code: 'BROKEN_LINK',
            message: `상대 경로 링크 대상을 찾을 수 없습니다: ${rawTarget}`,
            fix: `${relFile} 기준 올바른 상대 경로로 수정하거나 대상 파일을 생성하세요.`
          }));
        }
      }
    }
  }

  return findings;
}
