// Stap 2: inloggen via Keycloak (nagebootst), sessies, status en het noodaccount.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { hash } from "@node-rs/argon2";
import { bouwApp } from "../src/app.ts";
import { Oidc } from "../src/oidc.ts";
import { routes } from "../src/routes/index.ts";
import { ARGON2, adresToegestaan } from "../src/routes/nood.ts";
import { Sleutels } from "../src/sleutels.ts";
import { totpCode } from "../src/totp.ts";
import { vergeetInstellingen } from "../src/instellingen.ts";
import type { Bericht } from "../src/mail.ts";
import { verseDatabase, kop, wijzig, HERKOMST, GEHEIM } from "./hulp.ts";

let pool: pg.Pool, eigenaar: pg.Pool, app: FastifyInstance, kc: Server, kcAdres: string;
let klok = new Date("2026-11-09T09:00:00Z");
const mails: Bericht[] = [];
const codes = new Map<string, Record<string, unknown>>();
let laatsteNonce = "";

before(async () => {
  // Nagebootste Keycloak: discovery, sleutels, en een tokeneindpunt dat
  // id_tokens tekent met de claims die de test per code klaarzet.
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  kc = createServer(async (req, res) => {
    const url = new URL(req.url!, kcAdres);
    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ issuer: kcAdres, authorization_endpoint: `${kcAdres}/auth`, token_endpoint: `${kcAdres}/token`, jwks_uri: `${kcAdres}/jwks`, end_session_endpoint: `${kcAdres}/uit` }));
    }
    if (url.pathname === "/jwks") return res.end(JSON.stringify({ keys: [jwk] }));
    if (url.pathname === "/token") {
      let lijf = "";
      for await (const c of req) lijf += c;
      const p = new URLSearchParams(lijf);
      const claims = codes.get(p.get("code")!);
      if (!claims || p.get("client_secret") !== "kc-geheim-0123456789-abcdefghijklmn") {
        res.statusCode = 400;
        return res.end("{}");
      }
      const idToken = await new SignJWT({ nonce: laatsteNonce, ...claims })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(kcAdres).setAudience("oa-beheer").setIssuedAt().setExpirationTime("5m")
        .sign(privateKey);
      return res.end(JSON.stringify({ id_token: idToken, access_token: "x" }));
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => kc.listen(0, "127.0.0.1", r));
  kcAdres = `http://127.0.0.1:${(kc.address() as AddressInfo).port}`;

  const d = await verseDatabase("oa_beheer_t2");
  pool = d.pool;
  eigenaar = d.eigenaar;
  const oidc = new Oidc({ issuer: kcAdres, clientId: "oa-beheer", clientSecret: "kc-geheim-0123456789-abcdefghijklmn" }, `${HERKOMST}/api/auth/terug`);
  app = await bouwApp({ config: d.config, pool, oidc, nu: () => klok, mailer: { verstuur: async (b) => void mails.push(b) } }, routes);

  // Testpersonen: een superadmin en een medewerker met alleen accounts.view.
  const g1 = (await pool.query("INSERT INTO groepen (naam, rechten, niveau, superadmin) VALUES ('Superadmins', '{accounts.view,accounts.manage,groups.manage,audit.view,settings.manage}', 4, true) RETURNING id")).rows[0].id;
  const g2 = (await pool.query("INSERT INTO groepen (naam, rechten, niveau) VALUES ('Lezers', '{accounts.view}', 1) RETURNING id")).rows[0].id;
  const s = (await pool.query("INSERT INTO accounts (email, naam, taal) VALUES ('super@test.nl', 'Super', 'en') RETURNING id")).rows[0].id;
  const m = (await pool.query("INSERT INTO accounts (email, naam) VALUES ('mede@test.nl', 'Mede') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO lidmaatschappen VALUES ($1, $2), ($3, $4)", [s, g1, m, g2]);
});

after(async () => {
  await app.close();
  await pool.end();
  await eigenaar.end();
  kc.close();
});

