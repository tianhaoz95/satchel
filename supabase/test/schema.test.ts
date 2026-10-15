// Runs the Supabase migrations in PGlite (Postgres compiled to WASM) with a stubbed `auth` schema,
// then checks the RLS rules the portal and relay rely on.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const dir = path.join(import.meta.dirname, "..", "migrations");
const db = new PGlite();
const u1 = "11111111-1111-1111-1111-111111111111";
const u2 = "22222222-2222-2222-2222-222222222222";
const hash = (c: string) => c.repeat(64);

async function as(uid: string, sql: string) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role;");
  }
}

before(async () => {
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create role anon; create role authenticated; create role service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create publication supabase_realtime;
  `);
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(path.join(dir, f), "utf8"));
  await db.exec(`insert into auth.users values ('${u1}'), ('${u2}'); grant usage on schema public to authenticated;`);
  await as(u1, `insert into public.nodes(name, subdomain, token_sha256) values ('NAS', 'alex', '${hash("a")}')`);
});

test("reserved subdomains are rejected", async () => {
  await assert.rejects(as(u1, `insert into public.nodes(name, subdomain, token_sha256) values ('x', 'relay', '${hash("b")}')`), /reserved/);
});

test("subdomains are unique across users", async () => {
  await assert.rejects(as(u2, `insert into public.nodes(name, subdomain, token_sha256) values ('x', 'alex', '${hash("c")}')`), /duplicate key/);
});

test("users only see their own nodes", async () => {
  assert.equal((await as(u2, "select * from public.nodes")).rows.length, 0);
  assert.equal((await as(u1, "select * from public.nodes")).rows.length, 1);
});

test("status columns belong to the relay, not users", async () => {
  await assert.rejects(as(u1, "update public.nodes set online = true"), /permission denied/);
});

test("only the owner can rotate a token", async () => {
  await as(u1, `select public.rotate_node_token((select id from public.nodes limit 1), '${hash("d")}')`);
  await assert.rejects(as(u2, `select public.rotate_node_token((select id from public.nodes limit 1), '${hash("e")}')`));
  const row = (await db.query<{ token_sha256: string; user_id: string }>("select token_sha256, user_id from public.nodes")).rows[0];
  assert.equal(row.token_sha256, hash("d"));
  assert.equal(row.user_id, u1);
});

test("the per-user node limit is enforced", async () => {
  for (const i of [1, 2, 3, 4]) await as(u1, `insert into public.nodes(name, subdomain, token_sha256) values ('n${i}', 'alex${i}', '${hash(String(i))}')`);
  await assert.rejects(as(u1, `insert into public.nodes(name, subdomain, token_sha256) values ('n5', 'alex5', '${hash("f")}')`), /limit/);
});
