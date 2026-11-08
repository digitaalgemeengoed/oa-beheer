import type { FastifyInstance } from "fastify";
import { AppFout } from "../app.js";
import { schrijfAudit } from "../audit.js";
import { alleInstellingen, toetsWaarde, vergeetInstellingen } from "../instellingen.js";
import { vereis } from "../toegang.js";

export async function instellingRoutes(app: FastifyInstance): Promise<void> {
  const d = app.diensten;

  app.get("/api/instellingen", async (req) => {
    if (!req.persoon!.rechten.has("settings.manage")) vereis(req, "settings.view");
    return [...(await alleInstellingen(d.pool, true)).values()];
  });

  /** Een instelling wijzigen: altijd met reden; oude en nieuwe waarde in de audit. Andere processen lezen het binnen 30 seconden. */
  app.put<{ Params: { sleutel: string }; Body: { waarde: unknown; reden: string } }>(
    "/api/instellingen/:sleutel",
    {
      schema: {
        params: { type: "object", properties: { sleutel: { type: "string", pattern: "^[a-z_.]{3,100}$" } } },
        body: { type: "object", required: ["waarde", "reden"], additionalProperties: false, properties: { waarde: {}, reden: { type: "string", minLength: 5, maxLength: 1000 } } },
      },
    },
    async (req) => {
      vereis(req, "settings.manage");
      const p = req.persoon!;
      const i = (await alleInstellingen(d.pool, true)).get(req.params.sleutel);
      if (!i) throw new AppFout(404, "niet-gevonden", "Deze instelling bestaat niet.");
      const t = toetsWaarde(i, req.body.waarde);
      if (!t.ok) throw new AppFout(400, t.fout, "Deze waarde past niet bij de instelling.");
      await d.pool.query("UPDATE instellingen SET waarde = $2, gewijzigd = $3, gewijzigd_door = $4 WHERE sleutel = $1", [i.sleutel, JSON.stringify(t.waarde), d.nu(), p.id]);
      await schrijfAudit(d.pool, { account: p.id, email: p.email, actie: "instelling.gewijzigd", doel: i.sleutel, ip: req.ip, resultaat: "ok", details: { oud: i.waarde, nieuw: t.waarde, reden: req.body.reden } });
      vergeetInstellingen();
      return { waarde: t.waarde };
    },
  );
}
