import type { Db } from "./db.js";

/**
 * Een gebeurtenis in de auditketen. De database berekent de hash en
 * blokkeert wijzigen en verwijderen. Nooit wachtwoorden, codes of tokens in
 * details: alleen wat nodig is om terug te zien wat er gebeurde.
 */
export interface Gebeurtenis {
  account?: string | null;
  email?: string | null;
  actie: string;
  doel?: string | null;
  ip?: string | null;
  resultaat: string;
  details?: Record<string, unknown>;
}

const VERBODEN = /wachtwoord|password|token|code|secret|geheim|totp|cookie|authorization/i;

/** Haalt velden die nooit in de audit mogen eruit, ook genest. */
export function schoon(d: unknown): unknown {
  if (Array.isArray(d)) return d.map(schoon);
  if (d && typeof d === "object") {
    return Object.fromEntries(Object.entries(d as Record<string, unknown>).filter(([k]) => !VERBODEN.test(k)).map(([k, v]) => [k, schoon(v)]));
  }
  return typeof d === "string" && d.length > 1000 ? `${d.slice(0, 1000)}…` : d;
}

export async function schrijfAudit(db: Db, g: Gebeurtenis): Promise<void> {
  await db.query(
    "INSERT INTO audit (account, email, actie, doel, ip, resultaat, details) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [g.account ?? null, g.email ?? null, g.actie.slice(0, 100), g.doel?.slice(0, 300) ?? null, g.ip ?? null, g.resultaat.slice(0, 50), JSON.stringify(schoon(g.details ?? {}))],
  );
}
