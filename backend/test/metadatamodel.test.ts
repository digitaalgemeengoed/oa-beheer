// Het metadatamodel: rechten, concept, controle en publiceren via het platform (nagebootst).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { bouwApp } from "../src/app.ts";
import { routes } from "../src/routes/index.ts";
import { Platform } from "../src/platform.ts";
import { vergeetCatalogus } from "../src/routes/metadatamodel.ts";
import { Sleutels, nieuwToken } from "../src/sleutels.ts";
import { verseDatabase, kop, wijzig, GEHEIM } from "./hulp.ts";

let pool: pg.Pool, eigenaar: pg.Pool, app: FastifyInstance, zonder: FastifyInstance;
const klok = new Date("2026-11-09T09:00:00Z");
const sleutels = new Sleutels(GEHEIM);
const id: Record<string, string> = {};
const aanroepen: { methode: string; pad: string; kop: Record<string, string>; lichaam?: unknown }[] = [];
let versie = 1;

/** Het platform, nagebootst: catalogus, objecttype, versies, controle en publiceren. */
const nepFetch = (async (url: string | URL, init?: RequestInit) => {
  const pad = new URL(String(url)).pathname;
  const kop = init?.headers as Record<string, string>;
  const lichaam = init?.body ? JSON.parse(String(init.body)) : undefined;
  aanroepen.push({ methode: init?.method ?? "GET", pad, kop, lichaam });
  const json = (status: number, j: unknown) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
  if (pad === "/anonimisering/kwaliteit") return json(200, { metingen: 2, query: new URL(String(url)).search });
  if (pad === "/metadatamodellen") return json(200, { modellen: { mdto: { naam: "MDTO", velden: [] } }, waardelijsten: {}, rollen: ["titel"] });
  if (pad === "/objecttypen/document") return json(200, { versie, titel: "Document", schema: { properties: {} } });
  if (pad === "/objecttypen/document/versies") return json(200, [{ versie, gedeeld: versie === 1 }]);
  if (pad === "/metadatamodellen/controle") return json(200, { problemen: [], velden: [], schema: {} });
  if (pad === "/objecttypen/document/model") {
    if (lichaam.config.basis === "fout") return json(422, { fout: "model-ongeldig", melding: "Het metadatamodel klopt nog niet.", details: [{ veld: "", melding: "Er moet een veld voor de titel aan staan." }] });
    versie += 1;
    return json(201, { versie });
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
const vraag = (a: FastifyInstance, cookie: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object) =>
  a.inject({ method, url, headers: method === "GET" ? kop({ cookie }) : wijzig({ cookie }), payload: method === "GET" ? undefined : JSON.stringify(payload ?? {}) });

before(async () => {
  const d = await verseDatabase("oa_beheer_md");
  pool = d.pool;
  eigenaar = d.eigenaar;
  const platform = new Platform({ url: "http://platform.test", dienstsleutel: "platform-sleutel-0123456789", gemeente: "haarlem" }, nepFetch);
  app = await bouwApp({ config: d.config, pool, nu: () => klok, platform }, routes);
  zonder = await bouwApp({ config: d.config, pool, nu: () => klok, platform: null }, routes);
  const g = async (naam: string, rechten: string[]) => (await pool.query("INSERT INTO groepen (naam, rechten, niveau) VALUES ($1, $2, 2) RETURNING id", [naam, rechten])).rows[0].id;
  const beheer = await g("Informatiebeheer", ["metadata.view", "metadata.manage"]);
  const lezen = await g("Meelezers", ["metadata.view"]);
  const niets = await g("Anderen", ["audit.view", "anonimiseren.view"]);
  for (const [s, gr] of [["ib", beheer], ["lezer", lezen], ["ander", niets]] as const) {
    id[s] = (await pool.query("INSERT INTO accounts (email, naam) VALUES ($1, $1) RETURNING id", [`${s}@test.nl`])).rows[0].id;
    await pool.query("INSERT INTO lidmaatschappen VALUES ($1, $2)", [id[s], gr]);
  }
  vergeetCatalogus();
});

after(async () => {
  await app.close();
  await zonder.close();
  await pool.end();
  await eigenaar.end();
});

test("de nieuwe rechten mogen in een groep; andere niet", async () => {
  await assert.rejects(pool.query("INSERT INTO groepen (naam, rechten, niveau) VALUES ('x', '{metadata.alles}', 1)"), /groepen_rechten_check/);
});

test("zien: met metadata.view; zonder recht 403; zonder platform staat het uit", async () => {
  const ib = await sessie(id.ib);
  const r = await vraag(app, ib, "GET", "/api/metadatamodel");
  assert.equal(r.statusCode, 200, r.body);
  const j = r.json();
  assert.equal(j.aan, true);
  assert.equal(j.gemeente, "haarlem");
  assert.equal(j.actief.versie, 1);
  assert.equal(j.concept, null);
  const a = aanroepen.find((x) => x.pad === "/objecttypen/document")!;
  assert.equal(a.kop["x-oa-gemeente"], "haarlem");
  assert.equal(JSON.parse(Buffer.from(a.kop["x-oa-actor"], "base64url").toString()).naam, "ib@test.nl", "de beheerder gaat mee als actor");
  assert.equal((await vraag(app, await sessie(id.lezer), "GET", "/api/metadatamodel")).statusCode, 200);
  assert.equal((await vraag(app, await sessie(id.ander), "GET", "/api/metadatamodel")).statusCode, 403);
  assert.deepEqual((await vraag(zonder, ib, "GET", "/api/metadatamodel")).json(), { aan: false });
});

test("concept bewaren en weggooien: alleen met metadata.manage", async () => {
  const ib = await sessie(id.ib);
  const config = { basis: "rgbz", velden: [{ sleutel: "titel", aan: true, verplicht: true }] };
  assert.equal((await vraag(app, await sessie(id.lezer), "PUT", "/api/metadatamodel/concept", { config })).statusCode, 403);
  assert.equal((await vraag(app, ib, "PUT", "/api/metadatamodel/concept", { config })).statusCode, 200);
  const j = (await vraag(app, ib, "GET", "/api/metadatamodel")).json();
  assert.deepEqual(j.concept.config, config);
  assert.equal(j.concept.door, "ib@test.nl");
  assert.equal((await vraag(app, ib, "DELETE", "/api/metadatamodel/concept")).statusCode, 200);
  assert.equal((await vraag(app, ib, "GET", "/api/metadatamodel")).json().concept, null);
});

test("controleren mag een meelezer; het platform toetst", async () => {
  const r = await vraag(app, await sessie(id.lezer), "POST", "/api/metadatamodel/controle", { config: { basis: "mdto", velden: [] } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(aanroepen.at(-1)!.pad, "/metadatamodellen/controle");
});

test("publiceren: met reden, in de audit, concept weg; een fout van het platform komt terug met toelichting", async () => {
  const ib = await sessie(id.ib);
  const config = { basis: "rgbz", velden: [{ sleutel: "titel", aan: true, verplicht: true }, { sleutel: "auteur", aan: false, verplicht: false }] };
  await vraag(app, ib, "PUT", "/api/metadatamodel/concept", { config });
  assert.equal((await vraag(app, ib, "POST", "/api/metadatamodel/publiceer", { config })).statusCode, 400, "zonder reden");
  assert.equal((await vraag(app, await sessie(id.lezer), "POST", "/api/metadatamodel/publiceer", { config, reden: "Overstap op RGBZ" })).statusCode, 403);
  const r = await vraag(app, ib, "POST", "/api/metadatamodel/publiceer", { config, reden: "Overstap op RGBZ" });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().versie, 2);
  assert.equal((await vraag(app, ib, "GET", "/api/metadatamodel")).json().concept, null, "het concept is gepubliceerd");
  const audit = await pool.query("SELECT actie, doel, resultaat, details FROM audit WHERE actie = 'metadatamodel.gepubliceerd' ORDER BY id");
  assert.equal(audit.rows[0].doel, "document versie 2");
  assert.deepEqual(audit.rows[0].details, { basis: "rgbz", velden: 1, versie: 2, reden: "Overstap op RGBZ" });
  const metNaam = await vraag(app, ib, "POST", "/api/metadatamodel/publiceer", { config: { ...config, naam: "RGBZ Haarlem" }, reden: "Eigen naam voor het model" });
  assert.equal(metNaam.statusCode, 200, metNaam.body);
  assert.equal((aanroepen.at(-1)!.lichaam as { config: { naam: string } }).config.naam, "RGBZ Haarlem", "de naam gaat mee naar het platform");
  const a3 = await pool.query("SELECT details FROM audit WHERE actie = 'metadatamodel.gepubliceerd' ORDER BY id DESC LIMIT 1");
  assert.equal(a3.rows[0].details.naam, "RGBZ Haarlem");
  const fout = await vraag(app, ib, "POST", "/api/metadatamodel/publiceer", { config: { basis: "fout", velden: [] }, reden: "Proberen wat er misgaat" });
  assert.equal(fout.statusCode, 422);
  assert.equal(fout.json().details[0].melding, "Er moet een veld voor de titel aan staan.");
  const a2 = await pool.query("SELECT resultaat FROM audit WHERE actie = 'metadatamodel.gepubliceerd' ORDER BY id");
  assert.deepEqual(a2.rows.map((x) => x.resultaat), ["ok", "ok", "geweigerd"]);
});

test("anonimiseren, kwaliteit: alleen met anonimiseren.view; de vraag gaat door naar het platform", async () => {
  assert.equal((await vraag(app, await sessie(id.ib), "GET", "/api/anonimiseren/kwaliteit")).statusCode, 403);
  const r = await vraag(app, await sessie(id.ander), "GET", "/api/anonimiseren/kwaliteit?dagen=30&drempel=3");
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json(), { metingen: 2, query: "?dagen=30&drempel=3" });
  assert.equal((await vraag(app, await sessie(id.ander), "GET", "/api/anonimiseren/kwaliteit?drempel=1")).statusCode, 400);
  assert.equal((await vraag(zonder, await sessie(id.ander), "GET", "/api/anonimiseren/kwaliteit")).statusCode, 409);
});
