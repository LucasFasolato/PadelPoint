#!/usr/bin/env node
/* eslint-disable no-console */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm' : 'npm';

function runOrThrow(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: isWin && command === 'npm',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Command failed (${result.status}): ${command} ${args.join(' ')}`,
    );
  }
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    shell: isWin && command === 'npm',
    ...options,
  });
  return result;
}

function hasDocker() {
  const result = runCapture('docker', ['--version']);
  return !result.error && result.status === 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDockerPg(containerName) {
  for (let i = 0; i < 60; i += 1) {
    const result = runCapture('docker', [
      'exec',
      containerName,
      'pg_isready',
      '-U',
      'postgres',
    ]);
    if (result.status === 0) return;
    await sleep(1000);
  }
  throw new Error('Timed out waiting for dockerized postgres');
}

function findPgBinDir() {
  const fromEnv = process.env.PG_BIN_DIR;
  if (fromEnv) {
    return fromEnv;
  }

  if (isWin) {
    const candidates = [];
    for (let version = 18; version >= 12; version -= 1) {
      candidates.push(`C:\\Program Files\\PostgreSQL\\${version}\\bin`);
    }
    for (const candidate of candidates) {
      const initdb = path.join(candidate, 'initdb.exe');
      const pgCtl = path.join(candidate, 'pg_ctl.exe');
      const createdb = path.join(candidate, 'createdb.exe');
      const shareBki = path.join(
        path.dirname(candidate),
        'share',
        'postgres.bki',
      );
      if (
        fs.existsSync(initdb) &&
        fs.existsSync(pgCtl) &&
        fs.existsSync(createdb) &&
        fs.existsSync(shareBki)
      ) {
        return candidate;
      }
    }
    return null;
  }

  const okInitdb = runCapture('initdb', ['--version']);
  const okPgCtl = runCapture('pg_ctl', ['--version']);
  const okCreatedb = runCapture('createdb', ['--version']);
  if (
    okInitdb.status === 0 &&
    okPgCtl.status === 0 &&
    okCreatedb.status === 0
  ) {
    return '';
  }
  return null;
}

function joinExe(pgBinDir, exeName) {
  return pgBinDir ? path.join(pgBinDir, exeName) : exeName;
}

function randomSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function verifyWithDocker(repoRoot) {
  const suffix = randomSuffix();
  const containerName = `padelpoint-mig-${suffix}`;
  const dbName = `padelpoint_verify_${suffix}`;
  const port = 56000 + Math.floor(Math.random() * 1000);
  const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${port}/${dbName}`;

  try {
    runOrThrow('docker', [
      'run',
      '-d',
      '--name',
      containerName,
      '-e',
      'POSTGRES_USER=postgres',
      '-e',
      'POSTGRES_PASSWORD=postgres',
      '-e',
      `POSTGRES_DB=${dbName}`,
      '-p',
      `${port}:5432`,
      'postgres:17',
    ]);

    await waitForDockerPg(containerName);

    runOrThrow(npmCmd, ['run', 'build'], { cwd: repoRoot });
    runOrThrow(npmCmd, ['run', 'migration:run'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
    });
  } finally {
    runCapture('docker', ['rm', '-f', containerName]);
  }
}

function verifyWithExistingDatabase(repoRoot) {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'Docker is unavailable and DATABASE_URL is not set for fallback verification.',
    );
  }

  runOrThrow(npmCmd, ['run', 'build'], { cwd: repoRoot });
  runOrThrow(npmCmd, ['run', 'migration:run'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL,
    },
  });
}

function verifyWithLocalPgCluster(repoRoot, pgBinDir) {
  const suffix = randomSuffix();
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `padelpoint-mig-${suffix}-`),
  );
  const logFile = path.join(dataDir, 'postgres.log');
  const dbName = `padelpoint_verify_${suffix}`;
  const port = 57000 + Math.floor(Math.random() * 1000);

  const initdb = joinExe(pgBinDir, isWin ? 'initdb.exe' : 'initdb');
  const pgCtl = joinExe(pgBinDir, isWin ? 'pg_ctl.exe' : 'pg_ctl');
  const createdb = joinExe(pgBinDir, isWin ? 'createdb.exe' : 'createdb');
  const databaseUrl = `postgres://postgres@127.0.0.1:${port}/${dbName}`;

  let started = false;
  try {
    runOrThrow(initdb, ['-D', dataDir, '-U', 'postgres', '-A', 'trust']);
    runOrThrow(pgCtl, [
      '-D',
      dataDir,
      '-l',
      logFile,
      '-o',
      `-p ${port}`,
      'start',
    ]);
    started = true;

    runOrThrow(createdb, ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', dbName]);

    runOrThrow(npmCmd, ['run', 'build'], { cwd: repoRoot });
    runOrThrow(npmCmd, ['run', 'migration:run'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
    });
  } finally {
    if (started) {
      runCapture(pgCtl, ['-D', dataDir, 'stop']);
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function main() {
  const repoRoot = process.cwd();

  if (hasDocker()) {
    console.log(
      '[verify-migrations] Docker detected. Running clean-db verification in container.',
    );
    await verifyWithDocker(repoRoot);
    console.log('[verify-migrations] OK');
    return;
  }

  const pgBinDir = findPgBinDir();
  if (pgBinDir) {
    console.log(
      '[verify-migrations] Docker unavailable. Using temporary local PostgreSQL cluster fallback.',
    );
    verifyWithLocalPgCluster(repoRoot, pgBinDir);
    console.log('[verify-migrations] OK');
    return;
  }

  console.log(
    '[verify-migrations] Docker unavailable. Using DATABASE_URL fallback.',
  );
  verifyWithExistingDatabase(repoRoot);
  console.log('[verify-migrations] OK');
}

main().catch((error) => {
  console.error('[verify-migrations] FAILED');
  console.error(error.message);
  process.exit(1);
});
