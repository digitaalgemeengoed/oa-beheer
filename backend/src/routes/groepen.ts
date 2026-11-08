import type { FastifyInstance } from "fastify";
import { AppFout } from "../app.js";
import { schrijfAudit } from "../audit.js";
import { inTransactie, type Db } from "../db.js";
import { RECHTEN, type Persoon, type Recht } from "../persoon.js";
import { magBeheren, magGroepGeven, weigerAls, type Groep } from "../regels.js";
import { vereis } from "../toegang.js";

const UUID = { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } as const;
const GROEP = {
  type: "object",
  required: ["naam", "omschrijving", "rechten", "niveau", "superadmin", "reden"],
  additionalProperties: false,
  properties: {
    naam: { type: "string", minLength: 1, maxLength: 100 },
    omschrijving: { type: "string", maxLength: 1000 },
    rechten: { type: "array", uniqueItems: true, items: { enum: [...RECHTEN] } },
    niveau: { type: "integer", minimum: 1, maximum: 4 },
    superadmin: { type: "boolean" },
    reden: { type: "string", minLength: 5, maxLength: 1000 },
  },
} as const;

type GroepInvoer = { naam: string; omschrijving: string; rechten: Recht[]; niveau: number; superadmin: boolean; reden: string };

/**
 * Een bestaande groep wijzigen of verwijderen mag alleen als je de groep
 * zelf mag geven (voor en na), er niet zelf in zit, en alle leden mag
 * beheren: anders zou een groep een omweg zijn om je eigen rechten of die
 * van een hoger niveau te veranderen.
 */
async function magGroepWijzigen(db: Db, p: Persoon, id: string): Promise<Groep & { id: string; naam: string }> {
  const g = (await db.query("SELECT id, naam, niveau, superadmin, rechten, omschrijving FROM groepen WHERE id = $1", [id])).rows[0];
  if (!g) throw new AppFout(404, "niet-gevonden", "Deze groep bestaat niet.");
  weigerAls(magGroepGeven(p, g));
  const leden = (await db.query(
    `SELECT a.id, a.hoofdaccount, coalesce(max(g2.niveau), 0)::int AS niveau FROM lidmaatschappen l JOIN accounts a ON a.id = l.account
       LEFT JOIN lidmaatschappen l2 ON l2.account = a.id LEFT JOIN groepen g2 ON g2.id = l2.groep
      WHERE l.groep = $1 GROUP BY a.id`,
    [id],
  )).rows;
  if (leden.some((l) => l.id === p.id)) weigerAls("eigen-account");
  if (leden.some((l) => magBeheren(p, l) !== null)) weigerAls("lid-buiten-niveau");
  return g;
}

export async function groepRoutes(app: FastifyInstance): Promise<void> {
  const d = app.diensten;

  app.get("/api/groepen", async (req) => {
    const p = req.persoon!;
    if (!["groups.view", "groups.manage", "accounts.manage"].some((r) => p.rechten.has(r as Recht))) vereis(req, "groups.view");
    const r = await d.pool.query(
      `SELECT g.id, g.naam, g.omschrijving, g.rechten, g.niveau, g.superadmin, count(l.account)::int AS leden
         FROM groepen g LEFT JOIN lidmaatschappen l ON l.groep = g.id GROUP BY g.id ORDER BY g.niveau DESC, g.naam`,
    );
    return r.rows.map((g) => ({ ...g, toewijsbaar: p.rechten.has("accounts.manage") && magGroepGeven(p, g) === null }));
  });

  app.post<{ Body: GroepInvoer }>("/api/groepen", { schema: { body: GROEP } }, async (req, antwoord) => {
    vereis(req, "groups.manage");
    const p = req.persoon!;
    weigerAls(magGroepGeven(p, req.body));
    const { naam, omschrijving, rechten, niveau, superadmin, reden } = req.body;
    const id = await inTransactie(d.pool, async (c) => {
      if ((await c.query("SELECT 1 FROM groepen WHERE naam = $1", [naam])).rowCount) throw new AppFout(409, "bestaat-al", "Er is al een groep met deze naam.");
      const nieuw = (await c.query("INSERT INTO groepen (naam, omschrijving, rechten, niveau, superadmin) VALUES ($1, $2, $3, $4, $5) RETURNING id", [naam, omschrijving, rechten, niveau, superadmin])).rows[0].id;
      await schrijfAudit(c, { account: p.id, email: p.email, actie: "groep.aangemaakt", doel: nieuw, ip: req.ip, resultaat: "ok", details: { naam, rechten, niveau, superadmin, reden } });
      return nieuw;
    });
    return antwoord.code(201).send({ id });
  });

  app.put<{ Params: { id: string }; Body: GroepInvoer }>("/api/groepen/:id", { schema: { params: { type: "object", properties: { id: UUID } }, body: GROEP } }, async (req) => {
    vereis(req, "groups.manage");
    const p = req.persoon!;
    await inTransactie(d.pool, async (c) => {
      const oud = await magGroepWijzigen(c, p, req.params.id);
      weigerAls(magGroepGeven(p, req.body));
      const { naam, omschrijving, rechten, niveau, superadmin, reden } = req.body;
      await c.query("UPDATE groepen SET naam = $2, omschrijving = $3, rechten = $4, niveau = $5, superadmin = $6 WHERE id = $1", [oud.id, naam, omschrijving, rechten, niveau, superadmin]);
      await schrijfAudit(c, { account: p.id, email: p.email, actie: "groep.gewijzigd", doel: oud.id, ip: req.ip, resultaat: "ok", details: { oud: { naam: oud.naam, rechten: oud.rechten, niveau: oud.niveau, superadmin: oud.superadmin }, nieuw: { naam, rechten, niveau, superadmin }, reden } });
    });
    return {};
  });

  app.delete<{ Params: { id: string }; Body: { reden: string } }>(
    "/api/groepen/:id",
    { schema: { params: { type: "object", properties: { id: UUID } }, body: { type: "object", required: ["reden"], additionalProperties: false, properties: { reden: { type: "string", minLength: 5, maxLength: 1000 } } } } },
    async (req) => {
      vereis(req, "groups.manage");
      const p = req.persoon!;
      await inTransactie(d.pool, async (c) => {
        const oud = await magGroepWijzigen(c, p, req.params.id);
        await c.query("DELETE FROM groepen WHERE id = $1", [oud.id]);
        await schrijfAudit(c, { account: p.id, email: p.email, actie: "groep.verwijderd", doel: oud.id, ip: req.ip, resultaat: "ok", details: { naam: oud.naam, rechten: oud.rechten, niveau: oud.niveau, reden: req.body.reden } });
      });
      return {};
    },
  );
}
