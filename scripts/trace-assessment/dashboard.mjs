export function renderDashboard(assessment) {
  const data = JSON.stringify(assessment).replaceAll('<', '\\u003c');
  const completed = assessment.runs.filter((run) => run.status === 'completed').length;
  const maxDuration = Math.max(1, ...assessment.runs.map((run) => run.durationMs));
  const matrix = assessment.agreement.featureMatrix;
  const recurringRows = matrix.rows.filter((row) => row.count > 1);
  const oneOffRows = matrix.rows.filter((row) => row.count === 1);
  const repeatedTypes = recurringRows
    .filter((row) => featureKind(row.feature) === 'type')
    .sort((left, right) => right.count - left.count || left.feature.localeCompare(right.feature))
    .slice(0, 10);
  const lanes = assessment.runs.map((run) => traceLane(run, maxDuration)).join('');
  const templates = assessment.runs.map((run) => `<template id="run-${escapeHtml(run.id)}">${compareCard(run)}</template>`).join('');
  const firstClaude = assessment.runs.find((run) => run.provider === 'claude') ?? assessment.runs[0];
  const firstCodex = assessment.runs.find((run) => run.provider === 'codex') ?? assessment.runs[1] ?? assessment.runs[0];
  const semantic = assessment.semanticAlignment;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ontology trace review</title>
<style>
:root{color-scheme:light;--paper:#f3f3ee;--card:#fafaf7;--raised:#fff;--ink:#202622;--muted:#68716b;--faint:#98a099;--line:#d8ddd7;--line-strong:#c4cbc5;--claude:#d66b3f;--claude-soft:#f4e4dc;--codex:#247a73;--codex-soft:#dcece9;--good:#3c7b5a;--warn:#a56d27;--danger:#a74732;--shadow:0 18px 50px rgba(31,37,34,.08)}*{box-sizing:border-box}html{background:var(--paper)}body{margin:0;color:var(--ink);font:14px/1.42 ui-sans-serif,-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif}button,select,input{font:inherit;color:inherit}button{cursor:pointer}main{max-width:1560px;margin:auto;padding:22px 26px 34px}.top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px}.eyebrow,.meta,.kicker{color:var(--muted);font:10px/1.3 ui-monospace,SFMono-Regular,monospace;text-transform:uppercase;letter-spacing:.09em}h1{margin:3px 0 0;font-size:30px;line-height:1;letter-spacing:-.045em}h2{font-size:15px;line-height:1.2;margin:0}h3{font-size:12px;line-height:1.2;margin:0}.integrity{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--good)}.integrity::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px color-mix(in srgb,currentColor 12%,transparent)}.shell{margin-top:18px;border:1px solid var(--line);border-radius:18px;background:rgba(250,250,247,.88);box-shadow:var(--shadow);overflow:visible}.tabs{display:flex;align-items:center;gap:3px;padding:7px;border-bottom:1px solid var(--line);border-radius:18px 18px 0 0;background:rgba(246,246,242,.85);position:sticky;top:0;z-index:10;backdrop-filter:blur(18px) saturate(150%)}.tab{appearance:none;border:0;background:transparent;border-radius:10px;padding:8px 13px;color:var(--muted);font-weight:600}.tab:hover{background:rgba(31,37,34,.05);color:var(--ink)}.tab[aria-selected=true]{background:var(--raised);color:var(--ink);box-shadow:0 1px 5px rgba(31,37,34,.1)}.tab-spacer{flex:1}.tab-meta{padding-right:8px;color:var(--muted);font-size:11px}.workspace{padding:14px}.view[hidden]{display:none}.metrics{display:grid;grid-template-columns:repeat(5,minmax(128px,1fr));gap:8px}.metric{position:relative;min-height:92px;border:1px solid var(--line);border-radius:12px;background:var(--raised);padding:12px}.metric-label{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:11px;font-weight:600}.metric b{display:block;margin-top:10px;font:600 27px/1 ui-monospace,SFMono-Regular,monospace;letter-spacing:-.04em}.metric small{display:block;margin-top:6px;color:var(--muted);font-size:10px}.info{display:inline-grid;place-items:center;width:14px;height:14px;border:1px solid var(--line-strong);border-radius:50%;font:600 9px/1 ui-monospace,SFMono-Regular,monospace;color:var(--muted)}[data-tooltip]::after{content:attr(data-tooltip);position:absolute;z-index:30;left:12px;top:calc(100% + 6px);width:min(280px,calc(100vw - 36px));padding:9px 10px;border:1px solid rgba(255,255,255,.6);border-radius:9px;background:rgba(30,36,32,.94);color:white;font:11px/1.4 ui-sans-serif,-apple-system,sans-serif;box-shadow:0 12px 30px rgba(20,25,22,.22);opacity:0;transform:translateY(-3px);pointer-events:none;transition:opacity 120ms ease,transform 120ms ease}[data-tooltip]:hover::after,[data-tooltip]:focus-visible::after{opacity:1;transform:none}.metric:nth-child(5n)::after{left:auto;right:12px}.dashboard-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(300px,.8fr);gap:10px;margin-top:10px}.stack{display:grid;gap:10px}.panel{min-width:0;border:1px solid var(--line);border-radius:12px;background:var(--raised);padding:14px}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:11px}.panel-head p,.note{margin:4px 0 0;color:var(--muted);font-size:11px}.signal-list{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.signal{min-height:114px;padding:12px;border-radius:10px;background:#f1f2ed}.signal strong{display:block;font-size:13px}.signal p{margin:7px 0 0;color:var(--muted);font-size:12px}.bar-list{display:grid;gap:10px}.bar-row{display:grid;grid-template-columns:84px minmax(80px,1fr) 42px;gap:9px;align-items:center;font-size:11px}.bar-track{height:7px;border-radius:99px;background:#edf0eb;overflow:hidden}.bar-fill{height:100%;min-width:2px;border-radius:inherit;background:var(--ink)}.bar-fill.claude{background:var(--claude)}.bar-fill.codex{background:var(--codex)}.bar-fill.cross{background:linear-gradient(90deg,var(--claude),var(--codex))}.bar-value{text-align:right;font:11px ui-monospace,SFMono-Regular,monospace}.feature-bars{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 14px}.feature-bar{display:grid;grid-template-columns:minmax(80px,1fr) 70px 24px;gap:7px;align-items:center;font-size:11px}.feature-bar>span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.legend{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#f5f6f2;font-size:11px;color:var(--muted)}.legend strong{color:var(--ink)}.legend-item{display:inline-flex;align-items:center;gap:6px}.swatch{width:9px;height:9px;border-radius:50%;background:var(--faint)}.swatch.claude{background:var(--claude)}.swatch.codex{background:var(--codex)}.swatch.finish{background:var(--ink)}.swatch.faint{opacity:.28}.swatch.full{opacity:1}.method{margin-top:10px}.method summary,.proposal-detail summary,.trace-detail summary,.one-offs summary{cursor:pointer;color:var(--muted);font-size:11px}.method p{max-width:850px;color:var(--muted);font-size:11px}.compare-toolbar{display:flex;align-items:center;gap:9px;margin-bottom:10px}.compare-toolbar h2{margin-right:auto}.select-wrap{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:11px}select{appearance:none;border:1px solid var(--line);border-radius:9px;background:var(--raised);padding:7px 28px 7px 9px;background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 13px) 50%,calc(100% - 9px) 50%;background-size:4px 4px,4px 4px;background-repeat:no-repeat}.compare-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.proposal{min-width:0;border:1px solid var(--line);border-radius:12px;background:var(--raised);padding:14px}.proposal[data-provider=claude]{box-shadow:inset 3px 0 var(--claude)}.proposal[data-provider=codex]{box-shadow:inset 3px 0 var(--codex)}.proposal header{display:flex;justify-content:space-between;align-items:center}.provider{display:flex;align-items:center;gap:7px}.provider::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--codex)}.proposal[data-provider=claude] .provider::before{background:var(--claude)}.status{color:var(--good);font-size:10px}.proposal-meta{margin-top:4px;color:var(--muted);font:10px/1.35 ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere}.summary{min-height:58px;font-size:13px}.feature-summary{display:flex;flex-wrap:wrap;gap:5px;margin:10px 0}.feature-pill{border-radius:99px;padding:3px 7px;font:10px/1.2 ui-monospace,SFMono-Regular,monospace;background:#eef0eb}.feature-pill.type{background:#e7efea;color:#315e47}.feature-pill.relation{background:#e9e5f1;color:#5c4c76}.proposal-detail{border-top:1px solid var(--line);margin-top:9px;padding-top:8px}.proposal-detail ul{margin:8px 0 0;padding-left:17px}.proposal-detail li+li{margin-top:5px}.evidence-path{font:10px ui-monospace,SFMono-Regular,monospace}.question{border-top:1px solid var(--line);margin-top:10px;padding-top:9px;color:var(--muted)}pre{white-space:pre-wrap;overflow:auto;max-height:320px;background:#f0f1ec;border-radius:9px;padding:10px;font:10px/1.45 ui-monospace,SFMono-Regular,monospace}.feature-controls{display:flex;align-items:center;gap:9px}.matrix-wrap{overflow:auto;max-height:calc(100vh - 250px);border:1px solid var(--line);border-radius:10px}table{border-collapse:separate;border-spacing:0;width:100%;font:10px/1.25 ui-monospace,SFMono-Regular,monospace}th,td{height:31px;border-bottom:1px solid #e7e9e4;padding:5px 7px;text-align:center}thead th{position:sticky;top:0;z-index:2;background:#f2f3ee;color:var(--muted)}th:first-child{position:sticky;left:0;z-index:3;min-width:265px;text-align:left;background:var(--raised)}thead th:first-child{z-index:4;background:#f2f3ee}.feature-cell{display:flex;align-items:center;gap:8px}.freq-dot{flex:none;border-radius:50%;background:var(--ink);opacity:calc(.18 + var(--frequency) * .08);width:calc(6px + var(--frequency) * 1px);height:calc(6px + var(--frequency) * 1px)}.feature-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kind{margin-left:auto;color:var(--muted);font-size:9px}.presence{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--line)}.presence.on.claude{background:var(--claude)}.presence.on.codex{background:var(--codex)}.one-offs{margin-top:10px}.trace-axis{display:grid;grid-template-columns:112px 1fr;gap:10px;margin-bottom:3px;color:var(--muted);font:9px ui-monospace,SFMono-Regular,monospace}.axis-labels{display:flex;justify-content:space-between}.lane{display:grid;grid-template-columns:112px minmax(240px,1fr);gap:10px;padding:8px 0;border-top:1px solid #e7e9e4}.lane-label{display:flex;justify-content:space-between;gap:8px}.lane-label span{color:var(--muted);font:10px ui-monospace,SFMono-Regular,monospace}.events{position:relative;height:21px;border-left:1px solid var(--line);border-right:1px solid var(--line);background:linear-gradient(90deg,transparent 49.8%,var(--line) 50%,transparent 50.2%)}.event{position:absolute;top:3px;bottom:3px;width:4px;transform:translateX(-2px);border-radius:2px;background:var(--faint);opacity:.55}.event.assistant,.event.item{background:var(--codex);opacity:.9}.lane[data-provider=claude] .event.assistant{background:var(--claude)}.event.result,.event.turn{background:var(--ink);opacity:1}.trace-detail{grid-column:2}.trace-summary{display:grid;grid-template-columns:repeat(4,auto);gap:12px;justify-content:start;margin:5px 0 0;color:var(--muted);font:10px ui-monospace,SFMono-Regular,monospace}.footer-note{margin-top:10px;color:var(--muted);font-size:10px}@media(max-width:900px){main{padding:14px}.metrics{grid-template-columns:repeat(3,1fr)}.metric:nth-child(5n)::after{left:12px;right:auto}.metric:nth-child(3n)::after{left:auto;right:12px}.dashboard-grid{grid-template-columns:1fr}.signal-list{grid-template-columns:1fr}.compare-grid{grid-template-columns:1fr}.compare-toolbar{align-items:flex-start;flex-wrap:wrap}.compare-toolbar h2{width:100%}.feature-bars{grid-template-columns:1fr}}@media(max-width:600px){main{padding:0}.top{padding:16px}.top .meta{display:none}.shell{margin:0;border-left:0;border-right:0;border-radius:0;box-shadow:none}.tabs{border-radius:0;overflow:auto}.tab-meta{display:none}.workspace{padding:9px}.metrics{grid-template-columns:repeat(2,1fr)}.metric{min-height:86px}.metric:nth-child(3n)::after{left:12px;right:auto}.metric:nth-child(even)::after{left:auto;right:12px}.signal-list{grid-template-columns:1fr}.legend{gap:8px}.select-wrap{width:100%}.select-wrap select{flex:1;min-width:0}.lane,.trace-axis{grid-template-columns:86px minmax(220px,1fr)}.traces-scroll{overflow:auto}.matrix-wrap{max-height:calc(100vh - 205px)}th:first-child{min-width:220px}}
</style><style>
.metrics{grid-template-columns:repeat(6,minmax(118px,1fr))}.metric:nth-child(6n)::after{left:auto;right:12px}.semantic-list .bar-row{grid-template-columns:minmax(180px,1.35fr) minmax(80px,.65fr) 42px}.semantic-list .bar-row>span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media(max-width:1100px){.metrics{grid-template-columns:repeat(3,1fr)}}@media(max-width:600px){.metrics{grid-template-columns:repeat(2,1fr)}.semantic-list .bar-row{grid-template-columns:minmax(150px,1.35fr) minmax(60px,.65fr) 38px}}
</style></head><body><main>
<header class="top"><div><div class="eyebrow">Ontology trace review</div><h1>${escapeHtml(assessment.skill.name)}</h1></div><div><div class="integrity">Source vault unchanged</div><div class="meta">${assessment.runs.length} fresh runs · ${assessment.workspace.fileCount} files</div></div></header>
<section class="shell">
  <nav class="tabs" role="tablist" aria-label="Dashboard views">
    ${tab('overview', 'Overview', true)}${tab('runs', 'Runs')}${tab('features', 'Features')}${tab('traces', 'Traces')}
    <span class="tab-spacer"></span><span class="tab-meta">Claude 5 · Codex 5 · read-only</span>
  </nav>
  <div class="workspace">
    <section class="view" id="panel-overview" data-panel="overview" role="tabpanel" aria-labelledby="tab-overview">
      <div class="metrics">
        ${metric('Completed', `${completed}/${assessment.runs.length}`, 'Fresh harness sessions that returned a structured result.', 'all runs')}
        ${metric('Vault integrity', assessment.workspace.unchanged ? 'Exact' : 'Changed', 'SHA-256 manifest before and after every run. Exact means no source file bytes changed.', `${assessment.workspace.fileCount} files`)}
        ${metric('Exact overlap', percent(assessment.agreement.overall.pairwiseMeanJaccard), 'Pairwise Jaccard: for every pair of runs, exact normalized feature strings shared by both divided by all strings proposed by either. Averaged across all pairs. Semantic synonyms still count as different.', 'all run pairs')}
        ${semantic ? metric('Semantic alignment', percent(semantic.overall.pairwiseMeanSimilarity), 'Symmetric best-match cosine similarity from local sentence-transformer embeddings. Features only match within the same kind, so a type never matches a property. This measures conceptual alignment, not proposal quality.', semanticModelName(semantic.model)) : ''}
        ${metric('Cross-provider', percent(assessment.agreement.crossProvider.pairwiseMeanJaccard), 'The same exact-string Jaccard calculation, but only Claude–Codex pairs. This exposes provider vocabulary and scope differences.', 'Claude ↔ Codex')}
        ${metric('Recurring', `${recurringRows.length}/${matrix.rows.length}`, 'Features proposed by at least two runs. One-off wording and one-off evidence paths are excluded from this count.', `${oneOffRows.length} one-off`)}
      </div>
      <div class="dashboard-grid">
        <div class="stack">
          <section class="panel"><div class="panel-head"><div><h2>What the study says</h2><p>Human-readable signal, before the raw proposals.</p></div></div><div class="signal-list">
            <article class="signal"><strong>Structure is real</strong><p>Every run found enough repeated convention to propose an ontology.</p></article>
            <article class="signal"><strong>Vocabulary is unstable</strong><p>Runs often describe the same family differently: person/human, org/organization.</p></article>
            <article class="signal"><strong>Relations need judgment</strong><p>No relation string recurred exactly; providers disagree on naming and strictness.</p></article>
          </div></section>
          <section class="panel"><div class="panel-head"><div><h2>Most repeated types</h2><p>Exact type strings found by two or more runs.</p></div><span class="kicker">Feature frequency</span></div><div class="feature-bars">${frequencyBars(repeatedTypes, assessment.runs.length)}</div></section>
          ${semantic ? `<section class="panel"><div class="panel-head"><div><h2>Semantic matches</h2><p>Different words the model considers conceptually close.</p></div><span class="kicker">${escapeHtml(semanticModelName(semantic.model))}</span></div>${semanticMatchList(semantic.crossProvider.matches)}</section>` : ''}
        </div>
        <div class="stack">
          <section class="panel"><div class="panel-head"><div><h2>Exact overlap by cohort</h2><p>Higher means runs chose more identical strings.</p></div></div><div class="bar-list">
            ${cohortBar('Claude', assessment.agreement.claude.pairwiseMeanJaccard, 'claude')}
            ${cohortBar('Codex', assessment.agreement.codex.pairwiseMeanJaccard, 'codex')}
            ${cohortBar('Cross', assessment.agreement.crossProvider.pairwiseMeanJaccard, 'cross')}
          </div></section>
          ${semantic ? `<section class="panel"><div class="panel-head"><div><h2>Semantic alignment by cohort</h2><p>Higher means proposals express closer concepts, even with different wording.</p></div></div><div class="bar-list">${cohortBar('Claude', semantic.claude.pairwiseMeanSimilarity, 'claude')}${cohortBar('Codex', semantic.codex.pairwiseMeanSimilarity, 'codex')}${cohortBar('Cross', semantic.crossProvider.pairwiseMeanSimilarity, 'cross')}</div></section>` : ''}
          <section class="panel"><div class="panel-head"><div><h2>Visual key</h2><p>Color identifies provider; size and opacity encode frequency.</p></div></div><div class="legend">
            <span class="legend-item"><i class="swatch claude"></i>Claude</span><span class="legend-item"><i class="swatch codex"></i>Codex</span><span class="legend-item"><i class="swatch faint"></i>rare</span><span class="legend-item"><i class="swatch full"></i>frequent</span><span class="legend-item"><i class="swatch finish"></i>finished</span>
          </div><details class="method"><summary>How to read “agreement”</summary><p>Exact overlap is deliberately strict. It compares normalized strings across outcome, types, properties, relations, path defaults, validation rules, and evidence paths. Semantic alignment instead embeds ontology features locally and gives each feature partial credit for its closest same-kind match in the other run. That reveals conceptual convergence despite different vocabulary, but shared technical language can also raise cosine similarity. Inspect the match examples; neither metric is a quality score. The exploratory Inter-run agreement score is ${decimal(assessment.agreement.overall.interRunAgreement)}.</p></details></section>
        </div>
      </div>
    </section>

    <section class="view" id="panel-runs" data-panel="runs" role="tabpanel" aria-labelledby="tab-runs" hidden>
      <div class="compare-toolbar"><h2>Compare runs</h2>${runSelect('Left', 'compare-left-select', assessment.runs, firstClaude.id)}${runSelect('Right', 'compare-right-select', assessment.runs, firstCodex.id)}</div>
      <div class="compare-grid"><div id="compare-left"></div><div id="compare-right"></div></div>
      ${templates}
    </section>

    <section class="view" id="panel-features" data-panel="features" role="tabpanel" aria-labelledby="tab-features" hidden>
      <div class="panel-head"><div><h2>Recurring features</h2><p>Rows are exact normalized proposal features; columns are fresh runs.</p></div><div class="feature-controls"><label class="select-wrap">Kind ${kindSelect()}</label></div></div>
      <div class="legend"><strong>Feature frequency</strong><span class="legend-item"><i class="swatch faint"></i>2 runs</span><span class="legend-item"><i class="swatch full"></i>10 runs</span><span class="legend-item"><i class="swatch claude"></i>present in Claude</span><span class="legend-item"><i class="swatch codex"></i>present in Codex</span><span>Empty = not proposed</span></div>
      ${matrixTable(matrix.runs, recurringRows)}
      <details class="one-offs"><summary>One-off features · ${oneOffRows.length}</summary>${matrixTable(matrix.runs, oneOffRows, 'one-off-matrix')}</details>
    </section>

    <section class="view" id="panel-traces" data-panel="traces" role="tabpanel" aria-labelledby="tab-traces" hidden>
      <div class="panel-head"><div><h2>Trace overlay</h2><p>All lanes share the same ${formatDuration(maxDuration)} time scale.</p></div><div class="legend"><span class="legend-item"><i class="swatch faint"></i>system</span><span class="legend-item"><i class="swatch claude"></i>Claude work</span><span class="legend-item"><i class="swatch codex"></i>Codex work</span><span class="legend-item"><i class="swatch finish"></i>finish</span></div></div>
      <div class="traces-scroll"><div class="trace-axis"><span></span><div class="axis-labels"><span>0</span><span>${formatDuration(maxDuration / 2)}</span><span>${formatDuration(maxDuration)}</span></div></div>${lanes}</div>
      <p class="footer-note">Each marker is one recorded harness event. The detailed event JSON stays collapsed until needed.</p>
    </section>
  </div>
</section>
<script type="application/json" id="assessment-data">${data}</script>
<script>
const tabs=[...document.querySelectorAll('[role=tab]')];
const panels=[...document.querySelectorAll('[role=tabpanel]')];
function activateTab(id){for(const tab of tabs){const on=tab.dataset.tab===id;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1}for(const panel of panels)panel.hidden=panel.dataset.panel!==id}
for(const tab of tabs){tab.addEventListener('click',()=>activateTab(tab.dataset.tab));tab.addEventListener('keydown',(event)=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const next=(tabs.indexOf(tab)+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].focus();activateTab(tabs[next].dataset.tab)})}
function mountCard(selectId,targetId){const select=document.getElementById(selectId);const target=document.getElementById(targetId);const render=()=>{const template=document.getElementById('run-'+select.value);target.replaceChildren(template.content.cloneNode(true))};select.addEventListener('change',render);render()}
mountCard('compare-left-select','compare-left');mountCard('compare-right-select','compare-right');
const featureKind=document.getElementById('feature-kind');
featureKind.addEventListener('change',()=>{for(const row of document.querySelectorAll('tr[data-kind]'))row.hidden=featureKind.value!=='all'&&row.dataset.kind!==featureKind.value});
</script>
</main></body></html>`;
}

function tab(id, label, selected = false) {
  return `<button class="tab" id="tab-${id}" role="tab" data-tab="${id}" aria-controls="panel-${id}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}">${label}</button>`;
}

function metric(label, value, tooltip, detail) {
  return `<article class="metric" tabindex="0" data-tooltip="${escapeHtml(tooltip)}"><div class="metric-label">${label}<span class="info">?</span></div><b>${value}</b><small>${detail}</small></article>`;
}

function cohortBar(label, value, tone) {
  const width = Math.max(1, Math.round((value ?? 0) * 100));
  return `<div class="bar-row"><span>${label}</span><div class="bar-track"><div class="bar-fill ${tone}" style="width:${width}%"></div></div><span class="bar-value">${percent(value)}</span></div>`;
}

function frequencyBars(rows, runCount) {
  return rows.map((row) => {
    const label = row.feature.slice(row.feature.indexOf(':') + 1);
    return `<div class="feature-bar" title="${escapeHtml(row.feature)}"><span>${escapeHtml(label)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round((row.count / runCount) * 100)}%;opacity:${.35 + (row.count / runCount) * .65}"></div></div><span class="bar-value">${row.count}</span></div>`;
  }).join('') || '<p class="note">No type string appeared in more than one run.</p>';
}

