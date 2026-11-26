'use strict';
/* SiteGuard single-page app — vanilla JS, hash routing, no build step. */

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const SEVS = ['critical', 'high', 'medium', 'low', 'info'];
let me = { user: null, plans: {} };
let pollTimer = null;

// ------------------------------------------------------------------ helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
const host = (url) => { try { return new URL(url).host; } catch { return url; } };
const sev = (s) => `<span class="sev sev-${esc(s)}">${esc(s)}</span>`;
const grade = (g, small) => `<div class="grade ${small ? 'grade-sm' : ''} grade-${g ? esc(g) : 'none'}">${g ? esc(g) : '–'}</div>`;
const isPro = () => me.user?.plan === 'pro';

function counts(c) {
  if (!c) return '';
  return `<div class="counts">${SEVS.map((s) => `<span class="count">${sev(s)}<b>${c[s] || 0}</b></span>`).join('')}</div>`;
}

const CONFIG = window.SITEGUARD_CONFIG || {};
const API_BASE = `${String(CONFIG.apiBase || '').replace(/\/$/, '')}/api`;
const catalystSdk = () => (CONFIG.devAuth ? null : window.catalyst);

function devUser() { try { return storage('localStorage')?.getItem('sgDevUser') || ''; } catch { return ''; } }

async function authHeaders() {
  if (CONFIG.devAuth) return devUser() ? { 'X-Dev-User': devUser() } : {};
  // Slate and the functions live on different domains: send a Catalyst auth token.
  try {
    const t = await catalystSdk()?.auth?.generateAuthToken?.();
    return t?.access_token ? { Authorization: t.access_token } : {};
  } catch { return {}; }
}

async function apiFetch(path, { method = 'GET', body } = {}) {
  return fetch(`${API_BASE}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(await authHeaders()) },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });
}

async function api(path, opts) {
  const res = await apiFetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function render(html) { $view.innerHTML = html; window.scrollTo(0, 0); }
function on(selector, event, fn) { const el = $view.querySelector(selector); if (el) el.addEventListener(event, fn); return el; }
function showError(el, err) { if (el) { el.textContent = err.message || String(err); el.classList.remove('hidden'); } }

function storage(kind) { try { return window[kind]; } catch { return null; } }
function rememberPendingUrl(url) { try { storage('sessionStorage')?.setItem('pendingScan', url); } catch { /* ignore */ } }
function takePendingUrl() {
  try { const s = storage('sessionStorage'); const v = s?.getItem('pendingScan'); s?.removeItem('pendingScan'); return v; } catch { return null; }
}

async function refreshMe() {
  try { me = await api('/me'); } catch (err) { if (err.status !== 401) throw err; me = { user: null, plans: {} }; }
  renderNav();
}

async function logout() {
  if (CONFIG.devAuth) { try { storage('localStorage')?.removeItem('sgDevUser'); } catch { /* ignore */ } location.hash = '#/'; location.reload(); return; }
  catalystSdk()?.auth?.signOut(`${location.origin}/`); // does not return a promise
}

function renderNav() {
  const r = location.hash;
  const a = (href, label) => `<a href="${href}" class="${r.startsWith(href) ? 'active' : ''}">${label}</a>`;
  $nav.innerHTML = me.user
    ? `${a('#/sites', 'My sites')}${a('#/billing', 'Plan')}
       <span class="plan-badge ${isPro() ? 'pro' : ''}">${esc(me.user.plan)}</span>
       <span class="faint small">${esc(me.user.email)}</span>
       <button class="link-btn" id="logout">Log out</button>`
    : `${a('#/login', 'Log in')}<a class="btn btn-primary btn-sm" href="#/signup">Sign up free</a>`;
  const lo = document.getElementById('logout');
  if (lo) lo.addEventListener('click', logout);
}

async function startScan(url, errorEl) {
  try {
    const { auditId } = await api('/scan', { method: 'POST', body: { url } });
    location.hash = `#/audits/${auditId}`;
  } catch (err) { if (errorEl) showError(errorEl, err); else alert(err.message); }
}