/** Doorloopt het inloggen; geeft het sessiecookie of null, en waar de browser heen gaat. */
async function inloggen(claims: Record<string, unknown>, opties: { zonderCookie?: boolean; terug?: string } = {}) {
  const start = await app.inject({ method: "GET", url: `/api/auth/inloggen${opties.terug ? `?terug=${encodeURIComponent(opties.terug)}` : ""}`, headers: kop() });
  assert.equal(start.statusCode, 303);
  const naar = new URL(start.headers.location as string);
  assert.equal(naar.searchParams.get("prompt"), "login");
  assert.equal(naar.searchParams.get("code_challenge_method"), "S256");
  laatsteNonce = naar.searchParams.get("nonce")!;
  const binding = start.cookies.find((c) => c.name === "__Host-oa_beheer_inlog")!;
  assert.equal(binding.sameSite, "Strict");
  const code = `code-${Math.random()}`;
  codes.set(code, claims);
  const terug = await app.inject({
    method: "GET",
    url: `/api/auth/terug?code=${code}&state=${naar.searchParams.get("state")}`,
    headers: kop(opties.zonderCookie ? {} : { cookie: `${binding.name}=${binding.value}` }),
  });
  assert.equal(terug.statusCode, 303);
  const sessie = terug.cookies.find((c) => c.name === "__Host-oa_beheer" && c.value);
  return { cookie: sessie ? `__Host-oa_beheer=${sessie.value}` : null, naar: terug.headers.location as string, sessie };
}

const ik = (cookie: string | null) => app.inject({ method: "GET", url: "/api/ik", headers: kop(cookie ? { cookie } : {}) });
const MET_OTP = { amr: ["pwd", "otp"], email_verified: true };

test("onbekend e-mailadres: zelfde melding, geen sessie", async () => {
  const r = await inloggen({ sub: "kc-onbekend", email: "niemand@test.nl", ...MET_OTP });
  assert.equal(r.cookie, null);
  assert.equal(r.naar, "/?fout=inloggen");
  const a = (await pool.query("SELECT resultaat FROM audit WHERE actie = 'inloggen.mislukt' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(a.resultaat, "geen-account");
});

test("zonder het bindingscookie (andere browser) lukt inloggen niet", async () => {
  const r = await inloggen({ sub: "kc-mede", email: "mede@test.nl", ...MET_OTP }, { zonderCookie: true });
  assert.equal(r.cookie, null);
});

test("zonder tweede factor geen toegang, zolang mfa.vereist aan staat", async () => {
  const r = await inloggen({ sub: "kc-mede", email: "mede@test.nl", amr: ["pwd"], email_verified: true });
  assert.equal(r.cookie, null);
});

test("inloggen koppelt de Keycloak-gebruiker; het cookie is __Host-, HttpOnly, Secure, Strict", async () => {
  const r = await inloggen({ sub: "kc-mede", email: "mede@test.nl", ...MET_OTP }, { terug: "/accounts" });
  assert.ok(r.cookie);
  assert.equal(r.naar, "/accounts");
  assert.equal(r.sessie!.httpOnly, true);
  assert.equal(r.sessie!.secure, true);
  assert.equal(r.sessie!.sameSite, "Strict");
  assert.equal(r.sessie!.path, "/");
  const i = (await ik(r.cookie)).json();
  assert.deepEqual([i.email, i.rechten, i.niveau, i.nood], ["mede@test.nl", ["accounts.view"], 1, false]);
  assert.equal((await pool.query("SELECT keycloak_sub FROM accounts WHERE email = 'mede@test.nl'")).rows[0].keycloak_sub, "kc-mede");
  // In de database alleen de HMAC van het token.
  const token = r.cookie!.split("=")[1];
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM sessies WHERE token_hash = $1", [Buffer.from(token)])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM sessies WHERE token_hash = $1", [new Sleutels(GEHEIM).sessieHash(token)])).rows[0].n, 1);
});

test("een bestemming buiten het portaal wordt genegeerd", async () => {
  const r = await inloggen({ sub: "kc-mede", email: "mede@test.nl", ...MET_OTP }, { terug: "//kwaad.example/x" });
  assert.equal(r.naar, "/");
});

test("ook bekijken komt in de audit", async () => {
  const r = await inloggen({ sub: "kc-mede", email: "mede@test.nl", ...MET_OTP });
  await ik(r.cookie);
  const a = (await pool.query("SELECT actie, resultaat, email FROM audit ORDER BY id DESC LIMIT 1")).rows[0];
  assert.deepEqual(a, { actie: "GET /api/ik", resultaat: "200", email: "mede@test.nl" });
});

test("na 30 minuten stilte opnieuw inloggen; om middernacht ook", async () => {
  const r = await inloggen({ sub: "kc-mede", email: "mede@test.nl", ...MET_OTP });
  klok = new Date(klok.getTime() + 29 * 60_000);
  assert.equal((await ik(r.cookie)).statusCode, 200);
  klok = new Date(klok.getTime() + 29 * 60_000);
  assert.equal((await ik(r.cookie)).statusCode, 200, "activiteit houdt de sessie open");
  klok = new Date(klok.getTime() + 31 * 60_000);
  assert.equal((await ik(r.cookie)).statusCode, 401);
  const r2 = await inloggen({ sub: "kc-mede", email: "mede@test.nl", ...MET_OTP });
  klok = new Date("2026-11-09T22:59:00Z"); // 23:59 in Amsterdam
  assert.equal((await ik(r2.cookie)).statusCode, 401, "intussen te lang stil");
  const r3 = await inloggen({ sub: "kc-mede", email: "mede@test.nl", ...MET_OTP });
  klok = new Date("2026-11-09T23:00:30Z"); // net na middernacht
  assert.equal((await ik(r3.cookie)).statusCode, 401);
  klok = new Date("2026-11-10T09:00:00Z");
});

