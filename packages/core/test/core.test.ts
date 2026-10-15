import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { dateFields, maskMetadata, mergeMetadata, parseSni, readSidecar, writeSidecar, sidecarPath, DEFAULT_POLICY, Store, Vault } from "../src/index.ts";

test("date-like keys are indexed, month precision is normalized", () => {
  assert.deepEqual(dateFields({ expires_on: "2027-03", renew_by: "2026-12-01", title: "x", issued_on: "soon" }), [
    { key: "expires_on", value: "2027-03-01" },
    { key: "renew_by", value: "2026-12-01" },
  ]);
});

test("masking follows policy patterns and explicit sensitive keys", () => {
  const { meta, masked } = maskMetadata({ title: "Passport", passport_number: "567123498", nickname: "J", sensitive: ["nickname"] }, DEFAULT_POLICY);
  assert.equal(meta.title, "Passport");
  assert.notEqual(meta.passport_number, "567123498");
  assert.deepEqual(masked.sort(), ["nickname", "passport_number"]);
});

test("sensitive markers can only grow", () => {
  const a = mergeMetadata({ sensitive: ["a"] }, { sensitive: ["b"] }, false);
  assert.deepEqual(a.sensitive, ["a", "b"]);
  const b = mergeMetadata(a, { sensitive: [] }, true);
  assert.deepEqual(b.sensitive, ["a", "b"]);
});

test("sidecars round-trip as plain YAML next to the file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "satchel-core-"));
  const file = path.join(dir, "Registration.pdf");
  await writeFile(file, "x");
  await writeSidecar(file, { doc_type: "vehicle_registration", expires_on: "2027-03-31" });
  assert.equal(path.basename(sidecarPath(file)), ".Registration.pdf.satchel.yaml");
  assert.match(await readFile(sidecarPath(file), "utf8"), /expires_on: 2027-03-31/);
  assert.deepEqual(await readSidecar(file), { doc_type: "vehicle_registration", expires_on: "2027-03-31" });
});

test("vault paths cannot escape their root or touch reserved files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "satchel-core-"));
  const v = new Vault([{ name: "home", path: path.join(dir, "v") }], new Store(path.join(dir, "d")), path.join(dir, "d"));
  assert.throws(() => v.resolve("home/../../etc/passwd"), /escapes/);
  assert.throws(() => v.resolve("home/.satchel/journal.jsonl"), /Reserved/);
  assert.throws(() => v.resolve("home/a/.b.pdf.satchel.yaml"), /Reserved/);
  assert.throws(() => v.resolve("other/x"), /Unknown root/);
  assert.equal(v.resolve("home/People/a.pdf").rel, "People/a.pdf");
});

test("SNI is parsed from a real TLS ClientHello", async () => {
  const hello: Buffer = await new Promise((resolve) => {
    const srv = net.createServer((s) => s.once("data", (d) => { resolve(d); s.destroy(); srv.close(); }));
    srv.listen(0, "127.0.0.1", () => {
      const c = tls.connect({ host: "127.0.0.1", port: (srv.address() as any).port, servername: "alex.satchel.dev", rejectUnauthorized: false });
      c.on("error", () => {});
    });
  });
  assert.deepEqual(parseSni(hello), { host: "alex.satchel.dev", complete: true });
  assert.equal(parseSni(hello.subarray(0, 20)).complete, false);
  assert.equal(parseSni(Buffer.from("GET / HTTP/1.1\r\n")).host, null);
});
