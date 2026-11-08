import { bouwApp } from "./app.js";
import { leesConfig } from "./config.js";
import { maakPool } from "./db.js";
import { maakMailer } from "./mail.js";
import { Oidc } from "./oidc.js";
import { voerStatuswijzigingenUit } from "./persoon.js";
import { ruimPogingenOp } from "./pogingen.js";
import { routes } from "./routes/index.js";

const config = leesConfig();
const pool = maakPool(config.databaseUrl);
const oidc = config.oidc ? new Oidc(config.oidc, `${config.herkomst}/api/auth/terug`) : null;
const app = await bouwApp({ config, pool, oidc, mailer: maakMailer(config, (s) => console.log(s)) }, routes);
const d = app.diensten;

// Elke 30 seconden: geplande statuswijzigingen, en pogingen ouder dan een dag weg.
const taken = async () => {
  try {
    await voerStatuswijzigingenUit(pool, d.nu());
    await ruimPogingenOp(d);
  } catch (e) {
    app.log.error({ fout: (e as Error).message }, "periodieke taak mislukt");
  }
};
setInterval(taken, 30_000).unref();

await app.listen({ host: "0.0.0.0", port: config.poort });
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => app.close().then(() => pool.end()).finally(() => process.exit(0)));
