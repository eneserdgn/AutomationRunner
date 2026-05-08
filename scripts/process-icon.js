// Takes assets/pegasus-source.png (black outline on white/transparent)
// → white Pegasus on Pegasus-orange (#FF6600) rounded background → assets/icon.png
const { Jimp, rgbaToInt } = require('jimp');
const path = require('path');

const SRC  = path.join(__dirname, '..', 'assets', 'pegasus-source.png');
const OUT  = path.join(__dirname, '..', 'assets', 'icon.png');
const SIZE = 1024;

(async () => {
  // Load and resize source to 1024
  const src = await Jimp.read(SRC);
  src.resize({ w: SIZE, h: SIZE });

  const out = new Jimp({ width: SIZE, height: SIZE });

  // ── Rounded-rect background (iOS superellipse ~22% radius) ───────────────
  const R = SIZE * 0.22;
  const half = SIZE / 2;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cx = x - half, cy = y - half;
      const qx = Math.abs(cx) - half + R;
      const qy = Math.abs(cy) - half + R;
      const dist = Math.sqrt(Math.max(qx,0)**2 + Math.max(qy,0)**2)
                 + Math.min(Math.max(qx,qy), 0) - R;

      if (dist > 0) {
        // outside rounded rect → transparent
        out.setPixelColor(rgbaToInt(0, 0, 0, 0), x, y);
      } else {
        // Pegasus orange background
        out.setPixelColor(rgbaToInt(255, 102, 0, 255), x, y);
      }
    }
  }

  // ── Subtle inner gradient (darker at edges for depth) ────────────────────
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const existing = out.getPixelColor(x, y);
      const ea = existing & 0xff;
      if (ea === 0) continue; // skip transparent

      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const d  = Math.sqrt(dx*dx + dy*dy);
      const darken = Math.round(d * 30);
      const r = Math.max(0, 255 - darken);
      const g = Math.max(0, 102 - darken);
      out.setPixelColor(rgbaToInt(r, g, 0, 255), x, y);
    }
  }

  // ── Composite Pegasus onto background ────────────────────────────────────
  // Pegasus is black on white — we want white on orange.
  // For each pixel: if source is dark (the outline) → draw white; otherwise skip (show orange bg).
  const padding = Math.round(SIZE * 0.08); // 8% padding on each side
  const drawSize = SIZE - padding * 2;

  // Resize source to fit with padding
  const pegasus = await Jimp.read(SRC);
  pegasus.resize({ w: drawSize, h: drawSize });

  for (let py = 0; py < drawSize; py++) {
    for (let px = 0; px < drawSize; px++) {
      const srcColor = pegasus.getPixelColor(px, py);
      const sr = (srcColor >> 24) & 0xff;
      const sg = (srcColor >> 16) & 0xff;
      const sb = (srcColor >> 8)  & 0xff;
      const sa = srcColor & 0xff;

      // Brightness: if pixel is dark (the black outline)
      const brightness = (sr + sg + sb) / 3;
      const isDark = brightness < 128 && sa > 50;

      if (isDark) {
        const tx = px + padding;
        const ty = py + padding;
        if (tx >= 0 && tx < SIZE && ty >= 0 && ty < SIZE) {
          // Check it's still inside the rounded rect
          const bgColor = out.getPixelColor(tx, ty);
          const ba = bgColor & 0xff;
          if (ba > 0) {
            // White with slight orange tint to blend nicely
            out.setPixelColor(rgbaToInt(255, 255, 255, 245), tx, ty);
          }
        }
      }
    }
  }

  await out.write(OUT);
  console.log('✓ Icon written to', OUT);
})();
