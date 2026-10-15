// Seeds a realistic demo vault + node state, used for local demos and the report screenshots.
//   node scripts/demo-seed.ts [dir]        -> creates <dir>/vault and <dir>/data (default .satchel-dev)
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { saveConfig, loadConfig, hashPassword, SatchelNode } from "../packages/node/src/index.ts";
import { buildMcpServer } from "../packages/node/src/mcp.ts";

const dir = path.resolve(process.argv[2] ?? ".satchel-dev");
const vault = path.join(dir, "vault");
const data = path.join(dir, "data");
await rm(dir, { recursive: true, force: true });

const today = new Date();
const plus = (days: number) => new Date(today.getTime() + days * 86400_000).toISOString().slice(0, 10);

const files: Record<string, string> = {
  "People/Alex/ID/2024-05 Driver License (exp 2032-05).txt": `STATE OF CALIFORNIA · DRIVER LICENSE\nDL D7741025\nCLASS C\nEXP ${plus(2400)}\nRIVERA, ALEX\n`,
  "People/Alex/ID/2019-03 Passport.txt": `PASSPORT · UNITED STATES OF AMERICA\nPassport No. 567123498\nDate of expiry ${plus(150)}\n`,
  "People/Alex/Medical/2025-11 Eye Prescription.txt": `Bright Eyes Optometry\nOD -2.25 -0.50 x 180\nOS -2.00 -0.25 x 175\nPrescription valid until ${plus(38)}\n`,
  "Vehicles/2019 Honda Civic/Registration/2025-03 Registration.txt": `DMV REGISTRATION CARD\nPlate 8ABC123 · VIN 2HGFC2F59KH512345\nValid through ${plus(21)}\n`,
  "Vehicles/2019 Honda Civic/Insurance/2026-01 Auto Policy.txt": `Acme Mutual auto policy\nPolicy number AM-99812-77\nTerm ends ${plus(92)}\n`,
  "Home/Lease/2026-02 Apartment Lease.txt": `Residential lease\nTerm ends ${plus(140)}\nNotice period: 60 days\n`,
  "Home/Warranties/2024-08 Dishwasher Warranty.txt": `Bosch extended warranty\nCoverage until ${plus(-12)}\n`,
  "Pets/Mochi/2026-04 Rabies Vaccination.txt": `Rabies vaccine certificate · Mochi (cat)\nNext due ${plus(200)}\n`,
  "Scans/IMG_4471.txt": `GLOBAL ENTRY · TRUSTED TRAVELER\nPASSID 158822041\nExpires ${plus(820)}\n`,
  "Scans/scan_2026-10-02.txt": `Costco Optical receipt\nContact lenses 6-month supply\n`,
  "Inbox/2026-10-12 photo.txt": `SMOG CHECK CERTIFICATE\nVehicle 2HGFC2F59KH512345\nPASS\n`,
};
for (const [rel, body] of Object.entries(files)) {
  await mkdir(path.dirname(path.join(vault, rel)), { recursive: true });
  await writeFile(path.join(vault, rel), body);
}

const config = loadConfig(data);
config.name = "Alex's NAS";
config.roots = [{ name: "home", path: vault }];
config.owner = hashPassword(process.env.SATCHEL_PASSWORD ?? "demo");
config.listen = { host: "127.0.0.1", port: Number(process.env.SATCHEL_PORT ?? 7710) };
config.inbox = "home/Inbox";
saveConfig(data, config);