// ------------------------------------------------------------------- views
function viewHome() {
  render(`
    <section class="hero">
      <h1>Find your website's security holes<br>before attackers do.</h1>
      <p>Enter a URL. SiteGuard checks it against the best-known web security issues — TLS, exposed files, security headers, cookies, CORS, outdated libraries — and ranks what it finds from most to least severe.</p>
      <form class="scan-form" id="scan-form">
        <input id="url" name="url" placeholder="https://your-website.com" autocomplete="url" required>
        <button class="btn btn-primary" type="submit">Scan now</button>
      </form>
      <div id="err" class="error hidden"></div>
    </section>
    <section class="features">
      <div class="card"><h3>Ranked by severity</h3><p>Critical exposures first, nice-to-haves last, with a grade from A to F so you know where you stand.</p></div>
      <div class="card"><h3>Issue history per site</h3><p>Every audit is logged. See exactly when each issue was first detected and in which audit it was fixed — or came back.</p></div>
      <div class="card"><h3>Pro: scheduled audits</h3><p>Weekly or monthly audits, detailed fix instructions and evidence, and the report delivered to your inbox.</p></div>
    </section>`);
  on('#scan-form', 'submit', (e) => {
    e.preventDefault();
    const url = $view.querySelector('#url').value.trim();
    if (!me.user) { rememberPendingUrl(url); location.hash = '#/signup'; return; }
    startScan(url, $view.querySelector('#err'));
  });
}

function waitForCatalyst(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (window.catalyst?.auth?.signIn) return resolve(window.catalyst);
      if (Date.now() - started > timeoutMs) return reject(new Error('Could not load Catalyst sign-in. Check your connection and reload.'));
      return setTimeout(tick, 100);
    };
    tick();
  });
}

function viewAuth(mode) {
  const signup = mode === 'signup';
  if (CONFIG.devAuth) {
    render(`<div class="card auth-card"><h1>Log in (dev mode)</h1>
      <p class="muted">Local development: enter any e-mail to act as that user.</p>
      <form id="dev-form"><div class="field"><label for="email">E-mail</label><input id="email" type="email" required></div>
      <div class="row mt-16"><button class="btn btn-primary" type="submit">Continue</button></div></form></div>`);
    on('#dev-form', 'submit', async (e) => {
      e.preventDefault();
      try { storage('localStorage')?.setItem('sgDevUser', $view.querySelector('#email').value.trim()); } catch { /* ignore */ }
      await refreshMe();
      const pending = takePendingUrl();
      if (pending) return startScan(pending);
      location.hash = '#/sites';
      return undefined;
    });
    return;
  }
  if (signup) {
    render(`<div class="card auth-card"><h1>Create your free account</h1>
      <p class="muted">Free accounts get severity-ranked reports for up to 3 sites.</p>
      <form id="signup-form">
        <div class="grid-2"><div class="field"><label for="first">First name</label><input id="first" required autocomplete="given-name"></div>
        <div class="field"><label for="last">Last name</label><input id="last" autocomplete="family-name"></div></div>
        <div class="field"><label for="email">E-mail</label><input id="email" type="email" required autocomplete="email"></div>
        <div id="err" class="error hidden"></div>
        <div class="row mt-16"><button class="btn btn-primary" type="submit">Create account</button>
        <span class="muted small">Have an account? <a href="#/login">Log in</a></span></div>
      </form></div>`);
    on('#signup-form', 'submit', async (e) => {
      e.preventDefault();
      const err = $view.querySelector('#err');
      try {
        const sdk = await waitForCatalyst();
        await sdk.auth.signUp({
          first_name: $view.querySelector('#first').value.trim(),
          last_name: $view.querySelector('#last').value.trim(),
          email_id: $view.querySelector('#email').value.trim(),
          platform_type: 'web',
          ...(CONFIG.zaid ? { zaid: String(CONFIG.zaid) } : {}),
          redirect_url: `${location.origin}/`,
        });
        render(`<div class="card auth-card"><h1>Check your inbox</h1>
          <p>We sent a confirmation e-mail to <b>${esc($view.querySelector('#email')?.value || 'you')}</b>. Follow the link to set your password, then log in.</p>
          <a class="btn btn-primary" href="#/login">Go to log in</a></div>`);
      } catch (ex) { showError(err, ex); }
    });
    return;
  }
  render(`<div class="card auth-card"><h1>Log in</h1>
    <div id="login-box" class="login-box"><span class="spinner"></span></div>
    <div id="err" class="error hidden"></div>
    <p class="muted small">New here? <a href="#/signup">Create a free account</a></p></div>`);
  waitForCatalyst()
    .then((sdk) => { $view.querySelector('#login-box').innerHTML = ''; sdk.auth.signIn('login-box', { login_redirect: `${location.origin}/` }); })
    .catch((ex) => showError($view.querySelector('#err'), ex));
}