function semanticMatchList(matches = []) {
  const limits = new Map([['type', 3], ['relation', 2], ['property', 2], ['path-default', 2], ['validation', 1]]);
  const selected = [];
  for (const [kind, limit] of limits) selected.push(...matches.filter((match) => match.kind === kind).slice(0, limit));
  const rows = selected.map((match) => `<div class="bar-row"><span title="${escapeHtml(match.kind)} · ${escapeHtml(match.left)} ↔ ${escapeHtml(match.right)}">${escapeHtml(match.kind)} · ${escapeHtml(match.left)} ↔ ${escapeHtml(match.right)}</span><div class="bar-track"><div class="bar-fill cross" style="width:${Math.max(1, Math.round(match.similarity * 100))}%"></div></div><span class="bar-value">${percent(match.similarity)}</span></div>`).join('');
  return rows ? `<div class="bar-list semantic-list">${rows}</div>` : '<p class="note">No differently worded cross-provider matches.</p>';
}

function semanticModelName(model) {
  return String(model ?? 'sentence-transformer').split('/').at(-1);
}

function runSelect(label, id, runs, selected) {
  const options = runs.map((run) => `<option value="${escapeHtml(run.id)}"${run.id === selected ? ' selected' : ''}>${title(run)}</option>`).join('');
  return `<label class="select-wrap">${label}<select id="${id}">${options}</select></label>`;
}

