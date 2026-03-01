const fs = require('fs');
const path = require('path');

const DATASOURCE_FILENAME = 'typeorm.datasource.js';

function collectFiles(rootDir) {
  const files = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile()) files.push(fullPath);
    }
  }

  return files;
}

function resolveCompiledDatasourcePath(cwd = process.cwd()) {
  const distDir = path.resolve(cwd, 'dist');
  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
    throw new Error('Missing dist directory. Run `npm run build` first.');
  }

  const preferred = [
    path.join(distDir, 'src', 'database', DATASOURCE_FILENAME),
    path.join(distDir, 'database', DATASOURCE_FILENAME),
  ];

  for (const candidate of preferred) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  const matches = collectFiles(distDir).filter(
    (file) => path.basename(file) === DATASOURCE_FILENAME,
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw new Error(
      `Ambiguous compiled datasource path. Found ${matches.length} matches: ${matches.join(', ')}`,
    );
  }

  throw new Error(
    `Compiled datasource not found in dist. Expected ${DATASOURCE_FILENAME}.`,
  );
}

module.exports = {
  resolveCompiledDatasourcePath,
};
