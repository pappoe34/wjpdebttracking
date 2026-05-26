#!/usr/bin/env node
/*
 * verify-index-html.js
 *
 * Build-time integrity guard for index.html. Fails the Netlify deploy if
 * index.html appears truncated. The Edit tool truncated this file twice
 * (2026-05-23 and 2026-05-25), each causing an extended production outage
 * because the silent truncation dropped script tags and the closing
 * </body></html> tags.
 *
 * Checks performed (any failure exits 1):
 *   1. File ends with '</html>' (allowing trailing whitespace only).
 *   2. File contains exactly one <body> open and one </body> close.
 *   3. No mid-tag truncation — last non-whitespace line is '</html>'.
 *   4. Minimum file size of 100 KB (early-warning vs catastrophic loss).
 *   5. Every <script src="/x.js"> referenced exists in the publish dir.
 *
 * Invoked by Netlify build pipeline via netlify.toml [build] command.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = process.cwd();
const INDEX_PATH = path.join(REPO_ROOT, 'index.html');
const MIN_SIZE_BYTES = 100 * 1024;

function fail(msg) {
  console.error('\n❌ INDEX.HTML INTEGRITY CHECK FAILED');
  console.error('   ' + msg);
  console.error('\nThis blocks the deploy. Fix index.html locally and re-push.\n');
  process.exit(1);
}

function pass(msg) { console.log('   ✓ ' + msg); }

function main() {
  console.log('🛡  verify-index-html: checking ' + INDEX_PATH);

  if (!fs.existsSync(INDEX_PATH)) fail('index.html does not exist at repo root');

  const stat = fs.statSync(INDEX_PATH);
  if (stat.size < MIN_SIZE_BYTES) {
    fail(`index.html is only ${stat.size} bytes (min ${MIN_SIZE_BYTES}). Likely truncated.`);
  }
  pass(`size ok (${stat.size} bytes)`);

  const html = fs.readFileSync(INDEX_PATH, 'utf8');

  // Trim trailing whitespace, then verify the file ends with </html>
  const trimmed = html.replace(/\s+$/, '');
  if (!trimmed.endsWith('</html>')) {
    const tail = trimmed.slice(-80).replace(/\n/g, '\\n');
    fail(`index.html does NOT end with </html>. Tail: "...${tail}"`);
  }
  pass('ends with </html>');

  // Tag balance
  const bodyOpen = (html.match(/<body[\s>]/gi) || []).length;
  const bodyClose = (html.match(/<\/body>/gi) || []).length;
  if (bodyOpen !== 1) fail(`Expected exactly 1 <body> tag, found ${bodyOpen}`);
  if (bodyClose !== 1) fail(`Expected exactly 1 </body> tag, found ${bodyClose}`);
  pass(`<body>/</body> balanced (1/1)`);

  const htmlOpen = (html.match(/<html[\s>]/gi) || []).length;
  const htmlClose = (html.match(/<\/html>/gi) || []).length;
  if (htmlOpen !== 1) fail(`Expected exactly 1 <html> tag, found ${htmlOpen}`);
  if (htmlClose !== 1) fail(`Expected exactly 1 </html> tag, found ${htmlClose}`);
  pass(`<html>/</html> balanced (1/1)`);

  // Last non-whitespace line must be </html>
  const lines = html.split(/\r?\n/);
  let lastNonEmpty = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim()) { lastNonEmpty = lines[i].trim(); break; }
  }
  if (lastNonEmpty !== '</html>') {
    fail(`Last non-empty line is "${lastNonEmpty}", expected "</html>"`);
  }
  pass('last non-empty line is </html>');

  // Referenced /wjp-*.js scripts must exist on disk
  const scriptSrcRegex = /<script\s+src="\/(wjp-[\w./-]+\.js)(\?[^"]*)?"/g;
  const missing = [];
  let m;
  while ((m = scriptSrcRegex.exec(html))) {
    const src = m[1];
    if (!fs.existsSync(path.join(REPO_ROOT, src))) missing.push(src);
  }
  if (missing.length) {
    fail(`The following script files are referenced but missing on disk:\n     - ` + missing.join('\n     - '));
  }
  pass(`all referenced /wjp-*.js files exist on disk (${(html.match(scriptSrcRegex) || []).length} refs)`);

  console.log('\n✅ index.html integrity check passed.\n');
}

try { main(); } catch (e) {
  fail('Unexpected error: ' + (e && e.message || e));
}
