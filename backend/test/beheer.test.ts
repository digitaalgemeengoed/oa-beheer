// Stap 3: wie wie mag beheren; accounts, groepen, status, profiel en apparaten.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { bouwApp } from "../src/app.ts";
import { routes } from "../src/routes/index.ts";
import { Sleutels, nieuwToken } from "../src/sleutels.ts";
import { magBeheren, magGroepGeven } from "../src/regels.ts";
import type { Bericht } from "../src/mail.ts";
import { verseDatabase, kop, wijzig, GEHEIM } from "./hulp.ts";

let pool: pg.Pool, eigenaar: pg.Pool, app: FastifyInstance;
let klok = new Date("2026-11-09T09:00:00Z");
const mails: Bericht[] = [];
const id: Record<string, string> = {};
const groep: Record<string, string> = {};
const sleutels = new Sleutels(GEHEIM);

/** Een sessie zonder Keycloak: rechtstreeks in de database, zoals na een geslaagde aanmelding. */
async function sessie(account: string, apparaat = "Firefox op Linux"): Promise<string> {
  const token = nieuwToken();
  await pool.query("INSERT INTO sessies (account, token_hash, apparaat, ip, aangemaakt, laatst_actief, hard_einde) VALUES ($1, $2, $3, '192.0.2.1', $4, $4, $5)", [
    account, sleutels.sessieHash(token), apparaat, klok, new Date(klok.getTime() + 12 * 3600_000),
  ]);
  return `__Host-oa_beheer=${token}`;
}

const vraag = (cookie: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, headers: method === "GET" ? kop({ cookie }) : wijzig({ cookie }), payload: method === "GET" ? undefined : JSON.stringify(payload ?? {}) });

before(async () => {
  const d = await verseDatabase("oa_beheer_t3");
  pool = d.pool;
  eigenaar = d.eigenaar;
  app = await bouwApp({ config: d.config, pool, nu: () => klok, mailer: { verstuur: async (b) => void mails.push(b) } }, routes);
  const g = async (naam: string, rechten: string[], niveau: number, superadmin = false) =>
    (groep[naam] = (await pool.query("INSERT INTO groepen (naam, rechten, niveau, superadmin) VALUES ($1, $2, $3, $4) RETURNING id", [naam, rechten, niveau, superadmin])).rows[0].id);
  await g("Superadmins", ["accounts.view", "accounts.manage", "groups.view", "groups.manage", "audit.view", "settings.view", "settings.manage"], 4, true);
  await g("Beheerders", ["accounts.view", "accounts.manage", "groups.view", "groups.manage"], 3);
  await g("Auditors", ["audit.view"], 2);
  await g("Lezers", ["accounts.view"], 1);
  const a = async (sleutel: string, groepen: string[]) => {
    id[sleutel] = (await pool.query("INSERT INTO accounts (email, naam) VALUES ($1, $2) RETURNING id", [`${sleutel}@test.nl`, sleutel])).rows[0].id;
    for (const x of groepen) await pool.query("INSERT INTO lidmaatschappen VALUES ($1, $2)", [id[sleutel], groep[x]]);
  };
  await a("super", ["Superadmins"]);
  await a("manager", ["Beheerders"]);
  await a("collega", ["Beheerders"]);
  await a("lezer", ["Lezers"]);
  id.hoofd = (await pool.query("SELECT id FROM accounts WHERE hoofdaccount")).rows[0].id;
});

after(async () => {
  await app.close();
  await pool.end();
  await eigenaar.end();
});

test("de regels zelf", () => {
  const manager = { id: "m", superadmin: false, niveau: 3, rechten: new Set(["accounts.manage", "accounts.view"] as const) };
  assert.equal(magBeheren(manager, { id: "x", hoofdaccount: false, niveau: 2 }), null);
  assert.equal(magBeheren(manager, { id: "x", hoofdaccount: false, niveau: 3 }), "niveau");
  assert.equal(magBeheren(manager, { id: "m", hoofdaccount: false, niveau: 0 }), "eigen-account");
  assert.equal(magBeheren({ ...manager, superadmin: true }, { id: "h", hoofdaccount: true, niveau: 0 }), "hoofdaccount");
  assert.equal(magGroepGeven(manager, { niveau: 1, superadmin: false, rechten: ["accounts.view"] }), null);
  assert.equal(magGroepGeven(manager, { niveau: 1, superadmin: false, rechten: ["audit.view"] }), "recht-niet-zelf");
  assert.equal(magGroepGeven(manager, { niveau: 3, superadmin: false, rechten: [] }), "niveau");
  assert.equal(magGroepGeven(manager, { niveau: 1, superadmin: true, rechten: [] }), "superadmin");
});

