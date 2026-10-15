import { randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { Grant, Store } from "@satchel/core";
import { checkPassword, type NodeConfig } from "./config.ts";
import { esc, page } from "./html.ts";

export const ALL_SCOPES = ["read", "write", "organize", "reveal"] as const;
const SCOPE_TEXT: Record<string, string> = {
  read: "Search and read records (sensitive fields stay masked)",
  write: "Add and edit metadata",
  organize: "Propose renames and moves, edit VAULT.md (you approve each plan)",
  reveal: "See sensitive fields unmasked without asking (only for agents you fully trust)",
};
const ACCESS_TTL = 3600;
const REFRESH_TTL = 90 * 24 * 3600;

/**
 * OAuth 2.1 authorization server embedded in the node. The consent page, password check and token
 * signing all run on the owner's hardware, so the relay operator can never mint access.
 */
export class SatchelAuthProvider implements OAuthServerProvider {
  readonly store: Store;
  readonly getConfig: () => NodeConfig;

  constructor(store: Store, getConfig: () => NodeConfig) {
    this.store = store;
    this.getConfig = getConfig;
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    const store = this.store;
    return {
      getClient: (id) => store.getClient(id),
      registerClient: (client) => {
        const full = { ...client, client_id: randomUUID(), client_id_issued_at: Math.floor(Date.now() / 1000) } as OAuthClientInformationFull;
        store.saveClient(full);
        return full;
      },
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    res.type("html").send(consentPage(client, params, this.getConfig()));
  }

  /** POST /oauth/consent – the owner submitted the consent form. */
  async handleConsent(req: Request, res: Response) {
    const b = req.body ?? {};
    const client = this.store.getClient(String(b.client_id ?? ""));
    if (!client) return res.status(400).type("html").send(page("Unknown client", "<p>This client is not registered.</p>"));
    const redirect = new URL(String(b.redirect_uri));
    if (!client.redirect_uris.includes(redirect.href)) return res.status(400).send("redirect_uri mismatch");
    if (b.action === "deny") {
      redirect.searchParams.set("error", "access_denied");
      if (b.state) redirect.searchParams.set("state", String(b.state));
      return res.redirect(302, redirect.href);
    }
    const config = this.getConfig();
    if (!checkPassword(config.owner, String(b.password ?? ""))) {
      const params: AuthorizationParams = {
        redirectUri: redirect.href,
        codeChallenge: String(b.code_challenge),
        state: b.state ? String(b.state) : undefined,
        scopes: String(b.requested_scopes ?? "")
          .split(" ")
          .filter(Boolean),
        resource: b.resource ? new URL(String(b.resource)) : undefined,
      };
      return res
        .status(401)
        .type("html")
        .send(consentPage(client, params, config, "Wrong password."));
    }
    const asArray = (v: unknown) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
    const roots = asArray(b.roots).filter((r) => config.roots.some((x) => x.name === r));
    const scopes = asArray(b.scopes).filter((s) => (ALL_SCOPES as readonly string[]).includes(s));
    if (!scopes.includes("read")) scopes.unshift("read");
    const grant: Grant = { roots, scopes, label: client.client_name ?? "MCP client" };
    const code = randomBytes(24).toString("base64url");
    this.store.saveCode(code, client.client_id, grant, String(b.code_challenge), redirect.href, b.resource ? String(b.resource) : undefined);
    redirect.searchParams.set("code", code);
    if (b.state) redirect.searchParams.set("state", String(b.state));
    res.redirect(302, redirect.href);
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, code: string): Promise<string> {
    const row = this.store.getCode(code);
    if (!row) throw new InvalidGrantError("Invalid or expired authorization code");
    return row.challenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<OAuthTokens> {
    const row = this.store.getCode(code);
    if (!row || row.client_id !== client.client_id) throw new InvalidGrantError("Invalid authorization code");
    this.store.deleteCode(code);
    return this.issue(client.client_id, row.grant);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const row = this.store.findToken(refreshToken);
    if (row?.kind !== "refresh" || row.client_id !== client.client_id) throw new InvalidGrantError("Invalid refresh token");
    this.store.revokeToken(refreshToken);
    return this.issue(client.client_id, row.grant);
  }

  private issue(clientId: string, grant: Grant): OAuthTokens {
    const access = this.store.issueToken("access", clientId, grant, ACCESS_TTL);
    const refresh = this.store.issueToken("refresh", clientId, grant, REFRESH_TTL);
    return { access_token: access, token_type: "bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope: grant.scopes.join(" ") };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = this.store.findToken(token);
    if (!row || row.kind === "refresh") throw new InvalidTokenError("Invalid or expired token");
    const clientId = row.kind === "pat" ? `pat:${row.hash}` : row.client_id;
    return {
      token,
      clientId,
      scopes: row.grant.scopes,
      expiresAt: row.expires_at ? Math.floor(row.expires_at / 1000) : Math.floor(Date.now() / 1000) + 3600,
      extra: { grant: row.grant, clientName: row.kind === "pat" ? row.label : this.store.clientName(row.client_id) },
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: { token: string }): Promise<void> {
    this.store.revokeToken(request.token);
  }
}

function consentPage(client: OAuthClientInformationFull, params: AuthorizationParams, config: NodeConfig, error?: string): string {
  const requested = params.scopes?.length ? params.scopes : ["read"];
  const hidden = (n: string, v: string | undefined) => (v ? `<input type="hidden" name="${n}" value="${esc(v)}">` : "");
  let redirectHost = "";
  try {
    redirectHost = new URL(params.redirectUri).host;
  } catch {}
  const body = `
  <form method="post" action="/oauth/consent" class="card narrow">
    <p class="eyebrow">Connection request</p>
    <h1>${esc(client.client_name ?? "An MCP client")} wants to access your vault</h1>
    <p class="muted">It will be redirected back to <code>${esc(redirectHost)}</code>. You can revoke access any time from the Satchel app.</p>
    ${error ? `<p class="error">${esc(error)}</p>` : ""}
    <fieldset><legend>Folders it can see</legend>
      ${config.roots.map((r) => `<label class="check"><input type="checkbox" name="roots" value="${esc(r.name)}" checked> <b>${esc(r.name)}</b> <span class="muted">${esc(r.path)}</span></label>`).join("")}
    </fieldset>
    <fieldset><legend>What it can do</legend>
      ${ALL_SCOPES.map(
        (s) =>
          `<label class="check"><input type="checkbox" name="scopes" value="${s}" ${s === "read" ? "checked disabled" : requested.includes(s) && s !== "reveal" ? "checked" : ""}> <b>${s}</b> <span class="muted">${esc(SCOPE_TEXT[s])}</span></label>`,
      ).join("")}
      <input type="hidden" name="scopes" value="read">
    </fieldset>
    <label>Owner password<input type="password" name="password" autocomplete="current-password" autofocus required></label>
    ${hidden("client_id", client.client_id)}${hidden("redirect_uri", params.redirectUri)}${hidden("state", params.state)}
    ${hidden("code_challenge", params.codeChallenge)}${hidden("resource", params.resource?.href)}${hidden("requested_scopes", requested.join(" "))}
    <div class="row"><button type="submit" name="action" value="allow" class="primary">Allow</button>
    <button type="submit" name="action" value="deny" formnovalidate>Deny</button></div>
  </form>`;
  return page("Connect to Satchel", body);
}
