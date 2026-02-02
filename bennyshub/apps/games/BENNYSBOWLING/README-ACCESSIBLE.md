# Benny’s Bowling — Accessible Edition

A community modification of the original “Benny’s Bowling” by iliagrigorevdev, created to support players with severe mobility disabilities through single‑switch controls, clear visuals, and speech feedback. These small games can make a mega difference in someone’s life. We deeply appreciate the work done on the physics engine and other open‑source components that made this possible.

- Original project: https://github.com/iliagrigorevdev/bowling/
- Accessible Edition by NARBEHOUSE, LLC
- Modified: October 2025
- License: GNU GPLv3 (see LICENSE)
- Dedicated to @BEAMINBENNY

## What’s new in this Accessible Edition
- Switch‑access menus: Space scans forward; hold Space ≥3s scans backward every 2s; Enter selects/toggles.
- Position & Aim via Space: 5s oscillation left/right; resumes from where released; thicker aiming guide.
- Charge & Throw via Enter: 0–3s charge with non‑linear power; quick tap = weaker, full hold = strong.
- Text‑to‑Speech: English voices only (up to 8). Speaks menu focus, settings changes (ball style, alley theme), outcomes (“Strike!”), frame announcements, and final score. TTS cancels prior utterances to stay clear.
- Pause: Hold Enter ≥5s or click the on‑screen Pause button; keyboard scanning in Pause Menu (Continue, Settings, Main Menu).
- 1–2 Players: Single Player and Two Player options. Each player chooses a ball style; scores tracked independently. Keyboard scanning works on menus.
- Visuals: retro green/black UI; high‑contrast focus highlight; strike celebration banner.
- Themes: 10 alley themes with animated walls/backdrops and cohesive lighting; alley tint adapts to theme.
- Environment: gutter‑aware floor (center + recessed gutters), aligned side/back walls and scenic backdrop; original alley mesh hidden.
- Pins readability: pins stay bright white with very subtle lighting effects.
- Audio:
  - Ambient loop during gameplay: sound/bowling‑bg.wav (~30% volume).
  - Rolling SFX on throw: sound/rolling‑ball.wav.
  - Per‑pin drop SFX: sound/single‑pin.mp3.
  - Music toggle uses music/music (1).mp3; respects Settings → Music.

## Run locally
Serve the folder over HTTP (some browsers restrict local file access):

```powershell
python -m http.server 8000
```

Open http://localhost:8000/ in your browser.

Ensure the following files exist:
- `music/music (1).mp3`
- `sound/bowling-bg.wav`
- `sound/rolling-ball.wav`
- `sound/single-pin.mp3`

## Accessibility notes
- One‑switch navigation across menus and pause.
- TTS limited to English voices; announces key actions and outcomes.
- High‑contrast focus styling and larger aiming guide.

## Credits and thanks
- Original author: iliagrigorevdev (see upstream repository above).
- Thanks to the authors and maintainers of the physics engine and rendering libraries used by this project.
- Sounds/music per file names in `sound/` and `music/` folders.
- Dedicated to @BEAMINBENNY.

## License
This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License v3. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; see LICENSE for details.

© 2025 NARBEHOUSE, LLC — Modifications  
© Original authors (see upstream repository)
