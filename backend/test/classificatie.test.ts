// Het classificatiemodel: rechten, afwijken als apart recht, publiceren met reden via het platform (nagebootst).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { bouwApp } from "../src/app.ts";
import { routes } from "../src/routes/index.ts";
import { Platform } from "../src/platform.ts";
import { Sleutels, nieuwToken } from "../src/sleutels.ts";
import { verseDatabase, kop, wijzig, GEHEIM } from "./hulp.ts";

let pool: pg.Pool, eigenaar: pg.Pool, app: FastifyInstance;
const klok = new Date("2026-11-10T09:00:00Z");
const sleutels = new Sleutels(GEHEIM);
const id: Record<string, string> = {};
const aanroepen: { methode: string; pad: string; lichaam?: unknown }[] = [];
const MODEL = { selectielijst: "gemeenten-2020", attributen: [], vergrendelBij: ["definitief"], termijnStartBij: "definitief" };
let actief: unknown = null;

const nepFetch = (async (url: string | URL, init?: RequestInit) => {
  const pad = new URL(String(url)).pathname;
  const lichaam = init?.body ? JSON.parse(String(init.body)) : undefined;
  aanroepen.push({ methode: init?.method ?? "GET", pad, lichaam });
  const json = (status: number, j: unknown) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
  if (pad === "/classificatiemodel" && (init?.method ?? "GET") === "GET") return json(200, { selectielijsten: [], statussen: ["definitief"], actief, versies: [] });
  if (pad === "/classificatiemodel/controle") return json(200, { problemen: [] });
  if (pad === "/classificatiemodel") {
    actief = { versie: 1, config: lichaam.config };
    return json(201, { versie: 1, config: lichaam.config });
  }
  return json(404, { fout: "niet-gevonden" });
}) as typeof fetch;

async function sessie(account: string): Promise<string> {
  const token = nieuwToken();
  await pool.query("INSERT INTO sessies (account, token_hash, apparaat, ip, aangemaakt, laatst_actief, hard_einde) VALUES ($1, $2, 'test', '192.0.2.1', $3, $3, $4)", [
    account, sleutels.sessieHash(token), klok, new Date(klok.getTime() + 12 * 3600_000),
  ]);
  return `__Host-oa_beheer=${token}`;
}
const vraag = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers: method === "GET" ? kop({ cookie }) : wijzig({ cookie }), payload: method === "GET" ? undefined : JSON.stringify(payload ?? {}) });

before(async () => {
  const d = await verseDatabase("oa_beheer_cl");
  pool = d.pool;
  eigenaar = d.eigenaar;
  const platform = new Platform({ url: "http://platform.test", dienstsleutel: "platform-sleutel-0123456789", gemeente: "haarlem" }, nepFetch);
  app = await bouwApp({ config: d.config, pool, nu: () => klok, platform }, routes);
  const g = async (naam: string, rechten: string[]) => (await pool.query("INSERT INTO groepen (naam, rechten, niveau) VALUES ($1, $2, 2) RETURNING id", [naam, rechten])).rows[0].id;
  const groepen = { data: await g("Data-officers", ["classificatie.manage"]), archief: await g("Archief", ["classificatie.manage", "bewaartermijn.afwijken"]), lezer: await g("Lezers", ["classificatie.view"]) };
  for (const [s, gr] of Object.entries(groepen)) {
    id[s] = (await pool.query("INSERT INTO accounts (email, naam) VALUES ($1, $1) RETURNING id", [`${s}@test.nl`])).rows[0].id;
    await pool.query("INSERT INTO lidmaatschappen VALUES ($1, $2)", [id[s], gr]);
  }
});

after(async () => {
  await app.close();
  await pool.end();
  await eigenaar.end();
});

test("inzien met classificatie.view; publiceren alleen met classificatie.manage en een reden", async () => {
  const r = await vraag(await sessie(id.lezer), "GET", "/api/classificatie");
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().aan, true);
  assert.equal((await vraag(await sessie(id.lezer), "POST", "/api/classificatie/publiceer", { config: MODEL, reden: "Eerste model" })).statusCode, 403);
  assert.equal((await vraag(await sessie(id.data), "POST", "/api/classificatie/publiceer", { config: MODEL })).statusCode, 400);
  const p = await vraag(await sessie(id.data), "POST", "/api/classificatie/publiceer", { config: { ...MODEL, naam: "Haarlem 2026" }, reden: "Eerste model" });
  assert.equal(p.statusCode, 200, p.body);
  const a = await pool.query("SELECT doel, resultaat, details FROM audit WHERE actie = 'classificatiemodel.gepubliceerd'");
  assert.equal(a.rows[0].doel, "classificatiemodel versie 1");
  assert.equal(a.rows[0].details.naam, "Haarlem 2026");
});

test("afwijken van de selectielijst vraagt het recht bewaartermijn.afwijken", async () => {
  const met = { ...MODEL, afwijkingen: [{ resultaat: "1.1", bewaartermijn: "P12Y", reden: "Langer voor de accountant" }] };
  assert.equal((await vraag(await sessie(id.data), "POST", "/api/classificatie/publiceer", { config: met, reden: "Afwijking erbij" })).statusCode, 403);
  const ok = await vraag(await sessie(id.archief), "POST", "/api/classificatie/publiceer", { config: met, reden: "Afwijking erbij" });
  assert.equal(ok.statusCode, 200, ok.body);
  // Een data-officer kan daarna attributen toevoegen zolang de afwijkingen blijven zoals ze zijn.
  const attr = { ...met, attributen: [{ sleutel: "biv", label: "BIV", type: "keuze", opties: ["laag", "hoog"], verplicht: false }] };
  assert.equal((await vraag(await sessie(id.data), "POST", "/api/classificatie/publiceer", { config: attr, reden: "Attribuut BIV" })).statusCode, 200);
  assert.equal(aanroepen.filter((x) => x.pad === "/classificatiemodel" && x.methode === "POST").length, 3);
});
