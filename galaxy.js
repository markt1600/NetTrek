// NetTrek galaxy — 40 planets across 4 sectors. Player starts with home only.
"use strict";

const PLANET_NAMES = {
  FED: ["Earth","Vulcan","Andoria","Tellar","Rigel","Deneb","Izar","Centauri","Risa","Betazed"],
  ROM: ["Romulus","Remus","Nequencia","Achernar","Eisn","Praetor","Galorndon","Hellguard","Levaeri","Acamar"],
  KLI: ["Klingus","Qo'noS","Praxis","Mempa","Boreth","Krios","Narendra","Khitomer","Morska","Forcas"],
  ORI: ["Orion","Botchok","Septra","Daros","Verex","Sirius","Procyon","Lyra","Cygnus","Altair"],
};

const SECTOR_CENTERS = {
  FED: { x: 0.25, y: 0.25 },
  ROM: { x: 0.75, y: 0.25 },
  KLI: { x: 0.75, y: 0.75 },
  ORI: { x: 0.25, y: 0.75 },
};

function rng(seed) {
  let a = seed >>> 0;
  return function() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePlanet(name, team, x, y, flags) {
  const hasDefense = (flags & FLAG_HOME) !== 0;
  return {
    id: name,
    name,
    team,
    origTeam: team,
    x, y,
    flags,
    captureBy: null,        // ship id currently capturing
    captureProgress: 0,     // seconds held
    flashUntil: 0,
    // Phaser turret on home planets only — repairs to full if recaptured.
    defenseMaxHull: hasDefense ? PLANET_DEFENSE_HULL : 0,
    defenseHull:    hasDefense ? PLANET_DEFENSE_HULL : 0,
    defenseCool:    0,
    defenseRebuilding: false,   // true while the turret is healing back from 0 hull
  };
}

// Generate the galaxy. Player team starts with only their home planet.
// AI teams each own all 10 of their sector's planets (so they're scary).
function generateGalaxy(playerTeam, seed=12345) {
  const r = rng(seed);
  const planets = [];

  // Build per-team sector centers. The player sits at their canonical corner.
  // Enemy bases are now placed CLOSE to the player so combat starts quickly:
  //   1 enemy home inside short-range radar (~15,000u)
  //   2 enemy homes inside long-range radar (~60,000u)
  const playerSC = SECTOR_CENTERS[playerTeam];
  const px = playerSC.x * GALAXY_SIZE;
  const py = playerSC.y * GALAXY_SIZE;
  const sectorPos = { [playerTeam]: { x: px, y: py } };

  const enemyTeams = TEAM_IDS.filter(t => t !== playerTeam);
  const distances = [
    RADAR_SHORT_RANGE * 0.75,   // close — inside short radar (~11,250u)
    RADAR_LONG_RANGE  * 0.55,   // mid — inside long radar (~33,000u)
    RADAR_LONG_RANGE  * 0.85,   // far — still inside long radar (~51,000u)
  ];
  const baseAngle = r() * Math.PI * 2;
  const sliceAngle = (2 * Math.PI) / enemyTeams.length;
  for (let i = 0; i < enemyTeams.length; i++) {
    const team = enemyTeams[i];
    const ang = baseAngle + i * sliceAngle + (r() - 0.5) * 0.6;
    const dist = distances[i];
    let ex = px + Math.cos(ang) * dist;
    let ey = py + Math.sin(ang) * dist;
    ex = Math.max(3000, Math.min(GALAXY_SIZE - 3000, ex));
    ey = Math.max(3000, Math.min(GALAXY_SIZE - 3000, ey));
    sectorPos[team] = { x: ex, y: ey };
  }

  for (const team of TEAM_IDS) {
    const cx = sectorPos[team].x;
    const cy = sectorPos[team].y;
    const names = PLANET_NAMES[team];

    const positions = [];
    for (let i = 0; i < 10; i++) {
      let placed = false;
      for (let attempt = 0; attempt < 80 && !placed; attempt++) {
        const ang = r() * Math.PI * 2;
        const rad = (i === 0 ? 0 : 400 + r() * 1500);
        const x = cx + Math.cos(ang) * rad;
        const y = cy + Math.sin(ang) * rad;
        let ok = true;
        for (const p of positions) {
          if (Math.hypot(p.x - x, p.y - y) < 450) { ok = false; break; }
        }
        if (x < 300 || y < 300 || x > GALAXY_SIZE - 300 || y > GALAXY_SIZE - 300) ok = false;
        if (ok) { positions.push({ x, y }); placed = true; }
      }
      if (!placed) positions.push({ x: cx + (i-5)*200, y: cy + (i%2 === 0 ? 200 : -200) });
    }

    // Per-planet flags. Homeworld is always REPAIR | FUEL | HOME.
    const flagAssign = [
      FLAG_HOME | FLAG_FUEL | FLAG_REPAIR,
      FLAG_AGRI | FLAG_FUEL,
      FLAG_AGRI | FLAG_REPAIR,
      FLAG_FUEL | FLAG_REPAIR,
      FLAG_FUEL,
      FLAG_REPAIR,
      FLAG_FUEL,
      FLAG_REPAIR,
      0,
      0,
    ];

    for (let i = 0; i < 10; i++) {
      // All teams own their entire sector at start (player included).
      // Bonuses only accrue when you CAPTURE someone else's planet — initial ownership doesn't count.
      planets.push(makePlanet(names[i], team, positions[i].x, positions[i].y, flagAssign[i]));
    }
  }
  return planets;
}

// Bonus contribution from a single planet (used when a team captures it).
function planetBonus(p) {
  const b = emptyBonus();
  b.hull   += BONUS_PER_PLANET.hull;
  b.shield += BONUS_PER_PLANET.shield;
  b.energy += BONUS_PER_PLANET.energy;
  b.repair += BONUS_PER_PLANET.repair;
  for (const flagKey of Object.keys(BONUS_BY_FLAG)) {
    const flag = parseInt(flagKey, 10);
    if (p.flags & flag) {
      const extra = BONUS_BY_FLAG[flag];
      for (const k of Object.keys(extra)) b[k] = (b[k] || 0) + extra[k];
    }
  }
  return b;
}

function emptyBonus() {
  return { hull: 0, shield: 0, energy: 0, repair: 0, recharge: 0 };
}
