// Map v5's building facades (MAP_README.md, 'Buildings'): one atlas of FACADES (map/model/buildingsV5.ts's order), a
// 4 × 4 grid, each facade a bay (3 m) wide and two storeys tall — its ground floor (doors, a shopfront, a roller door)
// under the storey every floor above repeats — drawn white where the wall's own colour (the vertex colour) shows and
// dark where its windows are. The walls' u is the facade's index × 1000 + bays along the wall; v storeys up from the
// ground: one material for every building, one draw a tile. After dark some windows light (warm, a few at random, the
// same ones every night), more in towers and flats than in warehouses: facadeNight.value (0 day … 1 night).
//
//   const m = facadeMaterial()   (shared)      facadeNight.value = night

import * as THREE from 'three';

export const facadeNight = { value: 0 };
const N = 4, TW = 128, TH = 256;
let material: THREE.MeshLambertMaterial | null = null;

// each facade: ground storey and upper storey, drawn into its cell. (x, y) in the cell's own pixels, y down from the top:
// the upper storey's rows 0–127, the ground's 128–255; alpha < 1 marks a window (lit after dark)
type G = CanvasRenderingContext2D;
const win = (g: G, x: number, y: number, w: number, h: number, frame = '#d9d4ca') => { g.fillStyle = frame; g.fillRect(x - 3, y - 3, w + 6, h + 6); g.fillStyle = 'rgba(58,74,88,0.55)'; g.clearRect(x, y, w, h); g.fillRect(x, y, w, h); g.fillStyle = 'rgba(120,140,160,0.55)'; g.fillRect(x, y, w, h * 0.3); };
// (an arched window: its shape's alpha cut out, then filled — a window's alpha, below 1)
const arch = (g: G, x: number, y: number, w: number, h: number, fill: string) => { g.save(); g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath(); g.clip(); g.clearRect(x, y, w, h); g.fillStyle = fill; g.fillRect(x, y, w, h); g.restore(); };
const door = (g: G, x: number, y: number, w: number, h: number, c = '#6b4a32') => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const DRAW: Record<string, (g: G) => void> = {
  house: g => { win(g, 22, 40, 34, 46); win(g, 74, 40, 34, 46); win(g, 18, 168, 40, 48); door(g, 78, 160, 30, 96); },
  terrace: g => { win(g, 30, 36, 30, 56); win(g, 76, 36, 30, 56); g.fillStyle = '#e8e4da'; g.fillRect(0, 120, 128, 8); win(g, 22, 166, 40, 52); door(g, 80, 156, 28, 100, '#3b4a52'); },
  apartment: g => { win(g, 14, 30, 44, 54); win(g, 70, 30, 44, 54); g.fillStyle = '#bdb8ad'; g.fillRect(8, 92, 112, 10); win(g, 14, 158, 44, 54); win(g, 70, 158, 44, 54); },
  shop: g => { win(g, 26, 34, 30, 50); win(g, 72, 34, 30, 50); g.fillStyle = '#2b2f33'; g.fillRect(0, 128, 128, 18); g.fillStyle = 'rgba(70,96,112,0.5)'; g.clearRect(6, 152, 116, 100); g.fillRect(6, 152, 116, 100); g.fillStyle = '#2b2f33'; g.fillRect(60, 152, 4, 104); },
  office: g => { g.fillStyle = 'rgba(66,86,104,0.5)'; g.clearRect(0, 14, 128, 92); g.fillRect(0, 14, 128, 92); g.fillStyle = '#cfd3d6'; for (let x = 0; x < 128; x += 32) g.fillRect(x, 14, 4, 92); g.fillStyle = 'rgba(66,86,104,0.5)'; g.clearRect(0, 146, 128, 106); g.fillRect(0, 146, 128, 106); g.fillStyle = '#cfd3d6'; g.fillRect(62, 146, 4, 110); },
  warehouse: g => { g.fillStyle = '#c9ccce'; for (let x = 0; x < 128; x += 8) g.fillRect(x, 0, 3, 256); g.fillStyle = 'rgba(80,96,110,0.6)'; g.clearRect(10, 30, 108, 18); g.fillRect(10, 30, 108, 18); g.fillStyle = '#8f9497'; g.fillRect(16, 150, 96, 106); g.fillStyle = '#7d8285'; for (let y = 154; y < 256; y += 10) g.fillRect(16, y, 96, 3); },
  school: g => { win(g, 8, 36, 112, 46); g.fillStyle = '#d9d4ca'; g.fillRect(62, 33, 4, 52); win(g, 8, 164, 112, 46); door(g, 52, 214, 24, 42, '#2f5d7c'); },
  church: g => { arch(g, 44, 40, 40, 70, 'rgba(80,60,96,0.55)'); g.fillStyle = '#5a3d2b'; g.beginPath(); g.moveTo(44, 256); g.lineTo(44, 170); g.arc(64, 170, 20, Math.PI, 0); g.lineTo(84, 256); g.closePath(); g.fill(); },
  petrol: g => { g.fillStyle = '#2b2f33'; g.fillRect(0, 100, 128, 28); g.fillStyle = 'rgba(70,96,112,0.5)'; g.clearRect(4, 140, 120, 112); g.fillRect(4, 140, 120, 112); g.fillStyle = '#d9d4ca'; g.fillRect(62, 140, 4, 116); },
  mall: g => { g.fillStyle = '#d4cec2'; g.fillRect(0, 0, 128, 256); g.fillStyle = '#c4bdb0'; g.fillRect(0, 60, 128, 6); g.fillStyle = 'rgba(70,96,112,0.5)'; g.clearRect(30, 170, 68, 86); g.fillRect(30, 170, 68, 86); },
  hospital: g => { win(g, 12, 40, 44, 40); win(g, 72, 40, 44, 40); g.fillStyle = '#e6e2d8'; g.fillRect(0, 98, 128, 8); win(g, 12, 168, 44, 40); win(g, 72, 168, 44, 40); },
  station: g => { arch(g, 30, 36, 68, 74, 'rgba(80,60,96,0.4)'); g.fillStyle = 'rgba(70,96,112,0.5)'; g.clearRect(22, 160, 84, 96); g.fillRect(22, 160, 84, 96); },
  industrial: g => { win(g, 40, 30, 48, 26); g.fillStyle = '#9aa0a2'; g.fillRect(20, 156, 88, 100); g.fillStyle = '#8a9092'; for (let y = 160; y < 256; y += 9) g.fillRect(20, y, 88, 3); },
  plain: g => { win(g, 40, 40, 48, 40); win(g, 40, 168, 48, 40); },
  tower: g => { g.fillStyle = 'rgba(58,90,120,0.5)'; g.clearRect(0, 0, 128, 256); g.fillRect(0, 0, 128, 256); g.fillStyle = '#b8c4cc'; g.fillRect(0, 0, 128, 6); g.fillRect(0, 128, 128, 6); for (let x = 0; x < 128; x += 42) g.fillRect(x, 0, 3, 256); },
  garage: g => { g.fillStyle = '#a9adae'; g.fillRect(14, 146, 100, 110); g.fillStyle = '#9a9ea0'; for (let y = 150; y < 256; y += 8) g.fillRect(14, y, 100, 2); },
};
const ORDER = ['house', 'terrace', 'apartment', 'shop', 'office', 'warehouse', 'school', 'church', 'petrol', 'mall', 'hospital', 'station', 'industrial', 'plain', 'tower', 'garage'];

