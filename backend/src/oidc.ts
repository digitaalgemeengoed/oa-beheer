import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { nieuwToken } from "./sleutels.js";

/**
 * Inloggen bij Keycloak: authorization code flow met PKCE en nonce. Het
 * portaal is een vertrouwelijke client; tokens komen nooit in de browser en
 * worden niet bewaard: alleen wie het is, telt.
 */
export interface Ontdekking {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
  jwks_uri: string;
}

export interface OidcClaims {
  sub: string;
  email: string | null;
  emailGeverifieerd: boolean;
  naam: string | null;
  amr: string[];
  acr: string | null;
}

export class Oidc {
  private ontdekt: Promise<Ontdekking> | null = null;
  private sleutels: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(
    private readonly cfg: { issuer: string; clientId: string; clientSecret: string },
    private readonly terugAdres: string,
    private readonly doeFetch: typeof fetch = fetch,
  ) {}

  private ontdek(): Promise<Ontdekking> {
    this.ontdekt ??= this.doeFetch(`${this.cfg.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) })
      .then(async (r) => {
        if (!r.ok) throw new Error(`OIDC-ontdekking: ${r.status}`);
        return (await r.json()) as Ontdekking;
      })
      .catch((e) => {
        this.ontdekt = null;
        throw e;
      });
    return this.ontdekt;
  }

  /** Waar de browser heen gaat. prompt=login: altijd opnieuw het wachtwoord (en de code). */
  async inlogAdres(): Promise<{ adres: string; state: string; verifier: string; nonce: string }> {
    const o = await this.ontdek();
    const state = nieuwToken();
    const verifier = nieuwToken();
    const nonce = nieuwToken();
    const u = new URL(o.authorization_endpoint);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", this.cfg.clientId);
    u.searchParams.set("redirect_uri", this.terugAdres);
    u.searchParams.set("scope", "openid email profile");
    u.searchParams.set("state", state);
    u.searchParams.set("nonce", nonce);
    u.searchParams.set("prompt", "login");
    u.searchParams.set("max_age", "0");
    u.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    u.searchParams.set("code_challenge_method", "S256");
    return { adres: u.toString(), state, verifier, nonce };
  }

  async wisselCode(code: string, verifier: string, nonce: string): Promise<OidcClaims> {
    const o = await this.ontdek();
    const r = await this.doeFetch(o.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.terugAdres,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`Tokenwissel: ${r.status}`);
    const { id_token } = (await r.json()) as { id_token?: string };
    if (!id_token) throw new Error("Geen id_token");
    this.sleutels ??= createRemoteJWKSet(new URL(o.jwks_uri));
    const { payload } = await jwtVerify(id_token, this.sleutels, { issuer: o.issuer, audience: this.cfg.clientId, maxTokenAge: "5m" });
    if (payload.nonce !== nonce) throw new Error("Nonce klopt niet");
    return naarClaims(payload);
  }

  async uitlogAdres(naAfloop: string): Promise<string | null> {
    const o = await this.ontdek().catch(() => null);
    if (!o?.end_session_endpoint) return null;
    const u = new URL(o.end_session_endpoint);
    u.searchParams.set("client_id", this.cfg.clientId);
    u.searchParams.set("post_logout_redirect_uri", naAfloop);
    return u.toString();
  }
}

export function naarClaims(p: JWTPayload): OidcClaims {
  const tekst = (x: unknown) => (typeof x === "string" && x ? x : null);
  return {
    sub: String(p.sub),
    email: tekst(p.email)?.toLowerCase() ?? null,
    emailGeverifieerd: p.email_verified === true,
    naam: tekst(p.name) ?? tekst(p.preferred_username),
    amr: Array.isArray(p.amr) ? (p.amr as unknown[]).map(String) : [],
    acr: tekst(p.acr),
  };
}

/** Heeft de aanmelding een tweede factor gehad? Keycloak meldt dat in amr ("otp"). */
export function metTweedeFactor(c: OidcClaims): boolean {
  return c.amr.some((m) => ["otp", "mfa", "hwk", "swk", "webauthn"].includes(m.toLowerCase()));
}
