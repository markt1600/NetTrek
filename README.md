# NetTrek

A browser-based, single-player survival game inspired by **Netrek** (1988) and **NetTrek** (1985). You command one ship against three rival AI fleets — stay alive, capture planets to grow stronger.

No build step. Pure HTML + JS + CSS, ready to deploy to Vercel as a static site.

## Run locally

Any static file server works. From this folder:

```
# python
python3 -m http.server 8000

# or node
npx serve .
```

Open <http://localhost:8000>.

## Deploy to Vercel

```
npm i -g vercel
vercel              # follow prompts for first deploy
vercel --prod       # promote to production
```

Vercel auto-detects this as a static site (the included `vercel.json` only sets cache headers). You can also drag-and-drop the folder into the Vercel dashboard.

## How to play

Pick a team color, ship class, and difficulty on the start screen. Survive as long as possible; game ends when your 3 lives are gone. Score = kills + captures + seconds survived.

Controls:

- **Right-click** the tactical or galactic map — set course
- **Left-click** an enemy ship — fire phasers
- **0–9** — set warp speed
- **T** — fire torpedo
- **S** — toggle shields
- **O** — orbit nearest planet (must be slow & close)
- **C** — begin capture (orbit + hold for 5 seconds, no enemy within range)
- **Esc** — pause

Each planet you capture gives your team permanent bonuses to maximum hull, shield, fuel, and repair rate. Repair / fuel / agri planets give larger bonuses. The AI fleets capture too — get there first.

## Architecture

All files sit in the project root — no subfolders, drop the whole directory into Vercel and you're done.

- `index.html` — three screens (start, game, end) and an Instructions overlay.
- `style.css` — retro black/CRT-style HUD layout.
- `constants.js` — game tuning: ship classes, planet flags, weapon ranges.
- `galaxy.js` — 40-planet galaxy generation across 4 sectors.
- `ship.js` — ship physics, damage, refit/orbit/army handling.
- `weapons.js` — phasers and torpedoes.
- `ai.js` — team-aware bot behaviour (ogger / bomber / capturer / defender roles).
- `input.js` — mouse + keyboard binding.
- `render.js` — tactical and galactic canvas rendering.
- `ui.js` — HUD, scoreboard, message log.
- `main.js` — bootstrap, game loop, victory check.

## Credits & inspiration

- **Netrek** — Kevin Smith, Scott Silvey, Terence Chang, and many others (1988). <https://en.wikipedia.org/wiki/Netrek>
- **NetTrek** — Randy Carr (Macintosh, 1985–1989). <https://fatlion.com/nettrek/>

This game is not affiliated with either project; it's a small homage built for fun and easy deployment to a static host.
