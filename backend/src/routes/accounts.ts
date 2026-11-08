import type { FastifyInstance } from "fastify";
import { AppFout } from "../app.js";
import { schrijfAudit } from "../audit.js";
import { inTransactie } from "../db.js";
import { bericht } from "../mail.js";
import { voerStatuswijzigingenUit } from "../persoon.js";
import { laadDoel, laadGroepen, magBeheren, magGroepGeven, weigerAls } from "../regels.js";
import { beeindigAlle } from "../sessies.js";
import { vereis } from "../toegang.js";

const UUID = { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } as const;
const REDEN = { type: "string", minLength: 5, maxLength: 1000 } as const;
const STATUS = { enum: ["actief", "geblokkeerd", "gedeactiveerd"] } as const;

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  const d = app.diensten;

  app.get("/api/accounts", async (req) => {
    vereis(req, "accounts.view");
    const r = await d.pool.query(
      `SELECT a.id, a.email, a.naam, a.taal, a.status, a.hoofdaccount, a.aangemaakt,
              coalesce(max(g.niveau), 0)::int AS niveau,
              coalesce(array_agg(g.naam ORDER BY g.naam) FILTER (WHERE g.id IS NOT NULL), '{}') AS groepen,
              (SELECT max(laatst_actief) FROM sessies s WHERE s.account = a.id) AS laatst_actief,
              (SELECT count(*)::int FROM statuswijzigingen w WHERE w.account = a.id AND w.uitgevoerd IS NULL) AS gepland
         FROM accounts a LEFT JOIN lidmaatschappen l ON l.account = a.id LEFT JOIN groepen g ON g.id = l.groep
        GROUP BY a.id ORDER BY a.hoofdaccount DESC, a.naam`,
    );
    const p = req.persoon!;
    return r.rows.map((a) => ({ ...a, beheerbaar: p.rechten.has("accounts.manage") && magBeheren(p, a) === null }));
  });

  app.get<{ Params: { id: string } }>("/api/accounts/:id", { schema: { params: { type: "object", properties: { id: UUID } } } }, async (req) => {
    vereis(req, "accounts.view");
    const a = await laadDoel(d.pool, req.params.id);
    const groepen = (await d.pool.query("SELECT g.id, g.naam, g.niveau FROM lidmaatschappen l JOIN groepen g ON g.id = l.groep WHERE l.account = $1 ORDER BY g.naam", [a.id])).rows;
    const wijzigingen = (await d.pool.query(
      "SELECT w.status, w.reden, w.ingang, w.uitgevoerd, w.aangemaakt, b.naam AS door FROM statuswijzigingen w JOIN accounts b ON b.id = w.door WHERE w.account = $1 ORDER BY w.ingang DESC LIMIT 50",
      [a.id],
    )).rows;
    const sessies = (await d.pool.query("SELECT count(*)::int AS n FROM sessies WHERE account = $1 AND beeindigd IS NULL AND hard_einde > now()", [a.id])).rows[0].n;
    return { ...a, groepen, wijzigingen, actieveSessies: sessies, beheerbaar: req.persoon!.rechten.has("accounts.manage") && magBeheren(req.persoon!, a) === null };
  });

  /** Een account toevoegen. Nooit door zelf aan te melden; de persoon logt in via Keycloak met dit e-mailadres. */
  app.post<{ Body: { email: string; naam: string; taal: "nl" | "en"; groepen: string[]; reden: string } }>(
    "/api/accounts",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "naam", "taal", "groepen", "reden"],
          additionalProperties: false,
          properties: {
            email: { type: "string", minLength: 3, maxLength: 254, pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" },
            naam: { type: "string", minLength: 1, maxLength: 200 },
            taal: { enum: ["nl", "en"] },
            groepen: { type: "array", maxItems: 20, items: UUID, uniqueItems: true },
            reden: REDEN,
          },
        },
      },
    },
    async (req, antwoord) => {
      vereis(req, "accounts.manage");
      const p = req.persoon!;
      const groepen = await laadGroepen(d.pool, req.body.groepen);
      for (const g of groepen) weigerAls(magGroepGeven(p, g));
      const email = req.body.email.toLowerCase();
      const id = await inTransactie(d.pool, async (c) => {
        const bestaat = await c.query("SELECT 1 FROM accounts WHERE email = $1", [email]);
        if (bestaat.rowCount) throw new AppFout(409, "bestaat-al", "Er is al een account met dit e-mailadres.");
        const nieuw = (await c.query("INSERT INTO accounts (email, naam, taal, aangemaakt_door) VALUES ($1, $2, $3, $4) RETURNING id", [email, req.body.naam, req.body.taal, p.id])).rows[0].id;
        for (const g of groepen) await c.query("INSERT INTO lidmaatschappen (account, groep) VALUES ($1, $2)", [nieuw, g.id]);
        await schrijfAudit(c, { account: p.id, email: p.email, actie: "account.aangemaakt", doel: nieuw, ip: req.ip, resultaat: "ok", details: { email, naam: req.body.naam, groepen: groepen.map((g) => g.naam), reden: req.body.reden } });
        return nieuw;
      });
      const b = req.body.taal === "nl"
        ? bericht([email], "Je hebt toegang tot het beheerportaal van de Office Assistent", [`${p.naam} heeft je toegang gegeven tot ${d.config.herkomst}.`, "Je logt in met je account van de gemeente (Keycloak). Heb je daar nog geen tweestapsverificatie, dan stel je die bij de eerste aanmelding in.", `Inloggen: ${d.config.herkomst}/`])
        : bericht([email], "You have access to the Office Assistant admin portal", [`${p.naam} has given you access to ${d.config.herkomst}.`, "You sign in with your municipality account (Keycloak). If you do not have two-factor authentication yet, you set it up at your first sign-in.", `Sign in: ${d.config.herkomst}/`]);
      await d.mailer.verstuur(b).catch((e) => req.log.error({ fout: (e as Error).message }, "uitnodiging niet verstuurd"));
      return antwoord.code(201).send({ id });
    },
  );

  app.put<{ Params: { id: string }; Body: { naam: string; taal: "nl" | "en" } }>(
    "/api/accounts/:id",
    { schema: { params: { type: "object", properties: { id: UUID } }, body: { type: "object", required: ["naam", "taal"], additionalProperties: false, properties: { naam: { type: "string", minLength: 1, maxLength: 200 }, taal: { enum: ["nl", "en"] } } } } },
    async (req) => {
      vereis(req, "accounts.manage");
      const p = req.persoon!;
      const a = await laadDoel(d.pool, req.params.id);
      weigerAls(magBeheren(p, a));
      await d.pool.query("UPDATE accounts SET naam = $2, taal = $3 WHERE id = $1", [a.id, req.body.naam, req.body.taal]);
      await schrijfAudit(d.pool, { account: p.id, email: p.email, actie: "account.gewijzigd", doel: a.id, ip: req.ip, resultaat: "ok", details: { oud: { naam: a.naam }, nieuw: { naam: req.body.naam, taal: req.body.taal } } });
      return {};
    },
  );

  /** Groepen van een account vervangen. Elke groep die erbij komt of eraf gaat, moet je mogen geven. */
  app.put<{ Params: { id: string }; Body: { groepen: string[]; reden: string } }>(
    "/api/accounts/:id/groepen",
    { schema: { params: { type: "object", properties: { id: UUID } }, body: { type: "object", required: ["groepen", "reden"], additionalProperties: false, properties: { groepen: { type: "array", maxItems: 20, items: UUID, uniqueItems: true }, reden: REDEN } } } },
    async (req) => {
      vereis(req, "accounts.manage");
      const p = req.persoon!;
      const a = await laadDoel(d.pool, req.params.id);
      weigerAls(magBeheren(p, a));
      await inTransactie(d.pool, async (c) => {
        const huidig = (await c.query("SELECT groep FROM lidmaatschappen WHERE account = $1", [a.id])).rows.map((r) => r.groep as string);
        const erbij = req.body.groepen.filter((g) => !huidig.includes(g));
        const eraf = huidig.filter((g) => !req.body.groepen.includes(g));
        const betrokken = await laadGroepen(c, [...erbij, ...eraf]);
        for (const g of betrokken) weigerAls(magGroepGeven(p, g));
        for (const g of eraf) await c.query("DELETE FROM lidmaatschappen WHERE account = $1 AND groep = $2", [a.id, g]);
        for (const g of erbij) await c.query("INSERT INTO lidmaatschappen (account, groep) VALUES ($1, $2)", [a.id, g]);
        const naam = (id: string) => betrokken.find((g) => g.id === id)?.naam ?? id;
        await schrijfAudit(c, { account: p.id, email: p.email, actie: "account.groepen", doel: a.id, ip: req.ip, resultaat: "ok", details: { erbij: erbij.map(naam), eraf: eraf.map(naam), reden: req.body.reden } });
      });
      return {};
    },
  );

  /** Status wijzigen, nu of later. Blokkeren of deactiveren beëindigt alle sessies. */
  app.post<{ Params: { id: string }; Body: { status: "actief" | "geblokkeerd" | "gedeactiveerd"; reden: string; ingang?: string } }>(
    "/api/accounts/:id/status",
    { schema: { params: { type: "object", properties: { id: UUID } }, body: { type: "object", required: ["status", "reden"], additionalProperties: false, properties: { status: STATUS, reden: REDEN, ingang: { type: "string", format: "date-time" } } } } },
    async (req) => {
      vereis(req, "accounts.manage");
      const p = req.persoon!;
      const a = await laadDoel(d.pool, req.params.id);
      weigerAls(magBeheren(p, a));
      const nu = d.nu();
      const ingang = req.body.ingang ? new Date(req.body.ingang) : nu;
      if (Number.isNaN(ingang.getTime()) || ingang.getTime() > nu.getTime() + 366 * 24 * 3600_000) throw new AppFout(400, "verzoek-ongeldig", "Ongeldig moment.");
      await d.pool.query("INSERT INTO statuswijzigingen (account, status, reden, ingang, door) VALUES ($1, $2, $3, $4, $5)", [a.id, req.body.status, req.body.reden, ingang < nu ? nu : ingang, p.id]);
      await schrijfAudit(d.pool, { account: p.id, email: p.email, actie: "account.status.gepland", doel: a.id, ip: req.ip, resultaat: "ok", details: { status: req.body.status, reden: req.body.reden, ingang: (ingang < nu ? nu : ingang).toISOString() } });
      await voerStatuswijzigingenUit(d.pool, nu);
      return {};
    },
  );

  /** Overal uitloggen, bijvoorbeeld bij een verloren laptop. */
  app.post<{ Params: { id: string }; Body: { reden: string } }>(
    "/api/accounts/:id/uitloggen",
    { schema: { params: { type: "object", properties: { id: UUID } }, body: { type: "object", required: ["reden"], additionalProperties: false, properties: { reden: REDEN } } } },
    async (req) => {
      vereis(req, "accounts.manage");
      const p = req.persoon!;
      const a = await laadDoel(d.pool, req.params.id);
      weigerAls(magBeheren(p, a));
      const n = await beeindigAlle(d.pool, a.id, "door-beheerder", d.nu());
      await schrijfAudit(d.pool, { account: p.id, email: p.email, actie: "account.uitgelogd", doel: a.id, ip: req.ip, resultaat: "ok", details: { sessies: n, reden: req.body.reden } });
      return { beeindigd: n };
    },
  );
}
