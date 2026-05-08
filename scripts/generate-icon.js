// Generates assets/icon.png (1024×1024) – a Pegasus silhouette on a dark gradient.
// Run once: node scripts/generate-icon.js
const { Jimp, rgbaToInt } = require('jimp');
const path  = require('path');
const fs    = require('fs');

const SIZE = 1024;
const OUT  = path.join(__dirname, '..', 'assets', 'icon.png');

(async () => {
  const img = new Jimp({ width: SIZE, height: SIZE });

  // ── Background: deep indigo → purple radial gradient ─────────────────────
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x - SIZE / 2) / (SIZE / 2);
      const dy = (y - SIZE / 2) / (SIZE / 2);
      const d  = Math.sqrt(dx * dx + dy * dy);
      const t  = Math.min(d, 1);
      // centre: #1e1b4b  edge: #0d0b1e
      const r = Math.round(30  * (1 - t) + 13 * t);
      const g = Math.round(27  * (1 - t) + 11 * t);
      const b = Math.round(75  * (1 - t) + 30 * t);
      img.setPixelColor(rgbaToInt(r, g, b, 255), x, y);
    }
  }

  // ── Rounded rect clip (iOS-style) ────────────────────────────────────────
  const R = SIZE * 0.22;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cx = x - SIZE / 2, cy = y - SIZE / 2;
      const hw = SIZE / 2, hh = SIZE / 2;
      const qx = Math.abs(cx) - hw + R, qy = Math.abs(cy) - hh + R;
      const dist = Math.sqrt(Math.max(qx,0)**2 + Math.max(qy,0)**2) + Math.min(Math.max(qx,qy),0) - R;
      if (dist > 0) img.setPixelColor(rgbaToInt(0,0,0,0), x, y);
    }
  }

  // ── Glowing accent ring ───────────────────────────────────────────────────
  const cx = SIZE / 2, cy = SIZE / 2;
  const ringR = SIZE * 0.38, ringW = SIZE * 0.012;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.sqrt((x - cx)**2 + (y - cy)**2);
      const distToRing = Math.abs(d - ringR);
      if (distToRing < ringW) {
        const alpha = Math.round(120 * (1 - distToRing / ringW));
        img.setPixelColor(rgbaToInt(137, 180, 250, alpha), x, y);
      }
    }
  }

  // ── Draw Pegasus body using filled polygons ───────────────────────────────
  // Scale factor: icon is 1024, design coords are 0-100
  function sc(v) { return Math.round((v / 100) * SIZE); }

  function fillPoly(points, r, g, b, a = 255) {
    const xs = points.map(p => sc(p[0]));
    const ys = points.map(p => sc(p[1]));
    const minY = Math.max(0, Math.min(...ys));
    const maxY = Math.min(SIZE - 1, Math.max(...ys));

    for (let py = minY; py <= maxY; py++) {
      const nodes = [];
      let j = points.length - 1;
      for (let i = 0; i < points.length; i++) {
        if ((ys[i] < py && ys[j] >= py) || (ys[j] < py && ys[i] >= py)) {
          nodes.push(Math.round(xs[i] + (py - ys[i]) / (ys[j] - ys[i]) * (xs[j] - xs[i])));
        }
        j = i;
      }
      nodes.sort((a, b) => a - b);
      for (let k = 0; k < nodes.length - 1; k += 2) {
        for (let px = Math.max(0, nodes[k]); px <= Math.min(SIZE-1, nodes[k+1]); px++) {
          img.setPixelColor(rgbaToInt(r, g, b, a), px, py);
        }
      }
    }
  }

  function fillCircle(cx2, cy2, rad, r, g, b, a = 255) {
    const x0 = Math.max(0, sc(cx2) - sc(rad));
    const x1 = Math.min(SIZE - 1, sc(cx2) + sc(rad));
    const y0 = Math.max(0, sc(cy2) - sc(rad));
    const y1 = Math.min(SIZE - 1, sc(cy2) + sc(rad));
    const rPx = sc(rad);
    const cxPx = sc(cx2), cyPx = sc(cy2);
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        if ((px - cxPx)**2 + (py - cyPx)**2 <= rPx**2) {
          img.setPixelColor(rgbaToInt(r, g, b, a), px, py);
        }
      }
    }
  }

  const W = 230, G = 160, B = 250; // accent blue

  // Shadow / glow beneath body
  fillCircle(50, 58, 18, W, G, B, 18);

  // Body
  fillPoly([
    [34,72],[38,55],[50,50],[62,55],[66,72],
    [60,78],[50,80],[40,78]
  ], W, G, B, 240);

  // Neck
  fillPoly([
    [44,53],[50,42],[56,53],[53,56],[47,56]
  ], W, G, B, 240);

  // Head
  fillCircle(50, 38, 9, W, G, B, 240);

  // Snout
  fillPoly([
    [47,44],[53,44],[55,49],[50,51],[45,49]
  ], W, G, B, 230);

  // Eye
  fillCircle(47, 36, 1.8, 15, 12, 40, 255);
  fillCircle(46.6, 35.6, 0.7, W, G, B, 255);

  // Ear
  fillPoly([[47,30],[50,26],[53,30],[50,32]], W, G, B, 220);

  // Mane
  fillPoly([[50,28],[55,30],[58,38],[55,42],[52,40],[54,34],[50,32]], 167, 139, 250, 210);
  fillPoly([[50,30],[46,32],[44,38],[47,42],[50,40],[48,34],[50,32]], 167, 139, 250, 180);

  // Front legs
  fillPoly([[43,78],[47,78],[46,92],[42,92]], W, G, B, 235);
  fillPoly([[53,78],[57,78],[58,92],[54,92]], W, G, B, 235);

  // Hooves
  fillPoly([[42,90],[46,90],[47,95],[41,95]], 80, 70, 120, 255);
  fillPoly([[54,90],[58,90],[59,95],[53,95]], 80, 70, 120, 255);

  // Tail
  fillPoly([[65,68],[70,62],[74,70],[70,78],[66,76]], 167, 139, 250, 200);
  fillPoly([[66,72],[72,68],[75,76],[70,82],[66,78]], 137, 100, 230, 170);

  // Wing (right – near side)
  fillPoly([
    [57,60],[72,48],[80,55],[78,65],[65,68],[60,65]
  ], W, G, B, 220);
  // Wing feather detail lines (slightly darker)
  fillPoly([[60,63],[75,52],[78,55],[63,66]], 180, 140, 250, 100);

  // Wing (left – far side, smaller)
  fillPoly([
    [43,60],[28,48],[20,55],[22,65],[35,68],[40,65]
  ], W, G, B, 190);
  fillPoly([[40,63],[25,52],[22,55],[37,66]], 180, 140, 250, 80);

  // Sparkle stars around Pegasus
  const stars = [[22,30],[78,28],[18,68],[82,70],[50,18],[50,88]];
  for (const [sx, sy] of stars) {
    fillCircle(sx, sy, 1.2, 255, 255, 255, 180);
    fillPoly([[sx-0.3,sy-2.5],[sx+0.3,sy-2.5],[sx+0.3,sy+2.5],[sx-0.3,sy+2.5]], 255,255,255,140);
    fillPoly([[sx-2.5,sy-0.3],[sx+2.5,sy-0.3],[sx+2.5,sy+0.3],[sx-2.5,sy+0.3]], 255,255,255,140);
  }

  await img.write(OUT);
  console.log('✓ Icon written to', OUT);
})();
