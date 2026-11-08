import type { Diensten } from "./app.js";
import { geheel } from "./instellingen.js";

/**
 * Mislukte pogingen, per e-mailadres of netwerkadres, als HMAC (niet terug
 * te rekenen naar het adres). Na een dag verwijderd.
 */
export async function teVeelPogingen(d: Diensten, soort: string, waarde: string): Promise<boolean> {
  const max = await geheel(d.pool, "pogingen.maximum");
  const venster = await geheel(d.pool, "pogingen.venster_minuten");
  const r = await d.pool.query(
    "SELECT count(*)::int AS n FROM pogingen WHERE soort = $1 AND sleutel = $2 AND tijd > $3",
    [soort, d.sleutels.pogingHash(soort, waarde), new Date(d.nu().getTime() - venster * 60_000)],
  );
  return r.rows[0].n >= max;
}

export async function registreerPoging(d: Diensten, soort: string, waarde: string): Promise<void> {
  await d.pool.query("INSERT INTO pogingen (soort, sleutel, tijd) VALUES ($1, $2, $3)", [soort, d.sleutels.pogingHash(soort, waarde), d.nu()]);
}

export async function ruimPogingenOp(d: Diensten): Promise<void> {
  const grens = new Date(d.nu().getTime() - 24 * 3600_000);
  await d.pool.query("DELETE FROM pogingen WHERE tijd < $1", [grens]);
  await d.pool.query("DELETE FROM inlogstaat WHERE verloopt < $1", [d.nu()]);
}
