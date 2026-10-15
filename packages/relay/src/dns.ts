/** DNS-01 helper so nodes can get real certificates for <sub>.<domain> without the relay holding keys. */
export interface DnsProvider {
  setTxt(name: string, value: string): Promise<void>;
  removeTxt(name: string, value: string): Promise<void>;
}

export class CloudflareDns implements DnsProvider {
  readonly zoneId: string;
  readonly apiToken: string;
  constructor(zoneId: string, apiToken: string) {
    this.zoneId = zoneId;
    this.apiToken = apiToken;
  }
  private async api(path: string, init: RequestInit = {}) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${this.zoneId}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.apiToken}`, "content-type": "application/json" },
    });
    const body: any = await res.json();
    if (!body.success) throw new Error(`Cloudflare DNS: ${JSON.stringify(body.errors)}`);
    return body.result;
  }
  async setTxt(name: string, value: string) {
    await this.api("/dns_records", { method: "POST", body: JSON.stringify({ type: "TXT", name, content: value, ttl: 60 }) });
  }
  async removeTxt(name: string, value: string) {
    const rows = await this.api(`/dns_records?type=TXT&name=${encodeURIComponent(name)}`);
    for (const r of rows) if (r.content === value || r.content === `"${value}"`) await this.api(`/dns_records/${r.id}`, { method: "DELETE" });
  }
}

/** For tests and relays without DNS automation. */
export class MemoryDns implements DnsProvider {
  records = new Map<string, Set<string>>();
  async setTxt(name: string, value: string) {
    if (!this.records.has(name)) this.records.set(name, new Set());
    this.records.get(name)!.add(value);
  }
  async removeTxt(name: string, value: string) {
    this.records.get(name)?.delete(value);
  }
}
