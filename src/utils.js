import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { homedir } from 'os';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = resolve(__dirname, '..');
export const PROJECT_ROOT = process.cwd();
export const SWARM_DIR = join(PROJECT_ROOT, '.swarm-test');

export const paths = {
  swarmDir: SWARM_DIR,
  claudeMd: join(SWARM_DIR, 'CLAUDE.md'),
  config: join(SWARM_DIR, 'config.json'),
  playwrightConfig: join(SWARM_DIR, 'playwright.config.ts'),
  agents: join(SWARM_DIR, 'agents'),
  flows: join(SWARM_DIR, 'flows'),
  screenshots: join(SWARM_DIR, 'screenshots'),
  goldens: join(SWARM_DIR, 'goldens'),
  results: join(SWARM_DIR, 'results'),
  memory: join(SWARM_DIR, 'memory'),
  runs: join(SWARM_DIR, 'runs'),
  feedback: join(SWARM_DIR, 'memory', 'feedback.jsonl'),
  falsePositives: join(SWARM_DIR, 'memory', 'false-positives.json'),
  confirmedPatterns: join(SWARM_DIR, 'memory', 'confirmed-patterns.json'),
  flowHistory: join(SWARM_DIR, 'memory', 'flow-history.json'),
  flowMap: join(SWARM_DIR, 'memory', 'flow-map.json'),
  learnedRules: join(SWARM_DIR, 'memory', 'learned-rules.md'),
  agentVersions: join(SWARM_DIR, 'memory', 'agent-versions'),
};

export function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

export function readJson(p, fallback = null) {
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(p, data) {
  ensureDir(dirname(p));
  writeFileSync(p, JSON.stringify(data, null, 2));
}

export function readText(p, fallback = '') {
  return existsSync(p) ? readFileSync(p, 'utf8') : fallback;
}

export function writeText(p, content) {
  ensureDir(dirname(p));
  writeFileSync(p, content);
}

export function loadConfig() {
  const cfg = readJson(paths.config);
  if (!cfg) {
    throw new Error('.swarm-test/config.json not found. Run `swarm-test init` first.');
  }
  return cfg;
}

export function loadAgentPrompt(name) {
  const local = join(paths.agents, `${name}.md`);
  if (existsSync(local)) return readFileSync(local, 'utf8');
  const fallback = join(PACKAGE_ROOT, 'agents', `${name}.md`);
  if (existsSync(fallback)) return readFileSync(fallback, 'utf8');
  throw new Error(`Agent prompt not found: ${name}`);
}

export function checkClaudeCLI() {
  try {
    execSync('claude --version', { stdio: 'ignore' });
    return true;
  } catch {
    throw new Error('`claude` CLI not found in PATH. Install Claude Code first: https://claude.com/claude-code');
  }
}

export function gitInfo() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    const commit = execSync('git rev-parse --short HEAD', { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    return { branch, commit };
  } catch {
    return { branch: 'unknown', commit: 'unknown' };
  }
}

export function detectPackageManager(startDir = PROJECT_ROOT) {
  let dir = startDir;
  const stop = homedir();
  while (true) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = readJson(pkgPath, {});
      if (pkg.packageManager) {
        return pkg.packageManager.split('@')[0];
      }
    }
    if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(dir, 'yarn.lock')))      return 'yarn';
    if (existsSync(join(dir, 'bun.lockb')))      return 'bun';
    if (existsSync(join(dir, 'package-lock.json'))) return 'npm';
    if (dir === stop || dir === '/' || !dir) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'npm';
}

export function collectClaudeMdAncestors(startDir = PROJECT_ROOT) {
  const found = [];
  const stop = homedir();
  let dir = startDir;
  while (true) {
    const f = join(dir, 'CLAUDE.md');
    if (existsSync(f) && !found.includes(f)) found.unshift(f);
    if (dir === stop || dir === '/' || !dir) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return found;
}

export function buildProjectContext() {
  const ancestors = collectClaudeMdAncestors(PROJECT_ROOT);
  const parts = [];
  for (const f of ancestors) {
    if (f === paths.claudeMd) continue;
    const rel = relative(PROJECT_ROOT, f) || f;
    parts.push(`<!-- file: ${rel} -->\n${readText(f)}`);
  }
  const swarmCtx = readText(paths.claudeMd, '');
  if (swarmCtx) parts.push(`<!-- file: .swarm-test/CLAUDE.md (swarm-specific) -->\n${swarmCtx}`);
  return parts.join('\n\n---\n\n');
}

export function log(msg)  { console.log(chalk.cyan('›'), msg); }
export function ok(msg)   { console.log(chalk.green('✓'), msg); }
export function warn(msg) { console.log(chalk.yellow('⚠'), msg); }
export function err(msg)  { console.log(chalk.red('✗'), msg); }
