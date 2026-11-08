// Stap 4: de audit lezen en controleren, de dagelijkse hash, en instellingen.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { bouwApp } from "../src/app.ts";
import { routes } from "../src/routes/index.ts";
import { dagelijks } from "../src/routes/audit.ts";
import { Sleutels, nieuwToken } from "../src/sleutels.ts";
import { vergeetInstellingen } from "../src/instellingen.ts";
import type { Bericht } from "../src/mail.ts";
import { verseDatabase, kop, wijzig, GEHEIM } from "./hulp.ts";

let pool: pg.Pool, eigenaar: pg.Pool, app: FastifyInstance;
let klok = new Date("2026-11-09T09:00:00Z");
const mails: Bericht[] = [];
const id: Record<string, string> = {};
const sleutels = new Sleutels(GEHEIM);

async function sessie(account: string): Promise<string> {
  const token = nieuwToken();
  await pool.query("INSERT INTO sessies (account, token_hash, apparaat, ip, aangemaakt, laatst_actief, hard_einde) VALUES ($1, $2, 'Test', '192.0.2.1', $3, $3, $4)", [
    account, sleutels.sessieHash(token), klok, new Date(klok.getTime() + 24 * 3600_000),
  ]);
  return `__Host-oa_beheer=${token}`;
}
const vraag = (cookie: string, method: "GET" | "PUT", url: string, payload?: object) =>
  app.inject({ method, url, headers: method === "GET" ? kop({ cookie }) : wijzig({ cookie }), payload: payload ? JSON.stringify(payload) : undefined });

before(async () => {
  const d = await verseDatabase("oa_beheer_t4");
  pool = d.pool;
  eigenaar = d.eigenaar;
  app = await bouwApp({ config: d.config, pool, nu: () => klok, mailer: { verstuur: async (b) => void mails.push(b) } }, routes);
  const g = async (naam: string, rechten: string[], niveau: number, superadmin = false) =>
    (await pool.query("INSERT INTO groepen (naam, rechten, niveau, superadmin) VALUES ($1, $2, $3, $4) RETURNING id", [naam, rechten, niveau, superadmin])).rows[0].id;
  const groepen = { super: await g("S", ["accounts.view", "accounts.manage", "audit.view", "settings.view", "settings.manage"], 4, true), auditor: await g("A", ["audit.view", "settings.view"], 2), lezer: await g("L", ["accounts.view"], 1) };
  for (const [naam, groep] of Object.entries(groepen)) {
    id[naam] = (await pool.query("INSERT INTO accounts (email, naam) VALUES ($1, $2) RETURNING id", [`${naam}@test.nl`, naam])).rows[0].id;
    await pool.query("INSERT INTO lidmaatschappen VALUES ($1, $2)", [id[naam], groep]);
  }
});

after(async () => {
  await app.close();
  await pool.end();
  await eigenaar.end();
});

test("de audit lezen vraagt audit.view; filteren en pagineren", async () => {
  const l = await sessie(id.lezer);
  assert.equal((await vraag(l, "GET", "/api/audit")).statusCode, 403);
  for (let i = 0; i < 3; i++) await vraag(l, "GET", "/api/accounts");
  const a = await sessie(id.auditor);
  const r = (await vraag(a, "GET", "/api/audit?wie=lezer&actie=GET%20/api/accounts&aantal=2")).json();
  assert.equal(r.gebeurtenissen.length, 2);
  assert.ok(r.gebeurtenissen.every((g: { email: string; actie: string }) => g.email === "lezer@test.nl" && g.actie === "GET /api/accounts"));
  const volgende = (await vraag(a, "GET", `/api/audit?wie=lezer&actie=GET%20/api/accounts&aantal=2&voor=${r.volgende}`)).json();
  assert.equal(volgende.gebeurtenissen.length, 1);
  // De geweigerde poging staat er ook in.
  const geweigerd = (await vraag(a, "GET", "/api/audit?wie=lezer&resultaat=403")).json();
  assert.equal(geweigerd.gebeurtenissen[0].actie, "GET /api/audit");
  // Een % in het filter is gewoon een teken.
  assert.equal((await vraag(a, "GET", "/api/audit?wie=%25")).json().gebeurtenissen.length, 0);
  assert.equal((await vraag(a, "GET", "/api/audit?onzin=1")).statusCode, 400);
});

