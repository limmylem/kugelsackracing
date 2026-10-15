// Photo mode (Phase 8 Step 4; docs/PHOTO_MODE.md): in free roam, races, replays and meets — the game holds still
// (the world pauses where it can; in an online race your car coasts with nothing pressed) and a free camera flies
// round your car: WASD or the left stick to move, the mouse (drag) or the right stick to look, Q and E (or the
// triggers) down and up, the wheel or the bumpers to zoom. The panel: focus and depth of field (the distance in focus,
// how blurred the rest is), exposure, a filter, the time of day, the field of view and tilt, and hide the HUD (H).
// Photos: saved to the device, shared (the system's share sheet where there is one), or kept on the profile (a small
// copy). A short clip: the next few seconds of what's drawn (a replay playing, or the free camera), as a video file.
//
//   const P = createPhotoMode({ THREE, renderer, game, t })
//   game: { scene(), camera() (the game's camera now), target() (the car's position [x,y,z]), hours(), setHours(h),
//           pause(on), render(scene, camera) (the game's own drawing), canHoldStill (bool), place() (where: for the
//           photo's caption), api (account: to keep it on the profile) }
//   P.open() / P.close() / P.frame(seconds, input) → true while it's drawing / P.capture() → Blob

import { t as tr, esc } from '../ui/i18n.js';
import { trapFocus, announce } from '../ui/accessibility.js';

// colour filters as 4×5 matrices (rows: r, g, b, a; columns: r, g, b, a, offset 0..1) — the same on the screen (an SVG
// filter) and in the saved photo (on its pixels), so what you see is what's saved
export const FILTERS = {
  none: null,
  warm: [[1.08, 0.04, 0, 0, 0.02], [0.02, 1.02, 0, 0, 0.01], [0, 0, 0.88, 0, 0], [0, 0, 0, 1, 0]],
  cool: [[0.9, 0, 0, 0, 0], [0, 1.0, 0.04, 0, 0], [0, 0.04, 1.12, 0, 0.02], [0, 0, 0, 1, 0]],
  mono: [[0.3, 0.59, 0.11, 0, 0], [0.3, 0.59, 0.11, 0, 0], [0.3, 0.59, 0.11, 0, 0], [0, 0, 0, 1, 0]],
  sepia: [[0.393, 0.769, 0.189, 0, 0], [0.349, 0.686, 0.168, 0, 0], [0.272, 0.534, 0.131, 0, 0], [0, 0, 0, 1, 0]],
  vivid: [[1.3, -0.15, -0.15, 0, 0], [-0.15, 1.3, -0.15, 0, 0], [-0.15, -0.15, 1.3, 0, 0], [0, 0, 0, 1, 0]],
  film: [[0.95, 0.08, 0, 0, 0.03], [0.02, 0.92, 0.04, 0, 0.03], [0, 0.06, 0.82, 0, 0.06], [0, 0, 0, 1, 0]],
  night: [[0.6, 0.2, 0.1, 0, 0], [0.1, 0.8, 0.2, 0, 0], [0.1, 0.3, 1.0, 0, 0.03], [0, 0, 0, 1, 0]],
};
// a filter on an image's pixels (ImageData, in place)
export function applyFilter(data, name) {
  const M = FILTERS[name];
  if (!M) return data;
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, a = d[i + 3] / 255;
    for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, Math.round(255 * (M[k][0] * r + M[k][1] * g + M[k][2] * b + M[k][3] * a + M[k][4]))));
  }
  return data;
}
export const DEFAULT_PHOTO = { focus: 8, aperture: 0, exposure: 1, filter: 'none', fov: 50, roll: 0, hours: null, hideHud: true };
export const MAX_RANGE = 80;          // (the free camera stays this close to the car: it's a photographer, not a spy)