async function viewSites() {
  const sites = await api('/targets');
  const rows = sites.map((s) => `
    <tr>
      <td>${grade(s.lastAudit?.grade, true)}</td>
      <td><a href="#/sites/${s.id}"><b>${esc(host(s.url))}</b></a><div class="faint small mono">${esc(s.url)}</div></td>
      <td>${s.lastAudit ? (s.lastAudit.status === 'completed' ? counts(s.lastAudit.counts) : `<span class="muted">${esc(s.lastAudit.status)}</span>`) : '<span class="muted">Never audited</span>'}</td>
      <td class="small">${s.openIssues} open<br><span class="faint">${s.resolvedIssues} fixed</span></td>
      <td class="small">${s.lastAudit ? fmtDate(s.lastAudit.createdAt) : '—'}<br><span class="faint">${s.schedule?.enabled ? `Every ${s.schedule.frequency.replace('ly', '').replace('dai', 'day')}` : 'No schedule'}</span></td>
      <td><button class="btn btn-sm" data-audit="${s.id}">Audit now</button></td>
    </tr>`).join('');
  render(`
    <div class="row spread"><div><h1>My sites</h1><p class="muted">Every audit of every site is kept in its history.</p></div></div>
    <div class="card">
      <form class="scan-form" id="add-form"><input id="url" placeholder="Add a site: https://example.com" required><button class="btn btn-primary">Add &amp; scan</button></form>
      <div id="err" class="error hidden"></div>
    </div>
    <div class="card">
      ${sites.length ? `<div class="table-wrap"><table class="table"><thead><tr><th></th><th>Site</th><th>Last result</th><th>Issues</th><th>Last audit</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="empty">No sites yet. Add one above to run your first audit.</div>'}
    </div>`);
  on('#add-form', 'submit', (e) => { e.preventDefault(); startScan($view.querySelector('#url').value.trim(), $view.querySelector('#err')); });
  $view.querySelectorAll('[data-audit]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { const { auditId } = await api(`/targets/${b.dataset.audit}/audits`, { method: 'POST' }); location.hash = `#/audits/${auditId}`; } catch (err) { alert(err.message); b.disabled = false; }
  }));
}

