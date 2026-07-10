#!/usr/bin/env node
// Checks every external http(s) link in the project's Markdown (README + content/)
// for reachability, and exits non-zero if any link is genuinely broken.
//
//   node scripts/check-links.mjs
//
// No dependencies — uses the global fetch from Node 18+.
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

const SKIP_DIRS = new Set(['.git', 'node_modules', 'themes', 'public', 'resources']);
const CONCURRENCY = 6;
const TIMEOUT_MS = 20000;
const MAX_RETRIES = 4; // for throttling / transient errors
const UA =
  'Mozilla/5.0 (compatible; geoguessr-note-linkcheck/1.0; +https://github.com/dingyiyi0226/geoguessr-note)';

const WARN_STATUS = new Set([403, 405, 429, 503]); // reachable but blocked/throttled
const RETRY_STATUS = new Set([429, 503]);

// Add a RegExp here to skip a host that blocks automated checks but is known-good.
const IGNORE = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  /\]\((https?:\/\/[^)\s]+)\)/g, // [text](url) and ![alt](url)
  /(?:href|src)\s*=\s*["'](https?:\/\/[^"']+)["']/g, // <a href="…"> / <img src="…">
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
  const retryAfter = Number(res.headers.get('retry-after'));
  return { status: res.status, retryAfter: Number.isFinite(retryAfter) ? retryAfter : null };
}

// Returns { class: 'ok' | 'warn' | 'fail', status, error? }
async function reachable(url) {
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    let retryAfter = null;
    let error = null;
    try {
      // Prefer HEAD; fall back to GET (many CDNs reject or mishandle HEAD).
      let r = await requestStatus(url, 'HEAD');
      if (!(r.status >= 200 && r.status < 400)) r = await requestStatus(url, 'GET');
      status = r.status;
      retryAfter = r.retryAfter;
    } catch (err) {
      error = err?.message || String(err);
    }

    if (!error && status >= 200 && status < 400) return { class: 'ok', status };

    const transient = error != null || RETRY_STATUS.has(status);
    if (transient && attempt < MAX_RETRIES) {
      const backoff = retryAfter ? retryAfter * 1000 : Math.min(8000, 500 * 2 ** attempt);
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

const files = await collectMarkdown(ROOT);
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
