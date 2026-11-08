import { randomBytes } from "node:crypto";
import pg from "pg";
import { hash } from "@node-rs/argon2";
import { leesConfig } from "./config.js";
import { migreer } from "./migreer.js";
import { ARGON2 } from "./routes/nood.js";
import { Sleutels } from "./sleutels.js";
import { base32, nieuwTotpGeheim, otpauthAdres } from "./totp.js";

/**
 * Opdrachtregel op de server.
 *
 *   node dist/cli.js migreer         migraties en het hoofdaccount
 *   node dist/cli.js nood-instellen  nieuw wachtwoord en TOTP-geheim voor het noodaccount
 *
 * Het wachtwoord en het TOTP-geheim van het noodaccount kunnen alleen hier
 * worden gezet, als eigenaar van de database (DATABASE_URL_EIGENAAR).
 */
async function main(): Promise<void> {
  const opdracht = process.argv[2];
  const eigenaarUrl = process.env.DATABASE_URL_EIGENAAR;
  if (!eigenaarUrl) throw new Error("DATABASE_URL_EIGENAAR ontbreekt");
  const config = leesConfig();

  if (opdracht === "migreer") {
    await migreer({ eigenaarUrl, appWachtwoord: process.env.DATABASE_APP_WACHTWOORD, hoofdaccountEmail: config.hoofdaccountEmail, log: (s) => console.log(s) });
    return;
  }

  if (opdracht === "nood-instellen") {
    // 32 tekens uit 24 willekeurige bytes (192 bits); ruim boven het minimum van 24.
    const wachtwoord = randomBytes(24).toString("base64url");
    const geheim = nieuwTotpGeheim();
    const sleutels = new Sleutels(config.adminSecret);
    const c = new pg.Client({ connectionString: eigenaarUrl });
    await c.connect();
    try {
      const r = await c.query(
        "UPDATE beheer.nood SET wachtwoord_hash = $1, totp_versleuteld = $2, totp_laatste = NULL, bijgewerkt = now() WHERE account = (SELECT id FROM beheer.accounts WHERE hoofdaccount) RETURNING account",
        [await hash(wachtwoord, ARGON2), sleutels.versleutelTotp(geheim)],
      );
      if (!r.rowCount) throw new Error("Geen hoofdaccount; draai eerst: migreer");
      await c.query("UPDATE beheer.sessies SET beeindigd = now(), reden_einde = 'nood-opnieuw-ingesteld' WHERE nood AND beeindigd IS NULL");
      await c.query("INSERT INTO beheer.audit (account, actie, resultaat) VALUES ($1, 'nood.ingesteld', 'ok')", [r.rows[0].account]);
    } finally {
      await c.end();
    }
    console.log(`
Het noodaccount is ingesteld. Bewaar dit nu in je wachtwoordmanager; het
wordt nergens anders getoond of bewaard.

  Wachtwoord:   ${wachtwoord}
  TOTP-geheim:  ${base32(geheim)}
  Voor de app:  ${otpauthAdres(geheim, config.hoofdaccountEmail, config.host)}

Voeg het TOTP-geheim toe aan een authenticator-app (bijvoorbeeld door de
otpauth-regel als QR-code te tonen, of het geheim met de hand in te voeren).
Inloggen: ${config.herkomst}/emergency
`);
    return;
  }

  console.error("Gebruik: node dist/cli.js migreer | nood-instellen");
  process.exitCode = 2;
}

main().catch((e) => {
  console.error(`Mislukt: ${(e as Error).message}`);
  process.exitCode = 1;
});
