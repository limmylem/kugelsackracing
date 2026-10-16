// Map v5's street furniture in the game (MAP_README.md, 'Street furniture'): a tile's lists.furniture
// (map/format/furniture.ts) drawn as instances — a handful of draw calls a tile whatever the count — and its power lines
// (lists.wires) as one set of lines. The traffic lights run on the manifest's cycle (furniture.cycle: green, amber and
// all-red seconds), two phase groups opposite each other; their lenses are lit (unshaded) so they read by day and night.
//
//   const F = furnitureObjects(tile, cfg)  → { group, count, setDetail(d), dispose() }   (cfg = manifest.furniture)
//   furnitureTick(seconds, cfg)             each frame: the lights' cycle
import * as THREE from 'three';
import { FURN, FURNITURE_STRIDE, canopySize } from "../format/furniture.js";
let S = null, clock = 0;
const canvasTex = (w, h, draw) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
};
function shared(cfg) {
    if (S)
        return S;
    const st = cfg?.style ?? {}, signC = st.signs ?? {}, red = signC.stop ?? '#c8102e';
    const cyl = (rt, rb, h, seg = 8) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(0, h / 2, 0); return g; };
    const box = (w, h, d, y = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, y + h / 2, 0); return g; };
    const plate = (geo, y) => { geo.translate(0, y, 0.05); return geo; };
    const lit = (c) => new THREE.MeshBasicMaterial({ color: c });
    const face = (tex) => new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
    // (the faces: drawn once, shared by every sign)
    const stopTex = canvasTex(128, 128, g => { g.fillStyle = red; g.beginPath(); for (let k = 0; k < 8; k++) {
        const a = Math.PI / 8 + k * Math.PI / 4;
        g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62);
    } g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 5; g.stroke(); g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('STOP', 64, 66); });
    const giveTex = canvasTex(128, 128, g => { g.fillStyle = red; g.beginPath(); g.moveTo(6, 10); g.lineTo(122, 10); g.lineTo(64, 120); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(28, 22); g.lineTo(100, 22); g.lineTo(64, 92); g.fill(); g.fillStyle = '#111'; g.font = 'bold 15px sans-serif'; g.textAlign = 'center'; g.fillText('GIVE', 64, 44); g.fillText('WAY', 64, 62); });
    const busTex = canvasTex(64, 128, g => { g.fillStyle = '#e8e8e2'; g.fillRect(2, 2, 60, 124); g.fillStyle = '#0a5c36'; g.fillRect(6, 6, 52, 40); g.fillStyle = '#fff'; g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.fillText('BUS', 32, 34); g.fillStyle = '#222'; g.font = '12px sans-serif'; g.fillText('STOP', 32, 70); });
    const speedTex = new Map(), speedMat = new Map();
    const speedFace = (v) => { if (!speedMat.has(v)) {
        const t = canvasTex(128, 128, g => { g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill(); g.strokeStyle = signC.speed ?? red; g.lineWidth = 12; g.beginPath(); g.arc(64, 64, 55, 0, Math.PI * 2); g.stroke(); g.fillStyle = '#111'; g.font = `bold ${v >= 100 ? 44 : 54}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(v), 64, 67); });
        speedTex.set(v, t);
        speedMat.set(v, face(t));
    } return speedMat.get(v); };
    S = {
        post: cyl(0.04, 0.04, 2.3), pole: cyl(0.09, 0.11, 1), stobie: cyl(0.11, 0.16, 1, 6), pylon: cyl(0.4, 2.2, 1, 4),
        housing: box(0.34, 1.0, 0.26), board: box(0.56, 1.2, 0.04), lens: new THREE.CircleGeometry(0.1, 12),
        signDisc: plate(new THREE.PlaneGeometry(0.75, 0.75), 2.3), signTri: plate(new THREE.PlaneGeometry(0.8, 0.8), 2.3), busPlate: plate(new THREE.PlaneGeometry(0.35, 0.7), 2.4),
        shelter: (() => { const g = new THREE.BoxGeometry(3.2, 0.08, 1.5); g.translate(0, 2.4, 0); return g; })(), shelterBack: box(3.2, 2.3, 0.05, 0.05), seat: box(1.6, 0.06, 0.4, 0.45), bench: box(1.6, 0.45, 0.45), bin: cyl(0.25, 0.22, 0.9, 10), postBox: box(0.45, 1.25, 0.4), hydrant: cyl(0.12, 0.14, 0.75, 8), bollard: cyl(0.08, 0.08, 0.9, 8),
        metal: new THREE.MeshLambertMaterial({ color: st.streetLight?.pole ?? '#9aa0a2' }), dark: new THREE.MeshLambertMaterial({ color: st.trafficLight?.housing ?? '#26292b' }),
        concrete: new THREE.MeshLambertMaterial({ color: st.powerPole?.colour ?? '#7f8285' }), glass: new THREE.MeshLambertMaterial({ color: '#9fb4bf', transparent: true, opacity: 0.45 }),
        shelterMat: new THREE.MeshLambertMaterial({ color: st.busStop?.shelter ?? '#3b4a52' }), wood: new THREE.MeshLambertMaterial({ color: '#7a5a3a' }), green: new THREE.MeshLambertMaterial({ color: '#33503a' }),
        red: new THREE.MeshLambertMaterial({ color: '#c8102e' }), yellow: new THREE.MeshLambertMaterial({ color: '#d8b62a' }),
        stopFace: face(stopTex), giveFace: face(giveTex), busFace: face(busTex), speedFace,
        // (the lenses: [phase group][red, amber, green], lit or dark by the cycle)
        lenses: [0, 1].map(() => [lit('#3a0b0b'), lit('#3a2a08'), lit('#08300f')]),
        wire: new THREE.LineBasicMaterial({ color: '#2a2a2a' }),
    };
    return S;
}
// each frame: the cycle (green, amber, all red, then the other group's turn)
export function furnitureTick(seconds, cfg) {
    clock += seconds;
    if (!S)
        return;
    const C = cfg?.cycle ?? { green: 20, amber: 4, allRed: 2 }, half = C.green + C.amber + C.allRed, t = clock % (2 * half);
    const ON = ['#ff2a1a', '#ffb000', '#2bff6a'], OFF = ['#3a0b0b', '#3a2a08', '#08300f'];
    for (const g of [0, 1]) {
        const u = (t - g * half + 2 * half) % (2 * half), state = u < C.green ? 2 : u < C.green + C.amber ? 1 : 0;
        S.lenses[g].forEach((m, k) => m.color.set(k === state ? ON[k] : OFF[k]));
    }
}
export function furnitureObjects(tile, cfg) {
    const F = tile.lists.furniture?.data, W = tile.lists.wires?.data, group = new THREE.Group();
    group.name = 'furniture';
    const n = F ? F.length / FURNITURE_STRIDE : 0;
    if (!n && !W?.length)
        return { group, count: 0, setDetail() { }, dispose() { } };
    const Sh = shared(cfg), owned = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    // (pieces by what's drawn: geometry, material → their matrices)
    const bins = new Map();
    const add = (key, geo, mat, x, y, z, yaw, sx = 1, sy = 1, sz = 1, dx = 0, dy = 0, dz = 0) => {
        q.setFromAxisAngle(up, yaw);
        const off = new THREE.Vector3(dx, dy, dz).applyQuaternion(q);
        const m = new THREE.Matrix4().compose(p.set(x + off.x, y + off.y, z + off.z), q, s.set(sx, sy, sz));
        (bins.get(key) ?? bins.set(key, { geo, mat, ms: [] }).get(key)).ms.push(m);
    };
    for (let k = 0; k < n; k++) {
        const o = k * FURNITURE_STRIDE, x = F[o], y = F[o + 1], z = F[o + 2], yaw = F[o + 3], kind = F[o + 4], a = F[o + 5], b = F[o + 6];
        switch (kind) {
            case FURN.trafficLight: {
                const h = b || 3.2, g = a | 0;
                add('tlPole', Sh.pole, Sh.dark, x, y, z, yaw, 1, h, 1);
                add('tlHousing', Sh.housing, Sh.dark, x, y + h - 1.0, z, yaw, 1, 1, 1, 0, 0, 0.12);
                add('tlBoard', Sh.board, Sh.dark, x, y + h - 1.1, z, yaw, 1, 1, 1, 0, 0, 0.0);
                for (let l = 0; l < 3; l++)
                    add(`tlLens${g}${l}`, Sh.lens, Sh.lenses[g][l], x, y + h - 0.22 - l * 0.3, z, yaw, 1, 1, 1, 0, 0, 0.26);
                break;
            }
            case FURN.stop:
                add('post', Sh.post, Sh.metal, x, y, z, yaw);
                add('stop', Sh.signDisc, Sh.stopFace, x, y, z, yaw);
                break;
            case FURN.giveWay:
                add('post', Sh.post, Sh.metal, x, y, z, yaw);
                add('give', Sh.signTri, Sh.giveFace, x, y, z, yaw);
                break;
            case FURN.speed:
                add('post', Sh.post, Sh.metal, x, y, z, yaw);
                add(`speed${a | 0}`, Sh.signDisc, Sh.speedFace(a | 0), x, y, z, yaw);
                break;
            case FURN.busStop:
                add('post', Sh.post, Sh.metal, x, y, z, yaw, 1, 1.15, 1);
                add('bus', Sh.busPlate, Sh.busFace, x, y, z, yaw);
                break;
            case FURN.shelter:
                add('shelterRoof', Sh.shelter, Sh.shelterMat, x, y, z, yaw);
                add('shelterBack', Sh.shelterBack, Sh.glass, x, y, z, yaw, 1, 1, 1, 0, 0, -0.7);
                add('seat', Sh.seat, Sh.shelterMat, x, y, z, yaw, 1, 1, 1, 0, 0, -0.45);
                break;
            case FURN.powerPole:
                add('stobie', Sh.stobie, Sh.concrete, x, y, z, yaw, 1, a || 10.5, 1);
                add('crossarm', Sh.housing, Sh.concrete, x, y + (a || 10.5) - 0.5, z, yaw, 6, 0.12, 0.5);
                break;
            case FURN.pylon:
                add('pylon', Sh.pylon, Sh.metal, x, y, z, yaw, 1, a || 28, 1);
                break;
            case FURN.bench:
                add('bench', Sh.bench, Sh.wood, x, y, z, yaw);
                break;
            case FURN.bin:
                add('bin', Sh.bin, Sh.green, x, y, z, yaw);
                break;
            case FURN.postBox:
                add('postBox', Sh.postBox, Sh.red, x, y, z, yaw);
                break;
            case FURN.hydrant:
                add('hydrant', Sh.hydrant, Sh.yellow, x, y, z, yaw);
                break;
            case FURN.bollard:
                add('bollard', Sh.bollard, Sh.metal, x, y, z, yaw);
                break;
        }
    }
    for (const { geo, mat, ms } of bins.values()) {
        const im = new THREE.InstancedMesh(geo, mat, ms.length);
        ms.forEach((m, i) => im.setMatrixAt(i, m));
        im.computeBoundingSphere();
        im.matrixAutoUpdate = false;
        im.castShadow = mat !== Sh.glass;
        owned.push(im);
        group.add(im);
    }
    // power lines: three wires a span, sagging (a parabola, sag 2% of the span)
    let wires = null;
    if (W?.length) {
        const pos = [];
        for (let k = 0; k < W.length; k += 6) {
            const ax = W[k], ay = W[k + 1], az = W[k + 2], bx = W[k + 3], by = W[k + 4], bz = W[k + 5], L = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / (L || 1), nz = (bx - ax) / (L || 1);
            for (const o of [-1.2, 0, 1.2])
                for (let q2 = 0; q2 < 8; q2++) {
                    const t0 = q2 / 8, t1 = (q2 + 1) / 8, sag = (t) => -4 * 0.02 * L * t * (1 - t);
                    pos.push(ax + (bx - ax) * t0 + nx * o, ay + (by - ay) * t0 + sag(t0) - 0.3, az + (bz - az) * t0 + nz * o, ax + (bx - ax) * t1 + nx * o, ay + (by - ay) * t1 + sag(t1) - 0.3, az + (bz - az) * t1 + nz * o);
                }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.computeBoundingSphere();
        wires = new THREE.LineSegments(g, Sh.wire);
        wires.matrixAutoUpdate = false;
        group.add(wires);
    }
    return {
        group, count: n,
        setDetail(d) { for (const im of owned)
            im.visible = d < 650; if (wires)
            wires.visible = d < 900; },
        dispose() { for (const im of owned)
            im.dispose(); wires?.geometry.dispose(); group.removeFromParent(); },
    };
}
// ---------- Map v5's chains: their logos and signs, made in the game from the manifest's parodies (no real name is
// anywhere in the data or the drawing) ----------
const brandTex = new Map(), brandMats = new Map();
// a parody's logo: its shape in its secondary colour, its mark in its primary, at (x, y), size s
export function drawLogo(g, logo, colours, x, y, s) {
    const P = colours.primary, S2 = colours.secondary, r = s / 2, cx = x + r, cy = y + r;
    g.save();
    g.fillStyle = S2;
    g.beginPath();
    switch (logo?.shape) {
        case 'square':
            g.rect(x, y, s, s);
            break;
        case 'rounded':
        case 'pill': {
            const k = logo.shape === 'pill' ? r : s * 0.22;
            g.moveTo(x + k, y);
            g.arcTo(x + s, y, x + s, y + s, k);
            g.arcTo(x + s, y + s, x, y + s, k);
            g.arcTo(x, y + s, x, y, k);
            g.arcTo(x, y, x + s, y, k);
            break;
        }
        case 'triangle':
            g.moveTo(cx, y);
            g.lineTo(x + s, y + s);
            g.lineTo(x, y + s);
            break;
        case 'diamond':
            g.moveTo(cx, y);
            g.lineTo(x + s, cy);
            g.lineTo(cx, y + s);
            g.lineTo(x, cy);
            break;
        case 'drop':
            g.moveTo(cx, y);
            g.quadraticCurveTo(x + s, cy, cx, y + s);
            g.quadraticCurveTo(x, cy, cx, y);
            break;
        case 'leaf':
            g.ellipse(cx, cy, r * 0.6, r, Math.PI / 5, 0, Math.PI * 2);
            break;
        case 'chevron':
            g.moveTo(x, y + s * 0.2);
            g.lineTo(cx, y + s * 0.6);
            g.lineTo(x + s, y + s * 0.2);
            g.lineTo(x + s, y + s * 0.5);
            g.lineTo(cx, y + s);
            g.lineTo(x, y + s * 0.5);
            break;
        default: g.arc(cx, cy, r, 0, Math.PI * 2);
    }
    g.closePath();
    g.fill();
    // the mark: a few strokes, the parody's own
    g.fillStyle = P;
    g.strokeStyle = P;
    g.lineWidth = s * 0.08;
    g.lineCap = 'round';
    const m = logo?.mark;
    g.beginPath();
    if (m === 'bun') {
        g.ellipse(cx, cy - s * 0.06, r * 0.62, r * 0.32, 0, Math.PI, 0);
        g.fill();
        g.fillRect(cx - r * 0.62, cy + s * 0.04, r * 1.24, s * 0.09);
        g.beginPath();
        g.ellipse(cx, cy + s * 0.2, r * 0.6, r * 0.14, 0, 0, Math.PI);
        g.fill();
    }
    else if (m === 'flame' || m === 'chilli') {
        g.moveTo(cx, y + s * 0.15);
        g.quadraticCurveTo(x + s * 0.85, cy, cx, y + s * 0.85);
        g.quadraticCurveTo(x + s * 0.15, cy, cx, y + s * 0.15);
        g.fill();
    }
    else if (m === 'sun' || m === 'clock') {
        g.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
        g.fill();
        if (m === 'clock') {
            g.strokeStyle = S2;
            g.beginPath();
            g.moveTo(cx, cy);
            g.lineTo(cx, cy - r * 0.3);
            g.moveTo(cx, cy);
            g.lineTo(cx + r * 0.22, cy);
            g.stroke();
        }
    }
    else if (m === 'wave' || m === 'river') {
        for (let k = 0; k < 2; k++) {
            g.beginPath();
            g.moveTo(x + s * 0.18, cy + k * s * 0.16 - s * 0.06);
            g.bezierCurveTo(cx - r * 0.3, cy - s * 0.2 + k * s * 0.16, cx + r * 0.3, cy + s * 0.1 + k * s * 0.16, x + s * 0.82, cy - s * 0.06 + k * s * 0.16);
            g.stroke();
        }
    }
    else if (m === 'basket' || m === 'tag') {
        g.fillRect(x + s * 0.26, cy - s * 0.08, s * 0.48, s * 0.3);
        g.beginPath();
        g.arc(cx, cy - s * 0.08, s * 0.18, Math.PI, 0);
        g.stroke();
    }
    else if (m === 'leaf' || m === 'wheat' || m === 'apple') {
        g.ellipse(cx, cy + s * 0.04, r * 0.36, r * 0.5, m === 'apple' ? 0 : 0.6, 0, Math.PI * 2);
        g.fill();
    }
    else if (m === 'spanner' || m === 'roll' || m === 'drumstick' || m === 'slice') {
        g.save();
        g.translate(cx, cy);
        g.rotate(-Math.PI / 4);
        g.fillRect(-r * 0.6, -s * 0.07, r * 1.2, s * 0.14);
        g.beginPath();
        g.arc(r * 0.6, 0, s * 0.14, 0, Math.PI * 2);
        g.fill();
        g.restore();
    }
    else if (m === 'wing' || m === 'bird' || m === 'hen' || m === 'arrow') {
        g.moveTo(x + s * 0.2, cy + s * 0.15);
        g.lineTo(cx, y + s * 0.25);
        g.lineTo(x + s * 0.8, cy + s * 0.15);
        g.lineTo(cx, cy - s * 0.02);
        g.closePath();
        g.fill();
    }
    else {
        g.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
        g.fill();
    }
    g.restore();
}
// a parody's sign face: its colour, its logo, its name
function brandFace(b, k) {
    if (brandTex.has(k))
        return brandTex.get(k);
    const t = canvasTex(512, 256, g => {
        g.fillStyle = b.colours.primary;
        g.fillRect(0, 0, 512, 256);
        g.fillStyle = b.colours.secondary;
        g.fillRect(0, 226, 512, 30);
        drawLogo(g, b.logo, b.colours, 186, 18, 140);
        g.fillStyle = b.colours.text;
        g.font = 'bold 50px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(b.name, 256, 192, 490);
    });
    brandTex.set(k, t);
    return t;
}
const brandMat = (b, k) => { const key = `face${k}`; if (!brandMats.has(key))
    brandMats.set(key, new THREE.MeshLambertMaterial({ map: brandFace(b, k) })); return brandMats.get(key); };
const colourMat = (c) => { if (!brandMats.has(c))
    brandMats.set(c, new THREE.MeshLambertMaterial({ color: c })); return brandMats.get(c); };
// a tile's chains' sites and its buildings' sign bands (lists.shopSigns: [x, y, z, yaw, w, h, brand, name]): the bands
// in one canvas atlas a tile, one draw
export function brandObjects(tile, cfg) {
    const brands = cfg?.brands ?? [], F = tile.lists.furniture?.data, Sg = tile.lists.shopSigns?.data, group = new THREE.Group(), owned = [];
    group.name = 'brands';
    const box = (w, h, d) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); return g; };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const put = (geo, mat, x, y, z, yaw) => { const o = new THREE.Mesh(geo, mat); q.setFromAxisAngle(up, yaw); o.position.set(x, y, z); o.quaternion.copy(q); o.updateMatrix(); o.matrixAutoUpdate = false; o.castShadow = true; group.add(o); owned.push(geo); return o; };
    if (F)
        for (let k = 0; k < F.length; k += FURNITURE_STRIDE) {
            const kind = F[k + 4], b = brands[F[k + 5] | 0];
            if (!b || kind < FURN.pylonSign || kind > FURN.trolleyBay)
                continue;
            const x = F[k], y = F[k + 1], z = F[k + 2], yaw = F[k + 3];
            if (kind === FURN.pylonSign) {
                const h = F[k + 6] || 7;
                put(box(0.25, h - 1.6, 0.25), colourMat('#5b6066'), x - 0.8 * Math.cos(yaw), y, z + 0.8 * Math.sin(yaw), yaw);
                put(box(0.25, h - 1.6, 0.25), colourMat('#5b6066'), x + 0.8 * Math.cos(yaw), y, z - 0.8 * Math.sin(yaw), yaw);
                const face = new THREE.BoxGeometry(2.6, 1.6, 0.35);
                face.translate(0, h - 0.8, 0);
                const mats = [colourMat(b.colours.primary), colourMat(b.colours.primary), colourMat(b.colours.secondary), colourMat(b.colours.secondary), brandMat(b, F[k + 5] | 0), brandMat(b, F[k + 5] | 0)];
                const o = new THREE.Mesh(face, mats);
                q.setFromAxisAngle(up, yaw + Math.PI / 2);
                o.position.set(x, y, z);
                o.quaternion.copy(q);
                o.updateMatrix();
                o.matrixAutoUpdate = false;
                o.castShadow = true;
                group.add(o);
                owned.push(face);
            }
            else if (kind === FURN.canopy) {
                const h = F[k + 6] || 5.2, [W, D] = canopySize(F[k + 7]);
                const roof = new THREE.BoxGeometry(W, 0.7, D);
                roof.translate(0, h + 0.35, 0);
                put(roof, colourMat(b.colours.primary), x, y, z, yaw + Math.PI / 2);
                for (const [a, c] of [[-0.35, -0.3], [0.35, -0.3], [-0.35, 0.3], [0.35, 0.3]]) {
                    const cs = Math.cos(yaw + Math.PI / 2), sn = Math.sin(yaw + Math.PI / 2);
                    put(box(0.4, h, 0.4), colourMat(b.colours.secondary), x + (a * W) * cs + (c * D) * sn, y, z - (a * W) * sn + (c * D) * cs, yaw);
                }
            }
            else if (kind === FURN.pump) {
                put(box(0.9, 1.7, 0.5), colourMat(b.colours.secondary), x, y + 0.15, z, yaw);
                put(box(0.92, 0.25, 0.52), colourMat(b.colours.primary), x, y + 1.55, z, yaw);
                put(box(1.4, 0.15, 3.2), colourMat('#9a9a96'), x, y, z, yaw);
            }
            else if (kind === FURN.menuBoard) {
                put(box(0.15, 1.1, 0.15), colourMat('#3a3d40'), x, y, z, yaw);
                const face = new THREE.BoxGeometry(1.6, 1.3, 0.18);
                face.translate(0, 1.75, 0);
                const o = new THREE.Mesh(face, [colourMat('#222'), colourMat('#222'), colourMat('#222'), colourMat('#222'), brandMat(b, F[k + 5] | 0), colourMat('#222')]);
                q.setFromAxisAngle(up, yaw);
                o.position.set(x, y, z);
                o.quaternion.copy(q);
                o.updateMatrix();
                o.matrixAutoUpdate = false;
                group.add(o);
                owned.push(face);
            }
            else if (kind === FURN.trolleyBay) {
                const roof = new THREE.BoxGeometry(5, 0.1, 2.4);
                roof.translate(0, 2.2, 0);
                put(roof, colourMat(b.colours.primary), x, y, z, yaw);
                for (const [a, c] of [[-2.3, -1.1], [2.3, -1.1], [-2.3, 1.1], [2.3, 1.1]])
                    put(box(0.08, 2.2, 0.08), colourMat('#8d9296'), x + a, y, z + c, yaw);
            }
        }
    // the sign bands: an atlas of them, each its band colour (its chain's, else charcoal), a logo for a chain, the name
    let bands = null, tex = null;
    if (Sg?.length) {
        const names = tile.header.names, n = Sg.length / 8, per = 2, RW = 512, RH = 64, rows = Math.ceil(n / per), H = Math.min(4096, rows * RH);
        const fit = Math.min(n, Math.floor(H / RH) * per);
        tex = canvasTex(RW * per, H, g => {
            for (let s = 0; s < fit; s++) {
                const o = s * 8, bi = Sg[o + 6] | 0, b = bi >= 0 ? brands[bi] : null, x = (s % per) * RW, y = Math.floor(s / per) * RH;
                g.fillStyle = b ? b.colours.primary : '#2b2f33';
                g.fillRect(x, y, RW, RH);
                let tx = x + 12;
                if (b) {
                    drawLogo(g, b.logo, b.colours, x + 6, y + 6, RH - 12);
                    tx = x + RH + 4;
                }
                g.fillStyle = b ? b.colours.text : '#f2efe6';
                g.font = 'bold 38px sans-serif';
                g.textBaseline = 'middle';
                g.fillText(b ? b.name : names[Sg[o + 7]] ?? '', tx, y + RH / 2 + 2, x + RW - tx - 8);
            }
        });
        const pos = [], uv = [], idx = [];
        for (let s = 0; s < fit; s++) {
            const o = s * 8, x = Sg[o], y = Sg[o + 1], z = Sg[o + 2], yaw = Sg[o + 3], w = Sg[o + 4], h = Sg[o + 5];
            const ux = Math.cos(yaw), uz = -Math.sin(yaw), base = pos.length / 3;
            const u0 = (s % per) / per, u1 = u0 + 1 / per, v0 = 1 - (Math.floor(s / per) * RH) / H, v1 = 1 - (Math.floor(s / per) * RH + RH) / H;
            for (const [a, b2] of [[-1, 0], [1, 0], [1, 1], [-1, 1]])
                pos.push(x + ux * a * w / 2, y + b2 * h, z + uz * a * w / 2);
            uv.push(u0, v1, u1, v1, u1, v0, u0, v0);
            idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        g.computeBoundingSphere();
        bands = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
        bands.matrixAutoUpdate = false;
        group.add(bands);
        owned.push(g);
    }
    return {
        group,
        setDetail(d) { group.visible = d < 700; },
        dispose() { for (const g of owned)
            g.dispose(); tex?.dispose(); bands?.material?.dispose?.(); group.removeFromParent(); },
    };
}
