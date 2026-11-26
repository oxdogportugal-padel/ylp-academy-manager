'use strict';
// Every issue the scanner can report. Checks only emit an id + evidence; the
// human-readable material (and the default severity) lives here so reports,
// e-mails and the issue log all describe an issue the same way.

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const SEVERITY_RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));

const OWASP = {
  A01: 'A01:2021 Broken Access Control',
  A02: 'A02:2021 Cryptographic Failures',
  A04: 'A04:2021 Insecure Design',
  A05: 'A05:2021 Security Misconfiguration',
  A06: 'A06:2021 Vulnerable and Outdated Components',
  A07: 'A07:2021 Identification and Authentication Failures',
  A08: 'A08:2021 Software and Data Integrity Failures',
};

const CATALOG = {
  // ---------------------------------------------------------------- transport
  'transport.no_https': {
    severity: 'high', category: 'Transport security', owasp: OWASP.A02, cwe: 'CWE-319',
    title: 'Site is not available over HTTPS',
    summary: 'All traffic, including any credentials or cookies, travels in clear text.',
    description: 'The site only answers over plain HTTP. Anyone on the network path (public Wi-Fi, ISP, compromised router) can read and modify every page, form submission and cookie.',
    remediation: 'Install a TLS certificate (free certificates are available from Let\'s Encrypt or your hosting provider/CDN), serve the site over HTTPS and redirect all HTTP requests to HTTPS with a 301.',
    references: ['https://letsencrypt.org/getting-started/', 'https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html'],
  },
  'transport.no_https_redirect': {
    severity: 'medium', category: 'Transport security', owasp: OWASP.A02, cwe: 'CWE-319',
    title: 'HTTP does not redirect to HTTPS',
    summary: 'Visitors who type the address without https:// stay on an unencrypted connection.',
    description: 'HTTPS is available, but requests to the http:// version of the site are served without being redirected. Users following old links or typing the bare domain browse unencrypted, and an attacker can strip the upgrade.',
    remediation: 'Return a permanent redirect (301/308) from every http:// URL to the same https:// URL, then enable HSTS so browsers skip HTTP entirely.',
    references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Redirections'],
  },

  // ---------------------------------------------------------------------- tls
  'tls.cert_expired': {
    severity: 'critical', category: 'TLS certificate', owasp: OWASP.A02, cwe: 'CWE-298',
    title: 'TLS certificate has expired',
    summary: 'Browsers show a full-page security warning and most visitors cannot reach the site.',
    description: 'The certificate presented by the server is past its expiry date. Browsers block the page with an interstitial warning, API clients refuse to connect, and users are trained to click through warnings — which makes real interception attacks easier.',
    remediation: 'Renew the certificate immediately and automate renewal (e.g. certbot/ACME, or a managed certificate from your CDN or load balancer). Add expiry monitoring.',
    references: ['https://letsencrypt.org/docs/'],
  },
  'tls.cert_invalid': {
    severity: 'high', category: 'TLS certificate', owasp: OWASP.A02, cwe: 'CWE-295',
    title: 'TLS certificate is not trusted',
    summary: 'The certificate is self-signed, issued by an untrusted CA, incomplete, or for a different hostname.',
    description: 'Browsers cannot validate the certificate chain for this hostname, so they warn visitors and the connection offers no protection against impersonation.',
    remediation: 'Use a certificate from a publicly trusted CA that covers this exact hostname, and make sure the server sends the full intermediate chain.',
    references: ['https://www.ssllabs.com/ssltest/', 'https://whatsmychaincert.com/'],
  },
  'tls.cert_expiring_soon': {
    severity: 'medium', category: 'TLS certificate', owasp: OWASP.A02, cwe: 'CWE-298',
    title: 'TLS certificate expires soon',
    summary: 'The certificate expires within 14 days.',
    description: 'If the certificate is not renewed in time the site will become unreachable behind a browser security warning.',
    remediation: 'Renew now and automate renewal so it happens well before expiry (ACME clients renew at 30 days remaining by default).',
    references: ['https://letsencrypt.org/docs/integration-guide/'],
  },
  'tls.legacy_protocol': {
    severity: 'medium', category: 'TLS configuration', owasp: OWASP.A02, cwe: 'CWE-327',
    title: 'Deprecated TLS 1.0/1.1 is enabled',
    summary: 'The server still accepts TLS versions with known cryptographic weaknesses.',
    description: 'TLS 1.0 and 1.1 were formally deprecated in RFC 8996 (2021). They rely on weak primitives and are a compliance failure for PCI-DSS and many security baselines.',
    remediation: 'Disable TLS 1.0 and 1.1 in the web server, load balancer or CDN; allow only TLS 1.2 and 1.3.',
    references: ['https://datatracker.ietf.org/doc/html/rfc8996', 'https://ssl-config.mozilla.org/'],
  },

  // ------------------------------------------------------------------ exposure
  'exposure.git': {
    severity: 'critical', category: 'Sensitive file exposure', owasp: OWASP.A05, cwe: 'CWE-527',
    title: 'Git repository is publicly accessible',
    summary: 'The /.git directory can be downloaded, exposing source code and possibly secrets.',
    description: 'Anyone can reconstruct the full source code and commit history from an exposed .git folder using freely available tools. Repositories routinely contain credentials, API keys and internal URLs.',
    remediation: 'Block access to /.git (and all dot-directories) at the web server, or deploy build artifacts rather than a working copy. Assume every secret ever committed is compromised and rotate it.',
    references: ['https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/04-Review_Old_Backup_and_Unreferenced_Files_for_Sensitive_Information'],
  },
  'exposure.env': {
    severity: 'critical', category: 'Sensitive file exposure', owasp: OWASP.A05, cwe: 'CWE-538',
    title: 'Environment file (.env) is publicly accessible',
    summary: 'A .env file with configuration — typically database passwords and API keys — can be downloaded.',
    description: 'The file is served as plain text. .env files usually hold database credentials, payment/API secrets and application keys, giving an attacker direct access to backend systems.',
    remediation: 'Move the file outside the web root or deny access to dot-files at the web server. Rotate every credential the file contained.',
    references: ['https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html'],
  },
  'exposure.backup_file': {
    severity: 'critical', category: 'Sensitive file exposure', owasp: OWASP.A05, cwe: 'CWE-530',
    title: 'Configuration backup file is downloadable',
    summary: 'A backup copy of a server-side configuration file is served as plain text.',
    description: 'Editors and admins often leave copies such as wp-config.php.bak. Because the extension is not executed, the web server returns the raw source, including database credentials.',
    remediation: 'Delete backup/temporary copies from the web root, deny *.bak, *.old, *~ and *.swp at the web server, and rotate the exposed credentials.',
    references: ['https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/04-Review_Old_Backup_and_Unreferenced_Files_for_Sensitive_Information'],
  },
  'exposure.sql_dump': {
    severity: 'critical', category: 'Sensitive file exposure', owasp: OWASP.A05, cwe: 'CWE-530',
    title: 'Database dump is publicly downloadable',
    summary: 'An SQL dump in the web root may expose all stored data, including user records.',
    description: 'A database export is served to anyone. These files usually contain customer data and password hashes and can constitute a reportable data breach.',
    remediation: 'Remove the dump from the web root immediately, review access logs to see whether it was downloaded, and follow your breach-notification process if personal data was exposed.',
    references: ['https://gdpr.eu/article-33-notification-of-a-personal-data-breach/'],
  },
  'exposure.svn': {
    severity: 'high', category: 'Sensitive file exposure', owasp: OWASP.A05, cwe: 'CWE-527',
    title: 'Subversion metadata is publicly accessible',
    summary: 'The /.svn directory exposes source code metadata.',
    description: 'SVN working-copy metadata reveals file listings and may allow source code reconstruction.',
    remediation: 'Deny access to /.svn at the web server and deploy exported builds instead of working copies.',
    references: [],
  },
  'exposure.phpinfo': {
    severity: 'medium', category: 'Information disclosure', owasp: OWASP.A05, cwe: 'CWE-200',
    title: 'phpinfo() page is publicly accessible',
    summary: 'A diagnostic page reveals PHP version, modules, paths and environment variables.',
    description: 'phpinfo output helps attackers fingerprint exact versions and may leak environment variables, internal paths and sometimes credentials.',
    remediation: 'Delete the phpinfo/info page from production.',
    references: [],
  },
  'exposure.server_status': {
    severity: 'medium', category: 'Information disclosure', owasp: OWASP.A05, cwe: 'CWE-200',
    title: 'Apache server-status page is public',
    summary: 'Live request URLs, client IPs and server details are visible to anyone.',
    description: 'mod_status exposes currently processed requests (including URLs with tokens), client addresses and server configuration.',
    remediation: 'Restrict /server-status to localhost or an admin network (Require ip 127.0.0.1) or disable mod_status.',
    references: ['https://httpd.apache.org/docs/2.4/mod/mod_status.html'],
  },
  'exposure.directory_listing': {
    severity: 'medium', category: 'Information disclosure', owasp: OWASP.A05, cwe: 'CWE-548',
    title: 'Directory listing is enabled',
    summary: 'The server lists the contents of folders that have no index page.',
    description: 'Directory indexes let anyone browse every file in a folder, including uploads, backups and files that were never meant to be linked.',
    remediation: 'Disable auto-indexing (Apache: Options -Indexes; nginx: autoindex off).',
    references: ['https://cwe.mitre.org/data/definitions/548.html'],
  },
  'exposure.ds_store': {
    severity: 'low', category: 'Information disclosure', owasp: OWASP.A05, cwe: 'CWE-527',
    title: '.DS_Store file is accessible',
    summary: 'macOS folder metadata reveals file names in the directory.',
    description: '.DS_Store files list the names of files in a folder, which can point attackers at hidden or unlinked resources.',
    remediation: 'Remove .DS_Store files from deployments (add them to .gitignore) and deny dot-files at the web server.',
    references: [],
  },
  'exposure.security_txt_missing': {
    severity: 'info', category: 'Best practice', owasp: null, cwe: null,
    title: 'No security.txt contact file',
    summary: 'Security researchers have no published way to report vulnerabilities to you.',
    description: 'RFC 9116 defines /.well-known/security.txt so people who find a vulnerability know whom to contact. Without it, reports may never reach you.',
    remediation: 'Publish /.well-known/security.txt with at least Contact: and Expires: fields.',
    references: ['https://securitytxt.org/', 'https://www.rfc-editor.org/rfc/rfc9116'],
  },

  // ------------------------------------------------------------------- content
  'content.password_over_http': {
    severity: 'high', category: 'Transport security', owasp: OWASP.A02, cwe: 'CWE-319',
    title: 'Password form served over HTTP',
    summary: 'A login or password field is on a page loaded without encryption.',
    description: 'Passwords entered on this page can be captured by anyone on the network, and the page itself can be modified to send credentials elsewhere.',
    remediation: 'Serve the whole site, and especially every page with a password field, over HTTPS only.',
    references: ['https://developer.mozilla.org/en-US/docs/Web/Security/Insecure_passwords'],
  },
  'content.insecure_form_action': {
    severity: 'high', category: 'Transport security', owasp: OWASP.A02, cwe: 'CWE-319',
    title: 'Form submits data over HTTP',
    summary: 'A form on an HTTPS page posts its data to an http:// URL.',
    description: 'Even though the page is encrypted, the submitted form data travels in clear text to the target URL.',
    remediation: 'Change the form action to an https:// (or relative) URL.',
    references: [],
  },
  'content.mixed_active': {
    severity: 'high', category: 'Mixed content', owasp: OWASP.A02, cwe: 'CWE-311',
    title: 'Scripts or styles loaded over HTTP on an HTTPS page',
    summary: 'Active mixed content lets a network attacker inject code into the secure page.',
    description: 'Scripts, stylesheets or iframes are loaded over plain HTTP. Modern browsers block them (breaking the page); older ones run them, letting an attacker take full control of the page.',
    remediation: 'Load every resource over https:// (or protocol-relative/relative URLs), and consider the CSP directive upgrade-insecure-requests.',
    references: ['https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content'],
  },
  'content.mixed_passive': {
    severity: 'low', category: 'Mixed content', owasp: OWASP.A02, cwe: 'CWE-311',
    title: 'Images or media loaded over HTTP on an HTTPS page',
    summary: 'Passive mixed content can be swapped or tracked by a network attacker.',
    description: 'Images, audio or video load over plain HTTP. They can be replaced or used to track visitors, and browsers drop the padlock indicator.',
    remediation: 'Serve all media over HTTPS or add the CSP directive upgrade-insecure-requests.',
    references: ['https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content'],
  },
  'content.vulnerable_library': {
    severity: 'medium', category: 'Outdated components', owasp: OWASP.A06, cwe: 'CWE-1104',
    title: 'JavaScript library with known vulnerabilities',
    summary: 'The page loads a front-end library version with published CVEs.',
    description: 'A third-party library referenced by the page is older than the version that fixed publicly documented vulnerabilities (typically cross-site scripting or prototype pollution).',
    remediation: 'Upgrade the library to at least the fixed version listed in the evidence and keep front-end dependencies under automated update tooling (Dependabot, Renovate, npm audit).',
    references: ['https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/', 'https://retirejs.github.io/retire.js/'],
  },
  'content.sri_missing': {
    severity: 'low', category: 'Supply chain', owasp: OWASP.A08, cwe: 'CWE-353',
    title: 'Third-party script without Subresource Integrity',
    summary: 'If the external host is compromised, its script runs with full access to your page.',
    description: 'Scripts from other domains are included without an integrity hash, so the browser cannot detect if the file is tampered with at the CDN.',
    remediation: 'Add integrity="sha384-…" and crossorigin="anonymous" to <script> tags for files served from third-party CDNs, or self-host them.',
    references: ['https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity'],
  },
  'content.generator_version': {
    severity: 'low', category: 'Information disclosure', owasp: OWASP.A05, cwe: 'CWE-200',
    title: 'CMS version disclosed in page markup',
    summary: 'A generator meta tag announces the exact platform version.',
    description: 'Publishing the exact CMS version lets attackers immediately match the site against known exploits for that release.',
    remediation: 'Remove the generator meta tag (most CMSs have a setting or plugin for this) and keep the platform patched.',
    references: [],
  },

  // ------------------------------------------------------------------- headers
  'headers.csp_missing': {
    severity: 'medium', category: 'Security headers', owasp: OWASP.A05, cwe: 'CWE-1021',
    title: 'Content-Security-Policy header missing',
    summary: 'No browser-enforced policy limits where scripts can load from, so XSS is easier to exploit.',
    description: 'A Content Security Policy is the main defence-in-depth control against cross-site scripting and data injection: it tells the browser which sources of script, style and frames are legitimate.',
    remediation: 'Start with a report-only policy (Content-Security-Policy-Report-Only), tune it, then enforce, e.g. default-src \'self\'; script-src \'self\'; object-src \'none\'; base-uri \'self\'; frame-ancestors \'self\'.',
    references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP', 'https://csp-evaluator.withgoogle.com/'],
  },
  'headers.csp_unsafe': {
    severity: 'low', category: 'Security headers', owasp: OWASP.A05, cwe: 'CWE-1021',
    title: 'Content-Security-Policy allows unsafe scripts',
    summary: 'The policy permits inline scripts or eval, which removes most of its XSS protection.',
    description: 'script-src (or default-src) contains \'unsafe-inline\' without a nonce/hash, or \'unsafe-eval\'. Injected inline scripts will still execute.',
    remediation: 'Replace \'unsafe-inline\' with nonces or hashes (or \'strict-dynamic\'), and refactor code that relies on eval().',
    references: ['https://web.dev/articles/strict-csp'],
  },
  'headers.clickjacking': {
    severity: 'medium', category: 'Security headers', owasp: OWASP.A04, cwe: 'CWE-1021',
    title: 'Page can be framed by other sites (clickjacking)',
    summary: 'Neither X-Frame-Options nor CSP frame-ancestors is set.',
    description: 'A malicious site can load this page in an invisible iframe and trick users into clicking buttons (changing settings, making purchases, granting permissions).',
    remediation: 'Send Content-Security-Policy: frame-ancestors \'self\' (and X-Frame-Options: SAMEORIGIN for older browsers).',
    references: ['https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html'],
  },
  'headers.hsts_missing': {
    severity: 'medium', category: 'Security headers', owasp: OWASP.A02, cwe: 'CWE-319',
    title: 'Strict-Transport-Security (HSTS) header missing',
    summary: 'Browsers will still try HTTP first, leaving room for SSL-stripping attacks.',
    description: 'Without HSTS, a visitor\'s first request can be intercepted and downgraded to HTTP before the redirect happens.',
    remediation: 'Send Strict-Transport-Security: max-age=31536000; includeSubDomains (add preload once every subdomain supports HTTPS).',
    references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security', 'https://hstspreload.org/'],
  },
  'headers.hsts_weak': {
    severity: 'low', category: 'Security headers', owasp: OWASP.A02, cwe: 'CWE-319',
    title: 'HSTS max-age is too short',
    summary: 'The HSTS policy expires in less than 180 days.',
    description: 'A short max-age means browsers frequently forget the HTTPS-only rule, re-opening the downgrade window.',
    remediation: 'Use max-age of at least 15552000 (180 days); 31536000 (1 year) is recommended.',
    references: ['https://hstspreload.org/'],
  },
  'headers.xcto_missing': {
    severity: 'low', category: 'Security headers', owasp: OWASP.A05, cwe: 'CWE-693',
    title: 'X-Content-Type-Options header missing',
    summary: 'Browsers may MIME-sniff responses and execute uploaded files as scripts.',
    description: 'Without nosniff, a browser may interpret a file (e.g. a user upload) as HTML or JavaScript regardless of its declared type.',
    remediation: 'Send X-Content-Type-Options: nosniff on all responses.',
    references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Content-Type-Options'],
  },
  'headers.referrer_policy_missing': {
    severity: 'low', category: 'Security headers', owasp: OWASP.A05, cwe: 'CWE-200',
    title: 'Referrer-Policy header missing',
    summary: 'Full URLs (which may contain tokens or personal data) can leak to other sites.',
    description: 'Without an explicit policy, older browsers send the complete URL of the current page to every external site it links to or loads resources from.',
    remediation: 'Send Referrer-Policy: strict-origin-when-cross-origin (or no-referrer).',
    references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy'],
  },
  'headers.permissions_policy_missing': {
    severity: 'info', category: 'Security headers', owasp: OWASP.A05, cwe: null,
    title: 'Permissions-Policy header missing',
    summary: 'Powerful browser features (camera, geolocation, …) are not explicitly restricted.',
    description: 'Permissions-Policy limits which browser APIs the page and embedded iframes may use, reducing the impact of a compromised third-party script.',
    remediation: 'Send a policy disabling features you do not use, e.g. Permissions-Policy: camera=(), microphone=(), geolocation=().',
    references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy'],
  },
  'disclosure.server_version': {
    severity: 'low', category: 'Information disclosure', owasp: OWASP.A05, cwe: 'CWE-200',
    title: 'Server software version disclosed',
    summary: 'The Server header reveals the exact web-server version.',
    description: 'Version banners let attackers look up known vulnerabilities for that exact release without probing.',
    remediation: 'Hide version details (nginx: server_tokens off; Apache: ServerTokens Prod, ServerSignature Off; IIS: removeServerHeader).',
    references: [],
  },
  'disclosure.powered_by': {
    severity: 'low', category: 'Information disclosure', owasp: OWASP.A05, cwe: 'CWE-200',
    title: 'X-Powered-By header discloses technology',
    summary: 'The response advertises the framework or language version in use.',
    description: 'X-Powered-By has no functional purpose and helps attackers fingerprint the application stack.',
    remediation: 'Remove the header (PHP: expose_php = Off; Express: app.disable(\'x-powered-by\'); ASP.NET: remove in web.config).',
    references: [],
  },

  // ------------------------------------------------------------------- cookies
  'cookies.no_secure': {
    severity: 'medium', category: 'Cookies', owasp: OWASP.A02, cwe: 'CWE-614',
    title: 'Cookie set without the Secure flag',
    summary: 'The cookie can be sent over unencrypted HTTP and intercepted.',
    description: 'Without Secure, the browser will include the cookie in plain HTTP requests, where it can be stolen by a network attacker — for session cookies this means account takeover.',
    remediation: 'Add the Secure attribute to every cookie on an HTTPS site.',
    references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#restrict_access_to_cookies'],
  },
  'cookies.no_httponly': {
    severity: 'low', category: 'Cookies', owasp: OWASP.A05, cwe: 'CWE-1004',
    title: 'Cookie set without the HttpOnly flag',
    summary: 'JavaScript can read the cookie, so any XSS bug can steal it.',
    description: 'Cookies without HttpOnly are readable via document.cookie. If the cookie identifies a session, a single cross-site scripting flaw leads to session hijacking.',
    remediation: 'Add HttpOnly to every cookie that client-side JavaScript does not need (always for session/auth cookies).',
    references: ['https://owasp.org/www-community/HttpOnly'],
  },
  'cookies.no_samesite': {
    severity: 'low', category: 'Cookies', owasp: OWASP.A01, cwe: 'CWE-1275',
    title: 'Cookie set without a SameSite attribute',
    summary: 'The cookie relies on browser defaults for cross-site request protection.',
    description: 'An explicit SameSite attribute (Lax or Strict) limits when the browser sends the cookie on cross-site requests, which mitigates cross-site request forgery.',
    remediation: 'Set SameSite=Lax (or Strict) explicitly; use SameSite=None; Secure only for cookies that must work cross-site.',
    references: ['https://web.dev/articles/samesite-cookies-explained'],
  },

  // ---------------------------------------------------------------------- cors
  'cors.reflect_origin_credentials': {
    severity: 'high', category: 'CORS', owasp: OWASP.A01, cwe: 'CWE-942',
    title: 'CORS trusts any origin with credentials',
    summary: 'Any website can make authenticated requests and read the responses.',
    description: 'The server echoes back an arbitrary Origin in Access-Control-Allow-Origin together with Access-Control-Allow-Credentials: true. A malicious site visited by a logged-in user can read their data from this site.',
    remediation: 'Validate the Origin header against an explicit allow-list before reflecting it; never combine a reflected origin with credentials.',
    references: ['https://portswigger.net/web-security/cors', 'https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#cross-origin-resource-sharing'],
  },
  'cors.reflect_origin': {
    severity: 'medium', category: 'CORS', owasp: OWASP.A01, cwe: 'CWE-942',
    title: 'CORS reflects arbitrary origins',
    summary: 'Any website is allowed to read responses from this site.',
    description: 'The server copies any Origin header into Access-Control-Allow-Origin. Responses that depend on network position (intranet) or other implicit trust can be read by any site.',
    remediation: 'Only allow origins from an explicit allow-list.',
    references: ['https://portswigger.net/web-security/cors'],
  },
  'cors.wildcard': {
    severity: 'info', category: 'CORS', owasp: OWASP.A01, cwe: 'CWE-942',
    title: 'CORS allows all origins (*)',
    summary: 'Any website may read this page\'s responses (without cookies).',
    description: 'Access-Control-Allow-Origin: * is fine for genuinely public resources but should not be set on pages that return user-specific or internal data.',
    remediation: 'Confirm the content is public; otherwise restrict CORS to known origins.',
    references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS'],
  },

  // ------------------------------------------------------------------- methods
  'methods.trace': {
    severity: 'low', category: 'Server configuration', owasp: OWASP.A05, cwe: 'CWE-693',
    title: 'HTTP TRACE method is enabled',
    summary: 'TRACE echoes requests back and can aid cross-site tracing attacks.',
    description: 'The TRACE method reflects the full request, including headers, which has historically been used to bypass HttpOnly protections and reveals headers added by proxies.',
    remediation: 'Disable TRACE (Apache: TraceEnable Off; most other servers disable it by default).',
    references: ['https://owasp.org/www-community/attacks/Cross_Site_Tracing'],
  },

  // ----------------------------------------------------------------------- dns
  'dns.spf_missing': {
    severity: 'low', category: 'E-mail security', owasp: null, cwe: 'CWE-290',
    title: 'No SPF record for the domain',
    summary: 'Anyone can send e-mail that appears to come from this domain.',
    description: 'Without an SPF record, receiving mail servers cannot tell which servers are allowed to send mail for the domain, making phishing in your name easier.',
    remediation: 'Publish a TXT record such as "v=spf1 include:<your-mail-provider> -all" listing the services that send your mail.',
    references: ['https://www.cloudflare.com/learning/dns/dns-records/dns-spf-record/'],
  },
  'dns.dmarc_missing': {
    severity: 'low', category: 'E-mail security', owasp: null, cwe: 'CWE-290',
    title: 'No DMARC policy for the domain',
    summary: 'Spoofed e-mails from your domain are not rejected and you receive no reports about them.',
    description: 'DMARC tells receivers what to do with mail that fails SPF/DKIM and sends you reports about abuse of your domain.',
    remediation: 'Publish _dmarc.<domain> TXT "v=DMARC1; p=none; rua=mailto:dmarc@<domain>", monitor reports, then move to p=quarantine/reject.',
    references: ['https://dmarc.org/overview/'],
  },
};

function definitionFor(checkId) {
  const def = CATALOG[checkId];
  if (!def) throw new Error(`Unknown check id: ${checkId}`);
  return def;
}

module.exports = { CATALOG, SEVERITIES, SEVERITY_RANK, definitionFor };
