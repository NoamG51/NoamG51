# Pose Quest

A free web app that watches your camera and gives one tip at a time to make the photo better: pose, light, angle and framing. When everything looks good, it counts down and takes the photo.

Everything runs on the phone. No photos or video leave the device, and there's no API key or running cost.

## Modes

| Mode | Camera | Checks |
|---|---|---|
| **Solo** | Back | Head cut off, cropping at knees, too much sky, level horizon, backlight and shadows, phone held too high for full-body, stiff arms, square-on body, locked legs, rule of thirds |
| **Selfie** | Front | Phone below the chin, too close (nose distortion) or too far, eyes on the upper third, light on the face, shoulders square-on, eyes closed |
| **Group** | Front | Faces at the edge, gaps between people, one face much bigger, one face in shadow, phone below eye level, 0.5x lens for big groups, eyes closed |

**Game layer:** every problem the coach spots goes on a quest checklist. Fixing one earns XP (pose 20, lighting 15, framing and angle 10, polish 5) with a pop-up, and each photo earns XP from its score (+25 bonus at 85 or above). XP fills levels (Newbie → Snapper → Framer → Pose Pro → Light Chaser → Cover Star → Legend), and taking a photo on consecutive days builds a streak. Progress is saved in the phone's browser only.

**Ghost Pose:** instead of only telling you what to do, the app draws a dotted outline of the target pose or position on top of you. Joints that still need to move glow; once you match the outline it says "✓ Matched" and moves on. Outlines exist for: hand on hip, turning the body, bending the front knee, reframing (head cut off, too much sky, thirds), and selfie/group face position and size. Other tips (mostly lighting) show one line of text and a glowing spot.

**Photo review:** after every photo (auto or manual), a review screen opens with the score, a one-line summary, the fixes for next time in order (numbered on the photo too), what's already working, light and tilt readings, and the change versus your last photo. Retake goes straight back to the camera.

Tips are shown in order: framing, lighting, angle, pose, polish. A tip stays up for at least 2 seconds, shows "✓ Matched" when fixed, and can be skipped. Spoken tips use the phone's built-in voice.

## Put it on your phone (GitHub Pages, free)

1. On GitHub, open this repo → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick the branch with this code and the `/ (root)` folder, then **Save**.
3. After a minute, the page shows the site address, like `https://<username>.github.io/<repo>/`.
4. Open it on your phone. To use it like an app: Safari → Share → *Add to Home Screen* (iPhone), or Chrome → ⋮ → *Add to Home screen* (Android).

The camera only works over HTTPS, which GitHub Pages provides.

## Run it on your computer

```
python3 -m http.server 8000
```

Then open http://localhost:8000. Add `?debug` to the address to reach the app's state from the browser console. To test on a phone you need HTTPS, so GitHub Pages is the easier route.

## How it works

- `js/app.js`: camera, main loop, tip selection, auto-capture, photo viewer.
- `js/analyze.js`: turns MediaPipe body and face landmarks, a small light sample of the frame, and the phone's tilt sensor into simple measurements.
- `js/quest.js`: XP, levels and streak, saved in the browser.
- `js/ghost.js`: builds the target outlines from the person's current position.
- `js/rules.js`: the coaching rulebook. Each rule has a check, a short instruction, a reason, a priority and a score penalty. **Thresholds are first guesses; tune them here.**
- `vendor/mediapipe/`: [MediaPipe Tasks Vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) 0.10.14 (Apache-2.0), bundled so the app doesn't depend on a CDN.
- `models/`: MediaPipe pose (lite) and face landmark models (Apache-2.0).

## Not yet included

Tips that need to understand the scene ("Lean on the fence", "Sit on the steps") need an AI vision model, which costs money per use. For now, use the Pose Coach artifact in Claude for those on a still photo.
