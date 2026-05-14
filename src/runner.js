import { join } from 'path';
import { v4 as uuid } from 'uuid';
import { existsSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import {
  paths, ensureDir, loadConfig, loadAgentPrompt,
  readJson, writeJson, readText,
  gitInfo, log, ok, warn, err, checkClaudeCLI,
} from './utils.js';
import { runAgent } from './claude.js';

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

async function runE2E({ flow, config, runId, runDir }) {
  const flowSpec = readText(join(paths.flows, `${flow}.md`));
  const claudeMd = readText(paths.claudeMd);
  const learnedRules = readText(paths.learnedRules);

  const systemPrompt = loadAgentPrompt('e2e-agent');
  const screenshotDir = join(paths.screenshots, runId, flow);
  ensureDir(screenshotDir);

  const userPrompt = [
    '# Project context',
    claudeMd,
    learnedRules,
    `# Flow to test: ${flow}`,
    flowSpec,
    '# Runtime context',
    `- Target URL: ${config.target_url}`,
    `- Run id: ${runId}`,
    `- Screenshot directory (use this exact path): ${screenshotDir}`,
    `- Playwright config: ${paths.playwrightConfig}`,
    `- Working directory for the spec: ${runDir}`,
    '# Your task',
    `1. Write a Playwright TypeScript spec at ${runDir}/${flow}.spec.ts that exercises this flow against ${config.target_url}.`,
    `2. Take a screenshot at every meaningful step with: page.screenshot({ path: '${screenshotDir}/{stepId}-{label}.png', fullPage: false })`,
    `3. Run it via Bash: npx playwright test ${runDir}/${flow}.spec.ts --config=${paths.playwrightConfig} --reporter=line`,
    '4. If a step fails, retry it once with a corrected selector or timing; never abort the whole flow.',
    '5. Capture per-step status, error message and duration_ms.',
    '6. Return the result JSON as described.',
  ].join('\n\n');

  const outputFile = join(paths.results, runId, `e2e-${flow}.json`);
  return runAgent({
    systemPrompt,
    userPrompt,
    model: config.models.e2e,
    outputFile,
    cwd: process.cwd(),
    timeoutMs: 15 * 60_000,
  });
}

async function runAnalyst({ flow, config, runId }) {
  const flowSpec = readText(join(paths.flows, `${flow}.md`));
  const claudeMd = readText(paths.claudeMd);
  const learnedRules = readText(paths.learnedRules);
  const fp = readJson(paths.falsePositives, { patterns: [] });
  const confirmed = readJson(paths.confirmedPatterns, { patterns: [] });

  const screenshotDir = join(paths.screenshots, runId, flow);
  const screenshots = existsSync(screenshotDir)
    ? readdirSync(screenshotDir).filter(f => f.endsWith('.png')).sort().map(f => join(screenshotDir, f))
    : [];

  if (screenshots.length === 0) {
    const outputFile = join(paths.results, runId, `analyst-${flow}.json`);
    writeJson(outputFile, { flow, anomalies: [], note: 'no screenshots produced — skipping analysis' });
    return { flow, anomalies: [], note: 'skipped' };
  }

  const systemPrompt = loadAgentPrompt('business-analyst');

  const userPrompt = [
    '# Project context',
    claudeMd,
    learnedRules,
    `# Flow under analysis: ${flow}`,
    flowSpec,
    '# Memory',
    '## Known false-positive patterns (do NOT flag these)',
    JSON.stringify(fp.patterns, null, 2),
    '## Confirmed recurring patterns (be especially sensitive to these)',
    JSON.stringify(confirmed.patterns, null, 2),
    '# Screenshots to analyze',
    'Use the Read tool to view each screenshot, in order:',
    screenshots.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    '# Your task',
    'Walk through the screenshots in order. Produce a structured anomaly report covering wording, step ordering, business rules, dead ends, error messages, missing information, inconsistencies.',
  ].join('\n\n');

  const outputFile = join(paths.results, runId, `analyst-${flow}.json`);
  return runAgent({
    systemPrompt,
    userPrompt,
    model: config.models.analyst,
    outputFile,
    cwd: process.cwd(),
    timeoutMs: 15 * 60_000,
  });
}

function captureGoldens(currentRoot) {
  if (!existsSync(currentRoot)) return false;
  const flows = readdirSync(currentRoot);
  for (const flow of flows) {
    const src = join(currentRoot, flow);
    const dst = join(paths.goldens, flow);
    ensureDir(dst);
    for (const f of readdirSync(src)) {
      copyFileSync(join(src, f), join(dst, f));
    }
  }
  return true;
}

async function runRegression({ config, runId }) {
  const claudeMd = readText(paths.claudeMd);
  const currentRoot = join(paths.screenshots, runId);
  const goldensExist = existsSync(paths.goldens) && readdirSync(paths.goldens).length > 0;

  if (!goldensExist) {
    captureGoldens(currentRoot);
    return { regressions: [], first_run: true };
  }

  const systemPrompt = loadAgentPrompt('regression-agent');
  const userPrompt = [
    '# Project context',
    claudeMd,
    '# Your task',
    `Compare every screenshot in ${currentRoot}/<flow>/<step>.png against the matching golden in ${paths.goldens}/<flow>/<step>.png.`,
    'For each pair: run a pixel diff (use Bash). Try ImageMagick first:',
    '  compare -metric AE -fuzz 5% "<golden>" "<current>" /tmp/diff.png 2>&1 || true',
    'If ImageMagick is missing, fall back to Playwright snapshot comparison or use the Read tool to visually inspect both images.',
    'For every diff > 2% of pixels, use the Read tool on both images to judge whether it is a true regression, an intentional change, or needs human review.',
    'Return the JSON described in your system prompt.',
  ].join('\n\n');

  const outputFile = join(paths.results, runId, 'regression.json');
  return runAgent({
    systemPrompt,
    userPrompt,
    model: config.models.regression,
    outputFile,
    cwd: process.cwd(),
    timeoutMs: 15 * 60_000,
  });
}

function consolidate({ runId, config, flows, e2eResults, analystResults, regression, totalMs }) {
  const git = gitInfo();
  const workflows = flows.map((name, i) => {
    const e2e = e2eResults[i] || { steps: [], status: 'fail', duration: '0m 0s' };
    const analyst = analystResults[i] || { anomalies: [] };
    const flowRegressions = (regression.regressions || []).filter(r => (r.flux || r.flow) === name);

    const steps = (e2e.steps || []).map(step => {
      const stepAnomalies = (analyst.anomalies || []).filter(a => {
        const target = a['étape'] || a.etape || a.step;
        return target && (target === step.label || target === String(step.id));
      });
      const hasCritical = stepAnomalies.some(a => (a['sévérité'] || a.severite) === 'critique');
      return {
        id: step.id,
        label: step.label,
        agent: 'e2e',
        status: step.status === 'fail' ? 'fail' : (hasCritical ? 'warning' : (stepAnomalies.length > 0 ? 'warning' : (step.status || 'pass'))),
        screenshot: step.screenshot || '',
        note: step.note || '',
        duration_ms: step.duration_ms || 0,
        error: step.error || '',
        anomalies: stepAnomalies.map(a => ({
          ...a,
          fiabilité_historique: a['fiabilité_historique'] ?? 0,
          occurrences: a.occurrences ?? 0,
          verdicts_passés: a['verdicts_passés'] ?? [],
        })),
      };
    });

    const orphanAnomalies = (analyst.anomalies || []).filter(a => {
      const target = a['étape'] || a.etape || a.step;
      return !steps.some(s => s.label === target || String(s.id) === target);
    });
    if (orphanAnomalies.length > 0) {
      steps.push({
        id: steps.length + 1,
        label: '(flow-level)',
        agent: 'analyst',
        status: orphanAnomalies.some(a => (a['sévérité'] || a.severite) === 'critique') ? 'warning' : 'warning',
        screenshot: '',
        note: 'anomalies not bound to a specific step',
        duration_ms: 0,
        error: '',
        anomalies: orphanAnomalies,
      });
    }

    const anomalyCount = steps.reduce((s, st) => s + st.anomalies.length, 0);
    const anyFail = e2e.status === 'fail';
    const hasCritical = steps.some(s => s.anomalies.some(a => (a['sévérité'] || a.severite) === 'critique'));
    const status = anyFail ? 'fail' : hasCritical ? 'fail' : anomalyCount > 0 || flowRegressions.length > 0 ? 'warning' : 'pass';

    return {
      name,
      status,
      duration: e2e.duration || '0m 0s',
      anomalies_count: anomalyCount,
      steps,
      regressions: flowRegressions,
    };
  });

  const allAnomalies = workflows.flatMap(w => w.steps.flatMap(s => s.anomalies || []));
  const totalSteps = workflows.reduce((s, w) => s + w.steps.length, 0);
  const sev = key => allAnomalies.filter(a => (a['sévérité'] || a.severite) === key).length;

  return {
    run_id: runId,
    run_date: new Date().toISOString(),
    project: {
      name: config.project_name,
      framework: config.framework,
      target_url: config.target_url,
      git_branch: git.branch,
      git_commit: git.commit,
    },
    summary: {
      total_flows: workflows.length,
      total_steps: totalSteps,
      pass: workflows.filter(w => w.status === 'pass').length,
      warning: workflows.filter(w => w.status === 'warning').length,
      fail: workflows.filter(w => w.status === 'fail').length,
      anomalies_critiques: sev('critique'),
      anomalies_majeures: sev('majeur'),
      anomalies_mineures: sev('mineur'),
      regressions: (regression.regressions || []).length,
      duration_total: fmtDuration(totalMs),
    },
    workflows,
  };
}

export async function run(opts = {}) {
  checkClaudeCLI();
  const config = loadConfig();

  let flows = [...(config.flows || [])];
  if (opts.flows) {
    const requested = opts.flows.split(',').map(s => s.trim()).filter(Boolean);
    flows = flows.filter(f => requested.includes(f));
    if (flows.length === 0) {
      err(`None of the requested flows match config: ${opts.flows}`);
      process.exit(1);
    }
  }
  if (flows.length === 0) {
    warn('No flows configured. Edit .swarm-test/config.json and add flows.');
    return;
  }

  const runId = uuid();
  const runDir = join(paths.runs, runId);
  ensureDir(runDir);
  ensureDir(join(paths.results, runId));

  const quick = !!opts.quick;
  console.log(chalk.bold(`\nswarm-test run ${chalk.gray(runId.slice(0, 8))}${quick ? chalk.yellow(' [quick]') : ''}`));
  log(`${flows.length} flow(s): ${flows.join(', ')}`);
  if (quick) log(chalk.dim('quick mode: e2e only, analyst + regression skipped'));
  console.log('');

  const t0 = Date.now();
  const e2eResults = new Array(flows.length);
  const analystResults = new Array(flows.length);

  const concurrency = Math.max(1, config.concurrency || 3);
  const queue = flows.map((flow, idx) => ({ flow, idx }));

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const { flow, idx } = item;
      const spinner = ora(`[${flow}] e2e running`).start();
      try {
        const e2eRes = await runE2E({ flow, config, runId, runDir }).catch(e => ({
          flow, status: 'fail', duration: '0m 0s', steps: [], error: e.message,
        }));
        e2eResults[idx] = e2eRes;
        if (quick) {
          analystResults[idx] = { flow, anomalies: [] };
          if (e2eRes.status === 'fail') spinner.fail(`[${flow}] e2e fail`);
          else spinner.succeed(`[${flow}] e2e pass`);
          continue;
        }
        spinner.text = `[${flow}] e2e ${e2eRes.status} — analyst running`;
        const analystRes = await runAnalyst({ flow, config, runId }).catch(e => ({
          flow, anomalies: [], error: e.message,
        }));
        analystResults[idx] = analystRes;
        const aCount = (analystRes.anomalies || []).length;
        if (e2eRes.status === 'fail') spinner.fail(`[${flow}] e2e fail, ${aCount} anomalies`);
        else if (aCount > 0) spinner.warn(`[${flow}] pass, ${aCount} anomalies`);
        else spinner.succeed(`[${flow}] pass, 0 anomalies`);
      } catch (e) {
        spinner.fail(`[${flow}] ${e.message}`);
        e2eResults[idx] = { flow, status: 'fail', duration: '0m 0s', steps: [], error: e.message };
        analystResults[idx] = { flow, anomalies: [] };
      }
    }
  }));

  let regression = { regressions: [] };
  if (!quick) {
    const regSpinner = ora('regression check').start();
    try {
      regression = await runRegression({ config, runId });
      if (regression.first_run) regSpinner.succeed('regression: goldens captured (first run)');
      else {
        const n = (regression.regressions || []).length;
        if (n > 0) regSpinner.warn(`regression: ${n} differences`);
        else regSpinner.succeed('regression: no changes');
      }
    } catch (e) {
      regSpinner.fail(`regression: ${e.message}`);
      regression = { regressions: [] };
    }
  }

  const results = consolidate({
    runId,
    config,
    flows,
    e2eResults,
    analystResults,
    regression,
    totalMs: Date.now() - t0,
  });

  const resultsPath = join(paths.results, `results-${runId}.json`);
  writeJson(resultsPath, results);
  writeJson(join(paths.results, 'latest.json'), results);

  const hist = readJson(paths.flowHistory, { runs: [] });
  hist.runs.push({ run_id: runId, run_date: results.run_date, summary: results.summary });
  writeJson(paths.flowHistory, hist);

  console.log('');
  console.log(chalk.bold('Summary'));
  console.log(`  flows        : ${results.summary.total_flows}`);
  console.log(`  pass         : ${chalk.green(results.summary.pass)}`);
  console.log(`  warning      : ${chalk.yellow(results.summary.warning)}`);
  console.log(`  fail         : ${chalk.red(results.summary.fail)}`);
  console.log(`  critical     : ${chalk.red(results.summary.anomalies_critiques)}`);
  console.log(`  major        : ${chalk.yellow(results.summary.anomalies_majeures)}`);
  console.log(`  minor        : ${results.summary.anomalies_mineures}`);
  console.log(`  regressions  : ${results.summary.regressions}`);
  console.log(`  duration     : ${results.summary.duration_total}`);
  console.log('');
  log(`Results: ${chalk.cyan(resultsPath)}`);
  log(`Dashboard: ${chalk.cyan('npx swarm-test report')}`);

  if (opts.ci && results.summary.anomalies_critiques > 0) {
    err(`CI mode: ${results.summary.anomalies_critiques} critical anomalies — exiting 1`);
    process.exit(1);
  }
}
