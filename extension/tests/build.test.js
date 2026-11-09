import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Assertions about the built artifact, not the source.
 *
 * A successful build is not proof of a working extension: the popup once
 * compiled cleanly while emitting classic-runtime React.createElement calls
 * that referenced a global `React`, so it died with "React is not defined" the
 * moment it rendered. These tests inspect what actually ships.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.output', 'chrome-mv3');

const readOutput = (relativePath) => fs.readFileSync(path.join(outDir, relativePath), 'utf8');

const popupBundle = () => {
  const chunksDir = path.join(outDir, 'chunks');
  const file = fs.readdirSync(chunksDir).find((name) => /^popup-.*\.js$/.test(name));
  assert.ok(file, 'no popup chunk was produced');
  return fs.readFileSync(path.join(chunksDir, file), 'utf8');
};

test('the build output exists', () => {
  assert.ok(
    fs.existsSync(path.join(outDir, 'manifest.json')),
    'run "npm run build" before the tests (npm test does this for you)',
  );
});

test('the popup uses the automatic JSX runtime', () => {
  const bundle = popupBundle();

  // The classic transform emits React.createElement against a global binding
  // that bundled modules do not have.
  assert.equal(
    (bundle.match(/React\.createElement/g) ?? []).length,
    0,
    'popup was compiled with the classic JSX runtime; set esbuild.jsx to "automatic" in wxt.config.js',
  );

  assert.ok(
    /jsxs?\b|jsxRuntime|react\/jsx/.test(bundle),
    'no automatic JSX runtime found in the popup bundle',
  );
});

test('the popup has no free references to a global React', () => {
  // React's own code mentions "React" inside error message strings, which is
  // fine. A property access or call on a bare React identifier is not, so
  // string literals are removed before scanning.
  const bundle = popupBundle()
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

  const suspicious = bundle.match(/(^|[^.\w$])React\s*[.(]/g) ?? [];
  assert.deepEqual(
    suspicious,
    [],
    `the bundle dereferences a global React: ${suspicious.slice(0, 3).join(', ')}`,
  );
});

test('the manifest requests only the permissions the app needs', () => {
  const manifest = JSON.parse(readOutput('manifest.json'));

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), [
    'activeTab',
    'downloads',
    'scripting',
    'storage',
    'tabs',
  ]);

  // The scanner runs through activeTab, so no broad host access is requested
  // and the extension cannot reach any remote server.
  assert.ok(!manifest.permissions.includes('<all_urls>'));
  for (const host of manifest.host_permissions) {
    assert.match(host, /^http:\/\/(127\.0\.0\.1|localhost)\//, `unexpected host permission ${host}`);
  }
  assert.ok(!manifest.content_scripts, 'no content script should be auto-injected');
});

test('the popup entry point is wired up', () => {
  const manifest = JSON.parse(readOutput('manifest.json'));
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.ok(fs.existsSync(path.join(outDir, 'popup.html')));
});

test('the background bundle carries a self-contained scanner', () => {
  const background = readOutput('background.js');

  // chrome.scripting.executeScript serialises the function, so the scanner
  // must survive bundling as a standalone function declaration.
  const injected = background.match(/func:\s*([A-Za-z_$][\w$]*)/);
  assert.ok(injected, 'no function is passed to executeScript');

  const declaration = new RegExp(`function\\s+${injected[1]}\\s*\\(`);
  assert.ok(
    declaration.test(background),
    `${injected[1]} is not declared as a top-level function in the bundle`,
  );

  // Spot-check that the extraction rules survived rather than being split out.
  for (const marker of ['JobPosting', 'jobs-description__content', 'jobDescriptionText']) {
    assert.ok(background.includes(marker), `scanner lost "${marker}" during bundling`);
  }
});

test('no source maps or stray files leak into the build', () => {
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });

  const leaked = walk(outDir).filter((file) => file.endsWith('.map'));
  assert.deepEqual(leaked, [], 'production build should not ship source maps');
});