test("een account toevoegen: alleen met groepen die je zelf mag geven; uitnodiging per e-mail", async () => {
  const m = await sessie(id.manager);
  const ok = await vraag(m, "POST", "/api/accounts", { email: "Nieuw@Test.nl", naam: "Nieuw", taal: "en", groepen: [groep.Lezers], reden: "Nieuwe collega bij team Informatiebeheer" });
  assert.equal(ok.statusCode, 201, ok.body);
  assert.equal((await pool.query("SELECT email FROM accounts WHERE id = $1", [ok.json().id])).rows[0].email, "nieuw@test.nl");
  assert.equal(mails.at(-1)!.aan[0], "nieuw@test.nl");
  assert.match(mails.at(-1)!.onderwerp, /admin portal/);
  assert.equal((await vraag(m, "POST", "/api/accounts", { email: "x@test.nl", naam: "X", taal: "nl", groepen: [groep.Auditors], reden: "Auditrechten geven" })).json().fout, "recht-niet-zelf");
  assert.equal((await vraag(m, "POST", "/api/accounts", { email: "y@test.nl", naam: "Y", taal: "nl", groepen: [groep.Superadmins], reden: "Superadmin maken" })).statusCode, 403);
  assert.equal((await vraag(m, "POST", "/api/accounts", { email: "nieuw@test.nl", naam: "Dubbel", taal: "nl", groepen: [], reden: "Nog een keer" })).statusCode, 409);
  const l = await sessie(id.lezer);
  assert.equal((await vraag(l, "POST", "/api/accounts", { email: "z@test.nl", naam: "Z", taal: "nl", groepen: [], reden: "Mag ik dit?" })).statusCode, 403);
  assert.equal((await vraag(l, "GET", "/api/accounts")).statusCode, 200);
});

test("status: alleen onder je eigen niveau, nooit jezelf of het hoofdaccount; altijd met reden", async () => {
  const m = await sessie(id.manager);
  const l = await sessie(id.lezer);
  assert.equal((await vraag(m, "POST", `/api/accounts/${id.lezer}/status`, { status: "geblokkeerd" })).statusCode, 400, "zonder reden");
  assert.equal((await vraag(m, "POST", `/api/accounts/${id.collega}/status`, { status: "geblokkeerd", reden: "Zelfde niveau" })).json().fout, "niveau");
  assert.equal((await vraag(m, "POST", `/api/accounts/${id.manager}/status`, { status: "gedeactiveerd", reden: "Mezelf eruit" })).json().fout, "eigen-account");
  assert.equal((await vraag(m, "POST", `/api/accounts/${id.hoofd}/status`, { status: "geblokkeerd", reden: "Het hoofdaccount" })).json().fout, "hoofdaccount");
  const r = await vraag(m, "POST", `/api/accounts/${id.lezer}/status`, { status: "geblokkeerd", reden: "Laptop gestolen, onderzoek loopt" });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((await vraag(l, "GET", "/api/ik")).statusCode, 401, "de sessie van de lezer is meteen voorbij");
  const s = await sessie(id.super);
  assert.equal((await vraag(s, "POST", `/api/accounts/${id.collega}/status`, { status: "geblokkeerd", reden: "Superadmin mag dit" })).statusCode, 200);
  assert.equal((await vraag(s, "POST", `/api/accounts/${id.collega}/status`, { status: "actief", reden: "Weer terug na onderzoek" })).statusCode, 200);
  assert.equal((await vraag(s, "POST", `/api/accounts/${id.lezer}/status`, { status: "actief", reden: "Laptop teruggevonden" })).statusCode, 200);
});

test("een statuswijziging kan later ingaan", async () => {
  const s = await sessie(id.super);
  const l = await sessie(id.lezer);
  const ingang = new Date(klok.getTime() + 3600_000).toISOString();
  assert.equal((await vraag(s, "POST", `/api/accounts/${id.lezer}/status`, { status: "gedeactiveerd", reden: "Uit dienst per vandaag 11:00", ingang })).statusCode, 200);
  assert.equal((await vraag(l, "GET", "/api/ik")).statusCode, 200);
  klok = new Date(klok.getTime() + 3600_000 + 1000);
  assert.equal((await vraag(l, "GET", "/api/ik")).statusCode, 401);
  assert.equal((await pool.query("SELECT status FROM accounts WHERE id = $1", [id.lezer])).rows[0].status, "gedeactiveerd");
  const s2 = await sessie(id.super);
  await vraag(s2, "POST", `/api/accounts/${id.lezer}/status`, { status: "actief", reden: "Toch weer in dienst" });
});

