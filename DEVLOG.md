# Devlog videos

A short vertical video for TikTok and Instagram Reels, made almost by itself. You get:

- **20–45 seconds, 1080×1920 (vertical).** The game being driven on a race track, cutting between camera angles
  every couple of seconds. With multiplayer on, a second car ("Rival") races alongside, so you can see it's online.
- **A big title in the first 2 seconds** (the hook), **large captions burned in** (placed clear of the apps' buttons
  and text), and **an end card with ognistrada.com**.
- **The script drafted for you** from this week's commits, in a casual devlog voice. You can change it.
- **The post's caption with hashtags**, ready to paste.

It costs nothing: GitHub runs it for free (the repository is public), and every tool it uses is free. Nothing in the
game or on its servers changes.

## Make this week's video (in your browser, nothing to install)

1. Open **github.com/limmylem/kugelsackracing → Actions → devlog** (in the list on the left).
2. Click **Run workflow** (on the right), leave the boxes as they are, and click the green **Run workflow** button.
3. Wait about **40 minutes**. You can close the page. Want to read the script while it films? Click the run: it's on
   the run's page (the summary) after a couple of minutes.
4. When the run has a green tick, open it, scroll down to **Artifacts** and click **devlog-video**. You get a zip with:
   - `devlog-YYYY-MM-DD.mp4`: the video
   - `post.txt`: the caption and hashtags for the post
   - `script.txt`: the words used in the video
5. Watch the video. If you like it, upload the MP4 to TikTok or Instagram and paste in `post.txt`.

That's it. The run also marks this week's devlog (a git tag `devlog-YYYY-MM-DD`), so next week's script starts with
the commits after it.

## Change the words

Don't like the script? Run it again with your own words. **It skips the filming, so it takes about 5 minutes.**

1. Copy the run ID of the run you just did: the number at the end of its page's address
   (`…/actions/runs/`**`12345678901`**).
2. **Actions → devlog → Run workflow**, and fill in:
   - **Your script**: the hook first, then each caption, with `|` between them. For example:
     `My racing game has SOUND now | Every engine revs on its own audio thread | Tyres squeal when you push | END: Race real roads in your browser`
   - **Skip the filming**: the run ID you copied.
3. **Run workflow**, then download **devlog-video** as before.

Tips: keep the hook under about 8 words and each caption under about 12. Four to six captions make a 20–45 second
video (more, and the last ones are left out; the run's summary says so).

## Music (optional)

- **Easiest:** leave it out and add a sound in the TikTok or Instagram app when you post. Their music is licensed for
  use there.
- **Your own track:** put a direct `https://` link to an MP3 or M4A in **Background music** (for example a Dropbox
  link ending `?dl=1`). Only use music you have the right to use. No music comes with the tool, and none is ever
  saved in the repository.

## The other boxes

| Box | What it does |
|---|---|
| Film the live site / this commit's game | **live** (default) films ognistrada.com as players see it. **local** films the game as it is in the repository, even before it's deployed. |
| A second car joins | On (default): a second car races in the same private room. On the live site both cars use the load-test token (`LOADTEST_TOKEN`, already in the repository's secrets): made-up guests "Bot 190" and "Bot 191", never anyone's account, and nothing they do counts. If the token isn't there, it films one car and says so. |
| Mark this as this week's devlog | On (default): tags the commit `devlog-YYYY-MM-DD`. Turn it off for a test run. |

## Change what it films

`devlog/capture/shots.json` lists the shots: the track (a generated track's code: the game's **Track** world or
`dev/tracks.html` makes them), and for each shot when it starts (seconds into the lap), how long it is, and the camera
(`chase`, `bonnet`, `cockpit`, `side`, `high`). Shots marked `"multiplayer": true` are filmed with the second car.
Set `"names": true` to show the players' names over the cars.

## On your own computer (optional)

You need [Node.js 22](https://nodejs.org) and git. In a terminal:

```sh
git clone https://github.com/limmylem/kugelsackracing.git
cd kugelsackracing/devlog
npm ci
npx playwright install chromium

npm run draft                          # drafts out/script.txt: open it and edit the words
npm run make -- --target live          # films ognistrada.com, then makes out/devlog-<date>.mp4 and out/post.txt
npm run make -- --target live --reuse-clips --music ~/Music/my-track.mp3   # new words or music, without filming again
```

To film the repository's own game instead (`--target local`), run `npm ci` in the repository's folder first.
`--multiplayer` adds the second car (on the live site it needs `LOADTEST_TOKEN` set in your terminal; never paste it
into a chat). `--quick` does a fast, small test run. `npm run studio` opens Remotion's editor to see the template.

Everything it makes goes in `devlog/out/`, which git ignores: videos and music are never committed.

## How it works

- **Filming** (`devlog/capture/capture.mjs`): a headless Chromium opens the game at phone size, drops into a
  generated race track, and the game's own autopilot drives the lap. GitHub's computers have no graphics card, so the
  game draws about one frame a second: instead of recording in real time, the tool runs the game one frame at a time
  (1/30 of a second each) and takes a picture of each frame, so the footage is smooth. The game's buttons and panels
  are hidden by the tool, without changing the game. The second car is a second browser window, run in step with the
  first.
- **The script** (`devlog/script/draft.mjs`): the commit subjects since the last `devlog-*` tag (or the last 7 days),
  with behind-the-scenes work (deploys, tests, docs, the servers) left out and the player-facing changes rewritten as
  short captions. Plain rules, no AI service.
- **The video** (`devlog/remotion/`): a [Remotion](https://www.remotion.dev) template. Remotion is free for
  individuals and for companies of up to 3 people; a bigger company needs its company licence.
- **The workflow** (`.github/workflows/devlog.yml`): only ever runs when you click **Run workflow**.
