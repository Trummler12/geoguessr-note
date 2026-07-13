#!/usr/bin/env node
// Checks every external http(s) link in the project's Markdown (README + content/)
// for reachability, and exits non-zero if any link is genuinely broken.
//
//   node scripts/check-links.mjs
//
// No dependencies — uses the global fetch from Node 18+.
//
// Intended for local / trusted CI use only: it fetches every URL it finds, and
// the BLOCKED_HOST guard is best-effort (see its note), so don't run it on
// untrusted input without proper resolved-IP SSRF hardening.
//
// Result classes:
//   OK    2xx / 3xx
//   WARN  403 / 405 / 429 / 503 — reachable but blocked or throttled; not counted as failure
//   FAIL  404 / 410 / other 4xx / 5xx / timeout / network error — exits 1

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Hosts to skip entirely (never fetched): known-good but they block automated
// checks, so they'd only ever show up as noise. Add a RegExp per host to silence.
const IGNORE = [
  /\binaturalist\.org/, // 403s the bot UA; pages load fine in a browser
];

// Private/loopback/link-local hosts are never fetched: a public docs link should
// never point there, and fetching one on untrusted input would be an SSRF vector.
// Not airtight — a public hostname resolving to a private IP still gets through.
const BLOCKED_HOST = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /^\[?f[cd]/i,
];

const SKIP_DIRS = new Set(['.git', 'node_modules', 'themes', 'public', 'resources']);
const CONCURRENCY = 6;
const TIMEOUT_MS = 20000;
const MAX_RETRIES = 4; // for throttling / transient errors
const UA =
  'Mozilla/5.0 (compatible; geoguessr-note-linkcheck/1.0; +https://github.com/dingyiyi0226/geoguessr-note)';

const WARN_STATUS = new Set([403, 405, 429, 503]); // reachable but blocked/throttled
const RETRY_STATUS = new Set([429, 503]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseRetryAfter(value) {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs);
  // Retry-After may also be an HTTP-date rather than delta-seconds.
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, (date - Date.now()) / 1000);
}

async function collectMarkdown(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await collectMarkdown(join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const URL_PATTERNS = [
  /\]\(\s*(https?:\/\/[^)\s]+)\s*\)/g, // [text](url) and ![alt](url), tolerating spaces inside ()
  /[\w:.-]+\s*=\s*["'](https?:\/\/[^"']+)["']/g, // any attr="url": href, src, shortcode params (link=, …)
];

function extractUrls(text) {
  const urls = new Set();
  for (const pattern of URL_PATTERNS) {
    for (const match of text.matchAll(pattern)) urls.add(match[1]);
  }
  return urls;
}

async function requestStatus(url, method) {
  const res = await fetch(url, {
    method,
    redirect: 'follow',
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  try {
    await res.body?.cancel(); // don't download the body (some maps are several MB)
  } catch {}
  return { status: res.status, retryAfter: parseRetryAfter(res.headers.get('retry-after')) };
}

function isBlockedHost(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return BLOCKED_HOST.some((re) => re.test(host));
}

// Returns { class: 'ok' | 'warn' | 'fail', status, error? }
async function reachable(url) {
  if (isBlockedHost(url)) return { class: 'fail', status: 0, error: 'blocked host (SSRF guard)' };
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    let retryAfter = null;
    let error = null;
    try {
      // Prefer HEAD; fall back to GET (many CDNs reject or mishandle HEAD), but
      // not for retryable statuses — a GET would just double the load
      // on a host that's already throttling us.
      let r = await requestStatus(url, 'HEAD');
      if (!(r.status >= 200 && r.status < 400) && !RETRY_STATUS.has(r.status)) {
        r = await requestStatus(url, 'GET');
      }
      status = r.status;
      retryAfter = r.retryAfter;
    } catch (err) {
      error = err?.message || String(err);
    }

    if (!error && status >= 200 && status < 400) return { class: 'ok', status };

    const transient = error != null || RETRY_STATUS.has(status);
    if (transient && attempt < MAX_RETRIES) {
      const backoff = retryAfter != null ? retryAfter * 1000 : Math.min(8000, 500 * 2 ** attempt);
      await sleep(backoff + Math.random() * 300);
      continue;
    }

    if (!error && WARN_STATUS.has(status)) return { class: 'warn', status };
    return { class: 'fail', status, error };
  }
}

async function runPool(items, worker, size) {
  const results = new Array(items.length);
  let next = 0;
  const runner = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, runner));
  return results;
}

const files = [join(ROOT, 'README.md'), ...(await collectMarkdown(join(ROOT, 'content')))];
const usage = new Map(); // url -> Set(relative file paths)
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const rel = relative(ROOT, file);
  for (const url of extractUrls(text)) {
    if (IGNORE.some((re) => re.test(url))) continue;
    if (!usage.has(url)) usage.set(url, new Set());
    usage.get(url).add(rel);
  }
}

const urls = [...usage.keys()].sort();
if (urls.length === 0) {
  console.log('No external links found.');
  process.exit(0);
}

console.log(`Checking ${urls.length} external link(s) across ${files.length} Markdown file(s)…\n`);

const marks = { ok: '✓', warn: '⚠', fail: '✗' };
const results = await runPool(
  urls,
  async (url) => {
    const r = await reachable(url);
    console.log(`${marks[r.class]} ${String(r.status || 'ERR').padEnd(3)} ${url}`);
    return { url, ...r };
  },
  CONCURRENCY,
);

const warns = results.filter((r) => r.class === 'warn');
const fails = results.filter((r) => r.class === 'fail');

if (warns.length) {
  console.log(`\n${warns.length} warning(s) — reachable but blocked/throttled, not treated as failures:`);
  for (const r of warns) console.log(`  ⚠ [${r.status}] ${r.url}`);
}

if (fails.length) {
  console.log(`\n${fails.length} broken link(s):`);
  for (const r of fails) {
    console.log(`  ✗ [${r.status || r.error}] ${r.url}`);
    console.log(`      in: ${[...usage.get(r.url)].join(', ')}`);
  }
}

const ok = results.length - warns.length - fails.length;
console.log(`\n${ok} OK, ${warns.length} warning(s), ${fails.length} broken — of ${results.length} link(s).`);
process.exit(fails.length ? 1 : 0);