function compareCard(run) {
  return `<article class="proposal" data-provider="${run.provider}">
    <header><strong class="provider">${title(run)}</strong><span class="status ${run.status}">${run.status}</span></header>
    <div class="proposal-meta">${formatDuration(run.durationMs)} · ${run.eventCount} events · Session ${escapeHtml(run.sessionId)}</div>
    <p class="summary">${escapeHtml(run.response?.summary ?? run.stderr ?? 'No response')}</p>
    ${featureSummary(run.response?.features)}
    ${proposalList('Evidence', run.response?.evidence, (item) => `<span class="evidence-path">${escapeHtml(item.path)}</span> · ${escapeHtml(item.detail)}`)}
    ${proposalList('Conflicts', run.response?.conflicts, (item) => escapeHtml(item))}
    <details class="proposal-detail"><summary>Candidate ontology</summary><pre>${escapeHtml(run.response?.candidateSource ?? 'No candidate source')}</pre></details>
    ${run.response?.question ? `<p class="question"><strong>Question</strong><br>${escapeHtml(run.response.question)}</p>` : ''}
  </article>`;
}

function featureSummary(features) {
  if (!features) return '';
  const items = [
    ...features.conceptTypes.map((item) => ['type', item]),
    ...features.relations.map((item) => ['relation', item]),
  ];
  return items.length === 0 ? '' : `<div class="feature-summary">${items.map(([kind, item]) => `<span class="feature-pill ${kind}">${escapeHtml(kind)}:${escapeHtml(item)}</span>`).join('')}</div>`;
}

