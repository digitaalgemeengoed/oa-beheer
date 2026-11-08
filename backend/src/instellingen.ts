import type { Db } from "./db.js";

/**
 * Instellingen uit de database, hoogstens 30 seconden oud. Type, bereik en
 * standaard staan in de migratie; een ontbrekende of ongeldige waarde valt
 * terug op de standaard.
 */
export interface Instelling {
  sleutel: string;
  type: "geheel" | "boolean" | "tekst" | "lijst" | "tijdzone";
  waarde: unknown;
  standaard: unknown;
  minimum: number | null;
  maximum: number | null;
  omschrijving: { nl: string; en: string };
  gewijzigd: string | null;
  gewijzigd_door: string | null;
}

let cache: { tijd: number; waarden: Map<string, Instelling> } | null = null;

export function vergeetInstellingen(): void {
  cache = null;
}

export async function alleInstellingen(db: Db, vers = false): Promise<Map<string, Instelling>> {
  if (!vers && cache && Date.now() - cache.tijd < 30_000) return cache.waarden;
  const r = await db.query("SELECT sleutel, type, waarde, standaard, minimum, maximum, omschrijving, gewijzigd, gewijzigd_door FROM instellingen ORDER BY sleutel");
  const waarden = new Map<string, Instelling>(
    r.rows.map((x) => [x.sleutel, { ...x, minimum: x.minimum === null ? null : Number(x.minimum), maximum: x.maximum === null ? null : Number(x.maximum) }]),
  );
  cache = { tijd: Date.now(), waarden };
  return waarden;
}

export async function geheel(db: Db, sleutel: string): Promise<number> {
  const i = (await alleInstellingen(db)).get(sleutel);
  const w = Number(i?.waarde);
  return Number.isInteger(w) ? w : Number(i?.standaard);
}

export async function aanUit(db: Db, sleutel: string): Promise<boolean> {
  const i = (await alleInstellingen(db)).get(sleutel);
  return typeof i?.waarde === "boolean" ? i.waarde : i?.standaard === true;
}

export async function tekst(db: Db, sleutel: string): Promise<string> {
  const i = (await alleInstellingen(db)).get(sleutel);
  return typeof i?.waarde === "string" ? i.waarde : String(i?.standaard ?? "");
}

export async function lijst(db: Db, sleutel: string): Promise<string[]> {
  const i = (await alleInstellingen(db)).get(sleutel);
  return Array.isArray(i?.waarde) ? (i!.waarde as string[]) : [];
}

/** Toetst een nieuwe waarde tegen type en bereik; geeft de genormaliseerde waarde of een foutcode. */
export function toetsWaarde(i: Pick<Instelling, "type" | "minimum" | "maximum">, w: unknown): { ok: true; waarde: unknown } | { ok: false; fout: string } {
  switch (i.type) {
    case "geheel":
      if (typeof w !== "number" || !Number.isInteger(w)) return { ok: false, fout: "geen-geheel-getal" };
      if ((i.minimum !== null && w < i.minimum) || (i.maximum !== null && w > i.maximum)) return { ok: false, fout: "buiten-bereik" };
      return { ok: true, waarde: w };
    case "boolean":
      return typeof w === "boolean" ? { ok: true, waarde: w } : { ok: false, fout: "geen-ja-nee" };
    case "tekst":
      return typeof w === "string" && w.length <= 1000 ? { ok: true, waarde: w } : { ok: false, fout: "ongeldige-tekst" };
    case "tijdzone":
      try {
        if (typeof w !== "string") throw new Error();
        new Intl.DateTimeFormat("en", { timeZone: w });
        return { ok: true, waarde: w };
      } catch {
        return { ok: false, fout: "onbekende-tijdzone" };
      }
    case "lijst":
      if (!Array.isArray(w) || w.length > 100 || !w.every((x) => typeof x === "string" && x.length > 0 && x.length <= 254)) return { ok: false, fout: "ongeldige-lijst" };
      return { ok: true, waarde: [...new Set(w.map((x: string) => x.trim()))] };
  }
}
