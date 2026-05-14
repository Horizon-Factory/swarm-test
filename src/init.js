import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, relative, basename } from 'path';
import { execSync } from 'child_process';
import { glob } from 'glob';
import chalk from 'chalk';
import ora from 'ora';
import {
  paths, PROJECT_ROOT, PACKAGE_ROOT,
  ensureDir, readJson, writeJson, writeText, readText,
  log, ok, warn, checkClaudeCLI,
} from './utils.js';

const CRITICAL_KEYWORDS = [
  'login', 'logout', 'register', 'signup', 'signin', 'sign-in', 'sign-up',
  'checkout', 'payment', 'cart', 'pay',
  'form', 'submit',
  'onboarding', 'dashboard', 'profile', 'settings', 'account',
];

function detectFramework() {
  const pkgPath = join(PROJECT_ROOT, 'package.json');
  if (!existsSync(pkgPath)) return { name: 'unknown', deps: {} };
  const pkg = readJson(pkgPath, {});
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps.next) return { name: 'next', version: deps.next, deps };
  if (deps.nuxt || deps['nuxt3']) return { name: 'nuxt', version: deps.nuxt || deps['nuxt3'], deps };
  if (deps['@angular/core']) return { name: 'angular', version: deps['@angular/core'], deps };
  if (deps['@sveltejs/kit'] || deps.svelte) return { name: 'svelte', version: deps['@sveltejs/kit'] || deps.svelte, deps };
  if (deps.vue) return { name: 'vue', version: deps.vue, deps };
  if (deps.react) return { name: 'react', version: deps.react, deps };
  return { name: 'unknown', deps };
}