function atlas() {
  const c = document.createElement('canvas'); c.width = TW * N; c.height = TH * N;
  const g = c.getContext('2d')!;
  ORDER.forEach((name, k) => {
    const cx = (k % N) * TW, cy = Math.floor(k / N) * TH;
    g.save(); g.translate(cx, cy); g.beginPath(); g.rect(0, 0, TW, TH); g.clip();
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, TW, TH);
    DRAW[name](g);
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  return t;
}

export function facadeMaterial(wrap: (m: THREE.MeshLambertMaterial) => THREE.MeshLambertMaterial) {
  if (material) return material;
  const m = wrap(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  const tex = atlas(), before = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    before?.(sh, r);
    sh.uniforms.uFacades = { value: tex }; sh.uniforms.uNight = facadeNight as any;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFacade;').replace('#include <uv_vertex>', '#include <uv_vertex>\n  vFacade = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vFacade;\nuniform sampler2D uFacades;\nuniform float uNight;\nfloat fh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }')
      .replace('#include <map_fragment>', `
  float tileF = floor(vFacade.x / 1000.0);
  float bu = vFacade.x - tileF * 1000.0;
  vec2 cellF = vec2(mod(tileF, ${N}.0), floor(tileF / ${N}.0));
  // (the ground storey: the cell's lower half; every storey above: its upper half, repeating)
  float fv = vFacade.y < 1.0 ? 0.5 + (1.0 - fract(max(vFacade.y, 0.0))) * 0.5 : (1.0 - fract(vFacade.y)) * 0.5;
  vec2 auv = (cellF + vec2(0.01 + fract(bu) * 0.98, 0.005 + fv * 0.99)) / ${N}.0;
  vec4 texelF = textureGrad(uFacades, auv, dFdx(vFacade) / ${N}.0, dFdy(vFacade) / ${N * 2}.0);
  diffuseColor.rgb *= texelF.rgb;
  float windowF = 1.0 - texelF.a;
  float litF = step(tileF == 5.0 || tileF == 12.0 || tileF == 15.0 ? 0.85 : 0.55, fh(floor(vec2(bu, vFacade.y)) + tileF));`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3(1.0, 0.82, 0.55) * windowF * litF * uNight * 1.6;');
  };
  m.customProgramCacheKey = () => 'facades-v5';
  material = m;
  return m;
}
