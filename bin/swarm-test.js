#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { init } from '../src/init.js';
import { run } from '../src/runner.js';
import { dev } from '../src/dev.js';
import { feedback } from '../src/feedback.js';
import { improve } from '../src/improve.js';
import { learn } from '../src/learn.js';
import { diff } from '../src/diff.js';
import { report } from '../src/report.js';

const program = new Command();

program
  .name('swarm-test')
  .description('Autonomous multi-agent testing swarm for web apps')
  .version('1.0.0');

program.command('init')
  .description('Analyze the project and generate the swarm configuration')
  .action(init);

program.command('run')
  .description('Run the full swarm of test agents (e2e + analyst + regression)')
  .option('--ci', 'Exit with code 1 if any critical anomaly is detected')
  .option('--flows <list>', 'Comma-separated list of flow names to run')
  .option('--quick', 'Skip the business analyst and regression agents (e2e only, ~10x faster)')
  .action(run);

program.command('dev')
  .description('Local dev loop: auto-start dev server + test impacted flows only (quick mode)')
  .option('--all', 'Test every flow instead of only the ones impacted by uncommitted changes')
  .option('--flows <list>', 'Comma-separated list of flow names to run')
  .option('--no-start', 'Do not auto-start the dev server (assume it is already running)')
  .option('--full', 'Run the full swarm (analyst + regression) instead of quick mode')
  .action(dev);

program.command('feedback')
  .description('Interactively review anomalies from the latest run')
  .option('--mark-fp <id>', 'Mark a specific anomaly index as false positive')
  .action(feedback);

program.command('improve')
  .description('Rewrite agents from the feedback memory')
  .action(improve);

program.command('learn')
  .description('Update learned business rules from confirmed feedbacks')
  .action(learn);

program.command('report')
  .description('Generate and open the HTML dashboard for the latest run')
  .action(report);

program.command('diff')
  .description('Detect which flows are impacted by recent git changes')
  .option('--auto', 'Automatically run the swarm on impacted flows')
  .action(diff);

program.parseAsync(process.argv).catch(err => {
  console.error(chalk.red('✗'), err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
