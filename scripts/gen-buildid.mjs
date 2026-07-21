// Vygeneruje unikátne ID buildu pred každým "npm run build" — použije sa na
// zisťovanie, či má bežiaca appka (napr. pripnutá na ploche iPhonu) k dispozícii
// novšiu nasadenú verziu, nech sa vie sama obnoviť.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const buildId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

mkdirSync(join(root, "src"), { recursive: true });
writeFileSync(join(root, "src", "buildId.generated.js"), `export const BUILD_ID = ${JSON.stringify(buildId)};\n`);

mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(root, "public", "version.json"), JSON.stringify({ buildId }) + "\n");

console.log("BUILD_ID:", buildId);
