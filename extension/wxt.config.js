import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: '.',
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,

  manifest: {
    name: 'CV Tailor',
    description:
      'Scan any job listing, compare it against your CV, and generate a tailored ATS-friendly CV.',
    version: '1.0.0',

    // activeTab lets the scanner read the page the user explicitly clicked the
    // extension on, without requesting access to every site they visit.
    permissions: ['activeTab', 'scripting', 'storage', 'tabs', 'downloads'],

    // Only the local backend is reachable; no remote hosts are declared.
    host_permissions: ['http://127.0.0.1/*', 'http://localhost/*'],

    action: { default_title: 'CV Tailor' },
  },

  vite: () => ({
    plugins: [tailwindcss()],

    // Force the automatic JSX runtime. Without this, esbuild compiles .jsx
    // with the classic transform, emitting React.createElement calls that
    // reference a global `React` which does not exist in a bundled module.
    // The popup then dies with "React is not defined" at render time.
    esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  }),
});
