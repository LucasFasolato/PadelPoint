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

const cliPath = path.resolve(__dirname, '..', 'node_modules', 'typeorm', 'cli.js');
const args = ['-d', datasourcePath, ...process.argv.slice(2)];

console.log(
  `[typeorm:prod] datasource=${path.relative(process.cwd(), datasourcePath)}`,
);

const result = spawnSync('node', [cliPath, ...args], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(
    `[error] Unable to execute TypeORM CLI: ${result.error.message}`,
  );
  process.exit(1);
}

process.exit(typeof result.status === 'number' ? result.status : 1);
