import readline from 'readline';
import { appendFileSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import chalk from 'chalk';
import { v4 as uuid } from 'uuid';
import { paths, readJson, log, ok, warn, ensureDir } from './utils.js';

function ask(rl, q) {
  return new Promise(r => rl.question(q, a => r(a)));
}

function flattenAnomalies(results) {
  const out = [];
  for (const w of (results.workflows || [])) {
    for (const s of (w.steps || [])) {
      for (const a of (s.anomalies || [])) {
        out.push({ flow: w.name, step: s.label, screenshot: s.screenshot, anomaly: a });
      }
    }
  }
  return out;
}

function appendFeedback(entry) {
  ensureDir(dirname(paths.feedback));
  appendFileSync(paths.feedback, JSON.stringify(entry) + '\n');
}

export async function feedback(opts = {}) {
  const latest = readJson(join(paths.results, 'latest.json'));
  if (!latest) {
    warn('No run found. Run `swarm-test run` first.');
    return;
  }

  const anomalies = flattenAnomalies(latest);
  if (anomalies.length === 0) {
    ok('No anomalies to review.');
    return;
  }

  if (opts.markFp) {
    const idx = parseInt(opts.markFp, 10);
    if (Number.isNaN(idx) || idx < 1 || idx > anomalies.length) {
      warn(`Invalid anomaly index: ${opts.markFp} (have ${anomalies.length})`);
      return;
    }
    const item = anomalies[idx - 1];
    appendFeedback({
      date: new Date().toISOString(),
      id: uuid(),
      run_id: latest.run_id,
      flow: item.flow,
      étape: item.step,
      anomalie_type: item.anomaly.type || 'unknown',
      sévérité: item.anomaly['sévérité'] || item.anomaly.severite || 'mineur',
      verdict: 'faux_positif',
      commentaire: '',
      screenshot: item.screenshot || '',
    });
    ok(`Marked anomaly #${idx} as false positive.`);
    return;
  }

  console.log(chalk.bold(`\n${anomalies.length} anomalies from run ${latest.run_id.slice(0, 8)}\n`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let saved = 0;

  for (let i = 0; i < anomalies.length; i++) {
    const { flow, step, screenshot, anomaly } = anomalies[i];
    const sev = anomaly['sévérité'] || anomaly.severite || '—';
    const constat = anomaly.constat || anomaly.description || '—';
    const impact = anomaly.impact_métier || anomaly.impact || '—';
    console.log(chalk.bold(`[${i + 1}/${anomalies.length}] ${chalk.cyan(flow)} › ${step}`));
    console.log(`  ${chalk.dim('Sévérité:')} ${sev}   ${chalk.dim('Type:')} ${anomaly.type || '—'}`);
    console.log(`  ${chalk.dim('Constat:')} ${constat}`);
    console.log(`  ${chalk.dim('Impact:')}  ${impact}`);
    if (screenshot) console.log(`  ${chalk.dim('Screenshot:')} ${screenshot}`);

    const verdict = (await ask(rl, chalk.cyan('  [C]onfirmée / [F]aux positif / [I]gnoré / Enter to skip: '))).trim().toLowerCase();
    let v;
    if (verdict === 'c') v = 'confirmée';
    else if (verdict === 'f') v = 'faux_positif';
    else if (verdict === 'i') v = 'ignoré';
    else { console.log(''); continue; }

    const comment = (await ask(rl, chalk.cyan('  Comment (optional): '))).trim();

    appendFeedback({
      date: new Date().toISOString(),
      id: uuid(),
      run_id: latest.run_id,
      flow,
      étape: step,
      anomalie_type: anomaly.type || 'unknown',
      sévérité: sev,
      verdict: v,
      commentaire: comment,
      screenshot: screenshot || '',
    });
    saved++;
    console.log('');
  }
  rl.close();

  const total = existsSync(paths.feedback)
    ? readFileSync(paths.feedback, 'utf8').split('\n').filter(Boolean).length
    : 0;
  ok(`${saved} feedbacks saved (${total} total). Run \`swarm-test improve\` once you have 5+.`);
}
