// The colours quests are drawn in (Phase 4 Step 5 polish): the HUD's good and bad splits, warnings, the
// next-checkpoint arrow, the checkpoint and bonus gates' banners, the route and the guide line on the
// maps. Two palettes: the standard one, and one for colour-blind players (Okabe & Ito's colour-blind-safe
// set: blue against orange rather than green against red), chosen in the settings (Accessibility).
// Nothing in a palette is told apart by its colour alone — a split also has its sign (+0.42 / −0.42), the
// arrow its shape — but the colours should still read apart for every kind of colour vision:
// tests/unit/polish.test.mjs simulates protanopia, deuteranopia and tritanopia and checks they do.
//
// "More visible route guides" (guides: 'bold'): bigger, brighter arrows on the road, taller gates that
// glow (unlit by the scene, so they show at night), a thicker guide line on the maps and a bigger arrow on
// the HUD.
//
//   paletteOf(name) → { good, bad, warn, neutral, arrow, arrowMissed, checkpoint: [a, b, plate], bonus, route, guide }
//   guideStyle(mode) → { arrowOpacity, arrowScale, arrowColour?, gateHeight, gateGlow, lineWidth, hudArrow }

export const PALETTES = {
  standard: {
    name: 'Standard',
    good: '#7ee08a', bad: '#ff7a6a', warn: '#ffbd4a', neutral: '#ffffff',
    arrow: '#ffd24a', arrowMissed: '#ff7a6a',
    checkpoint: ['#1b1b1b', '#ffd400', '#d18a00'], bonus: ['#1b1b1b', '#38e1ff', '#0b7fa0'],
    route: '#e05cff', guide: '#1fb6ff',
  },
  // Okabe & Ito: sky blue for good, orange for bad, yellow for a warning; the arrow white, turning orange
  colourblind: {
    name: 'Colour-blind friendly',
    good: '#56b4e9', bad: '#e69f00', warn: '#f0e442', neutral: '#ffffff',
    arrow: '#ffffff', arrowMissed: '#e69f00',
    checkpoint: ['#1b1b1b', '#f0e442', '#0072b2'], bonus: ['#1b1b1b', '#ffffff', '#d55e00'],
    route: '#d55e00', guide: '#56b4e9',
  },
};

export const paletteOf = name => PALETTES[name] ?? PALETTES.standard;

export const GUIDES = {
  normal: { arrowOpacity: 0.55, arrowScale: 1.4, arrowColour: null, gateHeight: 1, gateGlow: false, lineWidth: 4, hudArrow: 46 },
  bold: { arrowOpacity: 0.9, arrowScale: 2.3, arrowColour: 'arrow', gateHeight: 1.35, gateGlow: true, lineWidth: 8, hudArrow: 68 },
};
export const guideStyle = mode => GUIDES[mode] ?? GUIDES.normal;

// ---------- colour vision (for the tests and anyone choosing new colours) ----------
// sRGB hex → linear RGB → simulated as seen with a dichromacy (Machado, Oliveira & Fernandes 2009, severity
// 1.0) → CIE Lab, and the distance between two colours (ΔE 1976)
const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255); };
const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const MACHADO = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
export const VISION = ['normal', ...Object.keys(MACHADO)];

function lab([r, g, b]) {
  const X = 0.4124 * r + 0.3576 * g + 0.1805 * b, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const fx = f(X / 0.95047), fy = f(Y), fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function seenAs(colour, vision = 'normal') {
  const c = hex(colour).map(lin), M = MACHADO[vision];
  const s = M ? M.map(row => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2]))) : c;
  return lab(s);
}
export const colourDistance = (a, b, vision = 'normal') => { const A = seenAs(a, vision), B = seenAs(b, vision); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
