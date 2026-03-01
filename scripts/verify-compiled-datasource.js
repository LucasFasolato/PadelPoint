const path = require('path');
const { resolveCompiledDatasourcePath } = require('./resolve-compiled-datasource');

try {
  const datasourcePath = resolveCompiledDatasourcePath();
  const relative = path.relative(process.cwd(), datasourcePath);
  console.log(`[ok] Compiled TypeORM datasource found: ${relative}`);
} catch (err) {
  const message = err instanceof Error ? err.message : 'unknown_error';
  console.error(`[error] ${message}`);
  process.exit(1);
}
