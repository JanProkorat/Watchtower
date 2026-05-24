// Generate icon.icns + tray-template.png from the source SVGs in this directory.
// Uses only built-in macOS tools (qlmanage, sips, iconutil) — no extra deps.
//
// Usage:
//   node build-resources/build-icons.mjs
//
// Output:
//   build-resources/icon.icns          (consumed by electron-builder)
//   build-resources/tray-template.png  (loaded at runtime by electron/tray.ts)
//   build-resources/tray-template@2x.png

import { mkdtempSync, rmSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function sh(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

// Render an SVG to a PNG of the requested square size using QuickLook +
// sips for the final exact-size resize (qlmanage's -s flag is best-effort).
function renderSvg(svgPath, outPng, size) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'wt-icon-'));
  try {
    sh(`qlmanage -t -s ${Math.max(size, 1024)} -o ${JSON.stringify(tmp)} ${JSON.stringify(svgPath)} >/dev/null 2>&1`);
    const intermediate = path.join(tmp, `${path.basename(svgPath)}.png`);
    if (!existsSync(intermediate)) {
      throw new Error(`qlmanage produced no output for ${svgPath}`);
    }
    sh(`sips -z ${size} ${size} ${JSON.stringify(intermediate)} --out ${JSON.stringify(outPng)} >/dev/null 2>&1`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ─── icon.icns ──────────────────────────────────────────────────────────────
const iconSvg = path.join(__dirname, 'icon.svg');
const iconset = path.join(__dirname, 'icon.iconset');
mkdirSync(iconset, { recursive: true });

const ICONSET_SIZES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

for (const [name, size] of ICONSET_SIZES) {
  console.log(`  rendering ${name} (${size}×${size})`);
  renderSvg(iconSvg, path.join(iconset, name), size);
}

const icns = path.join(__dirname, 'icon.icns');
sh(`iconutil -c icns ${JSON.stringify(iconset)} -o ${JSON.stringify(icns)}`);
rmSync(iconset, { recursive: true, force: true });
console.log(`✓ wrote ${path.relative(process.cwd(), icns)}`);

// ─── tray-template.png ──────────────────────────────────────────────────────
// qlmanage adds a white background when rendering SVGs, which kills the
// alpha channel macOS needs for a tray template image (everything ends up
// rendered as a solid foreground square). sips converts SVG → PNG
// natively and preserves transparency.
const traySvg = path.join(__dirname, 'tray-template.svg');
const trayTmp = path.join(__dirname, 'tray-template-source.png');
sh(`sips -s format png ${JSON.stringify(traySvg)} --out ${JSON.stringify(trayTmp)} >/dev/null 2>&1`);
// macOS menu-bar standard is 22pt @1x / 44px @2x.
sh(`sips -z 22 22 ${JSON.stringify(trayTmp)} --out ${JSON.stringify(path.join(__dirname, 'tray-template.png'))} >/dev/null 2>&1`);
sh(`sips -z 44 44 ${JSON.stringify(trayTmp)} --out ${JSON.stringify(path.join(__dirname, 'tray-template@2x.png'))} >/dev/null 2>&1`);
rmSync(trayTmp, { force: true });
console.log(`✓ wrote tray-template.png + @2x`);
