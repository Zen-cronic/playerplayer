// The browser build serves the vendored game assets over HTTP, but we don't
// want a second copy of them tracked in git. Mirror vendor/ into public/ before
// dev and build; public/game is gitignored.
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "vendor/tilemap-pack/assets");
const to = path.join(root, "public/game");

await mkdir(path.dirname(to), { recursive: true });
await cp(from, to, { recursive: true });
console.log(`synced game assets → public/game`);
