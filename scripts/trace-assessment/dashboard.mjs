export function renderDashboard(assessment) {
  const data = JSON.stringify(assessment).replaceAll('<', '\\u003c');
  const lanes = assessment.runs.map((run) => `
    <section class="lane" data-provider="${run.provider}">
      <div class="lane-label"><strong>${title(run)}</strong><span>${formatDuration(run.durationMs)}</span></div>
      <div class="events">${eventBars(run.events, run.durationMs)}</div>
      <details><summary>Trace · ${run.eventCount} events</summary><pre>${escapeHtml(JSON.stringify(run.events, null, 2))}</pre></details>
    </section>`).join('');
  const cards = assessment.runs.map((run) => `
    <article class="proposal" data-provider="${run.provider}">
      <header><strong>${title(run)}</strong><span class="status ${run.status}">${run.status}</span></header>
      <div class="proposal-meta">Session ${escapeHtml(run.sessionId)} · ${formatDuration(run.durationMs)}</div>
      <p>${escapeHtml(run.response?.summary ?? run.stderr ?? 'No response')}</p>
      <pre>${escapeHtml(run.response?.candidateSource ?? 'No candidate source')}</pre>
      ${evidence(run.response?.evidence)}
      ${conflicts(run.response?.conflicts)}
      ${run.response?.question ? `<section class="proposal-section"><h3>Question</h3><p>${escapeHtml(run.response.question)}</p></section>` : ''}
    </article>`).join('');
  const matrix = assessment.agreement.featureMatrix;
  const matrixRows = matrix.rows.map((row) => `<tr><th>${escapeHtml(row.feature)}</th>${row.present.map((present) => `<td>${present ? '●' : '·'}</td>`).join('')}</tr>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mini trace assessment</title>
<style>
:root{color-scheme:light;--paper:#f6f6f1;--ink:#1f2522;--muted:#68716b;--line:#d8ddd7;--claude:#d66b3f;--codex:#317f78;--card:#fbfbf8}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif}main{max-width:1440px;margin:auto;padding:32px}h1{font-size:28px;letter-spacing:-.04em;margin:0}h2{font-size:15px;margin:0 0 14px}.eyebrow,.meta{color:var(--muted);font:11px/1.4 ui-monospace,SFMono-Regular,monospace;text-transform:uppercase;letter-spacing:.08em}.top{display:flex;justify-content:space-between;gap:24px;align-items:end;padding-bottom:24px;border-bottom:1px solid var(--line)}.metrics{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin:24px 0}.metric{background:var(--card);padding:16px}.metric b{display:block;font:24px/1 ui-monospace,SFMono-Regular,monospace;margin-top:8px}.panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin:16px 0;overflow:hidden}.lane{display:grid;grid-template-columns:120px minmax(240px,1fr);gap:12px;padding:10px 0;border-top:1px solid var(--line)}.lane:first-of-type{border-top:0}.lane-label{display:flex;flex-direction:column}.lane-label span{color:var(--muted);font:11px ui-monospace,SFMono-Regular,monospace}.events{position:relative;height:24px;border-left:1px solid var(--line);border-right:1px solid var(--line)}.event{position:absolute;top:2px;bottom:2px;width:5px;transform:translateX(-2px);border-radius:2px;background:#b9c1bb}.event.assistant,.event.item{background:var(--codex)}.lane[data-provider=claude] .event.assistant{background:var(--claude)}.event.result,.event.turn{background:#202924}details{grid-column:2}summary{cursor:pointer;color:var(--muted);font-size:12px}pre{white-space:pre-wrap;overflow:auto;max-height:360px;background:#f0f1ec;border-radius:10px;padding:12px;font:11px/1.5 ui-monospace,SFMono-Regular,monospace}.proposals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.proposal{border:1px solid var(--line);border-radius:12px;padding:14px;min-width:0}.proposal header{display:flex;justify-content:space-between}.proposal-meta{margin-top:4px;color:var(--muted);font:10px/1.4 ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere}.proposal-section{border-top:1px solid var(--line);margin-top:14px;padding-top:12px}.proposal-section h3{margin:0 0 8px;color:var(--muted);font:10px/1.4 ui-monospace,SFMono-Regular,monospace;text-transform:uppercase;letter-spacing:.08em}.proposal-section ul{margin:0;padding-left:18px}.proposal-section li+li{margin-top:6px}.evidence-path{font:11px ui-monospace,SFMono-Regular,monospace}.status{color:var(--muted);font-size:11px}.status.completed{color:var(--codex)}.status.failed{color:#a74732}table{border-collapse:collapse;width:100%;font:11px/1.3 ui-monospace,SFMono-Regular,monospace}th,td{border-bottom:1px solid var(--line);padding:7px;text-align:center}th:first-child{text-align:left;position:sticky;left:0;background:var(--card)}.note{color:var(--muted);font-size:12px}@media(max-width:760px){main{padding:18px}.top{display:block}.metrics{grid-template-columns:1fr 1fr}.lane{grid-template-columns:88px minmax(180px,1fr)}.proposals{grid-template-columns:1fr}.matrix-wrap{overflow:auto}}
</style></head><body><main>
<header class="top"><div><div class="eyebrow">Mini trace assessment</div><h1>${escapeHtml(assessment.skill.name)}</h1></div><div class="meta">${assessment.runs.length} fresh runs · ${assessment.workspace.fileCount} files · vault ${assessment.workspace.unchanged ? 'unchanged' : 'changed'}</div></header>
<section class="metrics">
  ${metric('Overall Jaccard', percent(assessment.agreement.overall.pairwiseMeanJaccard))}
  ${metric('Claude agreement', percent(assessment.agreement.claude.pairwiseMeanJaccard))}
  ${metric('Codex agreement', percent(assessment.agreement.codex.pairwiseMeanJaccard))}
  ${metric('Inter-run agreement', decimal(assessment.agreement.overall.interRunAgreement))}
</section>
<section class="panel"><h2>Trace overlay</h2><p class="note">Synchronized event lanes reveal where runs inspect, reason, fail, or finish differently.</p>${lanes}</section>
<section class="panel"><h2>Proposals</h2><div class="proposals">${cards}</div></section>
<section class="panel"><h2>Feature presence</h2><p class="note">Pairwise Jaccard compares the normalized sets below. Inter-run agreement is exploratory, not a quality score.</p><div class="matrix-wrap"><table><thead><tr><th>Feature</th>${matrix.runs.map((run) => `<th>${escapeHtml(run)}</th>`).join('')}</tr></thead><tbody>${matrixRows}</tbody></table></div></section>
<script type="application/json" id="assessment-data">${data}</script>
</main></body></html>`;
}

function eventBars(events, durationMs) {
  return events.map((event) => `<span class="event ${eventClass(event.type)}" style="left:${Math.min(100, (event.atMs / Math.max(1, durationMs)) * 100).toFixed(2)}%" title="${escapeHtml(`${event.type ?? 'unknown'} · ${event.atMs} ms`)}"></span>`).join('');
}
function eventClass(type=''){return type.replaceAll('.', '-').split('-')[0]}
function title(run){return `${run.provider === 'claude' ? 'Claude' : 'Codex'} ${String(run.index).padStart(2,'0')}`}
function formatDuration(ms){return ms<1000?`${ms} ms`:`${(ms/1000).toFixed(1)} s`}
function metric(label,value){return `<div class="metric"><span class="meta">${label}</span><b>${value}</b></div>`}
function percent(value){return value===null?'—':`${Math.round(value*100)}%`}
function decimal(value){return value===null?'—':value.toFixed(2)}
function evidence(items=[]){return items.length===0?'':`<section class="proposal-section"><h3>Evidence</h3><ul>${items.map((item)=>`<li><span class="evidence-path">${escapeHtml(item.path)}</span> · ${escapeHtml(item.detail)}</li>`).join('')}</ul></section>`}
function conflicts(items=[]){return items.length===0?'':`<section class="proposal-section"><h3>Conflicts</h3><ul>${items.map((item)=>`<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`}
function escapeHtml(value){return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')}
