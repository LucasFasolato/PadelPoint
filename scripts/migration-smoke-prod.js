const path = require('path');
const { spawnSync } = require('child_process');
const { resolveCompiledDatasourcePath } = require('./resolve-compiled-datasource');

let datasourcePath;
try {
  datasourcePath = resolveCompiledDatasourcePath();
} catch (err) {
  const message = err instanceof Error ? err.message : 'unknown_error';
  console.error(`[error] ${message}`);
  process.exit(1);
}

const relativeDatasourcePath = path.relative(process.cwd(), datasourcePath);
console.log(`[smoke] Compiled datasource resolved: ${relativeDatasourcePath}`);

if (!process.env.DATABASE_URL) {
  console.log(
    '[smoke] DATABASE_URL is not set; skipping migration:show connection check.',
  );
  process.exit(0);
}

const cliPath = path.resolve(__dirname, '..', 'node_modules', 'typeorm', 'cli.js');
const result = spawnSync(
  'node',
  [cliPath, '-d', datasourcePath, 'migration:show'],
  {
    stdio: 'inherit',
    env: process.env,
  },
);

if (result.error) {
  console.error(`[error] migration smoke failed: ${result.error.message}`);
  process.exit(1);
}

process.exit(typeof result.status === 'number' ? result.status : 1);
