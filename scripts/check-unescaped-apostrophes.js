const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.next',
  '.turbo',
]);
const ALLOWED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      walk(path.join(dir, entry.name), files);
      continue;
    }

    if (ALLOWED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }
}

function buildLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

function getLineColumn(index, lineStarts) {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= index) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const lineIndex = high;
  return {
    line: lineIndex + 1,
    column: index - lineStarts[lineIndex] + 1,
  };
}

function getLineText(text, index) {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const nextNewline = text.indexOf('\n', index);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;
  return text.slice(lineStart, lineEnd);
}

function isAsciiLetter(char) {
  return /[A-Za-z]/.test(char);
}

function scanFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lineStarts = buildLineStarts(text);
  const findings = [];

  let state = 'code';

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (state === 'lineComment') {
      if (char === '\n') {
        state = 'code';
      }
      continue;
    }

    if (state === 'blockComment') {
      if (char === '*' && next === '/') {
        state = 'code';
        i += 1;
      }
      continue;
    }

    if (state === 'doubleQuote') {
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === '"') {
        state = 'code';
      }
      continue;
    }

    if (state === 'template') {
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === '`') {
        state = 'code';
      }
      continue;
    }

    if (state === 'singleQuote') {
      if (char === '\\') {
        i += 1;
        continue;
      }

      if (char === "'") {
        const prev = text[i - 1] || '';
        const after = next || '';

        if (isAsciiLetter(prev) && isAsciiLetter(after)) {
          const { line, column } = getLineColumn(i, lineStarts);
          findings.push({
            line,
            column,
            lineText: getLineText(text, i).trim(),
          });
        }

        state = 'code';
      }

      continue;
    }

    if (char === '/' && next === '/') {
      state = 'lineComment';
      i += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      state = 'blockComment';
      i += 1;
      continue;
    }

    if (char === "'") {
      state = 'singleQuote';
      continue;
    }

    if (char === '"') {
      state = 'doubleQuote';
      continue;
    }

    if (char === '`') {
      state = 'template';
    }
  }

  return findings;
}

function main() {
  const files = [];
  walk(ROOT, files);

  const allFindings = [];
  for (const file of files) {
    const findings = scanFile(file);
    for (const finding of findings) {
      allFindings.push({
        file: path.relative(ROOT, file),
        ...finding,
      });
    }
  }

  if (allFindings.length === 0) {
    console.log('No suspicious unescaped apostrophes found in single-quoted strings.');
    return;
  }

  console.error('Suspicious unescaped apostrophes found in single-quoted strings:');
  for (const finding of allFindings) {
    console.error(`- ${finding.file}:${finding.line}:${finding.column} ${finding.lineText}`);
  }
  process.exitCode = 1;
}

main();
