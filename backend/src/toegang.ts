import type { FastifyInstance } from "fastify";
import { AppFout } from "./app.js";
import { schrijfAudit } from "./audit.js";
import { laadPersoon, voerStatuswijzigingenUit, type Recht } from "./persoon.js";
import { beeindig, geldigeSessie, wisSessieCookie } from "./sessies.js";

/** Routes zonder sessie: gezondheid en het inloggen zelf. */
export const OPEN = new Set(["/api/gezondheid", "/api/auth/inloggen", "/api/auth/terug", "/api/nood/inloggen"]);

/**
 * Elke API-aanroep: eerst de geplande statuswijzigingen, dan sessie, status
 * en rechten vers uit de database. Elke aanroep van een ingelogde persoon
 * komt in de audit, ook wat hij alleen bekeek.
 */
export async function toegang(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (req, antwoord) => {
    const route = req.routeOptions.url ?? "";
    if (!route.startsWith("/api/") || OPEN.has(route)) return;
    const d = app.diensten;
    await voerStatuswijzigingenUit(d.pool, d.nu());
    const s = await geldigeSessie(d, req);
    const p = s ? await laadPersoon(d.pool, s.account, s.id, s.nood) : null;
    if (!s || !p || p.status !== "actief") {
      if (s) await beeindig(d.pool, s.id, "account-niet-actief", d.nu());
      wisSessieCookie(antwoord);
      throw new AppFout(401, "niet-ingelogd", "Log (opnieuw) in.");
    }
    req.persoon = p;
  });

  // Vóór het versturen vastleggen: lukt de audit niet, dan krijgt de gebruiker geen antwoord.
  app.addHook("onSend", async (req, antwoord, lading) => {
    const p = req.persoon;
    if (!p) return lading;
    const params = (req.params ?? {}) as Record<string, string>;
    await schrijfAudit(app.diensten.pool, {
      account: p.id,
      email: p.email,
      actie: `${req.method} ${req.routeOptions.url ?? "?"}`.slice(0, 100),
      doel: params.id ?? null,
      ip: req.ip,
      resultaat: String(antwoord.statusCode),
      details: p.nood ? { nood: true } : {},
    });
    return lading;
  });
}

/** Vereist een recht; anders 403. */
export function vereis(req: { persoon: { rechten: Set<Recht> } | null }, recht: Recht): void {
  if (!req.persoon?.rechten.has(recht)) throw new AppFout(403, "geen-recht", "Daarvoor heb je geen recht.");
}