async function viewSite(id, tab = 'history') {
  const [site, issues] = await Promise.all([api(`/targets/${id}`), api(`/targets/${id}/issues`)]);
  const { target, schedule, audits } = site;
  const last = audits.find((a) => a.status === 'completed');
  const open = issues.filter((i) => i.status === 'open');

  const auditRows = audits.map((a, idx) => `
    <tr><td>${grade(a.grade, true)}</td>
      <td><a href="#/audits/${a.id}">Audit #${audits.length - idx}</a><div class="faint small">${a.trigger === 'scheduled' ? 'Scheduled' : 'Manual'}</div></td>
      <td>${a.status === 'completed' ? counts(a.counts) : a.status === 'failed' ? `<span class="status-open">Failed</span> <span class="small muted">${esc(a.error)}</span>` : `<span class="spinner"></span> ${esc(a.status)}`}</td>
      <td class="small">${fmtDate(a.createdAt)}</td></tr>`).join('');

  const issueRows = issues.map((i) => `
    <tr>
      <td>${sev(i.severity)}</td>
      <td><b>${esc(i.title)}</b>${i.key !== 'site' ? ` <span class="tag mono">${esc(i.key)}</span>` : ''}<div class="faint small">${esc(i.category || '')}</div>
        <ul class="timeline">${i.history.map((h) => `<li>${esc(h.event)} ${fmtDate(h.at)} — <a href="#/audits/${h.auditId}">view audit</a></li>`).join('')}</ul></td>
      <td class="${i.status === 'open' ? 'status-open' : 'status-resolved'}">${i.status === 'open' ? 'Open' : 'Fixed'}</td>
      <td class="small">${fmtDay(i.firstDetectedAt)}</td>
      <td class="small">${i.resolvedAt ? fmtDay(i.resolvedAt) : '—'}</td>
      <td class="small">${i.openForDays} d${i.timesReopened ? `<div class="faint">reopened ×${i.timesReopened}</div>` : ''}</td>
    </tr>`).join('');

  render(`
    <div class="row spread">
      <div class="row">${grade(last?.grade)}<div><h1>${esc(host(target.url))}</h1><div class="muted mono">${esc(target.url)}</div></div></div>
      <div class="row"><button class="btn btn-primary" id="run">Run audit now</button><button class="btn btn-danger btn-sm" id="del">Delete site</button></div>
    </div>
    <div class="tabs">
      <button class="tab" data-tab="history">Audit history (${audits.length})</button>
      <button class="tab" data-tab="issues">Issue log (${open.length} open / ${issues.length - open.length} fixed)</button>
      <button class="tab" data-tab="schedule">Scheduled audits ${schedule?.enabled ? '✓' : ''}</button>
    </div>
    <section data-panel="history" class="card">${audits.length ? `<div class="table-wrap"><table class="table"><thead><tr><th></th><th>Audit</th><th>Result</th><th>Date</th></tr></thead><tbody>${auditRows}</tbody></table></div>` : '<div class="empty">No audits yet.</div>'}</section>
    <section data-panel="issues" class="card">
      <p class="muted small">Every issue ever detected on this site. An issue is marked <b class="status-resolved">Fixed</b> by the first completed audit that no longer finds it, and reopened if it comes back.</p>
      ${issues.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Severity</th><th>Issue &amp; history</th><th>Status</th><th>First detected</th><th>Fixed on</th><th>Open for</th></tr></thead><tbody>${issueRows}</tbody></table></div>` : '<div class="empty">No issues recorded yet.</div>'}
    </section>
    <section data-panel="schedule" class="card">${scheduleForm(schedule)}</section>`);

  const tabs = $view.querySelectorAll('.tab');
  const select = (name) => {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $view.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
  };
  tabs.forEach((t) => t.addEventListener('click', () => select(t.dataset.tab)));
  select(tab);

  on('#run', 'click', async (e) => {
    e.target.disabled = true;
    try { const { auditId } = await api(`/targets/${id}/audits`, { method: 'POST' }); location.hash = `#/audits/${auditId}`; } catch (err) { alert(err.message); e.target.disabled = false; }
  });
  on('#del', 'click', async () => {
    if (!confirm(`Delete ${target.url} and its entire audit history?`)) return;
    await api(`/targets/${id}`, { method: 'DELETE' });
    location.hash = '#/sites';
  });
  on('#schedule-form', 'submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api(`/targets/${id}/schedule`, { method: 'PUT', body: { frequency: f.frequency.value, recipients: f.recipients.value, enabled: f.enabled.checked } });
      viewSite(id, 'schedule');
    } catch (err) { showError($view.querySelector('#sched-err'), err); }
  });
  on('#remove-schedule', 'click', async () => { await api(`/targets/${id}/schedule`, { method: 'DELETE' }); viewSite(id, 'schedule'); });
}