const node = new SatchelNode(data);
await node.start();
const meta: Record<string, Record<string, unknown>> = {
  "People/Alex/ID/2024-05 Driver License (exp 2032-05).txt": { doc_type: "drivers_license", subject: "Alex", title: "California Driver License", issued_on: "2024-05-14", expires_on: plus(2400), license_number: "D7741025" },
  "People/Alex/ID/2019-03 Passport.txt": { doc_type: "passport", subject: "Alex", title: "US Passport", expires_on: plus(150), renew_by: plus(-30), passport_number: "567123498" },
  "People/Alex/Medical/2025-11 Eye Prescription.txt": { doc_type: "eye_prescription", subject: "Alex", title: "Eye prescription", expires_on: plus(38), provider: "Bright Eyes Optometry" },
  "Vehicles/2019 Honda Civic/Registration/2025-03 Registration.txt": { doc_type: "vehicle_registration", subject: "2019 Honda Civic", title: "Civic registration", expires_on: plus(21), plate_number: "8ABC123", vin_number: "2HGFC2F59KH512345" },
  "Vehicles/2019 Honda Civic/Insurance/2026-01 Auto Policy.txt": { doc_type: "insurance_policy", subject: "2019 Honda Civic", title: "Auto insurance", expires_on: plus(92), policy_number: "AM-99812-77" },
  "Home/Lease/2026-02 Apartment Lease.txt": { doc_type: "lease", subject: "Home", title: "Apartment lease", expires_on: plus(140), renew_by: plus(80) },
  "Home/Warranties/2024-08 Dishwasher Warranty.txt": { doc_type: "warranty", subject: "Home", title: "Dishwasher warranty", expires_on: plus(-12) },
  "Pets/Mochi/2026-04 Rabies Vaccination.txt": { doc_type: "vaccination", subject: "Mochi", title: "Rabies vaccination", expires_on: plus(200) },
};
for (const [rel, m] of Object.entries(meta)) await node.vault.setMetadata(`home/${rel}`, m, { actor: "Claude (claude.ai)" });

// Connections: an OAuth client as a connector would register, plus a personal token.
node.store.saveClient({ client_id: "c-claude", client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] } as any);
node.store.issueToken("refresh", "c-claude", { label: "Claude", roots: ["*"], scopes: ["read", "write", "organize"] }, 90 * 86400);
node.store.saveClient({ client_id: "c-gemini", client_name: "Gemini", redirect_uris: ["https://gemini.google.com/cb"] } as any);
node.store.issueToken("refresh", "c-gemini", { label: "Gemini", roots: ["*"], scopes: ["read"] }, 90 * 86400);
const pat = node.store.issueToken("pat", "pat", { label: "Claude Code (laptop)", roots: ["*"], scopes: ["read", "write", "organize"] }, null);

// Drive a realistic agent session through the real MCP tools.
const claude = { clientId: "c-claude", clientName: "Claude", grant: { label: "Claude", roots: ["*"], scopes: ["read", "write", "organize"] } };
const server: any = buildMcpServer(node, claude);
const call = async (name: string, args: any = {}) => {
  const tool = server._registeredTools[name];
  const res = await tool.handler(args, {});
  return JSON.parse(res.content[0].text);
};
await call("vault_status");
await call("list_expiring", { within_days: 90, include_past_days: 30, keys: ["expires_on", "renew_by"] });
await call("get_record", { path: "home/Vehicles/2019 Honda Civic/Registration/2025-03 Registration.txt" });
await call("set_metadata", { path: "home/Scans/IMG_4471.txt", fields: { doc_type: "trusted_traveler", subject: "Alex", title: "Global Entry card", expires_on: plus(820), passid_number: "158822041" }, replace: false, reason: "" });
await call("propose_reorganization", {
  moves: [
    { from: "home/Scans/IMG_4471.txt", to: `home/People/Alex/ID/2025-12 Global Entry (exp ${plus(820).slice(0, 7)}).txt` },
    { from: "home/Scans/scan_2026-10-02.txt", to: "home/People/Alex/Medical/2026-10 Contact Lens Receipt.txt" },
  ],
  reason: "Scans folder has two documents that belong under People/Alex per VAULT.md.",
});
await call("reveal_field", { path: "home/People/Alex/ID/2019-03 Passport.txt", key: "passport_number", reason: "You asked me to fill in the passport renewal form (DS-82)." });
await call("deliver_to_user", { path: "home/Vehicles/2019 Honda Civic/Registration/2025-03 Registration.txt", key: "plate_number", note: "For the DMV online renewal form." });
const gem = buildMcpServer(node, { clientId: "c-gemini", clientName: "Gemini", grant: { label: "Gemini", roots: ["*"], scopes: ["read"] } }) as any;
await gem._registeredTools["list_expiring"].handler({ within_days: 60, include_past_days: 0, keys: ["expires_on"] }, {});
await gem._registeredTools["search"].handler({ query: "eye prescription", limit: 5 }, {});
const dev = node.store.addDevice("iPhone");
node.stop();
console.log(JSON.stringify({ dir, vault, data, pat, device_token: dev.token, password: process.env.SATCHEL_PASSWORD ?? "demo" }, null, 2));
