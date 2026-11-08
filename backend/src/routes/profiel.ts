import type { FastifyInstance } from "fastify";
import { AppFout } from "../app.js";
import { schrijfAudit } from "../audit.js";


const UUID = { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } as const;

export async function profielRoutes(app: FastifyInstance): Promise<void> {
  const d = app.diensten;

  /** Je eigen gegevens en apparaten. Het wachtwoord wijzig je in Keycloak. */
  app.get("/api/profiel", async (req) => {
    const p = req.persoon!;
    const apparaten = (await d.pool.query(
      "SELECT id, apparaat, ip, aangemaakt, laatst_actief, nood FROM sessies WHERE account = $1 AND beeindigd IS NULL AND hard_einde > $2 ORDER BY laatst_actief DESC",
      [p.id, d.nu()],
    )).rows.map((s) => ({ ...s, ditApparaat: s.id === p.sessie }));
    return {
      naam: p.naam,
      email: p.email,
      taal: p.taal,
      apparaten,
      wachtwoordWijzigen: d.config.oidc && !p.nood ? `${d.config.oidc.issuer}/account/#/security/signingin` : null,
    };
  });

  app.put<{ Body: { naam: string; taal: "nl" | "en" } }>(
    "/api/profiel",
    { schema: { body: { type: "object", required: ["naam", "taal"], additionalProperties: false, properties: { naam: { type: "string", minLength: 1, maxLength: 200 }, taal: { enum: ["nl", "en"] } } } } },
    async (req) => {
      const p = req.persoon!;
      await d.pool.query("UPDATE accounts SET naam = $2, taal = $3 WHERE id = $1", [p.id, req.body.naam, req.body.taal]);
      await schrijfAudit(d.pool, { account: p.id, email: p.email, actie: "profiel.gewijzigd", doel: p.id, ip: req.ip, resultaat: "ok", details: { oud: { naam: p.naam, taal: p.taal }, nieuw: req.body } });
      return {};
    },
  );

  /** Een eigen apparaat afmelden. */
  app.post<{ Params: { id: string } }>("/api/profiel/apparaten/:id/uitloggen", { schema: { params: { type: "object", properties: { id: UUID } } } }, async (req) => {
    const p = req.persoon!;
    const r = await d.pool.query("UPDATE sessies SET beeindigd = $3, reden_einde = 'eigen-apparaat-afgemeld' WHERE id = $1 AND account = $2 AND beeindigd IS NULL", [req.params.id, p.id, d.nu()]);
    if (!r.rowCount) throw new AppFout(404, "niet-gevonden", "Dit apparaat is niet (meer) aangemeld.");
    await schrijfAudit(d.pool, { account: p.id, email: p.email, actie: "profiel.apparaat-afgemeld", doel: req.params.id, ip: req.ip, resultaat: "ok" });
    return {};
  });

  /** Het overzicht op de startpagina; wat je ziet, hangt af van je niveau en rechten. */
  app.get("/api/dashboard", async (req) => {
    const p = req.persoon!;
    const uit: Record<string, unknown> = { niveau: p.niveau };
    if (p.rechten.has("accounts.view")) {
      uit.accounts = (await d.pool.query("SELECT status, count(*)::int AS n FROM accounts WHERE NOT hoofdaccount GROUP BY status")).rows;
      uit.gepland = (await d.pool.query("SELECT count(*)::int AS n FROM statuswijzigingen WHERE uitgevoerd IS NULL")).rows[0].n;
    }
    if (p.rechten.has("audit.view")) {
      uit.audit = (await d.pool.query(
        "SELECT count(*) FILTER (WHERE tijd > $1)::int AS vandaag, count(*) FILTER (WHERE tijd > $1 AND actie IN ('inloggen.mislukt', 'nood.mislukt', 'nood.geblokkeerd'))::int AS mislukt, count(*) FILTER (WHERE tijd > $2 AND actie = 'nood.ingelogd')::int AS nood_week FROM audit",
        [new Date(d.nu().getTime() - 24 * 3600_000), new Date(d.nu().getTime() - 7 * 24 * 3600_000)],
      )).rows[0];
    }
    if (p.niveau >= 3 && p.rechten.has("accounts.view")) {
      uit.actieveSessies = (await d.pool.query("SELECT count(*)::int AS n FROM sessies WHERE beeindigd IS NULL AND hard_einde > $1", [d.nu()])).rows[0].n;
    }
    return uit;
  });

}
