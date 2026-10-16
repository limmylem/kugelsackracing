// The game's trailer (docs/RELEASE.md "Trailer"; devlog/trailer/make.mjs): 1920×1080, about 40 seconds. The logo and
// "Race the real world" over the first city; real cities driven by the game's autopilot, each named, with the map's
// credit while a real place is on screen; the race tracks and another player online; a caption now and then; an end
// card with the address. The game's own sound from the clips, and its own music (rendered by the game's music code,
// audio/music.js) under it all, building as it goes.
import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Html5Audio, Img, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { trailerPlan } from './trailerPlan.js';

const RED = '#e3121e', INK = '#050506';
const FONT = '"Barlow Condensed", "Arial Narrow", "Liberation Sans Narrow", "DejaVu Sans Condensed", Impact, sans-serif';

function useBrandFont() {
  const [handle] = useState(() => delayRender('Loading the font', { timeoutInMilliseconds: 20000 }));
  useEffect(() => {
    const faces = [['700', 'fonts/barlow-condensed-latin-700-normal.woff2'], ['800', 'fonts/barlow-condensed-latin-800-normal.woff2']];
    Promise.all(faces.map(([weight, file]) => new FontFace('Barlow Condensed', `url(${staticFile(file)}) format("woff2")`, { weight }).load().then(f => document.fonts.add(f)).catch(() => null)))
      .finally(() => continueRender(handle));
  }, [handle]);
}
const shadow = { textShadow: '0 4px 24px rgba(0,0,0,.65), 0 2px 4px rgba(0,0,0,.6)' };

function Shot({ cut, gameVolume, total }) {
  const frame = useCurrentFrame(), n = cut.to - cut.from;
  // (a slow push in: still moments read as moving)
  const zoom = interpolate(frame, [0, n], [1.0, 1.05]);
  // (the clip's own sound eased in and out at each cut: no click; the whole film's faded at its ends)
  const volume = f => { const edge = Math.min(1, (f + 1) / 3, (n - f) / 3), at = cut.from + f; return Math.max(0, gameVolume * edge * Math.min(1, at / 15, (total - at) / 45)); };
  // (a quick fade from black at each cut: softer than a hard cut, quick enough to keep the pace)
  const inFade = interpolate(frame, [0, 4], [1, 0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        <OffthreadVideo src={staticFile(cut.src)} trimBefore={cut.trimBefore} muted={!cut.sound || !gameVolume} volume={cut.sound ? volume : 0} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: INK, opacity: inFade }} />
    </AbsoluteFill>
  );
}

// the place's name, low on the left; and the map's credit, small, low on the right (OpenStreetMap's licence)
function Place({ name, n }) {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const s = spring({ frame: frame - 4, fps, config: { damping: 16 } }), out = interpolate(frame, [n - 6, n], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', padding: '0 0 90px 110px', opacity: out }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, transform: `translateX(${(1 - s) * -60}px)`, opacity: s }}>
        <div style={{ width: 10, height: 84, background: RED, borderRadius: 4 }} />
        <div>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 30, letterSpacing: 6, color: '#fff', opacity: 0.85, textTransform: 'uppercase', ...shadow }}>Real roads</div>
          <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 72, lineHeight: 1, color: '#fff', textTransform: 'uppercase', ...shadow }}>{name}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
const Credit = () => (
  <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'flex-end', padding: '0 28px 22px 0' }}>
    <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 20, color: '#fff', opacity: 0.8, ...shadow }}>Map data © OpenStreetMap contributors</div>
  </AbsoluteFill>
);

function Caption({ text, n }) {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14, stiffness: 200 } }), out = interpolate(frame, [n - 6, n], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: 110, opacity: out }}>
      <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 86, lineHeight: 1.05, color: '#fff', textAlign: 'center', textTransform: 'uppercase', maxWidth: 1500, transform: `translateY(${(1 - s) * 30}px)`, opacity: s, WebkitTextStroke: '8px rgba(5,5,6,.85)', paintOrder: 'stroke fill', ...shadow }}>{text}</div>
    </AbsoluteFill>
  );
}

function Title({ n }) {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 13, stiffness: 120 } }), line = spring({ frame: frame - 18, fps, config: { damping: 16 } });
  const out = interpolate(frame, [n - 8, n], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', background: `rgba(5,5,6,${0.55 * out})`, opacity: out }}>
      <Img src={staticFile('trailer/logo.png')} style={{ width: 760, transform: `scale(${0.8 + 0.2 * pop})`, opacity: pop }} />
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 52, letterSpacing: 14, color: '#fff', marginTop: 10, opacity: line, textTransform: 'uppercase', ...shadow }}>In your browser · Free</div>
    </AbsoluteFill>
  );
}

function EndCard({ site, line, small, n }) {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const inn = spring({ frame, fps, config: { damping: 16 } });
  return (
    <AbsoluteFill style={{ background: `rgba(5,5,6,${0.92 * inn})`, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', opacity: inn, transform: `translateY(${(1 - inn) * 50}px)` }}>
        <Img src={staticFile('trailer/logo.png')} style={{ width: 560 }} />
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 46, letterSpacing: 8, color: RED, textTransform: 'uppercase', marginTop: 18 }}>{line}</div>
        <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 104, color: '#fff', lineHeight: 1.1 }}>{site}</div>
        <div style={{ height: 8, width: interpolate(frame, [0, n * 0.5], [0, 520], { extrapolateRight: 'clamp' }), background: RED, borderRadius: 4, margin: '26px auto 22px' }} />
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 34, letterSpacing: 4, color: '#b8bcc3', textTransform: 'uppercase' }}>{small}</div>
      </div>
    </AbsoluteFill>
  );
}

export function Trailer({ clips, music, musicVolume = 0.75, gameVolume = 0.55, site = 'ognistrada.com', line = 'Play free in your browser', small = 'Closed beta · Rated 13+ · Map data © OpenStreetMap contributors' }) {
  useBrandFont();
  const { fps, durationInFrames } = useVideoConfig();
  const P = trailerPlan({ clips, fps });
  const fade = f => interpolate(f, [0, fps * 0.5, durationInFrames - fps * 2, durationInFrames], [0, musicVolume, musicVolume, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      {P.cuts.map((c, i) => (
        <Sequence key={i} from={c.from} durationInFrames={c.to - c.from} layout="none">
          <Shot cut={c} gameVolume={gameVolume} total={durationInFrames} />
          {c.place && c.from >= P.title.to ? <Place name={c.place} n={c.to - c.from} /> : null}
          {c.place ? <Credit /> : null}
        </Sequence>
      ))}
      {P.captions.map((c, i) => (
        <Sequence key={`c${i}`} from={c.from} durationInFrames={c.to - c.from}>
          <Caption text={c.text} n={c.to - c.from} />
        </Sequence>
      ))}
      <Sequence from={P.title.from} durationInFrames={P.title.to - P.title.from}><Title n={P.title.to - P.title.from} /></Sequence>
      <Sequence from={P.end.from} durationInFrames={P.end.to - P.end.from}><EndCard site={site} line={line} small={small} n={P.end.to - P.end.from} /></Sequence>
      {music ? <Html5Audio src={staticFile(music)} volume={fade} /> : null}
    </AbsoluteFill>
  );
}
