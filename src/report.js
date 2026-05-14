import { join, relative } from 'path';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import chalk from 'chalk';
import { paths, readJson, ok, warn, log } from './utils.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function relScreenshot(p) {
  if (!p) return '';
  return relative(paths.results, p).split(/[/\\]/).join('/');
}

function buildHTML(results, history) {
  const r = results;
  const h = history || { runs: [] };

  const totalFeedbacks = (() => {
    try {
      const fs = readJson(paths.feedback, null);
      return null;
    } catch { return null; }
  })();

  const fpRateSeries = (h.runs || []).slice(-20).map(run => {
    const sum = run.summary || {};
    const total = (sum.anomalies_critiques || 0) + (sum.anomalies_majeures || 0) + (sum.anomalies_mineures || 0);
    return { date: run.run_date, total };
  });

  const fpData = readJson(paths.falsePositives, { patterns: [] });
  const cpData = readJson(paths.confirmedPatterns, { patterns: [] });

  const allAnomalies = [];
  for (const w of (r.workflows || [])) {
    for (const s of (w.steps || [])) {
      for (const a of (s.anomalies || [])) {
        allAnomalies.push({
          flow: w.name,
          step: s.label,
          screenshot: s.screenshot,
          ...a,
          _index: allAnomalies.length + 1,
        });
      }
    }
  }

  const allRegressions = [];
  for (const w of (r.workflows || [])) {
    for (const rg of (w.regressions || [])) {
      allRegressions.push({ flow: w.name, ...rg });
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>swarm-test · ${escapeHtml(r.project?.name || 'report')} · ${escapeHtml(r.run_id.slice(0, 8))}</title>
<style>
:root {
  --bg: #0d1117;
  --panel: #161b22;
  --panel-2: #1f2630;
  --border: #30363d;
  --text: #e6edf3;
  --text-dim: #8b949e;
  --accent: #58a6ff;
  --green: #3fb950;
  --yellow: #d29922;
  --red: #f85149;
  --orange: #db6d28;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 14px; }
.wrap { max-width: 1280px; margin: 0 auto; padding: 24px; }
header { display: flex; align-items: baseline; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
h1 { font-size: 18px; font-weight: 600; margin: 0; }
.subtitle { color: var(--text-dim); font-size: 13px; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
.tab { padding: 10px 16px; cursor: pointer; color: var(--text-dim); border-bottom: 2px solid transparent; font-weight: 500; }
.tab.active { color: var(--text); border-bottom-color: var(--accent); }
.tab:hover { color: var(--text); }
.tab-content { display: none; }
.tab-content.active { display: block; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px; }
.kpi { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
.kpi-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
.kpi-value { font-size: 24px; font-weight: 600; }
.kpi.pass .kpi-value { color: var(--green); }
.kpi.warn .kpi-value { color: var(--yellow); }
.kpi.fail .kpi-value { color: var(--red); }
.workflow { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
.workflow-header { padding: 14px 16px; display: flex; align-items: center; gap: 12px; cursor: pointer; user-select: none; }
.workflow-header:hover { background: var(--panel-2); }
.workflow-name { font-weight: 600; flex: 1; }
.workflow-meta { color: var(--text-dim); font-size: 12px; }
.status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.status-dot.pass { background: var(--green); }
.status-dot.warning { background: var(--yellow); }
.status-dot.fail { background: var(--red); }
.progress { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: var(--border); width: 200px; }
.progress > div { height: 100%; }
.progress .pass { background: var(--green); }
.progress .warning { background: var(--yellow); }
.progress .fail { background: var(--red); }
.workflow-body { display: none; padding: 0 16px 16px; border-top: 1px solid var(--border); }
.workflow.open .workflow-body { display: block; }
.step { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.step:last-child { border-bottom: none; }
.step-thumb { width: 80px; height: 60px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 4px; flex-shrink: 0; cursor: pointer; background-size: cover; background-position: center; }
.step-info { flex: 1; }
.step-label { font-weight: 500; }
.step-note { color: var(--text-dim); font-size: 12px; margin-top: 2px; }
.step-anomalies { margin-top: 8px; }
.anomaly { background: var(--panel-2); border-left: 3px solid var(--yellow); padding: 8px 12px; border-radius: 4px; margin-bottom: 6px; font-size: 13px; }
.anomaly.critique { border-left-color: var(--red); }
.anomaly.majeur { border-left-color: var(--orange); }
.anomaly.mineur { border-left-color: var(--yellow); }
.anomaly-head { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
.badge { font-size: 10px; padding: 2px 6px; border-radius: 3px; background: var(--border); color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.badge.critique { background: var(--red); color: white; }
.badge.majeur { background: var(--orange); color: white; }
.badge.mineur { background: var(--yellow); color: black; }
.badge.type { background: var(--panel); border: 1px solid var(--border); }
.suggestion { color: var(--text-dim); font-size: 12px; margin-top: 4px; font-style: italic; }
.filters { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.filters select, .filters input { background: var(--panel); border: 1px solid var(--border); color: var(--text); padding: 6px 10px; border-radius: 4px; font-size: 13px; }
.regression-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
.regression-pair img { width: 100%; border: 1px solid var(--border); border-radius: 4px; }
.regression-pair .label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; margin-bottom: 6px; }
.regression-info { grid-column: 1 / -1; display: flex; gap: 16px; align-items: center; padding-top: 8px; border-top: 1px solid var(--border); }
.chart { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.chart-title { font-size: 12px; color: var(--text-dim); text-transform: uppercase; margin-bottom: 12px; }
.bar-chart { display: flex; align-items: flex-end; gap: 4px; height: 100px; }
.bar { flex: 1; background: var(--accent); border-radius: 2px 2px 0 0; min-height: 2px; opacity: 0.85; }
.bar:hover { opacity: 1; }
.lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: none; align-items: center; justify-content: center; z-index: 100; cursor: zoom-out; }
.lightbox.open { display: flex; }
.lightbox img { max-width: 90%; max-height: 90%; border: 1px solid var(--border); border-radius: 4px; }
button { background: var(--accent); color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
button.secondary { background: var(--panel-2); border: 1px solid var(--border); color: var(--text); }
button:hover { filter: brightness(1.1); }
code { background: var(--panel-2); padding: 2px 5px; border-radius: 3px; font-size: 12px; }
.cmd-popup { position: fixed; bottom: 20px; right: 20px; background: var(--panel); border: 1px solid var(--border); padding: 12px 16px; border-radius: 6px; display: none; z-index: 200; }
.cmd-popup.show { display: block; }
.empty { padding: 24px; text-align: center; color: var(--text-dim); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>swarm-test · ${escapeHtml(r.project?.name || '')}</h1>
    <span class="subtitle">${escapeHtml(r.project?.framework || '')} · ${escapeHtml(r.project?.git_branch || '')}@${escapeHtml(r.project?.git_commit || '')} · ${escapeHtml(new Date(r.run_date).toLocaleString())}</span>
  </header>

  <div class="tabs">
    <div class="tab active" data-tab="overview">Vue d'ensemble</div>
    <div class="tab" data-tab="anomalies">Anomalies métier (${allAnomalies.length})</div>
    <div class="tab" data-tab="regressions">Régressions (${allRegressions.length})</div>
    <div class="tab" data-tab="learning">Apprentissage</div>
  </div>

  <div class="tab-content active" data-pane="overview">
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Flux testés</div><div class="kpi-value">${r.summary.total_flows}</div></div>
      <div class="kpi pass"><div class="kpi-label">Pass</div><div class="kpi-value">${r.summary.pass}</div></div>
      <div class="kpi warn"><div class="kpi-label">Warning</div><div class="kpi-value">${r.summary.warning}</div></div>
      <div class="kpi fail"><div class="kpi-label">Fail</div><div class="kpi-value">${r.summary.fail}</div></div>
      <div class="kpi fail"><div class="kpi-label">Critique</div><div class="kpi-value">${r.summary.anomalies_critiques}</div></div>
      <div class="kpi warn"><div class="kpi-label">Majeur</div><div class="kpi-value">${r.summary.anomalies_majeures}</div></div>
      <div class="kpi"><div class="kpi-label">Mineur</div><div class="kpi-value">${r.summary.anomalies_mineures}</div></div>
      <div class="kpi"><div class="kpi-label">Régressions</div><div class="kpi-value">${r.summary.regressions}</div></div>
      <div class="kpi"><div class="kpi-label">Durée</div><div class="kpi-value" style="font-size: 16px;">${escapeHtml(r.summary.duration_total)}</div></div>
    </div>

    ${(r.workflows || []).map(w => {
      const pass = w.steps.filter(s => s.status === 'pass').length;
      const warning = w.steps.filter(s => s.status === 'warning').length;
      const fail = w.steps.filter(s => s.status === 'fail').length;
      const total = Math.max(1, w.steps.length);
      return `<div class="workflow" data-flow="${escapeHtml(w.name)}">
        <div class="workflow-header" onclick="this.parentElement.classList.toggle('open')">
          <div class="status-dot ${w.status}"></div>
          <div class="workflow-name">${escapeHtml(w.name)}</div>
          <div class="progress">
            <div class="pass" style="width:${(pass/total)*100}%"></div>
            <div class="warning" style="width:${(warning/total)*100}%"></div>
            <div class="fail" style="width:${(fail/total)*100}%"></div>
          </div>
          <div class="workflow-meta">${w.steps.length} steps · ${w.anomalies_count} anomalies · ${escapeHtml(w.duration)}</div>
        </div>
        <div class="workflow-body">
          ${w.steps.map(s => `
            <div class="step">
              ${s.screenshot ? `<div class="step-thumb" style="background-image:url('${escapeHtml(relScreenshot(s.screenshot))}')" onclick="openLightbox('${escapeHtml(relScreenshot(s.screenshot))}')"></div>` : `<div class="step-thumb"></div>`}
              <div class="step-info">
                <div class="step-label"><span class="status-dot ${s.status}" style="display:inline-block;margin-right:6px;vertical-align:middle"></span>${escapeHtml(s.label)} <span class="badge type">${escapeHtml(s.agent || 'e2e')}</span></div>
                ${s.note ? `<div class="step-note">${escapeHtml(s.note)}</div>` : ''}
                ${s.error ? `<div class="step-note" style="color:var(--red)">${escapeHtml(s.error)}</div>` : ''}
                ${s.anomalies.length ? `<div class="step-anomalies">${s.anomalies.map(a => renderAnomaly(a)).join('')}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>

  <div class="tab-content" data-pane="anomalies">
    <div class="filters">
      <select id="f-flow"><option value="">All flows</option>${[...new Set(allAnomalies.map(a => a.flow))].map(f => `<option>${escapeHtml(f)}</option>`).join('')}</select>
      <select id="f-sev"><option value="">All severities</option><option>critique</option><option>majeur</option><option>mineur</option></select>
      <select id="f-type"><option value="">All types</option>${[...new Set(allAnomalies.map(a => a.type).filter(Boolean))].map(t => `<option>${escapeHtml(t)}</option>`).join('')}</select>
    </div>
    <div id="anomalies-list">
      ${allAnomalies.length === 0 ? '<div class="empty">No anomalies detected.</div>' : allAnomalies.map(a => `
        <div class="anomaly ${escapeHtml(a['sévérité'] || a.severite || '')}" data-flow="${escapeHtml(a.flow)}" data-sev="${escapeHtml(a['sévérité'] || a.severite || '')}" data-type="${escapeHtml(a.type || '')}">
          <div class="anomaly-head">
            <span class="badge ${escapeHtml(a['sévérité'] || a.severite || '')}">${escapeHtml(a['sévérité'] || a.severite || '—')}</span>
            <span class="badge type">${escapeHtml(a.type || '—')}</span>
            <strong>${escapeHtml(a.flow)} › ${escapeHtml(a.step)}</strong>
            <span style="margin-left:auto;font-size:11px;color:var(--text-dim)">#${a._index} · fiabilité ${Number(a['fiabilité_historique'] || 0).toFixed(2)}</span>
          </div>
          <div>${escapeHtml(a.constat || a.description || '')}</div>
          <div class="suggestion"><strong>Impact:</strong> ${escapeHtml(a.impact_métier || a.impact || '')}</div>
          ${a.suggestion ? `<div class="suggestion"><strong>Suggestion:</strong> ${escapeHtml(a.suggestion)}</div>` : ''}
          <div style="margin-top:8px"><button class="secondary" onclick="markFP(${a._index})">Marquer faux positif</button></div>
        </div>`).join('')}
    </div>
  </div>

  <div class="tab-content" data-pane="regressions">
    ${allRegressions.length === 0 ? '<div class="empty">No regressions detected. Goldens may have just been captured.</div>' :
      allRegressions.map(rg => {
        const cur = rg.screenshot_current || rg.current || '';
        const gold = rg.screenshot_golden || rg.golden || '';
        const verdict = (rg.verdict || 'à_valider').toLowerCase();
        return `<div class="regression-pair">
          <div>
            <div class="label">Golden</div>
            ${gold ? `<img src="${escapeHtml(relScreenshot(gold))}" onclick="openLightbox('${escapeHtml(relScreenshot(gold))}')">` : '<div class="empty">no image</div>'}
          </div>
          <div>
            <div class="label">Current</div>
            ${cur ? `<img src="${escapeHtml(relScreenshot(cur))}" onclick="openLightbox('${escapeHtml(relScreenshot(cur))}')">` : '<div class="empty">no image</div>'}
          </div>
          <div class="regression-info">
            <span class="badge ${verdict === 'régression' ? 'critique' : verdict === 'intentionnel' ? '' : 'mineur'}">${escapeHtml(verdict)}</span>
            <strong>${escapeHtml(rg.flow)} › ${escapeHtml(rg.étape || rg.step || '')}</strong>
            <span style="color:var(--text-dim)">diff ${Number(rg.diff_percentage || 0).toFixed(2)}%</span>
            <span style="margin-left:auto;color:var(--text-dim)">${escapeHtml(rg.description || '')}</span>
            <button class="secondary" onclick="validateIntentional('${escapeHtml(rg.flow)}','${escapeHtml(rg.étape || rg.step || '')}')">Valider comme intentionnel</button>
          </div>
        </div>`;
      }).join('')}
  </div>

  <div class="tab-content" data-pane="learning">
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Runs</div><div class="kpi-value">${(h.runs || []).length}</div></div>
      <div class="kpi"><div class="kpi-label">False positives</div><div class="kpi-value">${(fpData.patterns || []).length}</div></div>
      <div class="kpi"><div class="kpi-label">Confirmed</div><div class="kpi-value">${(cpData.patterns || []).length}</div></div>
    </div>

    <div class="chart">
      <div class="chart-title">Anomalies per run (last ${fpRateSeries.length})</div>
      <div class="bar-chart">
        ${fpRateSeries.map(s => {
          const max = Math.max(1, ...fpRateSeries.map(x => x.total));
          return `<div class="bar" style="height:${(s.total/max)*100}%" title="${escapeHtml(s.date)}: ${s.total}"></div>`;
        }).join('')}
      </div>
    </div>

    <div class="chart">
      <div class="chart-title">Top confirmed patterns</div>
      ${(cpData.patterns || []).slice(0, 5).map(p => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">${escapeHtml(typeof p === 'string' ? p : (p.pattern || p.name || JSON.stringify(p)))}</div>`).join('') || '<div class="empty">No confirmed patterns yet.</div>'}
    </div>

    <div class="chart">
      <div class="chart-title">Top false-positive patterns eliminated</div>
      ${(fpData.patterns || []).slice(0, 5).map(p => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">${escapeHtml(typeof p === 'string' ? p : (p.pattern || p.name || JSON.stringify(p)))}</div>`).join('') || '<div class="empty">No false-positive patterns yet.</div>'}
    </div>

    <div class="chart">
      <div class="chart-title">Improve the agents</div>
      <p style="color:var(--text-dim)">When you have 5+ feedbacks, run this command to let the self-improver rewrite the agents:</p>
      <p><code>npx swarm-test improve</code></p>
    </div>
  </div>
</div>

<div class="lightbox" id="lightbox" onclick="this.classList.remove('open')">
  <img id="lightbox-img" src="">
</div>
<div class="cmd-popup" id="cmd-popup"></div>

<script>
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector('[data-pane="' + tab.dataset.tab + '"]').classList.add('active');
  });
});

function openLightbox(src) {
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox').classList.add('open');
}

function showCmd(cmd) {
  const p = document.getElementById('cmd-popup');
  p.innerHTML = 'Run this command:<br><code>' + cmd + '</code>';
  p.classList.add('show');
  navigator.clipboard?.writeText(cmd);
  setTimeout(() => p.classList.remove('show'), 4000);
}

function markFP(idx) {
  showCmd('npx swarm-test feedback --mark-fp ' + idx);
}

function validateIntentional(flow, step) {
  showCmd('# manually copy the screenshot to .swarm-test/goldens/' + flow + '/');
}

['f-flow', 'f-sev', 'f-type'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', filterAnomalies);
});

function filterAnomalies() {
  const flow = document.getElementById('f-flow').value;
  const sev = document.getElementById('f-sev').value;
  const type = document.getElementById('f-type').value;
  document.querySelectorAll('#anomalies-list .anomaly').forEach(el => {
    const matchF = !flow || el.dataset.flow === flow;
    const matchS = !sev || el.dataset.sev === sev;
    const matchT = !type || el.dataset.type === type;
    el.style.display = (matchF && matchS && matchT) ? '' : 'none';
  });
}
</script>
</body>
</html>`;

  function renderAnomaly(a) {
    const sev = a['sévérité'] || a.severite || '';
    return `<div class="anomaly ${escapeHtml(sev)}">
      <div class="anomaly-head">
        <span class="badge ${escapeHtml(sev)}">${escapeHtml(sev || '—')}</span>
        <span class="badge type">${escapeHtml(a.type || '—')}</span>
      </div>
      <div>${escapeHtml(a.constat || a.description || '')}</div>
      ${a.suggestion ? `<div class="suggestion">${escapeHtml(a.suggestion)}</div>` : ''}
    </div>`;
  }
}

export async function report() {
  const latest = readJson(join(paths.results, 'latest.json'));
  if (!latest) {
    warn('No run found. Run `swarm-test run` first.');
    return;
  }
  const history = readJson(paths.flowHistory, { runs: [] });
  const html = buildHTML(latest, history);
  const out = join(paths.results, `report-${latest.run_id}.html`);
  writeFileSync(out, html);

  ok(`Report written: ${chalk.cyan(out)}`);

  try {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    execSync(`${cmd} "${out}"`, { stdio: 'ignore' });
  } catch {
    log(`Open manually: ${out}`);
  }
}
