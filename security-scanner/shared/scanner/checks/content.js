'use strict';
// Inspects the HTML of the main page: mixed content, insecure forms,
// outdated front-end libraries, missing SRI and version disclosure.

const LIBRARIES = [
  { name: 'jquery-ui', patterns: ['jquery-ui'], rules: [{ below: '1.13.2', cves: ['CVE-2021-41184', 'CVE-2022-31160'] }] },
  { name: 'jquery', patterns: ['jquery'], rules: [{ below: '3.5.0', cves: ['CVE-2020-11022', 'CVE-2020-11023', 'CVE-2019-11358'] }] },
  { name: 'bootstrap', patterns: ['bootstrap'], rules: [{ below: '3.4.1', cves: ['CVE-2018-14040', 'CVE-2019-8331'] }, { from: '4.0.0', below: '4.3.1', cves: ['CVE-2019-8331'] }] },
  { name: 'angularjs', patterns: ['angular', 'angular.js', 'angularjs'], rules: [{ from: '1.0.0', below: '2.0.0', cves: ['CVE-2022-25869', 'CVE-2023-26116'], note: 'AngularJS 1.x is end-of-life and will not receive fixes' }] },
  { name: 'lodash', patterns: ['lodash'], rules: [{ below: '4.17.21', cves: ['CVE-2021-23337', 'CVE-2020-8203'], severity: 'high' }] },
  { name: 'moment', patterns: ['moment'], rules: [{ below: '2.29.4', cves: ['CVE-2022-31129', 'CVE-2022-24785'] }] },
  { name: 'handlebars', patterns: ['handlebars'], rules: [{ below: '4.7.7', cves: ['CVE-2021-23369', 'CVE-2021-23383'], severity: 'high' }] },
];

const VERSION = '(\\d+\\.\\d+\\.\\d+)';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function cmp(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function detectLibrary(src) {
  for (const lib of LIBRARIES) {
    for (const p of lib.patterns) {
      const n = esc(p);
      const re = new RegExp(`(?:^|[/@._-])${n}(?:[.-]v?${VERSION}(?:[.-](?:min|slim|bundle|full))*\\.js|@${VERSION}|/v?${VERSION}/)`, 'i');
      const m = src.match(re);
      if (m) return { lib, version: m[1] || m[2] || m[3] };
    }
  }
  return null;
}

function vulnerableRule(lib, version) {
  return lib.rules.find((r) => (!r.from || cmp(version, r.from) >= 0) && cmp(version, r.below) < 0) || null;
}

function attrs(tag) {
  const out = {};
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5];
  return out;
}

function tags(html, name) {
  const re = new RegExp(`<${name}\\b([^>]*)>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(attrs(m[1]));
  return out;
}

const baseDomain = (host) => host.split('.').slice(-2).join('.');

module.exports = function contentCheck(ctx) {
  const res = ctx.main.final;
  const html = res.text;
  if (!/html/i.test(res.headers['content-type'] || '') && !/<html/i.test(html.slice(0, 2000))) return;
  const page = ctx.finalUrl;

  const scripts = tags(html, 'script').filter((a) => a.src);
  const styles = tags(html, 'link').filter((a) => /stylesheet/i.test(a.rel || '') && a.href);
  const iframes = tags(html, 'iframe').filter((a) => a.src);
  const media = ['img', 'audio', 'video', 'source'].flatMap((t) => tags(html, t)).filter((a) => a.src);
  const forms = tags(html, 'form');

  if (ctx.isHttps) {
    const active = [...scripts.map((a) => a.src), ...styles.map((a) => a.href), ...iframes.map((a) => a.src)].filter((u) => /^http:\/\//i.test(u));
    if (active.length) ctx.add('content.mixed_active', 'site', { resources: [...new Set(active)].slice(0, 10) });
    const passive = media.map((a) => a.src).filter((u) => /^http:\/\//i.test(u));
    if (passive.length) ctx.add('content.mixed_passive', 'site', { resources: [...new Set(passive)].slice(0, 10) });
    const insecureForms = forms.map((f) => f.action).filter((a) => a && /^http:\/\//i.test(a));
    if (insecureForms.length) ctx.add('content.insecure_form_action', 'site', { actions: insecureForms.slice(0, 5) });
  } else if (/<input\b[^>]*type\s*=\s*["']?password/i.test(html)) {
    ctx.add('content.password_over_http', 'site', { url: page.href });
  }

  const libsSeen = new Set();
  for (const s of scripts) {
    const found = detectLibrary(s.src);
    if (found && !libsSeen.has(found.lib.name)) {
      libsSeen.add(found.lib.name);
      const rule = vulnerableRule(found.lib, found.version);
      if (rule) {
        ctx.add('content.vulnerable_library', found.lib.name, {
          library: found.lib.name, version: found.version, fixedIn: rule.from === '1.0.0' && found.lib.name === 'angularjs' ? 'migrate to a supported framework' : rule.below,
          cves: rule.cves, note: rule.note, src: s.src,
        }, rule.severity);
      }
    }
    let srcUrl;
    try { srcUrl = new URL(s.src, page); } catch { continue; }
    if (srcUrl.protocol.startsWith('http') && baseDomain(srcUrl.hostname) !== baseDomain(page.hostname) && !s.integrity) {
      ctx.add('content.sri_missing', srcUrl.hostname, { script: srcUrl.href });
    }
  }

  const generator = tags(html, 'meta').find((m) => (m.name || '').toLowerCase() === 'generator');
  if (generator && /\d+\.\d+/.test(generator.content || '')) {
    ctx.add('content.generator_version', 'generator', { generator: generator.content });
  }
};

module.exports.detectLibrary = detectLibrary;
module.exports.vulnerableRule = vulnerableRule;
