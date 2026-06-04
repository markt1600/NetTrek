// NetTrek galaxy — 40 planets in 4 sectors
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
  // Mulberry32
  let a = seed >>> 0;
  return function() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePlanet(name, team, x, y, flags, armies) {
  return {
    id: name,
    name,
    team,            // owner team id ("FED" etc.)
    origTeam: team,
    x, y,
    flags,
    armies,
    bombing: false,  // briefly true when bombed
    flashUntil: 0,
  };
}

function generateGalaxy(activeTeams, seed=12345) {
  // 40 planets distributed in 4 quadrants. Teams not active become IND (neutral).
  const r = rng(seed);
  const planets = [];

  for (const team of Object.keys(SECTOR_CENTERS)) {
    const cx = SECTOR_CENTERS[team].x * GALAXY_SIZE;
    const cy = SECTOR_CENTERS[team].y * GALAXY_SIZE;
    const owner = activeTeams.includes(team) ? team : "IND";
    const names = PLANET_NAMES[team];

    // 10 planets in this sector — first is homeworld
    const positions = [];
    for (let i = 0; i < NUM_PLANETS_PER_TEAM; i++) {
      let placed = false;
      for (let attempt = 0; attempt < 80 && !placed; attempt++) {
        const ang = r() * Math.PI * 2;
        const rad = (i === 0 ? 0 : 400 + r() * 1500); // homeworld at center
        const x = cx + Math.cos(ang) * rad;
        const y = cy + Math.sin(ang) * rad;
        // keep clear of other planets
        let ok = true;
        for (const p of positions) {
          if (Math.hypot(p.x - x, p.y - y) < 450) { ok = false; break; }
        }
        // keep clear of galaxy edge
        if (x < 300 || y < 300 || x > GALAXY_SIZE - 300 || y > GALAXY_SIZE - 300) ok = false;
        if (ok) { positions.push({ x, y }); placed = true; }
      }
      if (!placed) positions.push({ x: cx + (i-5)*200, y: cy + (i%2 === 0 ? 200 : -200) });
    }

    // assign flags
    // Homeworld: HOME | FUEL | REPAIR, 30 armies
    // 2 agris (FUEL or REPAIR or none), 6 others have fuel/repair distribution
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

    for (let i = 0; i < NUM_PLANETS_PER_TEAM; i++) {
      const armies = (flagAssign[i] & FLAG_HOME) ? 30 :
                     (flagAssign[i] & FLAG_AGRI) ? 12 + Math.floor(r() * 6) :
                     4 + Math.floor(r() * 8);
      const p = makePlanet(names[i], owner, positions[i].x, positions[i].y, flagAssign[i], armies);
      planets.push(p);
    }
  }
  return planets;
}

function planetGrowRate(p) {
  if (p.team === "IND") return 0;
  return (p.flags & FLAG_AGRI) ? ARMY_GROW_AGRI : ARMY_GROW_BASE;
}

function planetTickGrow(p, dt) {
  if (p.team === "IND") return;
  if (p.armies >= ARMY_PLANET_MAX) return;
  // armies don't grow if planet is being bombed actively (handled elsewhere)
  if (p.armies < 4 && (p.flags & FLAG_HOME) === 0) {
    // depleted planets grow slowly
    p._growBuf = (p._growBuf || 0) + dt * planetGrowRate(p) * 0.3;
  } else {
    p._growBuf = (p._growBuf || 0) + dt * planetGrowRate(p);
  }
  while (p._growBuf >= 1) {
    p.armies = Math.min(ARMY_PLANET_MAX, p.armies + 1);
    p._growBuf -= 1;
  }
}
