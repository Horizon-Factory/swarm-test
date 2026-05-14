import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import {
  paths, loadConfig, readText, writeText,
  ok, warn, checkClaudeCLI,
} from './utils.js';
import { runAgent } from './claude.js';

function readFeedbacks() {
  if (!existsSync(paths.feedback)) return [];
  return readFileSync(paths.feedback, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

export async function learn() {
  checkClaudeCLI();
  const config = loadConfig();
  const feedbacks = readFeedbacks()
    .filter(f => f.verdict === 'confirmée' && f.commentaire && f.commentaire.length > 5);

  if (feedbacks.length === 0) {
    warn('No confirmed feedback with comments. Nothing to learn.');
    return;
  }

  const spinner = ora('Extracting business rules from feedbacks').start();

  const userPrompt = [
    '# Task',
    'Extract implicit business rules from these confirmed user feedbacks. Each rule must be:',
    '- Factual (a statement about expected behavior), not an opinion',
    '- Specific enough to be verified by an analyst agent in future runs',
    '- Anonymized (no usernames, emails, ids, personal data)',
    'Return JSON: { "rules": [ { "rule": "string", "confidence": 0..1, "evidence": ["comment 1", ...] } ] }',
    '# Feedbacks',
    feedbacks.map(f => `[${f.flow} › ${f['étape']}] ${f.commentaire}`).join('\n'),
  ].join('\n\n');

  const outputFile = join(paths.results, `learn-${Date.now()}.json`);
  let result;
  try {
    result = await runAgent({
      systemPrompt: 'You extract business rules from user QA feedbacks. Return strict JSON only — write it to the requested file path.',
      userPrompt,
      model: config.models.improver,
      outputFile,
      cwd: process.cwd(),
      timeoutMs: 10 * 60_000,
    });
    spinner.succeed('Rules extracted');
  } catch (e) {
    spinner.fail(e.message);
    return;
  }

  const newRules = (result.rules || []).filter(r => r && r.rule && (r.confidence ?? 0) >= 0.5);
  if (newRules.length === 0) {
    warn('No rules with sufficient confidence (>= 0.5).');
    return;
  }

  let cur = readText(paths.learnedRules, '# Learned business rules\n\n');
  cur += `\n## ${new Date().toISOString().slice(0, 10)}\n\n`;
  for (const r of newRules) {
    cur += `- ${r.rule}  _(confidence ${Number(r.confidence).toFixed(2)})_\n`;
  }
  writeText(paths.learnedRules, cur);

  console.log('');
  ok(`Added ${newRules.length} rules to ${chalk.cyan('.swarm-test/memory/learned-rules.md')}`);
  for (const r of newRules) console.log(`  • ${r.rule}`);
}
