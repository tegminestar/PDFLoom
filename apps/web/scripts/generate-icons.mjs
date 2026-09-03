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

// mark.svg's background is a rounded rect (rx="112"), not a full-bleed
// square — the four corners outside that curve are genuine transparent
// pixels, which leaks an alpha channel into every PNG rasterized from it.
// That's harmless for a browser tab or a home-screen icon (the OS/browser
// chrome sits behind it anyway) but both Google's own favicon guidelines
// and Apple's apple-touch-icon spec explicitly say not to ship a
// transparent icon for those — Google in particular has been observed
// falling back to a generic globe in search results for one that is.
// flatten() fills any transparent pixel with the icon's own dark
// background color, which is visually a no-op (that's already the
// dominant color right up to the rounded edge) but makes the output
// fully opaque, matching what both platforms actually ask for. Only
// applied to the non-maskable set — the *-maskable icons exist
// specifically so the OS can safely crop/mask them, which requires them
// to stay as they are.
const FLATTEN_BG = "#0f1115";

const targets = [
  { svg: standardSvg, size: 512, out: path.join(iconsDir, "icon-512.png"), flatten: true },
  { svg: standardSvg, size: 192, out: path.join(iconsDir, "icon-192.png"), flatten: true },
  { svg: standardSvg, size: 180, out: path.join(publicDir, "apple-touch-icon.png"), flatten: true },
  { svg: standardSvg, size: 32, out: path.join(publicDir, "favicon-32.png"), flatten: true },
  { svg: standardSvg, size: 16, out: path.join(publicDir, "favicon-16.png"), flatten: true },
  { svg: maskableSvg, size: 512, out: path.join(iconsDir, "icon-512-maskable.png"), flatten: false },
  { svg: maskableSvg, size: 192, out: path.join(iconsDir, "icon-192-maskable.png"), flatten: false },
];

for (const { svg, size, out, flatten } of targets) {
  let pipeline = sharp(svg, { density: 384 }).resize(size, size);
  if (flatten) pipeline = pipeline.flatten({ background: FLATTEN_BG });
  await pipeline.png().toFile(out);
  console.log(`wrote ${path.relative(process.cwd(), out)} (${size}x${size}${flatten ? ", flattened" : ""})`);
}

// favicon.ico: the traditional root-level icon some crawlers and tools
// still request directly instead of reading the <link rel="icon"> tags
// (this app had none at all before — a bare 404). The modern ICO format
// (Vista+, universally supported today) can just wrap a PNG's raw bytes
// directly rather than needing a legacy BMP bitmap encoder, so this
// hand-builds the small ICO container around the 32px flattened PNG
// already generated above instead of pulling in an icon-encoding
// dependency for one file.
const favicon32 = await sharp(standardSvg, { density: 384 }).resize(32, 32).flatten({ background: FLATTEN_BG }).png().toBuffer();
const ICONDIR = Buffer.alloc(6);
ICONDIR.writeUInt16LE(0, 0); // reserved
ICONDIR.writeUInt16LE(1, 2); // type: 1 = icon
ICONDIR.writeUInt16LE(1, 4); // image count
const ICONDIRENTRY = Buffer.alloc(16);
ICONDIRENTRY.writeUInt8(32, 0); // width
ICONDIRENTRY.writeUInt8(32, 1); // height
ICONDIRENTRY.writeUInt8(0, 2); // color palette (0 = no palette, true color)
ICONDIRENTRY.writeUInt8(0, 3); // reserved
ICONDIRENTRY.writeUInt16LE(1, 4); // color planes
ICONDIRENTRY.writeUInt16LE(32, 6); // bits per pixel
ICONDIRENTRY.writeUInt32LE(favicon32.byteLength, 8); // image data size
ICONDIRENTRY.writeUInt32LE(ICONDIR.byteLength + ICONDIRENTRY.byteLength, 12); // offset of image data
const icoPath = path.join(publicDir, "favicon.ico");
await import("node:fs/promises").then((fs) => fs.writeFile(icoPath, Buffer.concat([ICONDIR, ICONDIRENTRY, favicon32])));
console.log(`wrote ${path.relative(process.cwd(), icoPath)} (32x32, PNG-in-ICO)`);
