// One-off/rerun-on-brand-change script: rasterizes the hand-authored SVG
// marks in public/icons/ into the real PNG assets the manifest and HTML
// reference. Run with `node scripts/generate-icons.mjs` after editing
// either source SVG.
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, "..", "public", "icons");
const publicDir = path.join(__dirname, "..", "public");

const standardSvg = readFileSync(path.join(iconsDir, "mark.svg"));
const maskableSvg = readFileSync(path.join(iconsDir, "mark-maskable.svg"));

const targets = [
  { svg: standardSvg, size: 512, out: path.join(iconsDir, "icon-512.png") },
  { svg: standardSvg, size: 192, out: path.join(iconsDir, "icon-192.png") },
  { svg: standardSvg, size: 180, out: path.join(publicDir, "apple-touch-icon.png") },
  { svg: standardSvg, size: 32, out: path.join(publicDir, "favicon-32.png") },
  { svg: standardSvg, size: 16, out: path.join(publicDir, "favicon-16.png") },
  { svg: maskableSvg, size: 512, out: path.join(iconsDir, "icon-512-maskable.png") },
  { svg: maskableSvg, size: 192, out: path.join(iconsDir, "icon-192-maskable.png") },
];

for (const { svg, size, out } of targets) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(out);
  console.log(`wrote ${path.relative(process.cwd(), out)} (${size}x${size})`);
}
