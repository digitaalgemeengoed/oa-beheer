import { BlockList, isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import { hash, verify, Algorithm } from "@node-rs/argon2";
import { AppFout } from "../app.js";
import { schrijfAudit } from "../audit.js";
import { lijst } from "../instellingen.js";
import { bericht } from "../mail.js";
import { registreerPoging, teVeelPogingen } from "../pogingen.js";
import { maakSessie, zetSessieCookie } from "../sessies.js";
import { controleerTotp } from "../totp.js";
import { nieuwToken } from "../sleutels.js";

/** Argon2id volgens OWASP: 19 MiB, 2 rondes. */
export const ARGON2 = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

/** Mag dit netwerkadres het noodaccount gebruiken? Leeg = overal. */
export function adresToegestaan(ip: string, lijstAdressen: string[]): boolean {
  if (!lijstAdressen.length) return true;
  const b = new BlockList();
  for (const a of lijstAdressen) {
    const [adres, prefix] = a.split("/");
    const soort = isIP(adres) === 6 ? "ipv6" : "ipv4";
    if (!isIP(adres)) continue;
    if (prefix !== undefined) b.addSubnet(adres, Number(prefix), soort);
    else b.addAddress(adres, soort);
  }
  const zuiver = ip.replace(/^::ffff:/, "");
  return b.check(zuiver, isIP(zuiver) === 6 ? "ipv6" : "ipv4");
}

/**
 * Het noodaccount (break-glass), op /emergency. Geen e-mail nodig: wachtwoord,
 * TOTP-code en een reden. Pogingen tellen alleen per netwerkadres, zodat
 * niemand het account op slot kan raden. Elk gebruik gaat in de audit en per
 * e-mail naar de superadmins; de sessie eindigt na 30 minuten.
 */
export async function noodRoutes(app: FastifyInstance): Promise<void> {
  const d = app.diensten;
  // Met dezelfde instellingen als het echte: een ontbrekend wachtwoord kost even lang.
  const nepHash = await hash(nieuwToken(), ARGON2);

  app.post<{ Body: { wachtwoord: string; totp: string; reden: string } }>(
    "/api/nood/inloggen",
    {
      schema: {
        body: {
          type: "object",
          required: ["wachtwoord", "totp", "reden"],
          additionalProperties: false,
          properties: {
            wachtwoord: { type: "string", minLength: 1, maxLength: 200 },
            totp: { type: "string", minLength: 6, maxLength: 6, pattern: "^[0-9]{6}$" },
            reden: { type: "string", minLength: 10, maxLength: 1000 },
          },
        },
      },
    },
    async (req, antwoord) => {
      const ip = req.ip;
      const weiger = async (resultaat: string, status = 401) => {
        await registreerPoging(d, "nood-ip", ip);
        await schrijfAudit(d.pool, { actie: "nood.mislukt", ip, resultaat, details: { reden: req.body.reden } });
        throw new AppFout(status, "nood-geweigerd", "Inloggen is niet gelukt.");
      };
      if (await teVeelPogingen(d, "nood-ip", ip)) {
        await schrijfAudit(d.pool, { actie: "nood.geblokkeerd", ip, resultaat: "te-veel-pogingen" });
        throw new AppFout(429, "te-veel-pogingen", "Te veel pogingen. Probeer het later opnieuw.");
      }
      const n = (await d.pool.query("SELECT n.account, n.wachtwoord_hash, n.totp_versleuteld, n.totp_laatste, a.email FROM nood n JOIN accounts a ON a.id = n.account WHERE a.hoofdaccount")).rows[0];
      // Altijd het wachtwoord controleren, ook als er niets is ingesteld: zelfde tijd.
      const wachtwoordGoed = await verify(n?.wachtwoord_hash ?? nepHash, req.body.wachtwoord, ARGON2).catch(() => false);
      let teller: number | null = null;
      if (n?.totp_versleuteld) {
        const geheim = d.sleutels.ontsleutelTotp(n.totp_versleuteld);
        teller = controleerTotp(geheim, req.body.totp, d.nu(), n.totp_laatste === null ? null : Number(n.totp_laatste));
      }
      if (!adresToegestaan(ip, await lijst(d.pool, "nood.toegestane_adressen"))) return weiger("adres-niet-toegestaan");
      if (!n?.wachtwoord_hash || !wachtwoordGoed || teller === null) return weiger(!n?.wachtwoord_hash ? "niet-ingesteld" : !wachtwoordGoed ? "wachtwoord" : "totp");
      // Een code maar één keer: alleen een hogere teller mag.
      const r = await d.pool.query("UPDATE nood SET totp_laatste = $2 WHERE account = $1 AND (totp_laatste IS NULL OR totp_laatste < $2)", [n.account, teller]);
      if (!r.rowCount) return weiger("totp-hergebruikt");

      const token = await maakSessie(d, d.pool, n.account, req, true);
      zetSessieCookie(antwoord, token);
      await schrijfAudit(d.pool, { account: n.account, email: n.email, actie: "nood.ingelogd", ip, resultaat: "ok", details: { reden: req.body.reden } });

      const supers = (await d.pool.query(
        `SELECT DISTINCT a.email, a.taal FROM accounts a JOIN lidmaatschappen l ON l.account = a.id JOIN groepen g ON g.id = l.groep
          WHERE g.superadmin AND a.status = 'actief' AND NOT a.hoofdaccount`,
      )).rows as { email: string; taal: "nl" | "en" }[];
      const tijd = d.nu().toISOString();
      for (const taal of ["nl", "en"] as const) {
        const aan = supers.filter((s) => s.taal === taal).map((s) => s.email);
        if (!aan.length) continue;
        const b = taal === "nl"
          ? bericht(aan, "Het noodaccount van het beheerportaal is gebruikt", [`Op ${tijd} is ingelogd met het noodaccount van ${d.config.host}, vanaf netwerkadres ${ip}.`, `Opgegeven reden: ${req.body.reden}`, "Was dit niet afgesproken? Behandel het als een beveiligingsincident."])
          : bericht(aan, "The admin portal's master account was used", [`At ${tijd} someone signed in with the master account of ${d.config.host}, from network address ${ip}.`, `Reason given: ${req.body.reden}`, "If this was not agreed, treat it as a security incident."]);
        await d.mailer.verstuur(b).catch((e) => req.log.error({ fout: (e as Error).message }, "e-mail aan superadmins mislukt"));
      }
      return { ok: true, sessieMinuten: 30 };
    },
  );
}
