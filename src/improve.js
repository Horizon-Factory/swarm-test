import { readFileSync, existsSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import {
  paths, loadConfig, loadAgentPrompt,
  readJson, writeJson, readText,
  ok, warn, log, checkClaudeCLI,
} from './utils.js';
import { runAgent } from './claude.js';

function readFeedbacks() {
  if (!existsSync(paths.feedback)) return [];
  return readFileSync(paths.feedback, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function statsByType(feedbacks) {
  const map = {};
  for (const f of feedbacks) {
    const t = f.anomalie_type || 'unknown';
    if (!map[t]) map[t] = { total: 0, confirmées: 0, faux_positifs: 0, ignorés: 0, commentaires: [] };
    map[t].total++;
    if (f.verdict === 'confirmée') map[t].confirmées++;
    else if (f.verdict === 'faux_positif') map[t].faux_positifs++;
    else map[t].ignorés++;
    if (f.commentaire) map[t].commentaires.push(f.commentaire);
  }
  return map;
}

export async function improve() {
  checkClaudeCLI();
  const config = loadConfig();
  const feedbacks = readFeedbacks();

  if (feedbacks.length < 5) {
    warn(`Need at least 5 feedbacks to improve agents (found ${feedbacks.length}).`);
    return;
  }
  const stats = statsByType(feedbacks);

  const systemPrompt = loadAgentPrompt('self-improver');
  const currentAnalyst = readText(join(paths.agents, 'business-analyst.md'));
  const currentE2E = readText(join(paths.agents, 'e2e-agent.md'));

  const spinner = ora('Self-improver analyzing feedbacks').start();

  const userPrompt = [
    '# Statistics by anomaly type',
    JSON.stringify(stats, null, 2),
    '# Recent feedbacks (last 200)',
    feedbacks.slice(-200).map(f => JSON.stringify(f)).join('\n'),
    '# Current business-analyst prompt',
    currentAnalyst,
    '# Current e2e-agent prompt',
    currentE2E,
    '# Your task',
    'Apply the steps from your system prompt and return the full JSON described there.',
  ].join('\n\n');

  const outputFile = join(paths.results, `improver-${Date.now()}.json`);
  let result;
  try {
    result = await runAgent({
      systemPrompt,
      userPrompt,
      model: config.models.improver,
      outputFile,
      cwd: process.cwd(),
      timeoutMs: 20 * 60_000,
    });
    spinner.succeed('Self-improver done');
  } catch (e) {
    spinner.fail(e.message);
    return;
  }

  const version = Date.now();
  const changes = [];

  if (result.rewrites?.['business-analyst']) {
    const cur = join(paths.agents, 'business-analyst.md');
    copyFileSync(cur, join(paths.agentVersions, `business-analyst.v${version}.md`));
    writeFileSync(cur, result.rewrites['business-analyst']);
    changes.push('business-analyst.md rewritten');
  }
  if (result.rewrites?.['e2e-agent']) {
    const cur = join(paths.agents, 'e2e-agent.md');
    copyFileSync(cur, join(paths.agentVersions, `e2e-agent.v${version}.md`));
    writeFileSync(cur, result.rewrites['e2e-agent']);
    changes.push('e2e-agent.md rewritten');
  }
  if (Array.isArray(result.false_positive_patterns)) {
    writeJson(paths.falsePositives, {
      patterns: result.false_positive_patterns,
      updated_at: new Date().toISOString(),
    });
    changes.push(`${result.false_positive_patterns.length} false-positive patterns saved`);
  }
  if (Array.isArray(result.confirmed_patterns)) {
    writeJson(paths.confirmedPatterns, {
      patterns: result.confirmed_patterns,
      updated_at: new Date().toISOString(),
    });
    changes.push(`${result.confirmed_patterns.length} confirmed patterns saved`);
  }

  console.log('');
  console.log(chalk.bold('Change summary'));
  for (const c of changes) ok(c);
  if (result.summary) console.log(`\n${result.summary}`);
}
