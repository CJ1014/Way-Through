// A tiny single-stroke handwriting "font" drawn as SVG, so the handwritten titles
// ("No way through.", "Way through.", "One Shot", "Paused") look inked on every OS instead
// of depending on an installed handwriting font. Glyph space: y 0 = ascender, 4.5 = x-height,
// 10 = baseline, 13.5 = descender. Each glyph: [advance, ...strokes], strokes = [x,y,...].
import { mulberry32 } from './util.js';

const BOWL = [4.6, 5.6, 3, 4.5, 1, 5.4, 0.3, 8, 1.6, 10, 3.6, 9.4, 4.6, 7.4];
const G = {
  a: [6, BOWL, [4.7, 4.6, 4.6, 8.5, 5.3, 10]],
  d: [6, BOWL, [4.7, 0.2, 4.6, 8.5, 5.3, 10]],
  e: [5.4, [0.6, 7.6, 4.6, 7.3, 4.2, 5.2, 2.5, 4.5, 0.6, 5.8, 0.4, 8.4, 2, 10, 4.4, 9.6]],
  g: [5.6, [4.4, 5.6, 2.8, 4.5, 0.8, 5.4, 0.4, 7.7, 1.8, 9.4, 3.8, 8.8, 4.5, 7], [4.6, 4.6, 4.5, 11, 3.4, 13.2, 1.4, 13.2, 0.4, 12]],
  h: [5.8, [0.8, 0.2, 0.8, 10], [0.8, 6.6, 2, 4.8, 3.8, 4.6, 4.6, 6, 4.6, 10]],
  n: [5.8, [0.8, 4.6, 0.8, 10], [0.8, 6.4, 2, 4.8, 3.8, 4.6, 4.6, 6, 4.6, 10]],
  o: [5.6, [2.6, 4.5, 0.6, 5.6, 0.3, 8, 1.8, 10, 3.8, 9.7, 5, 7.6, 4.6, 5.2, 2.6, 4.5, 1.6, 4.9]],
  r: [4.6, [0.8, 4.6, 0.8, 10], [0.8, 6.8, 1.8, 5, 3.2, 4.5, 4.2, 4.9]],
  s: [4.8, [4, 5.2, 2.6, 4.5, 0.9, 5, 0.9, 6.6, 2.4, 7.3, 4, 8.1, 4, 9.5, 2.4, 10.1, 0.5, 9.4]],
  t: [4.2, [1.8, 1.6, 1.8, 9, 2.6, 10, 3.8, 9.6], [0.2, 4.8, 3.6, 4.6]],
  u: [5.8, [0.7, 4.6, 0.7, 8.4, 1.8, 10, 3.6, 9.8, 4.6, 8], [4.7, 4.6, 4.7, 10]],
  w: [6.4, [0.2, 4.6, 1.4, 10, 2.9, 5.6, 4.3, 10, 5.8, 4.6]],
  y: [5.2, [0.3, 4.6, 2.5, 9.8], [4.8, 4.6, 2.4, 11.4, 1.3, 13.2, 0.2, 13]],
  '.': [2.2, [0.7, 9.5, 1.0, 9.9, 0.8, 10.1]],
  N: [6.6, [0.8, 10.2, 0.8, 0.4, 5.4, 10, 5.4, 0.2]],
  O: [7, [3.3, 0.1, 0.9, 1.4, 0.2, 5, 0.9, 8.8, 3.3, 10.1, 5.8, 8.8, 6.5, 5, 5.7, 1.3, 3.3, 0.1, 2.2, 0.5]],
  W: [8.2, [0, 0.4, 1.8, 10, 3.8, 3, 5.8, 10, 7.6, 0.3]],
  S: [6, [5, 1.6, 3.4, 0.2, 1.2, 0.6, 0.6, 2.6, 2, 4.4, 4.4, 5.6, 5.4, 7.8, 4.4, 9.8, 2, 10.2, 0.2, 8.8]],
  P: [5.8, [0.8, 10.2, 0.8, 0.3], [0.8, 0.4, 3.6, 0.2, 5, 1.6, 4.8, 3.6, 3.2, 4.9, 0.8, 5]],
  ' ': [3],
};

// Catmull-Rom through the points -> cubic Bezier path.
function smoothPath(p) {
  let d = `M${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
  const n = p.length / 2;
  if (n === 2) return d + `L${p[2].toFixed(2)} ${p[3].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const i0 = Math.max(0, i - 1), i2 = i + 1, i3 = Math.min(n - 1, i + 2);
    const x0 = p[i0 * 2], y0 = p[i0 * 2 + 1], x1 = p[i * 2], y1 = p[i * 2 + 1];
    const x2 = p[i2 * 2], y2 = p[i2 * 2 + 1], x3 = p[i3 * 2], y3 = p[i3 * 2 + 1];
    const c1x = x1 + (x2 - x0) / 6, c1y = y1 + (y2 - y0) / 6;
    const c2x = x2 - (x3 - x1) / 6, c2y = y2 - (y3 - y1) / 6;
    d += `C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  return d;
}

// Returns an <svg> element with the text hand-drawn. height: CSS px of the ascender->baseline.
export function handwritten(text, height = 48, seed = 3) {
  const rnd = mulberry32(seed + text.length * 17);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  let x = 0.4;
  const paths = [];
  for (const ch of text) {
    const g = G[ch] || G[ch.toLowerCase()] || G[' '];
    const [adv, ...strokes] = g;
    const wob = (rnd() - 0.5) * 0.5; // per-letter baseline wobble
    const slant = 0.1 + (rnd() - 0.5) * 0.05;
    for (const s of strokes) {
      const pts = [];
      for (let i = 0; i < s.length; i += 2) {
        const yy = s[i + 1] + wob + (rnd() - 0.5) * 0.22;
        const xx = x + s[i] + (10 - yy) * slant + (rnd() - 0.5) * 0.22;
        pts.push(xx, yy);
      }
      paths.push(smoothPath(pts));
    }
    x += adv + 0.7;
  }
  const w = x + 1.2, top = -0.8, h = 15;
  svg.setAttribute('viewBox', `0 ${top} ${w.toFixed(2)} ${h}`);
  const scale = height / 10;
  svg.setAttribute('width', (w * scale).toFixed(0));
  svg.setAttribute('height', (h * scale).toFixed(0));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', text);
  svg.classList.add('handsvg');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', paths.join(' '));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.05');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}
