import type pg from "pg";
import { schrijfAudit } from "./audit.js";
import type { Db } from "./db.js";

export const RECHTEN = ["accounts.view", "accounts.manage", "groups.view", "groups.manage", "audit.view", "settings.view", "settings.manage", "metadata.view", "metadata.manage", "anonimiseren.view"] as const;
export type Recht = (typeof RECHTEN)[number];

/** Rechten die alleen doorgeeft wie ze zelf heeft. */
export const GEVOELIG: Recht[] = ["accounts.view", "accounts.manage", "groups.view", "groups.manage", "audit.view"];

export interface Persoon {
  id: string;
  email: string;
  naam: string;
  taal: "nl" | "en";
  status: string;
  hoofdaccount: boolean;
  rechten: Set<Recht>;
  /** Hoogste clearance van de groepen; het noodaccount 4. */
  niveau: number;
  superadmin: boolean;
  nood: boolean;
  sessie: string;
}

/**
 * Rechten en status, bij elk verzoek vers uit de database: een wijziging
 * werkt meteen. Rechten tellen op over groepen; het niveau is het hoogste.
 */
export async function laadPersoon(db: Db, account: string, sessie: string, nood: boolean): Promise<Persoon | null> {
  const r = await db.query(
    `SELECT a.id, a.email, a.naam, a.taal, a.status, a.hoofdaccount,
            coalesce(array_agg(DISTINCT r) FILTER (WHERE r IS NOT NULL), '{}') AS rechten,
            coalesce(max(g.niveau), 0) AS niveau,
            coalesce(bool_or(g.superadmin), false) AS superadmin
       FROM accounts a
       LEFT JOIN lidmaatschappen l ON l.account = a.id
       LEFT JOIN groepen g ON g.id = l.groep
       LEFT JOIN LATERAL unnest(g.rechten) AS r ON true
      WHERE a.id = $1
      GROUP BY a.id`,
    [account],
  );
  const a = r.rows[0];
  if (!a) return null;
  if (a.hoofdaccount && nood) {
    return { ...a, rechten: new Set(RECHTEN), niveau: 4, superadmin: true, nood: true, sessie };
  }
  if (a.hoofdaccount) return null; // het hoofdaccount werkt alleen via /emergency
  return { ...a, rechten: new Set(a.rechten as Recht[]), niveau: Number(a.niveau), superadmin: a.superadmin, nood: false, sessie };
}

/**
 * Voert statuswijzigingen uit waarvan het moment is gekomen. Blokkeren of
 * deactiveren beëindigt alle sessies van het account. Draait voor elke
 * toegangscontrole en elke 30 seconden.
 */
export async function voerStatuswijzigingenUit(pool: pg.Pool, nu: Date): Promise<number> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query(
      `SELECT s.id, s.account, s.status, s.reden, s.door, a.email
         FROM statuswijzigingen s JOIN accounts a ON a.id = s.account
        WHERE s.uitgevoerd IS NULL AND s.ingang <= $1
        ORDER BY s.ingang, s.aangemaakt
        FOR UPDATE OF s SKIP LOCKED`,
      [nu],
    );
    for (const w of r.rows) {
      await c.query("UPDATE accounts SET status = $2 WHERE id = $1", [w.account, w.status]);
      await c.query("UPDATE statuswijzigingen SET uitgevoerd = $2 WHERE id = $1", [w.id, nu]);
      if (w.status !== "actief") {
        await c.query("UPDATE sessies SET beeindigd = $2, reden_einde = $3 WHERE account = $1 AND beeindigd IS NULL", [w.account, nu, `status-${w.status}`]);
      }
      await schrijfAudit(c, { account: w.door, actie: "account.status.ingegaan", doel: w.account, resultaat: "ok", details: { status: w.status, reden: w.reden, account_email: w.email } });
    }
    await c.query("COMMIT");
    return r.rowCount ?? 0;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
