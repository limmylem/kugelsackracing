// The devlog video (DEVLOG.md): 1080×1920, gameplay in quick cuts, a hook title in the first 2 seconds, big captions
// burned in (inside TikTok's and Reels' safe zone), an end card with the address, and music if there is some.
import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Html5Audio, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { plan } from './timeline.js';

// Where the apps' own buttons and text sit over a vertical video (px of 1080×1920): the captions stay clear of them
export const SAFE = { top: 250, bottom: 480, left: 70, right: 170 };
// (the captions' middle, px from the top)
const CAPTION_Y = 700;
const BRAND = '#e8433a', INK = '#0f141e';
const FONT = '"Barlow Condensed", "Arial Narrow", "Liberation Sans Narrow", "DejaVu Sans Condensed", Impact, sans-serif';

// The game's own typeface (Barlow Condensed, from Google Fonts — free, SIL Open Font License). If it can't be
// fetched, the video still renders, in a system font.
function useBrandFont() {
  const [handle] = useState(() => delayRender('Loading the font', { timeoutInMilliseconds: 20000 }));
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&display=block';
    document.head.appendChild(link);
    const loaded = new Promise(r => { link.onload = r; link.onerror = r; })
      .then(() => Promise.all(['700', '800'].map(w => document.fonts.load(`${w} 100px "Barlow Condensed"`))));
    Promise.race([loaded, new Promise(r => setTimeout(r, 8000))]).catch(() => null).finally(() => continueRender(handle));
  }, [handle]);
}

const outline = (px, color = INK) => ({ WebkitTextStroke: `${px}px ${color}`, paintOrder: 'stroke fill' });

function Footage({ cuts, dim }) {
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      {cuts.map((c, i) => (
        <Sequence key={i} from={c.from} durationInFrames={c.to - c.from} layout="none">
          <Shot cut={c} />
        </Sequence>
      ))}
      <AbsoluteFill style={{ backgroundColor: `rgba(15,20,30,${dim})` }} />
    </AbsoluteFill>
  );
}
function Shot({ cut }) {
  const frame = useCurrentFrame(), n = cut.to - cut.from;
  // (a slow push in on every shot: still footage reads as moving)
  const zoom = interpolate(frame, [0, n], [1.0, 1.06]);
  return (
    <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
      <OffthreadVideo src={staticFile(cut.src)} trimBefore={cut.trimBefore} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </AbsoluteFill>
  );
}

function Hook({ text, kicker, n }) {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 180 } });
  const out = interpolate(frame, [n - 6, n], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: `${SAFE.top}px ${SAFE.right}px ${SAFE.bottom}px ${SAFE.left}px`, opacity: out }}>
      <div style={{ textAlign: 'center', transform: `scale(${0.7 + 0.3 * pop}) rotate(${(1 - pop) * -4}deg)` }}>
        {kicker ? <div style={{ display: 'inline-block', fontFamily: FONT, fontWeight: 800, fontSize: 54, letterSpacing: 4, color: '#fff', background: BRAND, padding: '6px 26px', borderRadius: 14, marginBottom: 30, textTransform: 'uppercase' }}>{kicker}</div> : null}
        <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: fit(text, 128, 84), lineHeight: 1.02, color: '#fff', textTransform: 'uppercase', ...outline(14), textShadow: '0 10px 40px rgba(0,0,0,.55)' }}>{text}</div>
      </div>
    </AbsoluteFill>
  );
}
// (a long line in a smaller size, so it fits in a few lines)
const fit = (text, big, small) => { const n = String(text).length; return n <= 22 ? big : n >= 60 ? small : Math.round(big - (big - small) * (n - 22) / 38); };

function Caption({ text, n }) {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const list = String(text).split(/\s+/).filter(Boolean);
  // word by word: each pops in quickly (all shown within the first 40% of the caption's time)
  const per = Math.max(1, Math.min(4, Math.floor((n * 0.4) / Math.max(1, list.length))));
  const out = interpolate(frame, [n - 4, n], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    // (in the upper half, over the sky: clear of the car below and of the apps' buttons and text)
    <AbsoluteFill style={{ padding: `0 ${SAFE.right}px 0 ${SAFE.left}px`, justifyContent: 'center', alignItems: 'center', top: CAPTION_Y - 960, opacity: out }}>
      <div style={{ textAlign: 'center', fontFamily: FONT, fontWeight: 800, fontSize: fit(text, 96, 72), lineHeight: 1.08, color: '#fff', ...outline(12), textShadow: '0 6px 24px rgba(0,0,0,.6)', maxWidth: 1080 - SAFE.left - SAFE.right }}>
        {list.map((w, i) => {
          const s = spring({ frame: frame - i * per, fps, config: { damping: 14, stiffness: 260 } });
          return <span key={i} style={{ display: 'inline-block', marginRight: '0.24em', transform: `translateY(${(1 - s) * 30}px) scale(${0.85 + 0.15 * s})`, opacity: s > 0.01 ? 1 : 0 }}>{w}</span>;
        })}
      </div>
    </AbsoluteFill>
  );
}

function EndCard({ title, line, n }) {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const inn = spring({ frame, fps, config: { damping: 15 } });
  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(15,20,30,${0.55 * inn}) 0%, rgba(15,20,30,${0.9 * inn}) 100%)`, justifyContent: 'center', alignItems: 'center', padding: `${SAFE.top}px ${SAFE.right}px ${SAFE.bottom}px ${SAFE.left}px` }}>
      <div style={{ textAlign: 'center', transform: `translateY(${(1 - inn) * 80}px)`, opacity: inn }}>
        <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 60, letterSpacing: 6, color: BRAND, textTransform: 'uppercase', marginBottom: 6 }}>Play it free</div>
        <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 112, lineHeight: 1, color: '#fff', whiteSpace: 'nowrap', ...outline(10) }}>{title}</div>
        {line ? <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 56, color: '#fff', marginTop: 34, ...outline(8) }}>{line}</div> : null}
        <div style={{ height: 10, width: interpolate(frame, [0, n * 0.6], [0, 560], { extrapolateRight: 'clamp' }), background: BRAND, borderRadius: 5, margin: '40px auto 0' }} />
      </div>
    </AbsoluteFill>
  );
}

export function Devlog({ script, clips, music, musicVolume = 0.35, kicker = 'Devlog', site = 'ognistrada.com' }) {
  useBrandFont();
  const { fps, durationInFrames } = useVideoConfig();
  const P = plan({ script, clips, fps });
  const fade = f => interpolate(f, [0, fps, durationInFrames - fps * 1.5, durationInFrames], [0, musicVolume, musicVolume, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <Footage cuts={P.cuts} dim={0.08} />
      <Sequence from={P.hook.from} durationInFrames={P.hook.to - P.hook.from}>
        <AbsoluteFill style={{ backgroundColor: 'rgba(15,20,30,.35)' }} />
        <Hook text={script.hook || 'Devlog'} kicker={kicker} n={P.hook.to - P.hook.from} />
      </Sequence>
      {P.captions.map((c, i) => (
        <Sequence key={i} from={c.from} durationInFrames={c.to - c.from}>
          <Caption text={c.text} n={c.to - c.from} />
        </Sequence>
      ))}
      <Sequence from={P.end.from} durationInFrames={P.end.to - P.end.from}>
        <EndCard title={site} line={script.end || 'Race real roads in your browser'} n={P.end.to - P.end.from} />
      </Sequence>
      {music ? <Html5Audio src={staticFile(music)} volume={fade} loop /> : null}
    </AbsoluteFill>
  );
}