function scheduleForm(schedule) {
  if (!isPro()) {
    return `<div class="locked"><h3>Scheduled audits are a Pro feature</h3>
      <p>Audit this site automatically every day, week or month and receive the report — including what's new and what got fixed — by e-mail.</p>
      <a class="btn btn-primary" href="#/billing">Upgrade to Pro</a></div>`;
  }
  const freq = schedule?.frequency || 'weekly';
  return `
    <form id="schedule-form">
      <div class="grid-2">
        <div class="field"><label for="frequency">Frequency</label>
          <select id="frequency" name="frequency">${['daily', 'weekly', 'monthly'].map((f) => `<option value="${f}" ${f === freq ? 'selected' : ''}>${f[0].toUpperCase()}${f.slice(1)}</option>`).join('')}</select></div>
        <div class="field"><label for="recipients">E-mail report to</label>
          <input id="recipients" name="recipients" value="${esc(schedule?.recipients || me.user.email)}" placeholder="you@example.com, team@example.com"></div>
      </div>
      <div class="field"><label class="row"><input type="checkbox" name="enabled" id="enabled" class="checkbox" ${!schedule || schedule.enabled ? 'checked' : ''}> Enabled</label></div>
      <div id="sched-err" class="error hidden"></div>
      <div class="row">
        <button class="btn btn-primary" type="submit">${schedule ? 'Save schedule' : 'Create schedule'}</button>
        ${schedule ? '<button class="btn btn-danger" type="button" id="remove-schedule">Remove schedule</button>' : ''}
      </div>
      ${schedule ? `<p class="muted small">Next audit: <b>${fmtDate(schedule.nextRunAt)}</b>${schedule.lastRunAt ? ` · last run ${fmtDate(schedule.lastRunAt)}` : ''}</p>` : '<p class="muted small">The first audit runs within a minute of creating the schedule.</p>'}
    </form>`;
}

function changeBlock(report) {
  const { changes, previousAudit } = report;
  if (!previousAudit) return '<p class="muted small">This is the first audit of this site — every issue below is newly detected.</p>';
  const li = (i, cls, label) => `<li>${sev(i.severity)}<span class="${cls}">${label}</span> ${esc(i.title)} ${i.key !== 'site' ? `<span class="tag mono">${esc(i.key)}</span>` : ''}</li>`;
  const items = [
    ...changes.new.map((i) => li(i, 'chg-new', 'New')),
    ...changes.reopened.map((i) => li(i, 'chg-new', 'Came back')),
    ...changes.resolved.map((i) => li(i, 'chg-fixed', 'Fixed')),
  ];
  return `<h3>Since the previous audit <a class="small" href="#/audits/${previousAudit.id}">(${fmtDay(previousAudit.createdAt)}, grade ${esc(previousAudit.grade)})</a></h3>
    ${items.length ? `<ul class="change-list">${items.join('')}</ul>` : '<p class="muted small">No changes.</p>'}`;
}

function findingHtml(f, detailed) {
  const head = `<summary>${sev(f.severity)}<div><div class="f-title">${esc(f.title)} ${f.key !== 'site' ? `<span class="tag mono">${esc(f.key)}</span>` : ''}</div>
    <div class="f-sub">${esc(f.summary)}</div><div class="faint small">${esc(f.category)} · open since ${fmtDay(f.firstDetectedAt)}${f.timesReopened ? ` · reopened ×${f.timesReopened}` : ''}</div></div></summary>`;
  if (!detailed) return `<details class="finding">${head}<div class="f-body"><div class="locked">Why it matters, the evidence we found and step-by-step fix instructions are included in <a href="#/billing">Pro reports</a>.</div></div></details>`;
  return `<details class="finding">${head}<div class="f-body">
    <h4>Why it matters</h4><p>${esc(f.description)}</p>
    <h4>How to fix</h4><p class="fix">${esc(f.remediation)}</p>
    <h4>Evidence</h4><pre class="evidence">${esc(JSON.stringify(f.evidence, null, 2))}</pre>
    ${f.cwe || f.owasp ? `<h4>Classification</h4><p>${f.owasp ? `<span class="tag">${esc(f.owasp)}</span>` : ''}${f.cwe ? `<a class="tag" href="https://cwe.mitre.org/data/definitions/${esc(f.cwe.replace('CWE-', ''))}.html" target="_blank" rel="noopener">${esc(f.cwe)}</a>` : ''}</p>` : ''}
    ${f.references?.length ? `<h4>References</h4><p>${f.references.map((r) => `<a href="${esc(r)}" target="_blank" rel="noopener noreferrer">${esc(host(r))}</a>`).join(' · ')}</p>` : ''}
  </div></details>`;
}

