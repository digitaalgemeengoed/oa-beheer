import type { FastifyInstance } from "fastify";
import { toegang } from "../toegang.js";
import { authRoutes } from "./auth.js";
import { noodRoutes } from "./nood.js";

/** Alle routes, in volgorde; de toegangscontrole eerst. */
export const routes: ((app: FastifyInstance) => Promise<void>)[] = [toegang, authRoutes, noodRoutes];
