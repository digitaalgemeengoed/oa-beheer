// Stap 1: configuratie, webbeveiliging en de database (hoofdaccount, audit).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { leesConfig, ConfigFout } from "../src/config.ts";
import { bouwApp, AppFout, BEVEILIGINGSKOPPEN } from "../src/app.ts";
import { schrijfAudit, schoon } from "../src/audit.ts";
import { verseDatabase, kop, wijzig, HOST, GEHEIM } from "./hulp.ts";

let pool: pg.Pool, eigenaar: pg.Pool, app: FastifyInstance;

before(async () => {
  const d = await verseDatabase("oa_beheer_t1");
  pool = d.pool;
  eigenaar = d.eigenaar;
  app = await bouwApp({ config: d.config, pool }, [
    async (a) => {
      a.get("/api/kapot", async () => {
        throw new Error("geheime details uit de stack");
      });
      a.get("/api/geweigerd", async () => {
        throw new AppFout(403, "geen-recht", "Daarvoor heb je geen recht.");
      });
      a.post("/api/echo", { schema: { body: { type: "object", required: ["a"], properties: { a: { type: "string", maxLength: 5 } } } } }, async (r) => r.body);
    },
  ]);
});

after(async () => {
  await app.close();
  await pool.end();
  await eigenaar.end();
});

// --- configuratie --------------------------------------------------------------

test("het portaal start niet met een ontbrekend, kort of voorbeeldgeheim", () => {
  const basis = { BEHEER_HOST: HOST, DATABASE_URL: "postgresql://x", HOOFDACCOUNT_EMAIL: "a@b.nl" };
  assert.throws(() => leesConfig(basis), ConfigFout);
  assert.throws(() => leesConfig({ ...basis, ADMIN_SECRET: "kort" }), /te kort/);
  assert.throws(() => leesConfig({ ...basis, ADMIN_SECRET: "verander-mij-verander-mij-verander-mij" }), /voorbeeld/);
  assert.throws(() => leesConfig({ ...basis, ADMIN_SECRET: "a".repeat(40) }), /voorbeeld|willekeurig/);
  assert.throws(() => leesConfig({ ...basis, ADMIN_SECRET: "abababababababababababababababababab" }), /willekeurig/);
  assert.equal(leesConfig({ ...basis, ADMIN_SECRET: GEHEIM }).herkomst, `https://${HOST}`);
  assert.throws(() => leesConfig({ ...basis, ADMIN_SECRET: GEHEIM, OIDC_ISSUER: "https://id", OIDC_CLIENT_ID: "x", OIDC_CLIENT_SECRET: "kort" }), /OIDC_CLIENT_SECRET/);
});

// --- webbeveiliging ------------------------------------------------------------

test("elk antwoord draagt de beveiligingskoppen; de API ook no-store", async () => {
  for (const url of ["/api/gezondheid", "/een/pagina", "/api/bestaat-niet"]) {
    const r = await app.inject({ method: "GET", url, headers: kop() });
    for (const [k, v] of Object.entries(BEVEILIGINGSKOPPEN)) assert.equal(r.headers[k], v, `${k} op ${url}`);
    if (url.startsWith("/api/")) assert.equal(r.headers["cache-control"], "no-store");
  }
  const csp = BEVEILIGINGSKOPPEN["content-security-policy"];
  for (const d of ["default-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"]) assert.ok(csp.includes(d));
});

test("een andere hostnaam wordt geweigerd", async () => {
  const r = await app.inject({ method: "GET", url: "/api/gezondheid", headers: { host: "kwaad.example" } });
  assert.equal(r.statusCode, 421);
  assert.equal(r.headers["x-frame-options"], "DENY");
});

