import { existsSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import type pg from "pg";
import type { Config } from "./config.js";
import { Sleutels } from "./sleutels.js";
import type { Mailer } from "./mail.js";
import type { Oidc } from "./oidc.js";
import type { Persoon } from "./persoon.js";

/** Een fout die de gebruiker mag zien: vaste code en een korte, algemene melding. */
export class AppFout extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    melding: string,
  ) {
    super(melding);
  }
}

export const BEVEILIGINGSKOPPEN: Record<string, string> = {
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

const WIJZIGEND = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface Diensten {
  config: Config;
  pool: pg.Pool;
  sleutels: Sleutels;
  /** De klok, te vervangen in tests. */
  nu: () => Date;
  mailer: Mailer;
  /** Keycloak; null als OIDC niet is ingesteld (dan kan alleen het noodaccount in). */
  oidc: Oidc | null;
}

export type DienstenInvoer = Omit<Diensten, "sleutels" | "nu" | "mailer" | "oidc"> & Partial<Pick<Diensten, "nu" | "mailer" | "oidc">>;

declare module "fastify" {
  interface FastifyInstance {
    diensten: Diensten;
  }
  interface FastifyRequest {
    persoon: Persoon | null;
  }
}

export function clientIp(req: FastifyRequest): string {
  return req.ip;
}

/**
 * Bouwt het portaal: beveiligingskoppen op elk antwoord, alleen de eigen
 * hostnaam, wijzigende verzoeken alleen met de eigen Origin en JSON, een
 * grens aan de omvang, algemene foutmeldingen zonder stacktraces.
 */
export async function bouwApp(diensten: DienstenInvoer, routes: ((app: FastifyInstance) => Promise<void>)[] = []): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 64 * 1024,
    // Onbekende velden weigeren in plaats van stil weglaten.
    ajv: { customOptions: { removeAdditional: false, coerceTypes: "array", useDefaults: true } },
    // Caddy staat ervoor; alleen adressen uit private netwerken zijn proxy.
    trustProxy: ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "::1/128"],
    // Geen standaardlog per verzoek: daar staan querystrings in (codes van Keycloak).
    disableRequestLogging: true,
    logger: {
      level: process.env.LOG_NIVEAU ?? "info",
      redact: ["req.headers.cookie", "req.headers.authorization", "headers.cookie", "headers.authorization"],
    },
  });
  app.decorate("diensten", {
    ...diensten,
    sleutels: new Sleutels(diensten.config.adminSecret),
    nu: diensten.nu ?? (() => new Date()),
    mailer: diensten.mailer ?? { verstuur: async () => {} },
    oidc: diensten.oidc ?? null,
  });
  app.decorateRequest("persoon", null);

  await app.register(fastifyCookie);

  app.addHook("onRequest", async (req, antwoord) => {
    const host = (req.headers.host ?? "").toLowerCase();
    if (host !== diensten.config.host) {
      return antwoord.code(421).send({ fout: "onbekende-host" });
    }
    if (WIJZIGEND.has(req.method)) {
      if (req.headers.origin !== diensten.config.herkomst) {
        return antwoord.code(403).send({ fout: "herkomst" });
      }
      const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (type !== "application/json") {
        return antwoord.code(415).send({ fout: "alleen-json" });
      }
    }
  });

  app.addHook("onSend", async (req, antwoord, lading) => {
    for (const [k, v] of Object.entries(BEVEILIGINGSKOPPEN)) antwoord.header(k, v);
    if (req.url.startsWith("/api/")) {
      antwoord.header("cache-control", "no-store");
      antwoord.header("pragma", "no-cache");
    }
    return lading;
  });

  app.setErrorHandler((fout, req, antwoord) => {
    if (fout instanceof AppFout) return antwoord.code(fout.status).send({ fout: fout.code, melding: fout.message });
    const f = fout as { validation?: unknown; statusCode?: number; code?: string };
    if (f.validation) return antwoord.code(400).send({ fout: "verzoek-ongeldig" });
    if (f.statusCode === 413) return antwoord.code(413).send({ fout: "te-groot" });
    if (f.statusCode && f.statusCode >= 400 && f.statusCode < 500) return antwoord.code(f.statusCode).send({ fout: "verzoek-ongeldig" });
    req.log.error({ fout: (fout as Error).message, code: f.code, route: req.routeOptions?.url }, "interne fout");
    return antwoord.code(500).send({ fout: "intern" });
  });

  app.get("/api/gezondheid", async () => ({ status: "ok" }));

  // Direct aanroepen, niet registreren: hooks van de toegangscontrole gelden dan overal.
  for (const r of routes) await r(app);

  // De frontend: statische bestanden, en index.html voor elk ander pad.
  const map = diensten.config.frontendMap;
  const metFrontend = existsSync(join(map, "index.html"));
  if (metFrontend) await app.register(fastifyStatic, { root: map, wildcard: false, index: false });
  app.setNotFoundHandler((req, antwoord) => {
    if (req.url.startsWith("/api/") || req.method !== "GET") return antwoord.code(404).send({ fout: "niet-gevonden" });
    if (!metFrontend) return antwoord.code(404).type("text/plain").send("Frontend niet gebouwd");
    return antwoord.type("text/html").sendFile("index.html");
  });

  return app;
}
