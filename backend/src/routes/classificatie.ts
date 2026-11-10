import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppFout } from "../app.js";
import { schrijfAudit } from "../audit.js";
import type { Platform } from "../platform.js";
import { vereis } from "../toegang.js";

/**
 * Het classificatiemodel: welke resultaten uit de selectielijst de gemeente
 * gebruikt, gemotiveerde afwijkingen van de bewaartermijnen, eigen
 * classificatie-attributen, bij welke statussen een stuk vergrendeld is en
 * op welke status de bewaartermijn ingaat.
 *
 * Rechten: classificatie.view (inzien), classificatie.manage (wijzigen en
 * publiceren), bewaartermijn.afwijken (afwijkingen van de selectielijst; die
 * horen bij informatiebeheer of de archivaris). Publiceren altijd met reden,
 * in de audit.
 */

function platformVan(req: FastifyRequest): Platform {
  const p = req.server.diensten.platform;
  if (!p) throw new AppFout(409, "platform-uit", "Het platform is niet gekoppeld aan dit portaal. Zie INRICHTING.md, stap 9.");
  return p;
}

function magZien(req: FastifyRequest): void {
  if (!req.persoon?.rechten.has("classificatie.manage")) vereis(req, "classificatie.view");
}

interface Afwijking {
  resultaat: string;
  waardering?: string;
  bewaartermijn?: string;
  reden: string;
}
interface Config {
  naam?: string;
  selectielijst: string;
  uitgezet?: string[];
  afwijkingen?: Afwijking[];
  attributen: unknown[];
  vergrendelBij: string[];
  termijnStartBij: string;
}

const CONFIG = {
  type: "object",
  required: ["selectielijst", "attributen", "vergrendelBij", "termijnStartBij"],
  properties: {
    naam: { type: "string", maxLength: 80 },
    selectielijst: { type: "string", maxLength: 40 },
    uitgezet: { type: "array", maxItems: 1000, items: { type: "string" } },
    afwijkingen: { type: "array", maxItems: 500, items: { type: "object" } },
    attributen: { type: "array", maxItems: 50, items: { type: "object" } },
    vergrendelBij: { type: "array", maxItems: 20, items: { type: "string" } },
    termijnStartBij: { type: "string", maxLength: 100 },
  },
} as const;

/** De afwijkingen in vaste volgorde en vorm, om te zien of er iets aan veranderde. */
const afwijkingenVan = (c: Pick<Config, "afwijkingen"> | null | undefined) =>
  JSON.stringify(
    [...(c?.afwijkingen ?? [])]
      .map((a) => ({ resultaat: a.resultaat, waardering: a.waardering ?? null, bewaartermijn: a.bewaartermijn ?? null, reden: a.reden.trim() }))
      .sort((a, b) => a.resultaat.localeCompare(b.resultaat)),
  );

export async function classificatieRoutes(app: FastifyInstance): Promise<void> {
  const d = app.diensten;

  app.get("/api/classificatie", async (req) => {
    magZien(req);
    if (!d.platform) return { aan: false };
    const r = await platformVan(req).vraag<Record<string, unknown>>("GET", "/classificatiemodel", req.persoon!);
    return { aan: true, gemeente: d.platform.gemeente, ...r };
  });

  app.post<{ Body: { config: Config } }>(
    "/api/classificatie/controle",
    { schema: { body: { type: "object", required: ["config"], additionalProperties: false, properties: { config: CONFIG } } } },
    async (req) => {
      magZien(req);
      return platformVan(req).vraag("POST", "/classificatiemodel/controle", req.persoon!, { config: req.body.config });
    },
  );

  app.post<{ Body: { config: Config; reden: string } }>(
    "/api/classificatie/publiceer",
    {
      schema: {
        body: { type: "object", required: ["config", "reden"], additionalProperties: false, properties: { config: CONFIG, reden: { type: "string", minLength: 5, maxLength: 1000 } } },
      },
    },
    async (req) => {
      vereis(req, "classificatie.manage");
      const p = req.persoon!;
      const platform = platformVan(req);
      const huidig = await platform.vraag<{ actief: { config: Config } | null }>("GET", "/classificatiemodel", p);
      if (afwijkingenVan(huidig.actief?.config) !== afwijkingenVan(req.body.config)) vereis(req, "bewaartermijn.afwijken");
      const c = req.body.config;
      const details = {
        ...(c.naam?.trim() ? { naam: c.naam.trim() } : {}),
        uitgezet: c.uitgezet?.length ?? 0,
        afwijkingen: c.afwijkingen?.length ?? 0,
        attributen: c.attributen.length,
        vergrendelBij: c.vergrendelBij,
        termijnStartBij: c.termijnStartBij,
        reden: req.body.reden,
      };
      let model: { versie: number };
      try {
        model = await platform.vraag<{ versie: number }>("POST", "/classificatiemodel", p, { config: c });
      } catch (e) {
        await schrijfAudit(d.pool, { account: p.id, email: p.email, actie: "classificatiemodel.gepubliceerd", doel: "classificatiemodel", ip: req.ip, resultaat: "geweigerd", details: { ...details, fout: (e as Error).message } });
        throw e;
      }
      await schrijfAudit(d.pool, {
        account: p.id,
        email: p.email,
        actie: "classificatiemodel.gepubliceerd",
        doel: `classificatiemodel versie ${model.versie}`,
        ip: req.ip,
        resultaat: "ok",
        details: { ...details, versie: model.versie },
      });
      return model;
    },
  );
}
