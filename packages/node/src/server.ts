import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response, type NextFunction } from "express";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Grant } from "@satchel/core";
import { SatchelAuthProvider, ALL_SCOPES } from "./auth.ts";
import { buildMcpServer } from "./mcp.ts";
import type { SatchelNode } from "./node.ts";
import { adminRouter } from "./admin.ts";
import { companionRouter } from "./companion.ts";
import { ensureCertificate } from "./certs.ts";
import { page } from "./html.ts";

/** Resolved at app creation so embedders (the desktop app) can set SATCHEL_UI_DIR first. */
const uiDir = () => process.env.SATCHEL_UI_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui");

export function baseUrl(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

export function createApp(node: SatchelNode) {
  const UI_DIR = uiDir();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  const provider = new SatchelAuthProvider(node.store, () => node.config);

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (!req.path.startsWith("/mcp")) res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  // OAuth endpoints are mounted per origin, because the same node answers on localhost and on its
  // public relay hostname and the issuer must match the URL the client used.
  const authRouters = new Map<string, express.RequestHandler>();
  app.use(["/authorize", "/token", "/register", "/revoke", "/oauth/consent"], rateLimiter(60, 15 * 60_000));
  app.use((req, res, next) => {
    const base = baseUrl(req);
    let router = authRouters.get(base);
    if (!router) {
      router = mcpAuthRouter({
        provider,
        issuerUrl: new URL(base),
        resourceServerUrl: new URL("/mcp", base),
        scopesSupported: [...ALL_SCOPES],
        resourceName: `Satchel (${node.config.name})`,
        serviceDocumentationUrl: new URL("https://satchel.dev/docs"),
        // Routers are built lazily per origin, so the shared limiter below is used instead.
        authorizationOptions: { rateLimit: false },
        tokenOptions: { rateLimit: false },
        clientRegistrationOptions: { rateLimit: false },
        revocationOptions: { rateLimit: false },
      });
      authRouters.set(base, router);
    }
    router(req, res, next);
  });

  app.post("/oauth/consent", express.urlencoded({ extended: false }), (req, res) => void provider.handleConsent(req, res));

  // ---- MCP (stateless Streamable HTTP; one server instance per request, bound to the caller)
  const bearer = (req: Request, res: Response, next: NextFunction) =>
    requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL("/mcp", baseUrl(req))) })(req, res, next);

  app.post("/mcp", express.json({ limit: "4mb" }), bearer, async (req, res) => {
    const auth = (req as any).auth;
    const grant = auth.extra.grant as Grant;
    const server = buildMcpServer(node, { clientId: auth.clientId, clientName: String(auth.extra.clientName), grant });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const notAllowed = (_req: Request, res: Response) =>
    res
      .status(405)
      .set("Allow", "POST")
      .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);

  // ---- owner UIs
  app.use("/admin/api", express.json({ limit: "2mb" }), adminRouter(node));
  app.use("/admin", express.static(path.join(UI_DIR, "admin"), { index: "index.html" }));
  app.use("/app/api", companionRouter(node));
  app.use("/app", express.static(path.join(UI_DIR, "app"), { index: "index.html" }));
  app.use("/ui", express.static(path.join(UI_DIR, "shared")));

  app.get("/", (req, res) => {
    const local = ["127.0.0.1", "localhost", "::1"].includes(req.hostname);
    if (local) return res.redirect("/admin/");
    res.type("html").send(
      page(
        "Satchel node",
        `<div class="card narrow"><p class="eyebrow">Satchel node</p><h1>${node.config.name}</h1>
        <p class="muted">This is a personal Satchel vault. AI agents connect at <code>${baseUrl(req)}/mcp</code>; the owner uses the <a href="/app/">Satchel companion</a>.</p></div>`,
      ),
    );
  });
  return app;
}

/** Small fixed-window limiter per client IP for the OAuth endpoints. */
function rateLimiter(max: number, windowMs: number): express.RequestHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req, res, next) => {
    const key = req.socket.remoteAddress ?? "?";
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) {
      h = { n: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    if (++h.n > max) return void res.status(429).json({ error: "too_many_requests" });
    next();
  };
}

export type RunningServers = { http: http.Server; https: https.Server | null; close: () => Promise<void> };

/**
 * Starts the loopback HTTP listener (admin UI, local agents) and the TLS listener the tunnel forwards
 * to. The TLS key never leaves this machine; the relay only ever sees encrypted bytes.
 */
export async function startServers(node: SatchelNode): Promise<RunningServers> {
  const app = createApp(node);
  const httpServer = http.createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(node.config.listen.port, node.config.listen.host, resolve));
  let httpsServer: https.Server | null = null;
  if (node.config.publicHost || node.config.relay) {
    const cert = await ensureCertificate(node);
    httpsServer = https.createServer({ key: cert.key, cert: cert.cert }, app);
    await new Promise<void>((resolve) => httpsServer!.listen(node.config.tlsPort, "127.0.0.1", resolve));
  }
  return {
    http: httpServer,
    https: httpsServer,
    close: async () => {
      httpServer.closeAllConnections();
      httpsServer?.closeAllConnections();
      await Promise.all([new Promise((r) => httpServer.close(r)), httpsServer ? new Promise((r) => httpsServer!.close(r)) : null]);
    },
  };
}