export function createPhotoMode({ THREE, renderer, game, t = tr, clipSeconds = 8 }) {
  const el = document.createElement('div');
  el.id = 'photoMode'; el.hidden = true;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-labelledby', 'photoTitle');
  document.body.append(el);
  const svgFilter = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgFilter.setAttribute('width', '0'); svgFilter.setAttribute('height', '0'); svgFilter.style.position = 'absolute';
  svgFilter.innerHTML = '<filter id="photoFilter"><feColorMatrix type="matrix" values=""/></filter>';
  document.body.append(svgFilter);
  let on = false, S = { ...DEFAULT_PHOTO }, cam = null, yaw = 0, pitch = 0, release = null, composer = null, bokeh = null, savedExposure = 1, savedHours = null, recording = null;
  const keys = new Set();
  const view = () => game.camera();

  function open() {
    if (on) return;
    on = true;
    const g = view();
    cam = new THREE.PerspectiveCamera(g.fov, innerWidth / innerHeight, 0.05, g.far);
    cam.position.copy(g.position); cam.quaternion.copy(g.quaternion);
    const e = new THREE.Euler().setFromQuaternion(g.quaternion, 'YXZ');
    yaw = e.y; pitch = e.x;
    S = { ...S, fov: g.fov, hours: game.hours?.() ?? null };
    savedExposure = renderer.toneMappingExposure; savedHours = S.hours;
    game.pause?.(true);
    document.body.classList.add('photoMode');
    applyHud();
    el.hidden = false; draw();
    release = trapFocus(el, { onEscape: close });
    announce(t('photo.opened'));
  }
  function close() {
    if (!on) return;
    on = false;
    renderer.toneMappingExposure = savedExposure;
    if (savedHours != null && S.hours !== savedHours) game.setHours?.(savedHours);
    renderer.domElement.style.filter = '';
    document.body.classList.remove('photoMode', 'photoHideHud');
    game.pause?.(false);
    el.hidden = true; release?.(); release = null;
  }
  const applyHud = () => document.body.classList.toggle('photoHideHud', !!S.hideHud && on);
  function applyFilterCss() {
    const M = FILTERS[S.filter];
    svgFilter.querySelector('feColorMatrix').setAttribute('values', M ? M.flat().join(' ') : '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0');
    renderer.domElement.style.filter = M ? 'url(#photoFilter)' : '';
  }
  const row = (k, min, max, step, shown) => `<div class="slider"><label for="ph-${k}">${t(`photo.${k}`)}</label><input type="range" id="ph-${k}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${S[k]}" aria-valuetext="${esc(shown)}"><output for="ph-${k}">${esc(shown)}</output></div>`;
  function draw() {
    el.innerHTML = `<div class="head"><h2 id="photoTitle">${t('photo.title')}</h2><button type="button" class="close" data-a="close" aria-label="${t('photo.close')}">×</button></div>
      <p class="help">${t('photo.help')}</p>
      ${row('focus', 1, 60, 0.5, `${S.focus} m`)}${row('aperture', 0, 1, 0.05, S.aperture ? `${Math.round(S.aperture * 100)}%` : t('photo.sharp'))}
      ${row('exposure', 0.3, 2.5, 0.05, `${S.exposure.toFixed(2)}×`)}${row('fov', 15, 100, 1, `${Math.round(S.fov)}°`)}${row('roll', -30, 30, 1, `${S.roll}°`)}
      ${S.hours != null && game.setHours ? row('hours', 0, 24, 0.25, `${String(Math.floor(S.hours)).padStart(2, '0')}:${String(Math.round((S.hours % 1) * 60)).padStart(2, '0')}`) : ''}
      <div class="slider"><label for="ph-filter">${t('photo.filter')}</label><select id="ph-filter" data-k="filter">${Object.keys(FILTERS).map(f => `<option value="${f}" ${S.filter === f ? 'selected' : ''}>${t(`photo.filters.${f}`)}</option>`).join('')}</select></div>
      <div class="row"><input type="checkbox" id="ph-hud" data-k="hideHud" ${S.hideHud ? 'checked' : ''}><label for="ph-hud">${t('photo.hideHud')}</label></div>
      <div class="buttons"><button type="button" data-a="save">${t('photo.save')}</button><button type="button" data-a="share">${t('photo.share')}</button>
        ${game.api ? `<button type="button" data-a="profile">${t('photo.profile')}</button>` : ''}
        ${typeof MediaRecorder !== 'undefined' ? `<button type="button" data-a="clip">${recording ? t('photo.recording') : t('photo.clip', { s: clipSeconds })}</button>` : ''}</div>
      <p class="status" role="status"></p>`;
  }
  const say = text => { const s = el.querySelector('.status'); if (s) s.textContent = text; announce(text); };
  el.addEventListener('input', e => {
    const x = e.target, k = x.dataset.k;
    if (!k) return;
    S[k] = x.type === 'checkbox' ? x.checked : x.tagName === 'SELECT' ? x.value : +x.value;
    if (k === 'hours') game.setHours?.(S.hours);
    if (k === 'hideHud') applyHud();
    if (k === 'filter') applyFilterCss();
    if (x.type === 'range') { const o = x.nextElementSibling; o.textContent = k === 'focus' ? `${S.focus} m` : k === 'exposure' ? `${S.exposure.toFixed(2)}×` : k === 'fov' ? `${Math.round(S.fov)}°` : k === 'roll' ? `${S.roll}°` : k === 'aperture' ? (S.aperture ? `${Math.round(S.aperture * 100)}%` : t('photo.sharp')) : o.textContent; }
  });
  el.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'close') return close();
    try {
      if (a === 'save') { const blob = await capture(); download(blob, `ognistrada-${stamp()}.jpg`); say(t('photo.saved')); }
      if (a === 'share') { const blob = await capture(); await share(blob); }
      if (a === 'profile') { const small = await capture({ maxWidth: 960, maxBytes: 200_000 }); await game.api.post('/player/photos', { image: await dataUrl(small), place: game.place?.() ?? undefined }); say(t('photo.kept')); }
      if (a === 'clip') { if (!recording) await clip(); }
    } catch (err) { say(t('photo.failed', { why: err.message ?? String(err) })); }
  });
  addEventListener('keydown', e => {
    if (!on || e.target.closest?.('#photoMode input, #photoMode select')) return;
    keys.add(e.code);
    if (e.code === 'KeyH') { S.hideHud = !S.hideHud; applyHud(); draw(); }
  });
  addEventListener('keyup', e => keys.delete(e.code));
  let drag = null;
  renderer.domElement.addEventListener('pointerdown', e => { if (on) { drag = { x: e.clientX, y: e.clientY }; renderer.domElement.setPointerCapture?.(e.pointerId); } });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointermove', e => { if (!on || !drag) return; yaw -= (e.clientX - drag.x) * 0.004; pitch = Math.max(-1.45, Math.min(1.45, pitch - (e.clientY - drag.y) * 0.004)); drag = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('wheel', e => { if (on) { e.preventDefault(); S.fov = Math.max(15, Math.min(100, S.fov + Math.sign(e.deltaY) * 2)); } }, { passive: false });

  // the free camera, then the picture (with depth of field when there's any blur)
  function frame(seconds) {
    if (!on) return false;
    const pad = navigator.getGamepads?.()?.find(p => p);
    const ax = i => { const v = pad?.axes?.[i] ?? 0; return Math.abs(v) < 0.15 ? 0 : v; };
    const speed = (keys.has('ShiftLeft') ? 12 : 4) * seconds;
    const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - ax(1);
    const side = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + ax(0);
    const up = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0) + (pad?.buttons?.[7]?.value ?? 0) - (pad?.buttons?.[6]?.value ?? 0);
    yaw -= ax(2) * 2 * seconds; pitch = Math.max(-1.45, Math.min(1.45, pitch - ax(3) * 2 * seconds));
    if (pad?.buttons?.[4]?.pressed) S.fov = Math.min(100, S.fov + 30 * seconds);
    if (pad?.buttons?.[5]?.pressed) S.fov = Math.max(15, S.fov - 30 * seconds);
    cam.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, S.roll * Math.PI / 180, 'YXZ'));
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    cam.position.addScaledVector(dir, fwd * speed).addScaledVector(right, side * speed).y += up * speed;
    // (kept near the car, and above the ground the car's on)
    const tgt = game.target?.();
    if (tgt) {
      const c = new THREE.Vector3(...tgt), off = cam.position.clone().sub(c);
      if (off.length() > MAX_RANGE) cam.position.copy(c.add(off.setLength(MAX_RANGE)));
      cam.position.y = Math.max(cam.position.y, tgt[1] - 1.2);
    }
    cam.fov = S.fov; cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
    renderer.toneMappingExposure = S.exposure;
    render();
    return true;
  }
  async function ensureComposer() {
    if (composer) return;
    const [{ EffectComposer }, { RenderPass }, { BokehPass }, { OutputPass }] = await Promise.all([import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'), import('three/addons/postprocessing/BokehPass.js'), import('three/addons/postprocessing/OutputPass.js')]);
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(game.scene(), cam));
    bokeh = new BokehPass(game.scene(), cam, { focus: S.focus, aperture: 0.0001, maxblur: 0.012 });
    composer.addPass(bokeh); composer.addPass(new OutputPass());
  }
  let composerLoading = null;
  function render() {
    if (S.aperture > 0) {
      if (!composer) { composerLoading ??= ensureComposer(); game.render(game.scene(), cam); return; }
      composer.passes[0].scene = game.scene(); composer.passes[0].camera = cam;
      bokeh.camera = cam; bokeh.scene = game.scene();
      bokeh.uniforms.focus.value = S.focus; bokeh.uniforms.aperture.value = S.aperture * 0.0008; bokeh.uniforms.maxblur.value = 0.004 + 0.016 * S.aperture;
      bokeh.uniforms.aspect.value = cam.aspect;
      composer.setSize(innerWidth, innerHeight);
      composer.render();
    } else game.render(game.scene(), cam);
  }
  // the picture now, with its filter: a JPEG (at most maxWidth wide, and under maxBytes when asked)
  async function capture({ maxWidth = 2560, maxBytes = null } = {}) {
    render();
    const src = renderer.domElement, k = Math.min(1, maxWidth / src.width);
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0, c.width, c.height);
    if (FILTERS[S.filter]) g.putImageData(applyFilter(g.getImageData(0, 0, c.width, c.height), S.filter), 0, 0);
    let q = 0.92, blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
    while (maxBytes && blob.size > maxBytes && q > 0.35) { q -= 0.12; blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q)); }
    game.track?.('photo', 'capture', { filter: S.filter, dof: S.aperture > 0 });
    return blob;
  }
  async function share(blob, name = `ognistrada-${stamp()}.jpg`) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: t('photo.shareTitle') }); game.track?.('share', 'photo'); return; }
    download(blob, name); say(t('photo.savedNoShare'));
  }
  // a clip: the next few seconds of what's drawn, as a video (WebM or MP4, whichever this browser records)
  async function clip() {
    const stream = renderer.domElement.captureStream(30);
    const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(x => MediaRecorder.isTypeSupported?.(x)) ?? '';
    const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6e6 } : undefined), parts = [];
    recording = rec; draw(); say(t('photo.recording'));
    rec.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
    const done = new Promise(r => { rec.onstop = r; });
    rec.start(500);
    // (the game moves again while it records — a replay plays on, the world carries on — the free camera stays)
    game.pause?.(false);
    await new Promise(r => setTimeout(r, clipSeconds * 1000));
    rec.stop(); await done;
    game.pause?.(on);
    recording = null; draw();
    const blob = new Blob(parts, { type: rec.mimeType || 'video/webm' }), ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
    game.track?.('photo', 'clip', { seconds: clipSeconds });
    await share(blob, `ognistrada-${stamp()}.${ext}`);
  }
  return { el, open, close, frame, capture, get on() { return on; }, get settings() { return S; } };
}
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const dataUrl = blob => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