test("een geplande blokkade gaat op het moment zelf in en beëindigt de sessies", async () => {
  const r = await inloggen({ sub: "kc-mede", email: "mede@test.nl", ...MET_OTP });
  const m = (await pool.query("SELECT id FROM accounts WHERE email = 'mede@test.nl'")).rows[0].id;
  const s = (await pool.query("SELECT id FROM accounts WHERE email = 'super@test.nl'")).rows[0].id;
  await pool.query("INSERT INTO statuswijzigingen (account, status, reden, ingang, door) VALUES ($1, 'geblokkeerd', 'Onderzoek naar misbruik', $2, $3)", [m, new Date(klok.getTime() + 60_000), s]);
  assert.equal((await ik(r.cookie)).statusCode, 200);
  klok = new Date(klok.getTime() + 61_000);
  assert.equal((await ik(r.cookie)).statusCode, 401);
  assert.equal((await pool.query("SELECT status FROM accounts WHERE id = $1", [m])).rows[0].status, "geblokkeerd");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM sessies WHERE account = $1 AND beeindigd IS NULL", [m])).rows[0].n, 0);
  assert.equal((await inloggen({ sub: "kc-mede", email: "mede@test.nl", ...MET_OTP })).cookie, null);
});

test("uitloggen beëindigt de sessie en stuurt door naar Keycloak", async () => {
  const r = await inloggen({ sub: "kc-super", email: "super@test.nl", ...MET_OTP });
  const uit = await app.inject({ method: "POST", url: "/api/auth/uitloggen", headers: wijzig({ cookie: r.cookie! }), payload: "{}" });
  assert.match(uit.json().doorsturen, /\/uit\?client_id=oa-beheer/);
  assert.equal((await ik(r.cookie)).statusCode, 401);
});

test("het hoofdaccount kan niet via Keycloak inloggen", async () => {
  const r = await inloggen({ sub: "kc-nood", email: "beheerder@test.nl", ...MET_OTP });
  assert.equal(r.cookie, null);
});

// --- noodaccount ---------------------------------------------------------------

const WACHTWOORD = "Nood-wachtwoord-van-32-tekens-lang!";
const TOTP = Buffer.from("12345678901234567890");

test("noodaccount: niet ingesteld = geweigerd, met dezelfde melding", async () => {
  const r = await app.inject({ method: "POST", url: "/api/nood/inloggen", headers: wijzig({ "x-forwarded-for": "198.51.100.1" }), payload: { wachtwoord: WACHTWOORD, totp: "123456", reden: "Keycloak is onbereikbaar" } });
  assert.equal(r.statusCode, 401);
  assert.deepEqual(r.json(), { fout: "nood-geweigerd", melding: "Inloggen is niet gelukt." });
});