function proposalList(label, items = [], render) {
  return items.length === 0 ? '' : `<details class="proposal-detail"><summary>${label} · ${items.length}</summary><ul>${items.map((item) => `<li>${render(item)}</li>`).join('')}</ul></details>`;
}

function kindSelect() {
  const kinds = [['all', 'All'], ['type', 'Types'], ['property', 'Properties'], ['relation', 'Relations'], ['path-default', 'Path defaults'], ['validation', 'Validation'], ['evidence', 'Evidence']];
  return `<select id="feature-kind">${kinds.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>`;
}

function matrixTable(runs, rows, extraClass = '') {
  return `<div class="matrix-wrap ${extraClass}"><table><thead><tr><th>Feature</th>${runs.map((run) => `<th>${escapeHtml(run.replace('-', ' '))}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => matrixRow(row, runs)).join('')}</tbody></table></div>`;
}

function matrixRow(row, runs) {
  const kind = featureKind(row.feature);
  return `<tr data-kind="${kind}"><th><span class="feature-cell"><i class="freq-dot" style="--frequency:${row.count}"></i><span class="feature-name" title="${escapeHtml(row.feature)}">${escapeHtml(row.feature.slice(row.feature.indexOf(':') + 1))}</span><span class="kind">${kind}</span></span></th>${row.present.map((present, index) => `<td><i class="presence ${present ? 'on' : ''} ${runs[index].startsWith('claude') ? 'claude' : 'codex'}" title="${present ? 'present' : 'not proposed'}"></i></td>`).join('')}</tr>`;
}

function traceLane(run, maxDuration) {
  return `<section class="lane" data-provider="${run.provider}"><div class="lane-label"><strong>${title(run)}</strong><span>${formatDuration(run.durationMs)}</span></div><div class="events">${eventBars(run.events, maxDuration)}</div><details class="trace-detail"><summary>Trace · ${run.eventCount} events</summary><div class="trace-summary"><span>${run.status}</span><span>${run.response?.evidence?.length ?? 0} evidence</span><span>${run.response?.conflicts?.length ?? 0} conflicts</span><span>${escapeHtml(run.sessionId)}</span></div><pre>${escapeHtml(JSON.stringify(run.events, null, 2))}</pre></details></section>`;
}

function eventBars(events, maxDuration) {
  return events.map((event) => `<span class="event ${eventClass(event.type)}" style="left:${Math.min(100, (event.atMs / maxDuration) * 100).toFixed(2)}%" title="${escapeHtml(`${event.type ?? 'unknown'} · ${formatDuration(event.atMs)}`)}"></span>`).join('');
}

function featureKind(feature) { return feature.slice(0, feature.indexOf(':')); }
function eventClass(type = '') { return type.replaceAll('.', '-').split('-')[0]; }
function title(run) { return `${run.provider === 'claude' ? 'Claude' : 'Codex'} ${String(run.index).padStart(2, '0')}`; }
function formatDuration(ms) { return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`; }
function percent(value) { return value === null ? '—' : `${Math.round(value * 100)}%`; }
function decimal(value) { return value === null ? '—' : value.toFixed(3); }
function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
