#!/usr/bin/env node
// Generates the Tatara brand logo assets in public/brand/.
//
// Produces 4 SVG variants (wordmark ± tagline × light/dark) with text
// converted to outlined paths — so the SVGs render identically in any
// tool (Illustrator, Figma, Inkscape, a browser) without needing EB
// Garamond or Inter installed. Each SVG is rasterized to PNG at 1024,
// 2048, and 4096 px wide for presentations, social, and print.
//
// Re-run whenever the wordmark or tagline spec changes:
//   node scripts/generate-brand-logos.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FONTS_DIR = join(ROOT, "scripts", "brand-fonts");
const OUT_DIR = join(ROOT, "public", "brand");
mkdirSync(OUT_DIR, { recursive: true });

// --- Brand spec (mirrors .t-wordmark + .t-wordmark-tagline in globals.css) ---
const WORDMARK_TEXT = "Tatara";
const TAGLINE_TEXT = "The Operator's Console".toUpperCase();

// Master wordmark font-size. Tagline is a fixed ratio of this.
const WORDMARK_FONT_SIZE = 400;
const WORDMARK_LETTER_SPACING_EM = -0.005;
const TAGLINE_FONT_RATIO = 0.14;
const TAGLINE_LETTER_SPACING_EM = 0.18;
const GAP_EM = 8 / 22; // Tailwind gap-2 (0.5rem @ 22px size prop) scaled

// Ink colors from design-system globals.css
const INK = "#2E3E5C"; // indigo — for light/paper backgrounds
const PAPER = "#F2EAD8"; // cream — for dark/indigo backgrounds

const wordmark = opentype.loadSync(join(FONTS_DIR, "EBGaramond-SemiBold.ttf"));
const tagline = opentype.loadSync(join(FONTS_DIR, "Inter-Medium.ttf"));

// Render a string as an SVG <path d="..."> with manual letter-spacing.
function renderTextPath(font, text, fontSize, letterSpacingEm, x, y) {
  const letterSpacingPx = letterSpacingEm * fontSize;
  let cursor = x;
  const paths = [];
  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    const p = glyph.getPath(cursor, y, fontSize);
    paths.push(p.toPathData(3));
    const advance = (glyph.advanceWidth / font.unitsPerEm) * fontSize;
    cursor += advance + letterSpacingPx;
  }
  const widthPx = cursor - x - letterSpacingPx; // drop trailing spacing
  return { d: paths.join(" "), width: widthPx };
}

// Measure height of text (ascender→descender of the font, scaled).
function fontHeight(font, fontSize) {
  const asc = (font.ascender / font.unitsPerEm) * fontSize;
  const desc = (font.descender / font.unitsPerEm) * fontSize;
  return { ascent: asc, descent: desc, total: asc - desc };
}

function buildSvg({ withTagline, color }) {
  const wmFS = WORDMARK_FONT_SIZE;
  const tgFS = wmFS * TAGLINE_FONT_RATIO;
  const gap = wmFS * GAP_EM;

  // Baseline y for both wordmark and tagline (items-baseline)
  const wmMetrics = fontHeight(wordmark, wmFS);
  const baselineY = wmMetrics.ascent;

  const wm = renderTextPath(
    wordmark,
    WORDMARK_TEXT,
    wmFS,
    WORDMARK_LETTER_SPACING_EM,
    0,
    baselineY
  );

  let svgBody = `<path d="${wm.d}" fill="${color}"/>`;
  let contentWidth = wm.width;
  let contentHeight = wmMetrics.total;

  if (withTagline) {
    const tg = renderTextPath(
      tagline,
      TAGLINE_TEXT,
      tgFS,
      TAGLINE_LETTER_SPACING_EM,
      wm.width + gap,
      baselineY
    );
    svgBody += `<path d="${tg.d}" fill="${color}"/>`;
    contentWidth = wm.width + gap + tg.width;
  }

  // Padding: 10% of wordmark font-size on each side — gives a clean safe area
  const pad = wmFS * 0.1;
  const vbW = contentWidth + pad * 2;
  const vbH = contentHeight + pad * 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW.toFixed(2)} ${vbH.toFixed(2)}" width="${vbW.toFixed(0)}" height="${vbH.toFixed(0)}" fill="none">
  <g transform="translate(${pad.toFixed(2)} ${pad.toFixed(2)})">
    ${svgBody}
  </g>
</svg>
`;
  return { svg, width: vbW, height: vbH };
}

const VARIANTS = [
  { name: "tatara-wordmark-ink", withTagline: false, color: INK },
  { name: "tatara-wordmark-paper", withTagline: false, color: PAPER },
  { name: "tatara-lockup-ink", withTagline: true, color: INK },
  { name: "tatara-lockup-paper", withTagline: true, color: PAPER },
];

const PNG_WIDTHS = [1024, 2048, 4096];

async function main() {
  for (const variant of VARIANTS) {
    const { svg, width, height } = buildSvg(variant);
    const svgPath = join(OUT_DIR, `${variant.name}.svg`);
    writeFileSync(svgPath, svg, "utf8");
    console.log(`wrote ${svgPath} (${Math.round(width)}×${Math.round(height)})`);

    for (const targetWidth of PNG_WIDTHS) {
      const pngPath = join(OUT_DIR, `${variant.name}-${targetWidth}.png`);
      await sharp(Buffer.from(svg))
        .resize({ width: targetWidth })
        .png({ compressionLevel: 9 })
        .toFile(pngPath);
      console.log(`wrote ${pngPath}`);
    }
  }
  console.log(`\nDone. Assets in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