async function viewAudit(id) {
  const report = await api(`/audits/${id}`);
  const { audit, target } = report;
  if (audit.status === 'queued' || audit.status === 'running') {
    render(`<div class="card empty"><p><span class="spinner"></span></p><h2>Auditing ${esc(host(target.url))}…</h2>
      <p class="muted">Checking TLS, security headers, cookies, CORS, exposed files and front-end libraries. This usually takes 5–30 seconds.</p></div>`);
    pollTimer = setTimeout(() => { if (location.hash === `#/audits/${id}`) viewAudit(id); }, 2000);
    return;
  }
  if (audit.status === 'failed') {
    render(`<div class="card"><h1>Audit failed</h1><p>${esc(audit.error)}</p><a class="btn" href="#/sites/${target.id}">Back to ${esc(host(target.url))}</a></div>`);
    return;
  }
  const groups = SEVS.map((s) => report.findings.filter((f) => f.severity === s)).filter((g) => g.length);
  render(`
    <div class="row spread">
      <div class="row">${grade(audit.grade)}<div><h1>${esc(host(target.url))}</h1>
        <div class="muted small">Audit of ${fmtDate(audit.finishedAt)} · score ${audit.score}/100 · ${audit.trigger}</div></div></div>
      <div class="row"><a class="btn" href="#/sites/${target.id}">Site history</a>
        ${report.detailed ? '<button class="btn" id="export">Export JSON</button>' : ''}
        <button class="btn btn-primary" id="rerun">Re-run audit</button></div>
    </div>
    <div class="card stack">${counts(audit.counts)}${audit.finalUrl !== target.url ? `<p class="muted small">Final URL after redirects: <span class="mono">${esc(audit.finalUrl)}</span></p>` : ''}${changeBlock(report)}</div>
    ${!report.detailed ? '<div class="notice mt-16">You\'re seeing the free report. <a href="#/billing"><b>Upgrade to Pro</b></a> for explanations, evidence and fix instructions for every issue, plus scheduled audits by e-mail.</div>' : ''}
    <div class="stack mt-20">
      ${report.findings.length ? groups.map((g) => `<h2>${g[0].severity[0].toUpperCase()}${g[0].severity.slice(1)} (${g.length})</h2>${g.map((f) => findingHtml(f, report.detailed)).join('')}`).join('')
    : '<div class="card empty"><h2>No issues found 🎉</h2><p>This site passed every check.</p></div>'}
    </div>`);
  on('#export', 'click', async () => {
    const res = await apiFetch(`/audits/${audit.id}/export.json`);
    if (!res.ok) { alert('Export failed'); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `siteguard-audit-${audit.id}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  on('#rerun', 'click', async (e) => {
    e.target.disabled = true;
    try { const r = await api(`/targets/${target.id}/audits`, { method: 'POST' }); location.hash = `#/audits/${r.auditId}`; } catch (err) { alert(err.message); e.target.disabled = false; }
  });
}

async function viewBilling() {
  const cfg = await api('/billing/config');
  const status = new URLSearchParams(location.hash.split('?')[1] || '').get('status');
  const { free, pro } = me.plans;
  const plan = (p, items) => `
    <div class="card plan ${me.user.plan === p.id ? 'current' : ''}">
      <div class="row spread"><h2>${esc(p.name)}</h2>${me.user.plan === p.id ? '<span class="plan-badge pro">Current plan</span>' : ''}</div>
      <div class="price">${esc(p.price)}</div>
      <ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>
      <div data-action="${p.id}"></div>
    </div>`;
  render(`
    <h1>Your plan</h1>
    ${status === 'success' ? '<p class="notice">Thanks! Your Pro subscription is being activated — this can take a few seconds.</p>' : ''}
    <div class="plans">
      ${plan(free, [`Up to ${free.maxTargets} sites`, `${free.manualAuditsPerDay} audits per day`, 'Issues ranked from most to least severe', 'Full audit &amp; issue history per site'])}
      ${plan(pro, [`Up to ${pro.maxTargets} sites`, `${pro.manualAuditsPerDay} audits per day`, '<b>Detailed reports</b>: why it matters, evidence, step-by-step fixes, CWE/OWASP mapping',
    '<b>Scheduled audits</b> (daily, weekly, monthly)', '<b>E-mailed reports</b> highlighting new and fixed issues', 'JSON export'])}
    </div>
    <div id="err" class="error hidden"></div>`);
  const proSlot = $view.querySelector('[data-action="pro"]');
  const freeSlot = $view.querySelector('[data-action="free"]');
  const err = $view.querySelector('#err');
  if (isPro()) {
    if (cfg.stripeEnabled) proSlot.innerHTML = '<button class="btn" id="portal">Manage subscription</button>';
    if (cfg.devMode) freeSlot.innerHTML = '<button class="btn" id="dev-free">Switch to Free (dev mode)</button>';
  } else if (cfg.stripeEnabled) {
    proSlot.innerHTML = '<button class="btn btn-primary" id="checkout">Upgrade to Pro</button>';
  } else if (cfg.devMode) {
    proSlot.innerHTML = '<button class="btn btn-primary" id="dev-pro">Activate Pro (dev mode, no payment)</button>';
  } else {
    proSlot.innerHTML = '<p class="muted small">Online payments are not configured on this server yet.</p>';
  }
  const go = async (path) => { try { const r = await api(path, { method: 'POST' }); location.href = r.url; } catch (e) { showError(err, e); } };
  const setPlan = async (p) => { await api('/billing/dev-set-plan', { method: 'POST', body: { plan: p } }); await refreshMe(); viewBilling(); };
  on('#checkout', 'click', () => go('/billing/checkout'));
  on('#portal', 'click', () => go('/billing/portal'));
  on('#dev-pro', 'click', () => setPlan('pro'));
  on('#dev-free', 'click', () => setPlan('free'));
}

// ------------------------------------------------------------------ router
async function route() {
  clearTimeout(pollTimer);
  renderNav();
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  const authed = ['/sites', '/audits', '/billing'].some((p) => path.startsWith(p));
  if (authed && !me.user) { location.hash = '#/login'; return; }
  try {
    let m;
    if (path === '/') viewHome();
    else if (path === '/login') viewAuth('login');
    else if (path === '/signup') viewAuth('signup');
    else if (path === '/sites') await viewSites();
    else if ((m = path.match(/^\/sites\/(\d+)$/))) await viewSite(m[1]);
    else if ((m = path.match(/^\/audits\/(\d+)$/))) await viewAudit(m[1]);
    else if (path === '/billing') await viewBilling();
    else render('<div class="card empty"><h2>Page not found</h2><a href="#/">Go home</a></div>');
  } catch (err) {
    if (err.status === 401) { await refreshMe(); location.hash = '#/login'; return; }
    render(`<div class="card empty"><h2>Something went wrong</h2><p class="muted">${esc(err.message)}</p></div>`);
  }
}

window.addEventListener('hashchange', route);
refreshMe().then(() => {
  // Coming back from the login widget with a URL typed on the home page: scan it now.
  const pending = me.user ? takePendingUrl() : null;
  if (pending) startScan(pending); else route();
}).catch((err) => render(`<div class="card empty"><h2>Cannot reach the SiteGuard API</h2><p class="muted">${esc(err.message)}</p></div>`));
