// Vygeneruje unikátne ID buildu pred každým "npm run build" — použije sa na
// zisťovanie, či má bežiaca appka (napr. pripnutá na ploche iPhonu) k dispozícii
// novšiu nasadenú verziu, nech sa vie sama obnoviť.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const buildId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

mkdirSync(join(root, "src"), { recursive: true });
writeFileSync(join(root, "src", "buildId.generated.js"), `export const BUILD_ID = ${JSON.stringify(buildId)};\n`);

mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(root, "public", "version.json"), JSON.stringify({ buildId }) + "\n");

// Service worker (Fáza 6). Vyrobí sa zo šablóny, aby v ňom bolo číslo buildu —
// podľa neho si vie po nasadení novej verzie zahodiť starú kešu.
const sw = readFileSync(join(root, "scripts", "sw.template.js"), "utf8").replaceAll("__BUILD_ID__", buildId);
writeFileSync(join(root, "public", "sw.js"), sw);

console.log("BUILD_ID:", buildId);
