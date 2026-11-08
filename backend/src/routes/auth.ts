import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppFout } from "../app.js";
import { schrijfAudit } from "../audit.js";
import { aanUit } from "../instellingen.js";
import { metTweedeFactor } from "../oidc.js";
import { gelijk } from "../sleutels.js";
import { beeindig, maakSessie, wisSessieCookie, zetSessieCookie } from "../sessies.js";

const INLOG_COOKIE = "__Host-oa_beheer_inlog";

/** Alleen een eigen pagina als bestemming na het inloggen. */
export function veiligTerug(t: unknown): string {
  return typeof t === "string" && /^\/(?!\/|\\|api\/)[\w\-./?=&%#]*$/.test(t) && t.length < 300 ? t : "/";
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const d = app.diensten;

  /** Begint het inloggen bij Keycloak. Altijd opnieuw wachtwoord (en code). */
  app.get<{ Querystring: { terug?: string } }>("/api/auth/inloggen", async (req, antwoord) => {
    if (!d.oidc) throw new AppFout(503, "inloggen-uit", "Inloggen via Keycloak is niet ingesteld.");
    const { adres, state, verifier, nonce } = await d.oidc.inlogAdres();
    await d.pool.query("INSERT INTO inlogstaat (state_hash, verifier, nonce, terug, verloopt) VALUES ($1, $2, $3, $4, $5)", [
      d.sleutels.inlogHash(state), verifier, nonce, veiligTerug(req.query.terug), new Date(d.nu().getTime() + 10 * 60_000),
    ]);
    // Bindt de aanmelding aan deze browser. Keycloak (id.<domein>) is dezelfde site,
    // dus SameSite=Strict komt bij de terugkeer gewoon mee.
    antwoord.setCookie(INLOG_COOKIE, state, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 600 });
    return antwoord.redirect(adres, 303);
  });

  /** Terug van Keycloak. Elke mislukking geeft dezelfde melding; de reden staat alleen in de audit. */
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/auth/terug", async (req, antwoord) => {
    const mislukt = async (reden: string, extra: Record<string, unknown> = {}) => {
      await schrijfAudit(d.pool, { actie: "inloggen.mislukt", ip: req.ip, resultaat: reden, details: extra });
      antwoord.clearCookie(INLOG_COOKIE, { path: "/", secure: true, httpOnly: true, sameSite: "strict" });
      return antwoord.redirect("/?fout=inloggen", 303);
    };
    if (!d.oidc) return mislukt("oidc-uit");
    const { code, state, error } = req.query;
    if (error) return mislukt("geannuleerd");
    const cookie = req.cookies[INLOG_COOKIE];
    if (!code || !state || !cookie || !gelijk(Buffer.from(cookie), Buffer.from(state))) return mislukt("state");
    const staat = (await d.pool.query("DELETE FROM inlogstaat WHERE state_hash = $1 RETURNING verifier, nonce, terug, verloopt", [d.sleutels.inlogHash(state)])).rows[0];
    if (!staat || staat.verloopt < d.nu()) return mislukt("state-verlopen");

    let claims;
    try {
      claims = await d.oidc.wisselCode(code, staat.verifier, staat.nonce);
    } catch (e) {
      req.log.warn({ fout: (e as Error).message }, "tokenwissel mislukt");
      return mislukt("token");
    }
    if ((await aanUit(d.pool, "mfa.vereist")) && !metTweedeFactor(claims)) return mislukt("geen-tweede-factor", { sub: claims.sub });

    // Eerst op Keycloak-gebruiker; anders op e-mail (geverifieerd), en dan vastleggen.
    let a = (await d.pool.query("SELECT id, email, status, hoofdaccount, keycloak_sub FROM accounts WHERE keycloak_sub = $1", [claims.sub])).rows[0];
    if (!a && claims.email && claims.emailGeverifieerd) {
      a = (await d.pool.query("SELECT id, email, status, hoofdaccount, keycloak_sub FROM accounts WHERE email = $1 AND keycloak_sub IS NULL", [claims.email])).rows[0];
      if (a && !a.hoofdaccount) {
        await d.pool.query("UPDATE accounts SET keycloak_sub = $2 WHERE id = $1 AND keycloak_sub IS NULL", [a.id, claims.sub]);
        await schrijfAudit(d.pool, { account: a.id, email: a.email, actie: "account.gekoppeld", ip: req.ip, resultaat: "ok", details: { keycloak_sub: claims.sub } });
      }
    }
    if (!a) return mislukt("geen-account", { sub: claims.sub });
    if (a.hoofdaccount) return mislukt("hoofdaccount-via-keycloak");
    if (a.status !== "actief") return mislukt(`status-${a.status}`, { account: a.id });

    const token = await maakSessie(d, d.pool, a.id, req, false);
    zetSessieCookie(antwoord, token);
    antwoord.clearCookie(INLOG_COOKIE, { path: "/", secure: true, httpOnly: true, sameSite: "strict" });
    await schrijfAudit(d.pool, { account: a.id, email: a.email, actie: "inloggen.gelukt", ip: req.ip, resultaat: "ok", details: { amr: claims.amr } });
    return antwoord.redirect(staat.terug, 303);
  });

  app.post("/api/auth/uitloggen", async (req: FastifyRequest, antwoord: FastifyReply) => {
    const p = req.persoon!;
    await beeindig(d.pool, p.sessie, "uitgelogd", d.nu());
    wisSessieCookie(antwoord);
    const keycloak = p.nood || !d.oidc ? null : await d.oidc.uitlogAdres(`${d.config.herkomst}/`);
    return { doorsturen: keycloak ?? "/" };
  });

  /** Wie ben ik, wat mag ik. */
  app.get("/api/ik", async (req) => {
    const p = req.persoon!;
    const s = (await d.pool.query("SELECT hard_einde FROM sessies WHERE id = $1", [p.sessie])).rows[0];
    return {
      id: p.id,
      email: p.email,
      naam: p.naam,
      taal: p.taal,
      rechten: [...p.rechten].sort(),
      niveau: p.niveau,
      superadmin: p.superadmin,
      nood: p.nood,
      sessieEinde: s?.hard_einde ?? null,
    };
  });
}
