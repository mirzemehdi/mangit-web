// Copies the production web build into the mangit.app site at /translate/.
//   node scripts/publish-site.mjs [path-to-Mangit/Web/public]
// Then deploy the site from the Mangit repo (firebase deploy --only hosting).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const site = resolve(process.argv[2] ?? "../Mangit/Web/public");
if (!existsSync(join(site, "index.html")) || !existsSync(join(site, "sitemap.xml"))) {
  throw new Error(`${site} doesn't look like the mangit.app public folder`);
}
execFileSync("node", ["scripts/build.mjs", "--prod"], { stdio: "inherit", env: { ...process.env, WEB_BASE: "/translate/" } });
const target = join(site, "translate");
// Replace only our own folder, never anything else in the site.
if (existsSync(target)) for (const f of readdirSync(target)) rmSync(join(target, f), { recursive: true, force: true });
cpSync("web-dist", target, { recursive: true });
console.log(`published web-dist -> ${target}`);
