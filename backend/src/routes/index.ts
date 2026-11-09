import type { FastifyInstance } from "fastify";
import { toegang } from "../toegang.js";
import { authRoutes } from "./auth.js";
import { noodRoutes } from "./nood.js";
import { accountRoutes } from "./accounts.js";
import { groepRoutes } from "./groepen.js";
import { profielRoutes } from "./profiel.js";
import { auditRoutes } from "./audit.js";
import { instellingRoutes } from "./instellingen.js";
import { metadatamodelRoutes } from "./metadatamodel.js";
import { anonimiserenRoutes } from "./anonimiseren.js";

/** Alle routes, in volgorde; de toegangscontrole eerst. */
export const routes: ((app: FastifyInstance) => Promise<void>)[] = [toegang, authRoutes, noodRoutes, accountRoutes, groepRoutes, profielRoutes, auditRoutes, instellingRoutes, metadatamodelRoutes, anonimiserenRoutes];
