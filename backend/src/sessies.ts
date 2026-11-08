import type { FastifyReply, FastifyRequest } from "fastify";
import type { Diensten } from "./app.js";
import { schrijfAudit } from "./audit.js";
import type { Db } from "./db.js";
import { geheel, tekst } from "./instellingen.js";
import { nieuwToken } from "./sleutels.js";

/** __Host-: alleen via https, alleen deze host, pad /. */
export const COOKIE = "__Host-oa_beheer";

export function zetSessieCookie(antwoord: FastifyReply, token: string): void {
  antwoord.setCookie(COOKIE, token, { httpOnly: true, secure: true, sameSite: "strict", path: "/" });
}

export function wisSessieCookie(antwoord: FastifyReply): void {
  antwoord.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: "strict", path: "/" });
}

/** "Firefox op Linux": genoeg om je eigen apparaten te herkennen. */
export function apparaatVan(ua: string | undefined): string {
  const u = ua ?? "";
  const browser = /Edg\//.test(u) ? "Edge" : /Firefox\//.test(u) ? "Firefox" : /Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "Browser";
  const os = /Windows/.test(u) ? "Windows" : /Android/.test(u) ? "Android" : /iPhone|iPad/.test(u) ? "iOS" : /Mac OS X/.test(u) ? "macOS" : /Linux/.test(u) ? "Linux" : "onbekend";
  return `${browser} op ${os}`;
}

export async function maakSessie(d: Diensten, db: Db, account: string, req: FastifyRequest, nood: boolean): Promise<string> {
  const token = nieuwToken();
  const nu = d.nu();
  const hardEinde = nood ? new Date(nu.getTime() + 30 * 60_000) : volgendeMiddernacht(nu, await tekst(db, "sessie.dag_tijdzone"));
  await db.query(
    "INSERT INTO sessies (account, token_hash, apparaat, ip, aangemaakt, laatst_actief, hard_einde, nood) VALUES ($1, $2, $3, $4, $5, $5, $6, $7)",
    [account, d.sleutels.sessieHash(token), apparaatVan(req.headers["user-agent"]), req.ip, nu, hardEinde, nood],
  );
  return token;
}

function lokaleTijd(t: Date, tijdzone: string): Record<string, number> {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tijdzone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(t)
    .reduce<Record<string, number>>((a, p) => (p.type !== "literal" ? { ...a, [p.type]: Number(p.value) } : a), {});
}

/** Het eerstvolgende middernacht in de gegeven tijdzone, ook rond de wisseling van zomer- en wintertijd. */
export function volgendeMiddernacht(nu: Date, tijdzone: string): Date {
  const l = lokaleTijd(nu, tijdzone);
  const verstreken = (l.hour * 3600 + l.minute * 60 + l.second) * 1000 + nu.getMilliseconds();
  let gok = new Date(nu.getTime() - verstreken + 24 * 3600_000);
  // Was die dag 23 of 25 uur lang, dan staat de gok een uur naast middernacht: corrigeren.
  const g = lokaleTijd(gok, tijdzone);
  const afwijking = (g.hour >= 12 ? g.hour - 24 : g.hour) * 3600_000 + g.minute * 60_000;
  gok = new Date(gok.getTime() - afwijking);
  return gok;
}

export interface GeldigeSessie {
  id: string;
  account: string;
  nood: boolean;
  laatst_actief: Date;
  hard_einde: Date;
}

/**
 * Een geldige sessie bij dit cookie, of null. Beëindigt een sessie die te
 * lang stil was (opnieuw inloggen) of over haar harde einde is (middernacht,
 * of 30 minuten voor het noodaccount).
 */
export async function geldigeSessie(d: Diensten, req: FastifyRequest): Promise<GeldigeSessie | null> {
  const token = req.cookies[COOKIE];
  if (!token || token.length > 100) return null;
  const r = await d.pool.query(
    "SELECT id, account, nood, laatst_actief, hard_einde FROM sessies WHERE token_hash = $1 AND beeindigd IS NULL",
    [d.sleutels.sessieHash(token)],
  );
  const s = r.rows[0] as GeldigeSessie | undefined;
  if (!s) return null;
  const nu = d.nu();
  const stil = (await geheel(d.pool, "sessie.inactief_minuten")) * 60_000;
  const reden = nu >= s.hard_einde ? (s.nood ? "nood-30-minuten" : "einde-dag") : !s.nood && nu.getTime() - s.laatst_actief.getTime() > stil ? "inactief" : null;
  if (reden) {
    await beeindig(d.pool, s.id, reden, nu);
    await schrijfAudit(d.pool, { account: s.account, actie: "sessie.verlopen", doel: s.id, ip: req.ip, resultaat: reden });
    return null;
  }
  if (nu.getTime() - s.laatst_actief.getTime() > 30_000) {
    await d.pool.query("UPDATE sessies SET laatst_actief = $2 WHERE id = $1", [s.id, nu]);
  }
  return s;
}

export async function beeindig(db: Db, sessie: string, reden: string, nu: Date): Promise<void> {
  await db.query("UPDATE sessies SET beeindigd = $2, reden_einde = $3 WHERE id = $1 AND beeindigd IS NULL", [sessie, nu, reden]);
}

export async function beeindigAlle(db: Db, account: string, reden: string, nu: Date, behalve?: string): Promise<number> {
  const r = await db.query(
    "UPDATE sessies SET beeindigd = $2, reden_einde = $3 WHERE account = $1 AND beeindigd IS NULL AND ($4::uuid IS NULL OR id <> $4)",
    [account, nu, reden, behalve ?? null],
  );
  return r.rowCount ?? 0;
}
