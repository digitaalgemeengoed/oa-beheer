import type { FastifyInstance } from "fastify";
import type { Diensten } from "../app.js";
import { schrijfAudit } from "../audit.js";
import { geheel, lijst, tekst } from "../instellingen.js";
import { bericht } from "../mail.js";
import { vereis } from "../toegang.js";

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  const d = app.diensten;

  /** De audit lezen en filteren, nieuwste eerst, in pagina's. */
  app.get<{ Querystring: { van?: string; tot?: string; wie?: string; actie?: string; resultaat?: string; ip?: string; voor?: number; aantal?: number } }>(
    "/api/audit",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            van: { type: "string", format: "date-time" },
            tot: { type: "string", format: "date-time" },
            wie: { type: "string", maxLength: 254 },
            actie: { type: "string", maxLength: 100 },
            resultaat: { type: "string", maxLength: 50 },
            ip: { type: "string", maxLength: 45 },
            voor: { type: "integer", minimum: 1 },
            aantal: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          },
        },
      },
    },
    async (req) => {
      vereis(req, "audit.view");
      const q = req.query;
      const r = await d.pool.query(
        `SELECT id, tijd, account, email, actie, doel, ip, resultaat, details, encode(hash, 'hex') AS hash
           FROM audit
          WHERE ($1::timestamptz IS NULL OR tijd >= $1) AND ($2::timestamptz IS NULL OR tijd < $2)
            AND ($3::text IS NULL OR email ILIKE '%' || $3 || '%')
            AND ($4::text IS NULL OR actie LIKE $4 || '%')
            AND ($5::text IS NULL OR resultaat = $5)
            AND ($6::text IS NULL OR ip = $6)
            AND ($7::bigint IS NULL OR id < $7)
          ORDER BY id DESC LIMIT $8`,
        [q.van ?? null, q.tot ?? null, q.wie?.replace(/[%_\\]/g, "\\$&") ?? null, q.actie?.replace(/[%_\\]/g, "\\$&") ?? null, q.resultaat ?? null, q.ip ?? null, q.voor ?? null, q.aantal ?? 50],
      );
      return { gebeurtenissen: r.rows, volgende: r.rows.length === (q.aantal ?? 50) ? r.rows.at(-1).id : null };
    },
  );

  /** Klopt de keten? */
  app.get("/api/audit/controle", async (req) => {
    vereis(req, "audit.view");
    const c = (await d.pool.query("SELECT * FROM audit_controleer()")).rows[0];
    const anker = (await d.pool.query("SELECT laatste, encode(hash, 'hex') AS hash, tijd FROM audit_anker WHERE id = 1")).rows[0] ?? null;
    return { intact: c.gebroken_bij === null, gebrokenBij: c.gebroken_bij, gecontroleerd: Number(c.gecontroleerd), laatsteHash: c.laatste_hash, anker };
  });
}

/** De lokale datum (jjjj-mm-dd) in de tijdzone van het portaal. */
export function lokaleDatum(t: Date, tijdzone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tijdzone, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}

/**
 * Eén keer per dag (na 06:00 in de tijdzone van het portaal): gebeurtenissen
 * ouder dan de bewaartermijn opruimen, de keten controleren, en de laatste
 * hash mailen. Wie die mails bewaart, kan later aantonen dat de keten niet is
 * herschreven, ook niet door iemand met volledige macht over de database.
 */
export async function dagelijks(d: Diensten): Promise<boolean> {
  const tz = await tekst(d.pool, "sessie.dag_tijdzone");
  const nu = d.nu();
  const uur = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(nu));
  if (uur < 6) return false;
  const datum = lokaleDatum(nu, tz);
  const al = await d.pool.query("SELECT 1 FROM audit WHERE actie = 'audit.dagelijks' AND details->>'datum' = $1 LIMIT 1", [datum]);
  if (al.rowCount) return false;

  const opgeruimd = Number((await d.pool.query("SELECT audit_opruimen($1) AS n", [await geheel(d.pool, "audit.bewaartermijn_dagen")])).rows[0].n);
  const c = (await d.pool.query("SELECT * FROM audit_controleer()")).rows[0];
  const intact = c.gebroken_bij === null;
  await schrijfAudit(d.pool, { actie: "audit.dagelijks", resultaat: intact ? "ok" : "keten-gebroken", details: { datum, opgeruimd, gecontroleerd: Number(c.gecontroleerd), hash_voor_deze: c.laatste_hash } });
  const laatste = (await d.pool.query("SELECT id, encode(hash, 'hex') AS hash FROM audit ORDER BY id DESC LIMIT 1")).rows[0];

  const aan = await lijst(d.pool, "audit.dagelijkse_hash_aan");
  if (aan.length) {
    await d.mailer.verstuur(
      bericht(aan, `Auditketen ${d.config.host} ${datum}: ${intact ? "intact" : "GEBROKEN"}`, [
        `Laatste gebeurtenis: ${laatste.id}`,
        `Hash: ${laatste.hash}`,
        intact ? `De keten is gecontroleerd (${c.gecontroleerd} gebeurtenissen) en intact.` : `De keten is gebroken bij gebeurtenis ${c.gebroken_bij}. Behandel dit als een beveiligingsincident.`,
        "Bewaar deze e-mail. Komt de hash later niet meer voor in de keten, dan is de audit herschreven. / Keep this email: if this hash is later missing from the chain, the audit trail was rewritten.",
      ]),
    );
  }
  return true;
}
