import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const MAP = new URL("../migraties/", import.meta.url).pathname;

/**
 * Migraties als eigenaar van de database, het wachtwoord van de app-rol, en
 * het hoofdaccount. Het hoofdaccount bestaat daarna altijd (triggers).
 */
export async function migreer(opties: { eigenaarUrl: string; appWachtwoord?: string; hoofdaccountEmail: string; log?: (s: string) => void }): Promise<void> {
  const log = opties.log ?? (() => {});
  const c = new pg.Client({ connectionString: opties.eigenaarUrl });
  await c.connect();
  try {
    await c.query("CREATE TABLE IF NOT EXISTS public.beheer_migraties (naam text PRIMARY KEY, uitgevoerd timestamptz NOT NULL DEFAULT now())");
    for (const naam of (await readdir(MAP)).filter((b) => b.endsWith(".sql")).sort()) {
      if ((await c.query("SELECT 1 FROM public.beheer_migraties WHERE naam = $1", [naam])).rowCount) continue;
      await c.query("BEGIN");
      await c.query(await readFile(join(MAP, naam), "utf8"));
      await c.query("INSERT INTO public.beheer_migraties (naam) VALUES ($1)", [naam]);
      await c.query("COMMIT");
      log(`migratie ${naam}`);
    }
    if (opties.appWachtwoord) {
      // ALTER ROLE kent geen parameters; het wachtwoord gaat ge-escaped mee.
      const w = await c.query("SELECT quote_literal($1) AS w", [opties.appWachtwoord]);
      await c.query(`ALTER ROLE oa_beheer_app WITH LOGIN PASSWORD ${w.rows[0].w}`);
    }
    const h = await c.query("SELECT email FROM beheer.accounts WHERE hoofdaccount");
    if (h.rowCount === 0) {
      const r = await c.query(
        "INSERT INTO beheer.accounts (email, naam, hoofdaccount) VALUES ($1, 'Hoofdaccount', true) RETURNING id",
        [opties.hoofdaccountEmail.toLowerCase()],
      );
      await c.query("INSERT INTO beheer.nood (account) VALUES ($1)", [r.rows[0].id]);
      await c.query("INSERT INTO beheer.audit (account, email, actie, resultaat) VALUES ($1, $2, 'hoofdaccount.aangemaakt', 'ok')", [r.rows[0].id, opties.hoofdaccountEmail.toLowerCase()]);
      log(`hoofdaccount ${opties.hoofdaccountEmail} aangemaakt`);
    } else if (h.rows[0].email !== opties.hoofdaccountEmail.toLowerCase()) {
      log(`let op: het hoofdaccount is ${h.rows[0].email}; HOOFDACCOUNT_EMAIL (${opties.hoofdaccountEmail}) verandert dat niet`);
    }
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}
