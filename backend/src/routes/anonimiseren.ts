import type { FastifyInstance } from "fastify";
import { AppFout } from "../app.js";
import { vereis } from "../toegang.js";

/**
 * Anonimiseren, tabblad Kwaliteit: tellingen uit het gebruik, van het
 * platform. Alleen tellingen, vormen ("9-9") en signaalwoorden; nooit
 * waarden, en niet te herleiden tot een stuk.
 */
export async function anonimiserenRoutes(app: FastifyInstance): Promise<void> {
  const d = app.diensten;

  app.get<{ Querystring: { dagen?: number; drempel?: number } }>(
    "/api/anonimiseren/kwaliteit",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { dagen: { type: "integer", minimum: 1, maximum: 3660 }, drempel: { type: "integer", minimum: 2, maximum: 100 } },
        },
      },
    },
    async (req) => {
      vereis(req, "anonimiseren.view");
      if (!d.platform) throw new AppFout(409, "platform-uit", "Het platform is niet gekoppeld aan dit portaal. Zie INRICHTING.md, stap 9.");
      const q = new URLSearchParams({ dagen: String(req.query.dagen ?? 90), drempel: String(req.query.drempel ?? 5) });
      return d.platform.vraag("GET", `/anonimisering/kwaliteit?${q}`, req.persoon!);
    },
  );
}
