import nodemailer from "nodemailer";
import type { Config } from "./config.js";

export interface Bericht {
  aan: string[];
  onderwerp: string;
  tekst: string;
  html: string;
}

export interface Mailer {
  verstuur(b: Bericht): Promise<void>;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Platte tekst en html uit dezelfde regels; html zonder externe bronnen. */
export function bericht(aan: string[], onderwerp: string, regels: string[]): Bericht {
  return {
    aan,
    onderwerp,
    tekst: regels.join("\n\n"),
    html: `<!doctype html><html><body style="font-family: system-ui, sans-serif; line-height: 1.5">${regels.map((r) => `<p>${esc(r)}</p>`).join("")}</body></html>`,
  };
}

/** SMTP; zonder SMTP-instellingen gaan berichten alleen naar het log (zonder inhoud). */
export function maakMailer(config: Config, log: (s: string) => void): Mailer {
  if (!config.smtp) {
    return { verstuur: async (b) => log(`e-mail niet verstuurd (geen SMTP): "${b.onderwerp}" aan ${b.aan.length} ontvanger(s)`) };
  }
  const s = config.smtp;
  const t = nodemailer.createTransport({
    host: s.host,
    port: s.poort,
    secure: s.tls === "tls",
    requireTLS: s.tls === "starttls",
    ignoreTLS: s.tls === "geen",
    auth: s.gebruiker ? { user: s.gebruiker, pass: s.wachtwoord } : undefined,
  });
  return {
    verstuur: async (b) => {
      if (!b.aan.length) return;
      await t.sendMail({ from: s.afzender, to: b.aan, subject: b.onderwerp, text: b.tekst, html: b.html });
    },
  };
}
