# High Flyer

A browser fighter-jet game where you fly as the Weapons Systems Officer (WSO) in the back seat. You launch off a carrier, dogfight over the ocean, fly a long bombing run through three target areas, fight your way home and land back on the carrier.

There's no build step: it's plain HTML and JavaScript, with Three.js (r128) loaded from a CDN.

## Requirements

- A modern desktop browser with WebGL 2 (Chrome, Edge, Firefox or Safari).
- Python 3, or any other static file server.
- An internet connection, to load Three.js from cdnjs and jsdelivr.

## Run

Serve the folder over HTTP. Don't open `index.html` directly as a file, because the browser blocks parts of the game when it's loaded that way.

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765 and click **BEGIN MISSION**.

Any static server works too, for example `npx serve .`.

If you change the code and the browser still shows the old version, hard-refresh with Cmd+Shift+R (macOS) or Ctrl+Shift+R (Windows and Linux).

### From Claude Code

`.claude/launch.json` defines a `high-flyer` preview server on port 8765, so the game can be opened in the desktop app's browser pane.

## Controls

| Input | Action |
| --- | --- |
| Mouse | Aim the reticle, or the bomb designator in pod view |
| Hold reticle on a bandit | Build a missile lock |
| Left click | Fire a missile (pod view: release a bomb) |
| Space / right mouse | Gun (watch the heat); it can also shoot down missiles |
| F | Flares; best when the **FLARE** cue flashes |
| V | Toggle the targeting pod (bird's-eye view), during the strike |
| G / H | Landing gear and tail hook, on the carrier approach |
| P / Esc | Pause |
| M or the speaker button (top right) | Mute (remembered between visits) |

## Project layout

```
index.html          Page shell, briefing and end screens, CDN script tags
game.js             The whole game: world, models, mission phases, HUD, audio
.claude/launch.json Preview server config for Claude Code
```

## Debugging

`game.js` exposes a couple of hooks in the browser console:

```js
__dbg.skipTo('feetdry')   // jump to a mission phase: ingress, a2a, feetdry, bomb, feetwet, a2a2, approach
__dbg.view('tgp')         // switch view: cockpit, tgp, ext
__S                       // live game state
```
