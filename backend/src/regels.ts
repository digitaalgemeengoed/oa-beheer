import { AppFout } from "./app.js";
import type { Db } from "./db.js";
import { GEVOELIG, type Persoon, type Recht } from "./persoon.js";

/**
 * Wie mag wie beheren. Zuiver, zodat de regels los te testen zijn.
 *
 * - Niemand wijzigt zijn eigen groepen of status, of het hoofdaccount.
 * - Een superadmin beheert iedereen behalve zichzelf en het hoofdaccount.
 * - Anderen beheren alleen accounts met een lager niveau dan hun eigen.
 * - Een recht over accounts, groepen of de audit geeft alleen door wie het zelf heeft.
 */
export interface Doelaccount {
  id: string;
  hoofdaccount: boolean;
  niveau: number;
}

export interface Groep {
  id?: string;
  niveau: number;
  superadmin: boolean;
  rechten: Recht[];
}

export function magBeheren(actor: Pick<Persoon, "id" | "superadmin" | "niveau">, doel: Doelaccount): string | null {
  if (doel.hoofdaccount) return "hoofdaccount";
  if (doel.id === actor.id) return "eigen-account";
  if (actor.superadmin) return null;
  if (doel.niveau >= actor.niveau) return "niveau";
  return null;
}

/** Mag de actor deze groep toekennen, ontnemen, maken of wijzigen? */
export function magGroepGeven(actor: Pick<Persoon, "superadmin" | "niveau" | "rechten">, g: Groep): string | null {
  const nietZelf = g.rechten.filter((r) => GEVOELIG.includes(r) && !actor.rechten.has(r));
  if (nietZelf.length) return "recht-niet-zelf";
  if (actor.superadmin) return null;
  if (g.superadmin) return "superadmin";
  if (g.niveau >= actor.niveau) return "niveau";
  return null;
}

const MELDINGEN: Record<string, string> = {
  hoofdaccount: "Het hoofdaccount kan niemand wijzigen.",
  "eigen-account": "Je eigen groepen en status wijzig je niet zelf.",
  niveau: "Dit valt buiten je niveau.",
  superadmin: "Alleen een superadmin geeft superadmin-rechten.",
  "recht-niet-zelf": "Een recht dat je zelf niet hebt, kun je niet doorgeven.",
  "lid-buiten-niveau": "In deze groep zitten mensen die je niet mag beheren.",
};

export function weigerAls(reden: string | null): void {
  if (reden) throw new AppFout(403, reden, MELDINGEN[reden] ?? "Dat mag niet.");
}

export async function laadDoel(db: Db, id: string): Promise<Doelaccount & { email: string; status: string; naam: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppFout(404, "niet-gevonden", "Dit account bestaat niet.");
  const r = await db.query(
    `SELECT a.id, a.email, a.naam, a.status, a.hoofdaccount, coalesce(max(g.niveau), 0)::int AS niveau
       FROM accounts a LEFT JOIN lidmaatschappen l ON l.account = a.id LEFT JOIN groepen g ON g.id = l.groep
      WHERE a.id = $1 GROUP BY a.id`,
    [id],
  );
  if (!r.rowCount) throw new AppFout(404, "niet-gevonden", "Dit account bestaat niet.");
  return r.rows[0];
}

export async function laadGroepen(db: Db, ids: string[]): Promise<(Groep & { id: string; naam: string })[]> {
  if (ids.some((i) => !/^[0-9a-f-]{36}$/i.test(i))) throw new AppFout(400, "verzoek-ongeldig", "Onbekende groep.");
  const r = await db.query("SELECT id, naam, niveau, superadmin, rechten FROM groepen WHERE id = ANY($1::uuid[])", [ids]);
  if (r.rowCount !== new Set(ids).size) throw new AppFout(400, "groep-onbekend", "Een van de groepen bestaat niet.");
  return r.rows;
}