test("de ketencontrole", async () => {
  const a = await sessie(id.auditor);
  const c = (await vraag(a, "GET", "/api/audit/controle")).json();
  assert.equal(c.intact, true);
  assert.match(c.laatsteHash, /^[0-9a-f]{64}$/);
});

test("instellingen: lezen met settings.view, wijzigen met settings.manage, altijd met reden, getoetst", async () => {
  const a = await sessie(id.auditor);
  const s = await sessie(id.super);
  const lijst = (await vraag(a, "GET", "/api/instellingen")).json();
  assert.ok(lijst.find((i: { sleutel: string }) => i.sleutel === "sessie.inactief_minuten"));
  assert.equal((await vraag(a, "PUT", "/api/instellingen/pogingen.maximum", { waarde: 7, reden: "Meer ruimte" })).statusCode, 403);
  assert.equal((await vraag(s, "PUT", "/api/instellingen/pogingen.maximum", { waarde: 7 })).statusCode, 400, "zonder reden");
  assert.equal((await vraag(s, "PUT", "/api/instellingen/pogingen.maximum", { waarde: 99, reden: "Veel te veel" })).json().fout, "buiten-bereik");
  assert.equal((await vraag(s, "PUT", "/api/instellingen/pogingen.maximum", { waarde: "7", reden: "Tekst in plaats van getal" })).json().fout, "geen-geheel-getal");
  assert.equal((await vraag(s, "PUT", "/api/instellingen/sessie.dag_tijdzone", { waarde: "Mars/Olympus", reden: "Verkeerde zone" })).json().fout, "onbekende-tijdzone");
  assert.equal((await vraag(s, "PUT", "/api/instellingen/bestaat.niet", { waarde: 1, reden: "Bestaat niet" })).statusCode, 404);
  const ok = await vraag(s, "PUT", "/api/instellingen/pogingen.maximum", { waarde: 7, reden: "Na klachten van gebruikers" });
  assert.equal(ok.statusCode, 200);
  const g = (await pool.query("SELECT details FROM audit WHERE actie = 'instelling.gewijzigd' ORDER BY id DESC LIMIT 1")).rows[0].details;
  assert.deepEqual(g, { oud: 5, nieuw: 7, reden: "Na klachten van gebruikers" });
  const lijstje = await vraag(s, "PUT", "/api/instellingen/audit.dagelijkse_hash_aan", { waarde: ["Archief@test.nl ", "archief@test.nl "], reden: "Archief krijgt de hash" });
  assert.deepEqual(lijstje.json().waarde, ["archief@test.nl"]);
  vergeetInstellingen();
});

test("dagelijks: na 06:00 één keer per dag opruimen, controleren en de hash mailen", async () => {
  klok = new Date("2026-11-10T04:30:00Z"); // 05:30 in Amsterdam
  assert.equal(await dagelijks(app.diensten), false);
  klok = new Date("2026-11-10T06:00:00Z"); // 07:00
  assert.equal(await dagelijks(app.diensten), true);
  assert.equal(await dagelijks(app.diensten), false, "niet twee keer op een dag");
  const m = mails.at(-1)!;
  assert.deepEqual(m.aan, ["archief@test.nl"]);
  assert.match(m.onderwerp, /2026-11-10: intact/);
  const laatste = (await pool.query("SELECT encode(hash, 'hex') AS h FROM audit ORDER BY id DESC LIMIT 1")).rows[0].h;
  assert.ok(m.tekst.includes(laatste));
  klok = new Date("2026-11-11T06:00:00Z");
  assert.equal(await dagelijks(app.diensten), true, "de volgende dag weer");
});
