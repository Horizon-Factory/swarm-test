import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import { ensureDir } from './utils.js';

const MODEL_MAP = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
};

export function resolveModel(name) {
  if (!name) return MODEL_MAP.sonnet;
  return MODEL_MAP[name.toLowerCase()] || name;
}

/**
 * Invoke a Claude agent as a subprocess and wait for it to write a JSON result file.
 *
 * Rationale: parsing JSON from stdout is fragile (markdown fences, preambles).
 * We instruct the agent to write the final structured result with the Write tool to
 * a known absolute path, and we read that path back.
 */
export function runAgent({
  systemPrompt,
  userPrompt,
  model = 'sonnet',
  outputFile,
  cwd = process.cwd(),
  timeoutMs = 900_000,
  allowEdits = true,
}) {
  if (!outputFile) throw new Error('runAgent: outputFile is required');
  ensureDir(dirname(outputFile));

  const args = [
    '--print',
    '--model', resolveModel(model),
    '--append-system-prompt', systemPrompt,
  ];
  // The swarm is non-interactive by design — agents must be able to run
  // Playwright, write specs, read screenshots, etc. without prompts.
  // `bypassPermissions` accepts all tool calls inside the subprocess; the
  // blast radius is bounded because the agent only operates inside the
  // project under .swarm-test/ as instructed by the runner prompts.
  if (allowEdits) args.push('--permission-mode', 'bypassPermissions');

  const fullPrompt = [
    userPrompt,
    '',
    '---',
    '',
    'IMPORTANT — How you must return your answer:',
    `Write your FINAL structured JSON output to this exact absolute file path using the Write tool:`,
    outputFile,
    '',
    'The file must contain ONLY valid JSON: no markdown fences, no preamble, no trailing text.',
    'Do not echo the JSON to stdout — only write it to the file. When the file is written, stop.',
  ].join('\n');

  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn('claude', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch (e) {
      return reject(e);
    }

    proc.stdin.write(fullPrompt);
    proc.stdin.end();

    let stderr = '';
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', d => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      reject(new Error(`Agent timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('error', e => {
      clearTimeout(timer);
      reject(e);
    });

    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 && code !== null) {
        return reject(new Error(`claude exited with code ${code}: ${stderr.slice(0, 500)}`));
      }
      if (!existsSync(outputFile)) {
        return reject(new Error(`Agent did not write expected output file: ${outputFile}`));
      }
      try {
        let txt = readFileSync(outputFile, 'utf8').trim();
        txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        resolve(JSON.parse(txt));
      } catch (e) {
        reject(new Error(`Agent output is not valid JSON (${outputFile}): ${e.message}`));
      }
    });
  });
}
