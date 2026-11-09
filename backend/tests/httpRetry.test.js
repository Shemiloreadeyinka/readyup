import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchWithRetry, parseDuration, retryDelayMs } from '../src/ai/httpRetry.js';

/**
 * Rate limiting is normal operation on a free tier, not an error: this
 * pipeline sends four large requests in a burst. These tests cover the wait
 * logic that lets a run finish anyway.
 */

let server;
let baseUrl;
let script = [];
let requestCount = 0;

before(async () => {
  server = http.createServer((req, res) => {
    const step = script[Math.min(requestCount, script.length - 1)];
    requestCount += 1;

    for (const [name, value] of Object.entries(step.headers ?? {})) res.setHeader(name, value);
    res.writeHead(step.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(step.body ?? {}));
  });

  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const useScript = (steps) => {
  script = steps;
  requestCount = 0;
};

/* ----------------------------- duration parsing ------------------------- */

test('parseDuration understands the formats providers actually send', () => {
  assert.equal(parseDuration('36.877s'), 36877);
  assert.equal(parseDuration('2m30s'), 150000);
  assert.equal(parseDuration('7m12s'), 432000);
  assert.equal(parseDuration('500ms'), 500);
  assert.equal(parseDuration('30'), 30000, 'bare numbers are seconds, as in Retry-After');
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('soon'), null);
});

test('the wait comes from the headers when the server provides them', () => {
  const withRetryAfter = { headers: new Headers({ 'retry-after': '12' }) };
  assert.equal(retryDelayMs(withRetryAfter, 0), 12000);

  // Groq sends reset windows rather than Retry-After. These are the real
  // headers observed when the token budget ran out but requests had not.
  const tokensExhausted = {
    headers: new Headers({
      'x-ratelimit-reset-tokens': '36.877s',
      'x-ratelimit-remaining-tokens': '0',
      'x-ratelimit-reset-requests': '7m12s',
      'x-ratelimit-remaining-requests': '995',
    }),
  };
  assert.equal(
    retryDelayMs(tokensExhausted, 0),
    37377,
    'should wait for the exhausted token window, not the daily request window',
  );

  // When requests are the exhausted dimension, that window is the one to wait for.
  const requestsExhausted = {
    headers: new Headers({
      'x-ratelimit-reset-tokens': '10s',
      'x-ratelimit-remaining-tokens': '7000',
      'x-ratelimit-reset-requests': '45s',
      'x-ratelimit-remaining-requests': '0',
    }),
  };
  assert.equal(retryDelayMs(requestsExhausted, 0), 45500);
});

test('the wait is capped so a run cannot hang indefinitely', () => {
  const absurd = { headers: new Headers({ 'retry-after': '99999' }) };
  assert.ok(retryDelayMs(absurd, 0) <= 75_000);
});

test('without headers it backs off exponentially', () => {
  const bare = { headers: new Headers() };
  const first = retryDelayMs(bare, 0);
  const third = retryDelayMs(bare, 2);
  assert.ok(first >= 1000 && first < 1600);
  assert.ok(third >= 4000 && third < 4600);
});

/* ------------------------------ retry behaviour ------------------------- */

test('a rate limited request succeeds after waiting', async () => {
  useScript([
    { status: 429, headers: { 'retry-after': '0.05' } },
    { status: 429, headers: { 'retry-after': '0.05' } },
    { status: 200, body: { ok: true } },
  ]);

  const waits = [];
  const response = await fetchWithRetry(baseUrl, {}, { onRetry: (info) => waits.push(info) });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(requestCount, 3, 'should have tried three times');
  assert.equal(waits.length, 2);
  assert.equal(waits[0].status, 429);
});

test('a persistent rate limit returns the last response rather than hanging', async () => {
  useScript([{ status: 429, headers: { 'retry-after': '0.01' } }]);

  const response = await fetchWithRetry(baseUrl, {}, { retries: 2 });

  assert.equal(response.status, 429);
  assert.equal(requestCount, 3, 'initial attempt plus two retries');
});

test('server errors are retried, client errors are not', async () => {
  useScript([{ status: 503, headers: { 'retry-after': '0.01' } }, { status: 200, body: {} }]);
  assert.equal((await fetchWithRetry(baseUrl, {}, { retries: 2 })).status, 200);

  // A bad key must fail immediately: retrying cannot fix it.
  useScript([{ status: 401, body: { error: 'bad key' } }]);
  const unauthorised = await fetchWithRetry(baseUrl, {}, { retries: 3 });
  assert.equal(unauthorised.status, 401);
  assert.equal(requestCount, 1, '401 must not be retried');

  useScript([{ status: 400, body: {} }]);
  await fetchWithRetry(baseUrl, {}, { retries: 3 });
  assert.equal(requestCount, 1, '400 must not be retried');
});

test('a successful first attempt makes no extra requests', async () => {
  useScript([{ status: 200, body: { fine: true } }]);
  const response = await fetchWithRetry(baseUrl, {}, { retries: 3 });

  assert.equal(response.status, 200);
  assert.equal(requestCount, 1);
});

test('aborting during the wait stops the retry loop', async () => {
  useScript([{ status: 429, headers: { 'retry-after': '30' } }]);

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);

  await assert.rejects(
    () => fetchWithRetry(baseUrl, {}, { retries: 3, signal: controller.signal }),
    (error) => error.name === 'AbortError',
  );
});
