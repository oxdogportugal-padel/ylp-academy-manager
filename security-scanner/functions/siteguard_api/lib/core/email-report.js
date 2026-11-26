'use strict';
// Renders an audit report as an e-mail (HTML + plain text).

const COLORS = { critical: '#b42318', high: '#d1490f', medium: '#b7791f', low: '#2f6fb3', info: '#667085' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

function badge(sev) {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;text-transform:uppercase;color:#fff;background:${COLORS[sev]}">${sev}</span>`;
}

function renderAuditEmail(report, appUrl) {
  const { target, audit, changes, findings } = report;
  const link = `${appUrl}/#/audits/${audit.id}`;
  const counts = audit.counts || {};
  const subject = audit.status === 'completed'
    ? `[SiteGuard] ${new URL(target.url).host}: grade ${audit.grade} — ${counts.critical || 0} critical, ${counts.high || 0} high`
      + (changes.resolved.length ? `, ${changes.resolved.length} fixed` : '')
    : `[SiteGuard] ${new URL(target.url).host}: audit failed`;

  if (audit.status !== 'completed') {
    const text = `The scheduled audit of ${target.url} could not complete: ${audit.error}\n\n${link}`;
    return { subject, text, html: `<p>The scheduled audit of <b>${esc(target.url)}</b> could not complete.</p><p>${esc(audit.error)}</p><p><a href="${link}">Open in SiteGuard</a></p>` };
  }

  const changeList = (title, items, color) => (items.length ? `
    <h3 style="margin:20px 0 6px;font-size:15px;color:${color}">${title} (${items.length})</h3>
    <ul style="margin:0;padding-left:18px">${items.map((i) => `<li>${badge(i.severity)} ${esc(i.title)} <span style="color:#667085">(${esc(i.key)})</span>${i.firstDetectedAt ? ` <span style="color:#667085">— first detected ${day(i.firstDetectedAt)}</span>` : ''}</li>`).join('')}</ul>` : '');

  const findingRows = findings.map((f) => `
    <tr><td style="padding:10px 0;border-top:1px solid #eaecf0;vertical-align:top;width:90px">${badge(f.severity)}</td>
    <td style="padding:10px 0;border-top:1px solid #eaecf0">
      <b>${esc(f.title)}</b> <span style="color:#667085">${esc(f.key !== 'site' ? `(${f.key})` : '')}</span><br>
      <span style="color:#475467">${esc(f.summary)}</span>
      ${report.detailed && f.remediation ? `<div style="margin-top:6px;padding:8px 10px;background:#f2f4f7;border-radius:6px"><b>How to fix:</b> ${esc(f.remediation)}</div>` : ''}
    </td></tr>`).join('');

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f9fafb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#101828">
  <div style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #eaecf0;border-radius:12px;padding:28px">
    <div style="font-size:13px;color:#667085">SiteGuard ${audit.trigger === 'scheduled' ? 'scheduled' : ''} security audit · ${day(audit.finishedAt)}</div>
    <h1 style="font-size:22px;margin:6px 0 2px">${esc(target.url)}</h1>
    <div style="font-size:15px;margin:12px 0">Grade <b style="font-size:22px">${esc(audit.grade)}</b> · score ${audit.score}/100</div>
    <div style="font-size:14px">${['critical', 'high', 'medium', 'low', 'info'].map((s) => `${badge(s)} ${counts[s] || 0}`).join(' &nbsp; ')}</div>
    ${report.previousAudit ? `<p style="color:#475467;font-size:14px">Compared with the previous audit on ${day(report.previousAudit.createdAt)} (grade ${esc(report.previousAudit.grade)}):</p>` : ''}
    ${changeList('New issues', changes.new, '#b42318')}
    ${changeList('Issues that came back', changes.reopened, '#d1490f')}
    ${changeList('Fixed since last audit', changes.resolved, '#067647')}
    <h3 style="margin:24px 0 6px;font-size:15px">All open issues, most severe first</h3>
    ${findings.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px">${findingRows}</table>` : '<p>No issues found. 🎉</p>'}
    <p style="margin-top:24px"><a href="${link}" style="background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open the full report</a></p>
    <p style="font-size:12px;color:#98a2b3">SiteGuard runs passive, non-intrusive checks only. You receive this because a scheduled audit is configured for this site.</p>
  </div></body></html>`;

  const text = [
    `SiteGuard security audit — ${target.url}`,
    `Grade ${audit.grade} (${audit.score}/100) · critical ${counts.critical || 0}, high ${counts.high || 0}, medium ${counts.medium || 0}, low ${counts.low || 0}, info ${counts.info || 0}`,
    '',
    ...(changes.new.length ? ['NEW:', ...changes.new.map((i) => `  [${i.severity}] ${i.title} (${i.key})`), ''] : []),
    ...(changes.reopened.length ? ['CAME BACK:', ...changes.reopened.map((i) => `  [${i.severity}] ${i.title} (${i.key})`), ''] : []),
    ...(changes.resolved.length ? ['FIXED:', ...changes.resolved.map((i) => `  [${i.severity}] ${i.title} (${i.key})`), ''] : []),
    'OPEN ISSUES:',
    ...findings.map((f) => `  [${f.severity.toUpperCase()}] ${f.title} (${f.key})\n    ${f.summary}${report.detailed && f.remediation ? `\n    Fix: ${f.remediation}` : ''}`),
    '',
    `Full report: ${link}`,
  ].join('\n');

  return { subject, html, text };
}

module.exports = { renderAuditEmail };
