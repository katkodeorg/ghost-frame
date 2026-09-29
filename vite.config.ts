import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * Emits docs/sw.js with a precache list of every built asset plus the static
 * files in public/, and a cache version derived from their contents.
 */
function serviceWorker(): Plugin {
  return {
    name: 'ghostframe-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const icons = readdirSync('public/icons').map((f) => `icons/${f}`);
      const files = ['./', 'index.html', 'manifest.webmanifest', 'favicon.svg', ...icons, ...built];
      const hash = createHash('sha256');
      for (const f of built) {
        const chunk = bundle[f];
        hash.update(f);
        hash.update(chunk.type === 'chunk' ? chunk.code : chunk.source);
      }
      const source = readFileSync('scripts/sw-template.js', 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__PRECACHE__', JSON.stringify([...new Set(files)], null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Relative base so the build works at https://<user>.github.io/<repo>/
  base: './',
  plugins: [serviceWorker(), ...(mode === 'https' ? [basicSsl()] : [])],
  build: {
    outDir: 'docs',
    emptyOutDir: true,
    target: 'es2020',
  },
  server: {
    // Allow HTTPS tunnels (cloudflared / ngrok) for testing on a phone.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app'],
  },
}));
