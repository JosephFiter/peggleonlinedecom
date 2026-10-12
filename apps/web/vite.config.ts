import { defineConfig, loadEnv, type Plugin } from 'vite';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/**
 * Dev-only convenience: when PEGGLE_DIR points at a local Peggle Nights
 * install, the dev server exposes those files so the page can load them
 * without picking the folder on every reload. Not part of production builds.
 */
function devGameFiles(dir: string | undefined): Plugin {
  return {
    name: 'peggle-dev-game-files',
    apply: 'serve',
    configureServer(server) {
      if (!dir || !existsSync(join(dir, 'main.pak'))) return;
      const root = resolve(dir);
      const list = (): string[] => {
        const out = ['main.pak'];
        for (const sub of ['levelpacks', 'music']) {
          const p = join(root, sub);
          if (existsSync(p)) for (const f of readdirSync(p)) out.push(`${sub}/${f}`);
        }
        return out;
      };
      server.middlewares.use('/__dev_game/', (req, res) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]!.replace(/^\//, ''));
        if (url === 'list') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(list()));
          return;
        }
        const file = resolve(root, url);
        if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('content-type', 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // PEGGLE_DIR may come from the shell or from apps/web/.env.local (gitignored).
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [devGameFiles(process.env.PEGGLE_DIR ?? env.PEGGLE_DIR)],
    optimizeDeps: {
      include: ['@cornerstonejs/codec-openjpeg/decodewasmjs'],
    },
  };
});