function detectTargetUrl() {
  // local-first default: always start with localhost, the swarm targets dev by default
  const files = ['.env.local', '.env.development', '.env'];
  const keys = ['TARGET_URL', 'APP_URL', 'BASE_URL', 'NEXT_PUBLIC_SITE_URL', 'PUBLIC_SITE_URL', 'VITE_BASE_URL', 'NUXT_PUBLIC_SITE_URL'];
  for (const file of files) {
    const p = join(PROJECT_ROOT, file);
    if (!existsSync(p)) continue;
    for (const line of readText(p).split('\n')) {
      const [k, ...rest] = line.split('=');
      const v = rest.join('=').trim().replace(/^["']|["']$/g, '');
      if (keys.includes(k?.trim()) && /^https?:\/\//.test(v)) return v;
    }
  }
  return null;
}

function detectDevPort() {
  const pkg = readJson(join(PROJECT_ROOT, 'package.json'), {});
  const dev = (pkg.scripts || {}).dev || '';
  const m = dev.match(/-p\s+(\d+)|--port[=\s]+(\d+)/);
  if (m) return parseInt(m[1] || m[2], 10);
  return 3000;
}

function detectRoutes(framework) {
  const dirs = ({
    next:    ['app', 'pages', 'src/app', 'src/pages'],
    nuxt:    ['pages', 'src/pages'],
    react:   ['src/pages', 'src/routes', 'src/views', 'pages'],
    vue:     ['src/views', 'src/pages', 'pages'],
    svelte:  ['src/routes'],
    angular: ['src/app'],
  }[framework]) || ['src/pages', 'pages', 'app', 'src/app', 'src/routes', 'src/views'];

  const found = [];
  for (const d of dirs) {
    const abs = join(PROJECT_ROOT, d);
    if (!existsSync(abs)) continue;
    const files = glob.sync('**/*.{js,jsx,ts,tsx,vue,svelte}', {
      cwd: abs,
      ignore: ['**/node_modules/**', '**/_*', '**/api/**'],
      nodir: true,
    });
    for (const f of files) {
      let route = '/' + f
        .replace(/\.(jsx?|tsx?|vue|svelte)$/, '')
        .replace(/\/(index|page|\+page)$/, '')
        .replace(/^index$/, '')
        .replace(/\[([^\]]+)\]/g, ':$1');
      if (route === '/') route = '/';
      else route = route.replace(/\/$/, '');
      found.push({ route: route || '/', source: relative(PROJECT_ROOT, join(abs, f)) });
    }
    if (found.length > 0) break;
  }
  const unique = new Map();
  for (const r of found) unique.set(r.route, r);
  return Array.from(unique.values());
}

function detectFlowsFromRoutes(routes) {
  const flows = new Map();
  for (const r of routes) {
    const path = r.route.toLowerCase();
    for (const kw of CRITICAL_KEYWORDS) {
      if (path.includes(kw)) {
        if (!flows.has(kw)) flows.set(kw, { name: kw, routes: [], sources: [] });
        flows.get(kw).routes.push(r.route);
        flows.get(kw).sources.push(r.source);
        break;
      }
    }
  }
  return Array.from(flows.values());
}

function detectFlowsFromSource() {
  const files = glob.sync('**/*.{js,jsx,ts,tsx,vue,svelte}', {
    cwd: PROJECT_ROOT,
    ignore: [
      '**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**',
      '**/.nuxt/**', '**/.svelte-kit/**', '**/coverage/**',
    ],
    nodir: true,
  }).slice(0, 800);

  const flows = new Map();
  for (const f of files) {
    let content;
    try { content = readFileSync(join(PROJECT_ROOT, f), 'utf8').toLowerCase(); } catch { continue; }
    for (const kw of CRITICAL_KEYWORDS) {
      if (content.includes(kw)) {
        if (!flows.has(kw)) flows.set(kw, { name: kw, routes: [], sources: [] });
        const list = flows.get(kw).sources;
        if (list.length < 20 && !list.includes(f)) list.push(f);
      }
    }
  }
  return Array.from(flows.values());
}

function recentGitLog() {
  try {
    return execSync('git log --oneline -50', {
      cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return '';
  }
}

function gitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch { return 'unknown'; }
}

function copyPackageFile(rel, dest) {
  const src = join(PACKAGE_ROOT, rel);
  if (!existsSync(src)) throw new Error(`Missing package file: ${rel}`);
  writeText(dest, readFileSync(src, 'utf8'));
}

function fillTemplate(tplRel, vars) {
  let txt = readFileSync(join(PACKAGE_ROOT, tplRel), 'utf8');
  for (const [k, v] of Object.entries(vars)) {
    txt = txt.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
  }
  return txt;
}

function updateGitignore() {
  const gi = join(PROJECT_ROOT, '.gitignore');
  const block = [
    '',
    '# swarm-test (runtime artifacts only — config, agents, memory, goldens are committed)',
    '.swarm-test/screenshots/',
    '.swarm-test/results/',
    '.swarm-test/runs/',
    '',
  ].join('\n');
  const current = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  if (current.includes('.swarm-test/screenshots')) return;
  writeFileSync(gi, current + block);
}

async function promptUrl(defaultUrl) {
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(res =>
    rl.question(chalk.cyan('? ') + `Target URL (default ${defaultUrl}): `, a => {
      rl.close();
      res(a.trim() || defaultUrl);
    })
  );
  return answer;
}

export async function init() {
  try { checkClaudeCLI(); } catch (e) {
    console.error(chalk.red('✗'), e.message);
    process.exit(1);
  }

  const spinner = ora('Detecting project').start();
  const framework = detectFramework();
  spinner.text = `Framework: ${framework.name}`;
  const port = detectDevPort();
  const localDefault = `http://localhost:${port}`;
  let targetUrl = detectTargetUrl() || localDefault;
  spinner.stop();

  if (process.env.SWARM_TEST_PROMPT_URL === '1') targetUrl = await promptUrl(localDefault);

  const sp2 = ora('Detecting routes and flows').start();
  const routes = detectRoutes(framework.name);
  let flows = detectFlowsFromRoutes(routes);
  if (flows.length === 0) flows = detectFlowsFromSource();
  sp2.succeed(`${routes.length} routes, ${flows.length} flows detected`);

  for (const dir of [
    paths.swarmDir, paths.agents, paths.flows, paths.screenshots,
    paths.goldens, paths.results, paths.memory, paths.agentVersions, paths.runs,
  ]) ensureDir(dir);

  const branch = gitBranch();
  const recent = recentGitLog();

  const pkg = readJson(join(PROJECT_ROOT, 'package.json'), {});
  const devScript = (pkg.scripts || {}).dev || null;

  const config = {
    project_name: basename(PROJECT_ROOT),
    framework: framework.name,
    framework_version: framework.version || null,
    target_url: targetUrl,
    dev_script: devScript,
    dev_port: port,
    routes: routes.map(r => r.route),
    flows: flows.map(f => f.name),
    models: {
      orchestrator: 'sonnet',
      e2e: 'sonnet',
      analyst: 'opus',
      regression: 'haiku',
      improver: 'opus',
    },
    concurrency: 3,
    created_at: new Date().toISOString(),
    git_branch: branch,
  };
  writeJson(paths.config, config);

  const flowMap = {};
  for (const f of flows) flowMap[f.name] = { sources: f.sources, routes: f.routes };
  writeJson(paths.flowMap, flowMap);

  if (!existsSync(paths.falsePositives)) {
    writeJson(paths.falsePositives, { patterns: [], updated_at: new Date().toISOString() });
  }
  if (!existsSync(paths.confirmedPatterns)) {
    writeJson(paths.confirmedPatterns, { patterns: [], updated_at: new Date().toISOString() });
  }
  if (!existsSync(paths.flowHistory)) {
    writeJson(paths.flowHistory, { runs: [] });
  }

  if (!existsSync(paths.claudeMd)) {
    writeText(paths.claudeMd, fillTemplate('templates/CLAUDE.md.template', {
      PROJECT_NAME: config.project_name,
      FRAMEWORK: config.framework,
      TARGET_URL: config.target_url,
      FLOWS_LIST: flows.length ? flows.map(f => `- ${f.name}`).join('\n') : '- (none detected — add manually)',
      ROUTES_LIST: routes.slice(0, 30).map(r => `- ${r.route}`).join('\n') || '- (none)',
      GIT_RECENT: recent.slice(0, 2000) || '(no git history)',
    }));
  }

  for (const f of flows) {
    const flowFile = join(paths.flows, `${f.name}.md`);
    if (existsSync(flowFile)) continue;
    writeText(flowFile, fillTemplate('templates/flow.md.template', {
      FLOW_NAME: f.name,
      TARGET_URL: targetUrl,
      ENTRY_ROUTES: f.routes.length ? f.routes.map(r => `- ${r}`).join('\n') : '- (specify the entry URL for this flow)',
      SOURCES: f.sources.slice(0, 5).map(s => `- ${s}`).join('\n') || '- (none detected)',
    }));
  }

  if (!existsSync(paths.playwrightConfig)) {
    writeText(paths.playwrightConfig, fillTemplate('templates/playwright.config.template.ts', {
      TARGET_URL: targetUrl,
    }));
  }

  for (const agent of ['orchestrator', 'e2e-agent', 'business-analyst', 'regression-agent', 'self-improver']) {
    const dest = join(paths.agents, `${agent}.md`);
    if (!existsSync(dest)) copyPackageFile(`agents/${agent}.md`, dest);
  }

  if (!existsSync(paths.learnedRules)) {
    writeText(
      paths.learnedRules,
      '# Learned business rules\n\n_Auto-managed by `swarm-test learn`. Confirmed patterns from user feedbacks accumulate here._\n\n'
    );
  }

  updateGitignore();

  console.log('');
  ok(`Detected: framework ${chalk.bold(config.framework)}, ${chalk.bold(flows.length)} critical flows, target ${chalk.bold(targetUrl)}.`);
  log(`Edit ${chalk.cyan('.swarm-test/CLAUDE.md')} with your business rules, refine ${chalk.cyan('.swarm-test/flows/*.md')}.`);
  log(`Local dev loop: ${chalk.cyan('swarm-test dev')} (auto-start dev server + test impacted flows only).`);
  log(`Full review: ${chalk.cyan('swarm-test run')}.`);
}
