import fs from 'node:fs';
import path from 'node:path';
import { updateFenceState } from '../../skills/krig/scripts/lib/markdown.mjs';

export function makeFinding({ gate, file, line = 1, code, message, fix }) {
  return Object.freeze({ gate, file, line, code, message, fix });
}

export function parseYamlScalar(rawVal) {
  const trimmed = rawVal.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  const withoutComment = trimmed.replace(/\s+#.*$/, '').trim();
  if (withoutComment === 'true') return true;
  if (withoutComment === 'false') return false;
  return withoutComment;
}

function parseSimpleYamlLines(lines) {
  const entries = [];
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = rawLine.match(/^\s*/)[0].length;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const rawRest = trimmed.slice(colon + 1).trim();

    if (rawRest === '>' || rawRest === '|-' || rawRest === '|' || rawRest === '>-') {
      const blockLines = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextRaw = lines[j];
        if (!nextRaw.trim()) {
          blockLines.push('');
          j += 1;
          continue;
        }
        const nextIndent = nextRaw.match(/^\s*/)[0].length;
        if (nextIndent <= indent) break;
        blockLines.push(nextRaw.trim());
        j += 1;
      }
      i = j - 1;
      const joiner = rawRest.startsWith('>') ? ' ' : '\n';
      entries.push({ indent, key, value: blockLines.join(joiner).trim(), isSection: false });
      continue;
    }

    if (rawRest === '') {
      entries.push({ indent, key, value: null, isSection: true });
    } else {
      entries.push({ indent, key, value: parseYamlScalar(rawRest), isSection: false });
    }
  }
  return entries;
}

export function parseFrontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
  if (!match) {
    return { frontmatter: null, body: markdown };
  }
  const entries = parseSimpleYamlLines(match[1].split(/\r?\n/));
  const data = {};
  for (const entry of entries) {
    if (!entry.isSection) {
      data[entry.key] = entry.value;
    }
  }
  return { frontmatter: data, body: match[2] };
}

export function parseOpenAiYaml(yamlText) {
  const result = { interface: {}, policy: {} };
  const entries = parseSimpleYamlLines(yamlText.split(/\r?\n/));
  let section = null;

  for (const entry of entries) {
    if (entry.indent === 0 && entry.isSection) {
      section = entry.key;
      continue;
    }
    if (section && section in result && !entry.isSection) {
      result[section][entry.key] = entry.value;
    }
  }
  return result;
}

export function extractH2Sections(markdownBody) {
  const sections = new Map();
  const lines = markdownBody.split(/\r?\n/);
  let current = null;
  let buffer = [];
  let fence = null;

  for (const line of lines) {
    const step = updateFenceState(fence, line);
    if (step.toggled) {
      fence = step.nextState;
      if (current !== null) buffer.push(line);
      continue;
    }
    if (!fence && /^##\s+(.+)$/.test(line)) {
      if (current !== null) {
        sections.set(current, buffer.join('\n').trim());
      }
      current = line.replace(/^##\s+/, '').trim();
      buffer = [];
      continue;
    }
    if (current !== null) {
      buffer.push(line);
    }
  }
  if (current !== null) {
    sections.set(current, buffer.join('\n').trim());
  }
  return sections;
}

export function walkFiles(rootDir, predicate) {
  const results = [];
  if (!fs.existsSync(rootDir)) return results;

  function visit(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'state' || entry.name === '.krig') {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if ((entry.isFile() || entry.isSymbolicLink()) && (!predicate || predicate(full))) {
        results.push(full);
      }
    }
  }

  visit(rootDir);
  return results.sort();
}