test("wijzigende verzoeken alleen met de eigen Origin en JSON", async () => {
  const lijf = JSON.stringify({ a: "x" });
  assert.equal((await app.inject({ method: "POST", url: "/api/echo", headers: { host: HOST, "content-type": "application/json" }, payload: lijf })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/echo", headers: wijzig({ origin: "https://kwaad.example" }), payload: lijf })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/echo", headers: wijzig({ "content-type": "text/plain" }), payload: lijf })).statusCode, 415);
  assert.equal((await app.inject({ method: "POST", url: "/api/echo", headers: wijzig({ "content-type": "application/x-www-form-urlencoded" }), payload: "a=x" })).statusCode, 415);
  const goed = await app.inject({ method: "POST", url: "/api/echo", headers: wijzig(), payload: lijf });
  assert.equal(goed.statusCode, 200);
});

test("invoer wordt getoetst; te grote verzoeken geweigerd; fouten zijn algemeen", async () => {
  const ongeldig = await app.inject({ method: "POST", url: "/api/echo", headers: wijzig(), payload: JSON.stringify({ a: "veel te lang" }) });
  assert.deepEqual(ongeldig.json(), { fout: "verzoek-ongeldig" });
  const groot = await app.inject({ method: "POST", url: "/api/echo", headers: wijzig(), payload: JSON.stringify({ a: "x".repeat(70_000) }) });
  assert.equal(groot.statusCode, 413);
  const kapot = await app.inject({ method: "GET", url: "/api/kapot", headers: kop() });
  assert.equal(kapot.statusCode, 500);
  assert.deepEqual(kapot.json(), { fout: "intern" });
  assert.doesNotMatch(kapot.body, /geheime|stack|at /);
  assert.deepEqual((await app.inject({ method: "GET", url: "/api/geweigerd", headers: kop() })).json(), { fout: "geen-recht", melding: "Daarvoor heb je geen recht." });
});

// --- hoofdaccount --------------------------------------------------------------

test("het hoofdaccount bestaat en kan niet worden gewijzigd, verwijderd of in een groep", async () => {
  const h = (await pool.query("SELECT * FROM accounts WHERE hoofdaccount")).rows[0];
  assert.equal(h.email, "beheerder@test.nl");
  await assert.rejects(pool.query("UPDATE accounts SET status = 'geblokkeerd' WHERE id = $1", [h.id]), /hoofdaccount/);
  await assert.rejects(eigenaar.query("UPDATE beheer.accounts SET status = 'geblokkeerd' WHERE id = $1", [h.id]), /hoofdaccount/, "ook niet als eigenaar");
  await assert.rejects(eigenaar.query("DELETE FROM beheer.accounts WHERE id = $1", [h.id]), /nooit verwijderd/);
  await assert.rejects(pool.query("DELETE FROM accounts WHERE id = $1", [h.id]), /permission denied/);
  await assert.rejects(pool.query("INSERT INTO accounts (email, naam, hoofdaccount) VALUES ('tweede@test.nl', 'X', true)"), /een_hoofdaccount|duplicate/);
  const g = (await pool.query("INSERT INTO groepen (naam, niveau) VALUES ('Beheer', 2) RETURNING id")).rows[0].id;
  await assert.rejects(pool.query("INSERT INTO lidmaatschappen (account, groep) VALUES ($1, $2)", [h.id, g]), /hoofdaccount/);
  await assert.rejects(pool.query("INSERT INTO statuswijzigingen (account, status, reden, ingang, door) VALUES ($1, 'geblokkeerd', 'proberen', now(), $1)", [h.id]), /hoofdaccount/);
  // Naam en taal mogen wel.
  await pool.query("UPDATE accounts SET naam = 'Nood' WHERE id = $1", [h.id]);
  // Het noodgeheim kan de app niet schrijven.
  await assert.rejects(pool.query("UPDATE nood SET wachtwoord_hash = 'x'"), /permission denied/);
});

test("accounts worden nooit verwijderd", async () => {
  const a = (await pool.query("INSERT INTO accounts (email, naam) VALUES ('iemand@test.nl', 'Iemand') RETURNING id")).rows[0].id;
  await assert.rejects(pool.query("DELETE FROM accounts WHERE id = $1", [a]), /permission denied/);
  await assert.rejects(eigenaar.query("DELETE FROM beheer.accounts WHERE id = $1", [a]), /nooit verwijderd/);
});

// --- audit ---------------------------------------------------------------------

test("audit: een hashketen; geen wachtwoorden of tokens; niet te wijzigen of te verwijderen", async () => {
  await schrijfAudit(pool, { actie: "test.een", resultaat: "ok", ip: "203.0.113.5", details: { wachtwoord: "x", token: "y", veld: "naam", genest: { sessie_token: "z", wat: 1 } } });
  await schrijfAudit(pool, { actie: "test.twee", resultaat: "geweigerd" });
  const rijen = (await pool.query("SELECT * FROM audit ORDER BY id")).rows;
  const laatste = rijen.at(-1);
  assert.deepEqual(rijen.at(-2).details, { veld: "naam", genest: { wat: 1 } });
  assert.deepEqual(laatste.vorige_hash, rijen.at(-2).hash);
  const c = (await pool.query("SELECT * FROM audit_controleer()")).rows[0];
  assert.equal(c.gebroken_bij, null);
  assert.equal(c.laatste_hash, laatste.hash.toString("hex"));
  await assert.rejects(pool.query("UPDATE audit SET resultaat = 'ok' WHERE id = $1", [laatste.id]), /permission denied/);
  await assert.rejects(pool.query("DELETE FROM audit WHERE id = $1", [laatste.id]), /permission denied/);
  await assert.rejects(eigenaar.query("UPDATE beheer.audit SET resultaat = 'ok' WHERE id = $1", [laatste.id]), /auditketen/);
  await assert.rejects(eigenaar.query("DELETE FROM beheer.audit WHERE id = $1", [laatste.id]), /auditketen/);
  await assert.rejects(eigenaar.query("TRUNCATE beheer.audit"), /auditketen/);
  assert.deepEqual(schoon({ Authorization: "x", a: ["b"] }), { a: ["b"] });
});

test("audit: wie de database volledig beheerst en de keten wijzigt, wordt door de controle betrapt", async () => {
  const id = (await pool.query("SELECT min(id) AS id FROM audit WHERE actie = 'test.een'")).rows[0].id;
  await eigenaar.query("ALTER TABLE beheer.audit DISABLE TRIGGER audit_geen_update");
  await eigenaar.query("UPDATE beheer.audit SET resultaat = 'vervalst' WHERE id = $1", [id]);
  await eigenaar.query("ALTER TABLE beheer.audit ENABLE TRIGGER audit_geen_update");
  assert.equal((await pool.query("SELECT * FROM audit_controleer()")).rows[0].gebroken_bij, id);
  // Herstel, voor de volgende test.
  await eigenaar.query("ALTER TABLE beheer.audit DISABLE TRIGGER audit_geen_update");
  await eigenaar.query("UPDATE beheer.audit SET resultaat = 'ok' WHERE id = $1", [id]);
  await eigenaar.query("ALTER TABLE beheer.audit ENABLE TRIGGER audit_geen_update");
  assert.equal((await pool.query("SELECT * FROM audit_controleer()")).rows[0].gebroken_bij, null);
});

test("audit: opruimen na de bewaartermijn houdt de keten controleerbaar (anker)", async () => {
  await assert.rejects(pool.query("SELECT audit_opruimen(10)"), /te kort/);
  // Twee oude gebeurtenissen nabootsen: de eigenaar zet de tijd terug (dat breekt hun hash,
  // maar die rijen verdwijnen; de keten erna moet kloppen).
  const ids = (await pool.query("SELECT id FROM audit ORDER BY id LIMIT 2")).rows.map((r) => r.id);
  await eigenaar.query("ALTER TABLE beheer.audit DISABLE TRIGGER audit_geen_update");
  await eigenaar.query("UPDATE beheer.audit SET tijd = now() - interval '400 days' WHERE id = ANY($1)", [ids]);
  await eigenaar.query("ALTER TABLE beheer.audit ENABLE TRIGGER audit_geen_update");
  const n = (await pool.query("SELECT audit_opruimen(365) AS n")).rows[0].n;
  assert.equal(Number(n), 2);
  const c = (await pool.query("SELECT * FROM audit_controleer()")).rows[0];
  assert.equal(c.gebroken_bij, null);
  const opgeruimd = (await pool.query("SELECT details FROM audit WHERE actie = 'audit.opgeruimd'")).rows[0].details;
  assert.equal(opgeruimd.verwijderd, 2);
});