test("groepen van een account: niet je eigen; alleen wat je zelf mag geven; meteen van kracht", async () => {
  const m = await sessie(id.manager);
  assert.equal((await vraag(m, "PUT", `/api/accounts/${id.manager}/groepen`, { groepen: [groep.Superadmins], reden: "Mezelf promoveren" })).json().fout, "eigen-account");
  assert.equal((await vraag(m, "PUT", `/api/accounts/${id.lezer}/groepen`, { groepen: [groep.Lezers, groep.Auditors], reden: "Auditrecht erbij" })).json().fout, "recht-niet-zelf");
  const s = await sessie(id.super);
  assert.equal((await vraag(s, "PUT", `/api/accounts/${id.collega}/groepen`, { groepen: [groep.Lezers], reden: "Andere rol, alleen nog lezen" })).statusCode, 200);
  const c = await sessie(id.collega);
  assert.equal((await vraag(c, "POST", "/api/accounts", { email: "q@test.nl", naam: "Q", taal: "nl", groepen: [], reden: "Kan ik nog beheren?" })).statusCode, 403, "rechten worden bij elk verzoek gelezen");
  const a = (await pool.query("SELECT details FROM audit WHERE actie = 'account.groepen' ORDER BY id DESC LIMIT 1")).rows[0].details;
  assert.deepEqual([a.erbij, a.eraf], [["Lezers"], ["Beheerders"]]);
  await vraag(s, "PUT", `/api/accounts/${id.collega}/groepen`, { groepen: [groep.Beheerders], reden: "Terug naar beheerder" });
});

test("groepen beheren: niet boven je niveau, niet je eigen groep, geen rechten die je niet hebt", async () => {
  const m = await sessie(id.manager);
  const ok = await vraag(m, "POST", "/api/groepen", { naam: "Teamleiders", omschrijving: "Kunnen accounts zien", rechten: ["accounts.view"], niveau: 2, superadmin: false, reden: "Nieuwe rol teamleider" });
  assert.equal(ok.statusCode, 201, ok.body);
  assert.equal((await vraag(m, "POST", "/api/groepen", { naam: "Te hoog", omschrijving: "", rechten: [], niveau: 3, superadmin: false, reden: "Gelijk aan mij" })).json().fout, "niveau");
  assert.equal((await vraag(m, "POST", "/api/groepen", { naam: "Audit", omschrijving: "", rechten: ["audit.view"], niveau: 1, superadmin: false, reden: "Audit doorgeven" })).json().fout, "recht-niet-zelf");
  assert.equal((await vraag(m, "PUT", `/api/groepen/${groep.Beheerders}`, { naam: "Beheerders", omschrijving: "", rechten: ["accounts.view", "accounts.manage", "groups.view", "groups.manage", "settings.manage"], niveau: 3, superadmin: false, reden: "Eigen groep uitbreiden" })).statusCode, 403);
  assert.equal((await vraag(m, "PUT", `/api/groepen/${ok.json().id}`, { naam: "Teamleiders", omschrijving: "Zien en wijzigen", rechten: ["accounts.view", "accounts.manage"], niveau: 2, superadmin: false, reden: "Teamleiders mogen ook wijzigen" })).statusCode, 200);
  assert.equal((await vraag(m, "DELETE", `/api/groepen/${ok.json().id}`, { reden: "Toch niet nodig" })).statusCode, 200);
  assert.equal((await vraag(m, "DELETE", `/api/groepen/${groep.Beheerders}`, { reden: "Eigen groep weg" })).statusCode, 403);
  const g = (await vraag(m, "GET", "/api/groepen")).json();
  assert.equal(g.find((x: { naam: string }) => x.naam === "Lezers").toewijsbaar, true);
  assert.equal(g.find((x: { naam: string }) => x.naam === "Auditors").toewijsbaar, false);
});

test("profiel: eigen apparaten zien en afmelden, niet die van een ander", async () => {
  const thuis = await sessie(id.lezer, "Firefox op Linux");
  const werk = await sessie(id.lezer, "Edge op Windows");
  const p = (await vraag(thuis, "GET", "/api/profiel")).json();
  assert.equal(p.apparaten.length >= 2, true);
  const ander = p.apparaten.find((a: { apparaat: string; ditApparaat: boolean }) => a.apparaat === "Edge op Windows" && !a.ditApparaat);
  assert.equal((await vraag(thuis, "POST", `/api/profiel/apparaten/${ander.id}/uitloggen`)).statusCode, 200);
  assert.equal((await vraag(werk, "GET", "/api/ik")).statusCode, 401);
  const s = await sessie(id.super);
  const vanSuper = (await vraag(s, "GET", "/api/profiel")).json().apparaten[0].id;
  assert.equal((await vraag(thuis, "POST", `/api/profiel/apparaten/${vanSuper}/uitloggen`)).statusCode, 404);
  assert.equal((await vraag(thuis, "PUT", "/api/profiel", { naam: "Lezer de Vries", taal: "en" })).statusCode, 200);
  assert.equal((await vraag(thuis, "GET", "/api/ik")).json().taal, "en");
});

test("dashboard: wat je ziet hangt af van je rechten", async () => {
  const l = await sessie(id.lezer);
  const s = await sessie(id.super);
  const dl = (await vraag(l, "GET", "/api/dashboard")).json();
  const ds = (await vraag(s, "GET", "/api/dashboard")).json();
  assert.ok(dl.accounts && !dl.audit);
  assert.ok(ds.accounts && ds.audit && typeof ds.actieveSessies === "number");
});
