import { AppFout } from "./app.js";
import type { Config } from "./config.js";
import type { Persoon } from "./persoon.js";

/**
 * Het platform (opendop-mini), rechtstreeks over het interne netwerk, met de
 * dienstsleutel. De beheerder gaat mee als actor: het platform legt vast wie
 * een nieuw metadatamodel publiceerde.
 */
export class Platform {
  constructor(
    private readonly c: NonNullable<Config["platform"]>,
    private readonly doeFetch: typeof fetch = fetch,
  ) {}

  get gemeente(): string {
    return this.c.gemeente;
  }

  async vraag<T>(methode: "GET" | "POST", pad: string, persoon: Persoon, lichaam?: unknown): Promise<T> {
    const actor = Buffer.from(JSON.stringify({ sub: `oa-beheer:${persoon.id}`, naam: persoon.email, beheerder: true })).toString("base64url");
    let r: Response;
    try {
      r = await this.doeFetch(`${this.c.url}${pad}`, {
        method: methode,
        headers: {
          "x-oa-dienstsleutel": this.c.dienstsleutel,
          "x-oa-gemeente": this.c.gemeente,
          "x-oa-actor": actor,
          ...(lichaam !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: lichaam !== undefined ? JSON.stringify(lichaam) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AppFout(502, "platform-onbereikbaar", "Het platform is nu niet bereikbaar.");
    }
    const j = (await r.json().catch(() => ({}))) as T & { fout?: string; melding?: string; details?: unknown };
    if (!r.ok) {
      throw new AppFout(r.status === 422 ? 422 : 502, j.fout ?? "platform-fout", j.melding ?? `Het platform gaf fout ${r.status}.`, j.details);
    }
    return j;
  }
}
