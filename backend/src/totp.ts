import { createHmac, randomBytes } from "node:crypto";

/** TOTP (RFC 6238): SHA-1, 30 seconden, 6 cijfers; zoals elke authenticator-app. */
const ALFABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function nieuwTotpGeheim(): Buffer {
  return randomBytes(20);
}

export function base32(b: Buffer): string {
  let bits = 0, waarde = 0, uit = "";
  for (const byte of b) {
    waarde = (waarde << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      uit += ALFABET[(waarde >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) uit += ALFABET[(waarde << (5 - bits)) & 31];
  return uit;
}

export function totpCode(geheim: Buffer, teller: number): string {
  const t = Buffer.alloc(8);
  t.writeBigUInt64BE(BigInt(teller));
  const h = createHmac("sha1", geheim).update(t).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/**
 * Controleert een code, met één stap speling naar voren en achteren. Geeft de
 * teller die klopte (om hergebruik te weigeren), of null.
 */
export function controleerTotp(geheim: Buffer, code: string, nu: Date, laatsteGebruikt: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const teller = Math.floor(nu.getTime() / 30_000);
  for (const d of [0, -1, 1]) {
    const t = teller + d;
    if (laatsteGebruikt !== null && t <= laatsteGebruikt) continue;
    if (totpCode(geheim, t) === code) return t;
  }
  return null;
}

export function otpauthAdres(geheim: Buffer, label: string, uitgever: string): string {
  return `otpauth://totp/${encodeURIComponent(`${uitgever}:${label}`)}?secret=${base32(geheim)}&issuer=${encodeURIComponent(uitgever)}&algorithm=SHA1&digits=6&period=30`;
}