test("noodaccount: wachtwoord, TOTP en reden; alle rechten; superadmins krijgen e-mail; einde na 30 minuten", async () => {
  const s = new Sleutels(GEHEIM);
  await eigenaar.query("UPDATE beheer.nood SET wachtwoord_hash = $1, totp_versleuteld = $2", [await hash(WACHTWOORD, ARGON2), s.versleutelTotp(TOTP)]);
  const code = totpCode(TOTP, Math.floor(klok.getTime() / 30_000));
  const kort = await app.inject({ method: "POST", url: "/api/nood/inloggen", headers: wijzig({ "x-forwarded-for": "198.51.100.2" }), payload: { wachtwoord: WACHTWOORD, totp: code, reden: "kort" } });
  assert.equal(kort.statusCode, 400, "een reden van minstens tien tekens");
  const r = await app.inject({ method: "POST", url: "/api/nood/inloggen", headers: wijzig({ "x-forwarded-for": "198.51.100.2" }), payload: { wachtwoord: WACHTWOORD, totp: code, reden: "Keycloak is onbereikbaar sinds 08:00" } });
  assert.equal(r.statusCode, 200, r.body);
  const cookie = `__Host-oa_beheer=${r.cookies.find((c) => c.name === "__Host-oa_beheer")!.value}`;
  const i = (await ik(cookie)).json();
  assert.equal(i.nood, true);
  assert.equal(i.niveau, 4);
  assert.ok(i.rechten.includes("settings.manage"));
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].aan, ["super@test.nl"]);
  assert.match(mails[0].onderwerp, /master account/, "in de taal van de ontvanger");
  assert.match(mails[0].tekst, /Keycloak is onbereikbaar sinds 08:00/);
  assert.match(mails[0].html, /^<!doctype html>/);
  const a = (await pool.query("SELECT details, ip FROM audit WHERE actie = 'nood.ingelogd'")).rows[0];
  assert.deepEqual([a.details.reden, a.ip], ["Keycloak is onbereikbaar sinds 08:00", "198.51.100.2"]);
  // Dezelfde code nog eens: geweigerd.
  const opnieuw = await app.inject({ method: "POST", url: "/api/nood/inloggen", headers: wijzig({ "x-forwarded-for": "198.51.100.2" }), payload: { wachtwoord: WACHTWOORD, totp: code, reden: "Tweede keer proberen" } });
  assert.equal(opnieuw.statusCode, 401);
  // Actief blijven helpt niet: na 30 minuten is het voorbij.
  for (let i = 0; i < 3; i++) {
    klok = new Date(klok.getTime() + 9 * 60_000);
    assert.equal((await ik(cookie)).statusCode, 200);
  }
  klok = new Date(klok.getTime() + 4 * 60_000);
  assert.equal((await ik(cookie)).statusCode, 401);
});

test("noodaccount: pogingen tellen per netwerkadres; een ander adres kan het nog", async () => {
  vergeetInstellingen();
  for (let i = 0; i < 5; i++) {
    const r = await app.inject({ method: "POST", url: "/api/nood/inloggen", headers: wijzig({ "x-forwarded-for": "203.0.113.66" }), payload: { wachtwoord: "fout-wachtwoord-fout-wachtwoord", totp: "000000", reden: "Raden of het lukt" } });
    assert.equal(r.statusCode, 401);
  }
  const code = totpCode(TOTP, Math.floor(klok.getTime() / 30_000));
  const geblokkeerd = await app.inject({ method: "POST", url: "/api/nood/inloggen", headers: wijzig({ "x-forwarded-for": "203.0.113.66" }), payload: { wachtwoord: WACHTWOORD, totp: code, reden: "Nu met het goede wachtwoord" } });
  assert.equal(geblokkeerd.statusCode, 429, "ook met de goede gegevens, vanaf dit adres");
  const ander = await app.inject({ method: "POST", url: "/api/nood/inloggen", headers: wijzig({ "x-forwarded-for": "198.51.100.9" }), payload: { wachtwoord: WACHTWOORD, totp: code, reden: "Vanaf een ander adres" } });
  assert.equal(ander.statusCode, 200);
  // De teller staat als HMAC in de database, niet als adres.
  const p = (await pool.query("SELECT sleutel FROM pogingen LIMIT 1")).rows[0];
  assert.doesNotMatch(p.sleutel.toString("latin1"), /203\.0\.113/);
});

test("noodaccount: alleen vanaf toegestane adressen, als die lijst gevuld is", async () => {
  assert.equal(adresToegestaan("198.51.100.9", []), true);
  assert.equal(adresToegestaan("198.51.100.9", ["198.51.100.0/24"]), true);
  assert.equal(adresToegestaan("::ffff:198.51.100.9", ["198.51.100.9"]), true);
  assert.equal(adresToegestaan("203.0.113.1", ["198.51.100.0/24", "2001:db8::/32"]), false);
  assert.equal(adresToegestaan("2001:db8::5", ["2001:db8::/32"]), true);
  await pool.query("UPDATE instellingen SET waarde = '[\"192.0.2.0/24\"]' WHERE sleutel = 'nood.toegestane_adressen'");
  vergeetInstellingen();
  klok = new Date(klok.getTime() + 60_000);
  const code = totpCode(TOTP, Math.floor(klok.getTime() / 30_000));
  const r = await app.inject({ method: "POST", url: "/api/nood/inloggen", headers: wijzig({ "x-forwarded-for": "198.51.100.10" }), payload: { wachtwoord: WACHTWOORD, totp: code, reden: "Buiten de toegestane adressen" } });
  assert.equal(r.statusCode, 401);
  assert.equal((await pool.query("SELECT resultaat FROM audit WHERE actie = 'nood.mislukt' ORDER BY id DESC LIMIT 1")).rows[0].resultaat, "adres-niet-toegestaan");
  await pool.query("UPDATE instellingen SET waarde = '[]' WHERE sleutel = 'nood.toegestane_adressen'");
  vergeetInstellingen();
});
