#!/usr/bin/env node
/**
 * Detects the project's dev command + port, probes the target URL, and
 * reports whether the dev server is ready. Does NOT spawn the server —
 * server lifecycle is the user's concern.
 *
 * Output: a single JSON object on stdout.
 *   - { ready: true,  url: "http://localhost:3000" }
 *   - { ready: false, url: "...", suggested_command: "pnpm run dev", suggested_cwd: "...", hint: "..." }
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

function findUp(name, start) {
  let dir = start;
  const stop = homedir();
  while (true) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
    if (dir === stop || dir === '/') return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function detectPackageManager(projectDir) {
  if (existsSync(join(projectDir, 'pnpm-lock.yaml')) || findUp('pnpm-lock.yaml', projectDir)) return 'pnpm';
  if (existsSync(join(projectDir, 'yarn.lock'))     || findUp('yarn.lock', projectDir))     return 'yarn';
  if (existsSync(join(projectDir, 'bun.lockb'))     || findUp('bun.lockb', projectDir))     return 'bun';
  const pkgPath = findUp('package.json', projectDir);
  if (pkgPath) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg.packageManager) return pkg.packageManager.split('@')[0];
    } catch {}
  }
  return 'npm';
}

function detectDev() {
  const pkgPath = findUp('package.json', process.cwd());
  if (!pkgPath) return null;
  let pkg;
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { return null; }
  const script = pkg.scripts?.dev;
  if (!script) return null;
  const cwd = dirname(pkgPath);
  const pm = detectPackageManager(cwd);
  const m = script.match(/(?:-p|--port)[=\s]+(\d+)/);
  const port = m ? parseInt(m[1], 10) : 3000;
  return { command: `${pm} run dev`, cwd, port };
}

async function probe(url, timeoutMs = 2500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { method: 'GET', signal: ctrl.signal });
    clearTimeout(t);
    return r.status < 500;
  } catch { return false; }
}

async function main() {
  const dev = detectDev();
  const url =
    process.env.SWARM_TARGET_URL ||
    (dev ? `http://localhost:${dev.port}` : 'http://localhost:3000');

  if (await probe(url)) {
    console.log(JSON.stringify({ ready: true, url }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    ready: false,
    url,
    suggested_command: dev?.command || 'npm run dev',
    suggested_cwd: dev?.cwd || process.cwd(),
    hint: 'Server is not responding. Ask the user to run the suggested command in another terminal, wait for it to be ready, then say "go".',
  }, null, 2));
  process.exit(2);
}

main().catch(e => {
  console.error(JSON.stringify({ ready: false, error: e.message }));
  process.exit(1);
});
