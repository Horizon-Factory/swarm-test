import { spawn, execSync } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import {
  paths, loadConfig, readJson,
  log, ok, warn, err, checkClaudeCLI,
} from './utils.js';
import { run } from './runner.js';

function uncommittedFiles() {
  const all = new Set();
  const cmds = [
    'git diff --name-only',
    'git diff --cached --name-only',
    'git ls-files --others --exclude-standard',
  ];
  for (const cmd of cmds) {
    try {
      const out = execSync(cmd, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim();
      for (const line of out.split('\n')) if (line) all.add(line);
    } catch {}
  }
  if (all.size === 0) {
    try {
      const out = execSync('git diff HEAD~1 HEAD --name-only', {
        cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
      for (const line of out.split('\n')) if (line) all.add(line);
    } catch {}
  }
  return Array.from(all);
}

function isMatch(changed, source) {
  if (changed === source) return true;
  if (changed.endsWith('/' + source) || source.endsWith('/' + changed)) return true;
  if (changed.includes(source) || source.includes(changed)) return true;
  return false;
}

function impactedFlows(files) {
  const flowMap = readJson(paths.flowMap, {});
  const impacted = new Set();
  for (const [flow, info] of Object.entries(flowMap)) {
    for (const src of (info.sources || [])) {
      if (files.some(f => isMatch(f, src))) {
        impacted.add(flow);
        break;
      }
    }
  }
  return Array.from(impacted);
}

async function waitForUrl(url, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.status < 500) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

function startDevServer(devScript, devPort) {
  const parts = devScript.split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  const proc = spawn(cmd, args, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, PORT: String(devPort), FORCE_COLOR: '0' },
  });

  proc.stdout?.on('data', () => {});
  proc.stderr?.on('data', () => {});
  proc.on('error', e => {
    err(`Dev server spawn failed: ${e.message}`);
  });

  return proc;
}

function killDevServer(proc) {
  if (!proc || proc.killed) return;
  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    try { proc.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => {
    try { process.kill(-proc.pid, 'SIGKILL'); } catch {
      try { proc.kill('SIGKILL'); } catch {}
    }
  }, 3000).unref();
}

export async function dev(opts = {}) {
  checkClaudeCLI();
  const config = loadConfig();
  const url = config.target_url;

  let flows;
  if (opts.all) {
    flows = config.flows;
    log(`Running all ${flows.length} flows (--all)`);
  } else if (opts.flows) {
    flows = opts.flows.split(',').map(s => s.trim()).filter(Boolean);
    log(`Running ${flows.length} requested flow(s)`);
  } else {
    const files = uncommittedFiles();
    if (files.length === 0) {
      warn('No uncommitted changes detected.');
      log(`Use ${chalk.cyan('--all')} to run every flow, or ${chalk.cyan('--flows=a,b')} to pick.`);
      return;
    }
    flows = impactedFlows(files);
    if (flows.length === 0) {
      warn(`${files.length} file(s) changed, but none map to a known flow.`);
      log(`Use ${chalk.cyan('--all')} or refine ${chalk.cyan('.swarm-test/memory/flow-map.json')}.`);
      return;
    }
    log(`${files.length} file(s) changed → ${flows.length} impacted flow(s): ${flows.join(', ')}`);
  }

  let devProc = null;
  // commander turns --no-start into opts.start === false; default is undefined/true
  const skipStart = opts.start === false;
  if (!skipStart) {
    if (!config.dev_script) {
      warn('No dev_script in config.json. Skipping auto-start — make sure your server is already running.');
    } else {
      const spinner = ora(`Starting dev server: ${config.dev_script}`).start();
      devProc = startDevServer(config.dev_script, config.dev_port || 3000);

      const ready = await waitForUrl(url, 90_000);
      if (!ready) {
        spinner.fail(`Dev server did not respond on ${url} within 90s`);
        killDevServer(devProc);
        process.exit(1);
      }
      spinner.succeed(`Dev server ready on ${url}`);
    }
  }

  const cleanup = () => killDevServer(devProc);
  process.on('SIGINT',  () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  try {
    await run({ flows: flows.join(','), quick: !opts.full });
  } finally {
    cleanup();
  }
}
