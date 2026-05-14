import { execSync } from 'child_process';
import chalk from 'chalk';
import { paths, readJson, log, warn } from './utils.js';
import { run } from './runner.js';

function changedFiles() {
  const tryCmds = [
    'git diff HEAD~1 HEAD --name-only',
    'git diff --name-only HEAD',
    'git diff --name-only',
  ];
  for (const cmd of tryCmds) {
    try {
      const out = execSync(cmd, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim().split('\n').filter(Boolean);
      if (out.length > 0) return out;
    } catch {}
  }
  return [];
}

function isMatch(changed, source) {
  if (changed === source) return true;
  if (changed.endsWith('/' + source) || source.endsWith('/' + changed)) return true;
  if (changed.includes(source) || source.includes(changed)) return true;
  return false;
}

export async function diff(opts = {}) {
  const files = changedFiles();
  if (files.length === 0) {
    warn('No changed files detected.');
    return;
  }
  const flowMap = readJson(paths.flowMap, {});
  if (Object.keys(flowMap).length === 0) {
    warn('Flow map empty. Run `swarm-test init` first.');
    return;
  }

  const impacted = new Set();
  for (const [flow, info] of Object.entries(flowMap)) {
    for (const src of (info.sources || [])) {
      if (files.some(f => isMatch(f, src))) {
        impacted.add(flow);
        break;
      }
    }
  }

  if (impacted.size === 0) {
    log(`${files.length} file(s) changed, no mapped flow impacted.`);
    return;
  }

  console.log(chalk.bold(`${files.length} file(s) changed, ${impacted.size} flow(s) impacted:`));
  for (const f of impacted) console.log(`  • ${f}`);

  if (opts.auto) {
    console.log('');
    await run({ flows: Array.from(impacted).join(',') });
  } else {
    console.log('');
    log(`Run only the impacted flows: ${chalk.cyan(`npx swarm-test run --flows=${Array.from(impacted).join(',')}`)}`);
  }
}
