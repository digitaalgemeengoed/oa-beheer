// Gedeelde opzet voor de tests: een verse database per testbestand.
import pg from "pg";
import { leesConfig, type Config } from "../src/config.ts";
import { migreer } from "../src/migreer.ts";
import { maakPool } from "../src/db.ts";

// Een PostgreSQL waar "beheer" superuser is. Standaard de lokale testcluster via de socket in /tmp.
const PG_HOST = process.env.TEST_PG_HOST ?? "/tmp";
const PG_POORT = process.env.TEST_PG_POORT ?? "55432";
const SERVER = `postgresql://beheer@/postgres?host=${encodeURIComponent(PG_HOST)}&port=${PG_POORT}`;

export const HOST = "oa-admin.test.nl";
export const HERKOMST = `https://${HOST}`;
export const GEHEIM = "k3J9-xQ2v!Lm8Rt5Zp1Wc7Yh4Nb6Fd0Gs";

export function testConfig(db: string, extra: Record<string, string> = {}): Config {
  return leesConfig({
    BEHEER_HOST: HOST,
    ADMIN_SECRET: GEHEIM,
    DATABASE_URL: dbUrl(db, "oa_beheer_app"),
    HOOFDACCOUNT_EMAIL: "beheerder@test.nl",
    FRONTEND_MAP: "/bestaat/niet",
    ...extra,
  });
}

export function dbUrl(db: string, gebruiker = "beheer"): string {
  return `postgresql://${gebruiker}@/${db}?host=${encodeURIComponent(PG_HOST)}&port=${PG_POORT}`;
}

/** Maakt een lege database, voert de migraties uit en geeft een pool als app-rol. */
export async function verseDatabase(naam: string): Promise<{ pool: pg.Pool; eigenaar: pg.Pool; config: Config }> {
  const c = new pg.Client({ connectionString: SERVER });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${naam} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${naam}`);
  await c.end();
  await migreer({ eigenaarUrl: dbUrl(naam), hoofdaccountEmail: "beheerder@test.nl" });
  const config = testConfig(naam);
  return { pool: maakPool(config.databaseUrl), eigenaar: maakPool(dbUrl(naam)), config };
}

export const kop = (extra: Record<string, string> = {}) => ({ host: HOST, ...extra });
export const wijzig = (extra: Record<string, string> = {}) => ({ host: HOST, origin: HERKOMST, "content-type": "application/json", ...extra });
