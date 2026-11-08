import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Alle sleutels komen uit ADMIN_SECRET, elk met een eigen doel (HKDF). Wie
 * één sleutel kent, kent de andere niet.
 */
export class Sleutels {
  private readonly sessie: Buffer;
  private readonly poging: Buffer;
  private readonly totp: Buffer;
  private readonly inlog: Buffer;

  constructor(adminSecret: string) {
    const afleiden = (doel: string) => Buffer.from(hkdfSync("sha256", adminSecret, "oa-beheer", doel, 32));
    this.sessie = afleiden("sessietoken");
    this.poging = afleiden("pogingen");
    this.totp = afleiden("totp-geheim");
    this.inlog = afleiden("inlogstaat");
  }

  /** HMAC van een sessietoken: alleen dit staat in de database. */
  sessieHash(token: string): Buffer {
    return createHmac("sha256", this.sessie).update(token).digest();
  }

  /** HMAC van een e-mailadres of netwerkadres voor de pogingenteller. */
  pogingHash(soort: string, waarde: string): Buffer {
    return createHmac("sha256", this.poging).update(`${soort}\u0000${waarde.toLowerCase()}`).digest();
  }

  inlogHash(state: string): Buffer {
    return createHmac("sha256", this.inlog).update(state).digest();
  }

  /** AES-256-GCM voor het TOTP-geheim van het hoofdaccount. */
  versleutelTotp(geheim: Buffer): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.totp, iv);
    c.setAAD(Buffer.from("oa-beheer/totp/v1"));
    const ct = Buffer.concat([c.update(geheim), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
  }

  ontsleutelTotp(blob: Buffer): Buffer {
    const d = createDecipheriv("aes-256-gcm", this.totp, blob.subarray(0, 12));
    d.setAAD(Buffer.from("oa-beheer/totp/v1"));
    d.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
  }
}

export function nieuwToken(): string {
  return randomBytes(32).toString("base64url");
}

export function gelijk(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
