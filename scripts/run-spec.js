#!/usr/bin/env node
/**
 * Run a single Playwright spec, return a JSON summary on stdout.
 *
 * Usage:
 *   node run-spec.js <path/to/spec.ts>
 *
 * Output JSON:
 *   { ok, exit_code, stdout, stderr, command }
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

const specPath = process.argv[2];
if (!specPath) {
  console.error(JSON.stringify({ error: 'Usage: run-spec.js <spec-path>' }));
  process.exit(1);
}
const abs = resolve(specPath);
if (!existsSync(abs)) {
  console.error(JSON.stringify({ error: `Spec file not found: ${abs}` }));
  process.exit(1);
}

const args = ['playwright', 'test', abs, '--reporter=line'];
const res = spawnSync('npx', args, {
  encoding: 'utf8',
  cwd: process.cwd(),
  env: process.env,
  maxBuffer: 50 * 1024 * 1024,
});

const out = {
  ok: res.status === 0,
  exit_code: res.status,
  command: `npx ${args.join(' ')}`,
  stdout: (res.stdout || '').slice(-8000),
  stderr: (res.stderr || '').slice(-4000),
};
console.log(JSON.stringify(out, null, 2));
process.exit(res.status || 0);
