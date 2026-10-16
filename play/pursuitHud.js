// A co-op pursuit's panel on screen (docs/PURSUIT.md; a solo pursuit's is play/questUi.js pursuitPanel): the shared
// heat, what the police are doing (after you, the cooldown's time left, escaped), your bust meter, your state (busted:
// back in N s, or watching), the mission (who has the goods; your drop), and the party. Drawn from the race room's word.
//
//   const H = createPursuitHud()   H.show(view)   H.hide()   H.dispose()
//     view: { level, maxHeat, phase, cooldown, bust, seen, units, score, coop: { kind, me, carrier, mine, players }, names(uid) }

import { t } from '../ui/i18n.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createPursuitHud() {
  let el = null;
  const ensure = () => {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'pursuitHud';
    el.style.cssText = 'position:fixed;top:70px;left:18px;z-index:45;background:rgba(14,18,26,.6);color:#fff;border-radius:10px;padding:8px 12px;min-width:170px;font:600 14px Barlow,system-ui,sans-serif;pointer-events:none';
    document.body.appendChild(el);
    return el;
  };
  return {
    show(v) {
      const E = ensure(), C = v.coop, me = C?.me;
      const lights = [1, 2, 3, 4, 5].map(n => `<span style="display:inline-block;width:14px;height:14px;margin-right:3px;border-radius:3px;background:${n <= v.level ? (n >= 4 ? '#ff3b4a' : '#ff9f1a') : n <= v.maxHeat ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.05)'}"></span>`).join('');
      const K = v.cooldown;
      const state = v.phase === 'escaped' ? `<div style="font-size:24px;color:#7ee08a">${t('pursuit.escaped')}</div>`
        : v.phase === 'cooldown' && K ? `<div style="font-size:24px;color:#ffbd4a">${t('pursuit.cooldown', { s: Math.ceil(K.left) })}</div><div style="font-size:12px">${t('pursuit.leaveArea')}</div>`
          : `<div style="font-size:24px;color:#ff5a5f">${t(v.seen ? 'pursuit.inPursuit' : 'pursuit.losing')}</div>`;
      const bust = v.bust > 0.02 && v.phase === 'pursuit' && me?.state === 'active' ? `<div style="height:6px;background:rgba(255,255,255,.15);border-radius:3px;margin:4px 0"><i style="display:block;height:100%;width:${Math.round(v.bust * 100)}%;background:#ff3b4a;border-radius:3px"></i></div>` : '';
      const mine = me?.state === 'respawning' ? `<div style="color:#ff7a6a">${t('pursuit.coopRespawn', { s: Math.ceil(me.respawnIn ?? 0) })}</div>` : me?.state === 'spectating' ? `<div style="color:#ff7a6a">${t('pursuit.coopWatching')}</div>` : me?.state === 'arrived' ? `<div style="color:#7ee08a">${t('pursuit.coopArrived')}</div>` : '';
      const goods = C?.kind === 'getaway' ? `<div style="font-size:12px">${C.mine ? t('pursuit.coopYouCarry') : C.carrier ? t('pursuit.coopCarrier', { name: esc(v.names(C.carrier)) }) : t('pursuit.coopDropped')}</div>` : '';
      const party = (C?.players ?? []).map(p => `<div style="font-size:12px;opacity:${p.state === 'active' || p.state === 'arrived' ? 1 : 0.55}">${esc(v.names(p.id))}${p.id === C.carrier ? ' ★' : ''} · ${t(`pursuit.coopState.${p.state}`)}</div>`).join('');
      E.innerHTML = `<div style="font-size:12px;opacity:.8">${t('pursuit.heat', { n: v.level })}</div><div>${lights}</div>${state}${bust}${mine}${goods}<div style="font-size:12px;margin-top:4px">${t('pursuit.units', { n: v.units, score: Math.round(v.score ?? 0).toLocaleString('en-GB') })}</div><div style="margin-top:4px">${party}</div>`;
      E.style.display = '';
    },
    hide() { if (el) el.style.display = 'none'; },
    dispose() { el?.remove(); el = null; },
  };
}
