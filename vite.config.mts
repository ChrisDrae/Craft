import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vitest/config";
import { MemoryStore, handleIce, handleSignal } from "./api/_signal.ts";

/**
 * The multiplayer endpoints of api/ (Vercel functions when deployed) on the dev and preview servers too,
 * with mailboxes in memory, so friends on the same network can join a world served by `npm run dev`.
 */
function signaling(): Plugin {
  const store = new MemoryStore();
  const serve = async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== "/api/signal" && path !== "/api/ice") return next();
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, { method: req.method, body: req.method === "POST" ? body : undefined });
    const response = path === "/api/ice" ? await handleIce({}) : await handleSignal(request, store);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(await response.text());
  };
  // Nothing returned: a function returned from these hooks would be run later as a hook of its own
  const use = (server: { middlewares: { use(fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): unknown } }): void => {
    server.middlewares.use((req, res, next) => void serve(req, res, next));
  };
  return { name: "craft-signaling", configureServer: use, configurePreviewServer: use };
}

export default defineConfig({
  base: "./",
  plugins: [signaling()],
  server: {
    watch: {
      // Native file events get dropped on Windows when files change in quick succession
      usePolling: true,
      interval: 100,
      ignored: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
    },
  },
  build: { target: "es2022" },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
