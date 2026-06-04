# NetTrek

A browser-based, single-player tribute to **Netrek** (1988) and **NetTrek** (1985) — a top-down team-vs-team space combat / strategy game in which you and AI teammates try to capture every enemy planet.

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

Pick a team, difficulty, and game length on the start screen. The goal is to capture every enemy planet for your team. You command one ship and 3 AI teammates; each enemy team has 4 AI bots.

Quick controls (full reference is on the **Instructions** screen):

- **Right-click** the tactical map (left) or galactic map (right) — set course toward that point
- **Left-click** an enemy ship — fire phasers (instant beam, costs fuel)
- **0–9** — set warp speed
- **T** — fire torpedo toward your last clicked point / current heading
- **S** — toggle shields. Shields must be DOWN to beam armies up or to refit.
- **O** — orbit nearest planet (must be slow & close)
- **B** — bomb enemy planet you're orbiting (kills armies)
- **X / Z** — beam armies up / down
- **R** — cycle to next ship class while orbiting a friendly planet, shields down
- **Y / U / I** — tractor / pressor beam on the ship you're hovering / release
- **Esc** — pause

You need **kills** before you can carry armies (max armies you can carry = `kills × 2`, up to your ship's capacity). Drop armies onto an enemy planet with 0 armies to capture it.

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
