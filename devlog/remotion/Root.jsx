// The compositions (Remotion): "Devlog", 1080×1920 at 30 fps; its length comes from the script (remotion/timeline.js);
// "Trailer", 1920×1080 (remotion/Trailer.jsx)
import React from 'react';
import { Composition } from 'remotion';
import { Devlog } from './Devlog.jsx';
import { plan } from './timeline.js';
import { Trailer } from './Trailer.jsx';
import { trailerPlan } from './trailerPlan.js';

// (what the studio shows before anything's been captured: npm run studio)
const example = {
  script: { hook: 'My racing game has sound now', captions: ['Every engine revs on its own audio thread', 'Tyres squeal when you push too hard', 'Race your friends online'], end: 'Race real roads in your browser' },
  clips: [], music: null,
};

export const Root = () => (
  <>
  <Composition
    id="Devlog"
    component={Devlog}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={30 * 20}
    defaultProps={example}
    calculateMetadata={({ props }) => ({ durationInFrames: plan({ script: props.script, clips: props.clips, fps: 30 }).frames })}
  />
  {/* the trailer (docs/RELEASE.md; trailer/make.mjs): 1920×1080, its length from its clips */}
  <Composition
    id="Trailer"
    component={Trailer}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={30 * 10}
    defaultProps={{ clips: [], music: null }}
    calculateMetadata={({ props }) => ({ durationInFrames: trailerPlan({ clips: props.clips, fps: 30 }).frames })}
  />
  </>
);
