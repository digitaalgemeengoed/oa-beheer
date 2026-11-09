import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppFout } from "../app.js";
import { schrijfAudit } from "../audit.js";
import type { Platform } from "../platform.js";
import { vereis } from "../toegang.js";

/**
 * Het metadatamodel van het objecttype "document": welk basismodel (MDTO,
 * RGBZ of TMLO), welke velden aan staan en verplicht zijn, met welk label,
 * welke hulptekst en welke waardelijst, en eigen velden van de gemeente.
 *
 * De catalogus en de regels staan in het platform (uit oa-contract): het
 * portaal stuurt alleen de keuze. Publiceren maakt een nieuwe versie van
 * het objecttype voor deze gemeente; stukken houden de versie waarmee ze
 * zijn vastgelegd. Wat een beheerder nog aan het opstellen is, staat hier
 * als concept.
 */
const OBJECTTYPE = "document";

interface Catalogus {
  modellen: Record<string, unknown>;
  waardelijsten: Record<string, unknown>;
  rollen: string[];
}

let catalogus: { waarde: Catalogus; tot: number } | null = null;

function platformVan(req: FastifyRequest): Platform {
  const p = req.server.diensten.platform;
  if (!p) throw new AppFout(409, "platform-uit", "Het platform is niet gekoppeld aan dit portaal. Zie INRICHTING.md, stap 9.");
  return p;
}

function magZien(req: FastifyRequest): void {
  if (!req.persoon?.rechten.has("metadata.manage")) vereis(req, "metadata.view");
}

/** De keuze zoals het platform haar verwacht; de inhoud toetst het platform zelf. */
const CONFIG = {
  type: "object",
  required: ["basis", "velden"],
  properties: { basis: { type: "string", maxLength: 10 }, velden: { type: "array", maxItems: 200, items: { type: "object" } } },
} as const;

export async function metadatamodelRoutes(app: FastifyInstance): Promise<void> {
  const d = app.diensten;

  app.get("/api/metadatamodel", async (req) => {
    magZien(req);
    if (!d.platform) return { aan: false };
    const p = platformVan(req);
    const persoon = req.persoon!;
    if (!catalogus || catalogus.tot < Date.now()) {
      catalogus = { waarde: await p.vraag<Catalogus>("GET", "/metadatamodellen", persoon), tot: Date.now() + 10 * 60_000 };
    }
    const [actief, versies, concept] = await Promise.all([
      p.vraag<{ versie: number; titel: string; schema: Record<string, unknown> }>("GET", `/objecttypen/${OBJECTTYPE}`, persoon),
      p.vraag<unknown[]>("GET", `/objecttypen/${OBJECTTYPE}/versies`, persoon),
      d.pool.query(
        `SELECT c.config, c.gewijzigd, a.email AS door FROM metadatamodel_concept c LEFT JOIN accounts a ON a.id = c.gewijzigd_door WHERE c.objecttype = $1`,
        [OBJECTTYPE],
      ),
    ]);
    const k = concept.rows[0];
    return {
      aan: true,
      gemeente: p.gemeente,
      objecttype: OBJECTTYPE,
      catalogus: catalogus.waarde,
      actief: { versie: actief.versie, titel: actief.titel, config: actief.schema["x-oa-config"] ?? null, schema: actief.schema },
      versies,
      concept: k ? { config: k.config, gewijzigd: k.gewijzigd, door: k.door } : null,
    };
  });

  /** Het concept bewaren: alleen in het portaal, het paneel merkt er niets van. */
  app.put<{ Body: { config: Record<string, unknown> } }>(
    "/api/metadatamodel/concept",
    { schema: { body: { type: "object", required: ["config"], additionalProperties: false, properties: { config: CONFIG } } } },
    async (req) => {
      vereis(req, "metadata.manage");
      await d.pool.query(
        `INSERT INTO metadatamodel_concept (objecttype, config, gewijzigd, gewijzigd_door) VALUES ($1, $2, $3, $4)
         ON CONFLICT (objecttype) DO UPDATE SET config = EXCLUDED.config, gewijzigd = EXCLUDED.gewijzigd, gewijzigd_door = EXCLUDED.gewijzigd_door`,
        [OBJECTTYPE, JSON.stringify(req.body.config), d.nu(), req.persoon!.id],
      );
      return { bewaard: d.nu() };
    },
  );

  app.delete("/api/metadatamodel/concept", async (req) => {
    vereis(req, "metadata.manage");
    await d.pool.query("DELETE FROM metadatamodel_concept WHERE objecttype = $1", [OBJECTTYPE]);
    return { weg: true };
  });

  /** Toetsen en het paneel voorvertonen, zonder iets vast te leggen. */
  app.post<{ Body: { config: Record<string, unknown> } }>(
    "/api/metadatamodel/controle",
    { schema: { body: { type: "object", required: ["config"], additionalProperties: false, properties: { config: CONFIG } } } },
    async (req) => {
      magZien(req);
      return platformVan(req).vraag("POST", "/metadatamodellen/controle", req.persoon!, { config: req.body.config });
    },
  );

  /** Publiceren: een nieuwe versie van het objecttype voor deze gemeente. Altijd met reden; in de audit. */
  app.post<{ Body: { config: { basis: string; velden: { aan?: boolean }[] }; reden: string } }>(
    "/api/metadatamodel/publiceer",
    {
      schema: {
        body: { type: "object", required: ["config", "reden"], additionalProperties: false, properties: { config: CONFIG, reden: { type: "string", minLength: 5, maxLength: 1000 } } },
      },
    },
    async (req) => {
      vereis(req, "metadata.manage");
      const p = req.persoon!;
      let type: { versie: number };
      try {
        type = await platformVan(req).vraag<{ versie: number }>("POST", `/objecttypen/${OBJECTTYPE}/model`, p, { config: req.body.config });
      } catch (e) {
        await schrijfAudit(d.pool, { account: p.id, email: p.email, actie: "metadatamodel.gepubliceerd", doel: OBJECTTYPE, ip: req.ip, resultaat: "geweigerd", details: { basis: req.body.config.basis, reden: req.body.reden, fout: (e as Error).message } });
        throw e;
      }
      await d.pool.query("DELETE FROM metadatamodel_concept WHERE objecttype = $1", [OBJECTTYPE]);
      await schrijfAudit(d.pool, {
        account: p.id,
        email: p.email,
        actie: "metadatamodel.gepubliceerd",
        doel: `${OBJECTTYPE} versie ${type.versie}`,
        ip: req.ip,
        resultaat: "ok",
        details: { basis: req.body.config.basis, velden: req.body.config.velden.filter((v) => v.aan).length, versie: type.versie, reden: req.body.reden },
      });
      return type;
    },
  );
}

/** Alleen voor tests: de catalogus opnieuw ophalen. */
export function vergeetCatalogus(): void {
  catalogus = null;
}
