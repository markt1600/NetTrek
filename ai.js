// AI bot controllers — assign each bot a role and run a simple state machine.
"use strict";

// Roles:
//   "OG"  ogger / attacker — hunt ships with armies, or contest contested space
//   "BOMB" bomb runs on enemy planets to reduce armies
//   "CAP" capture runs — load armies at home agri, capture enemy planet
//   "DEF" defender — patrol homeworld, intercept incoming carriers
//
// State machine ticks every ~0.3s with `aiThinkAt`. Each tick chooses targets.

function initAiState(s, world) {
  if (s.isPlayer) return;
  if (s.aiState) return;
  s.aiState = { role: "OG", target: null, planetTarget: null, lastRoleChange: 0 };
}

function aiPickRole(s, world) {
  // Choose role based on team needs.
  const teamPlanets = world.planets.filter(p => p.team === s.team);
  const enemyPlanets = world.planets.filter(p => p.team !== s.team && p.team !== "IND");
  const hasArmies = s.armies > 0;
  const def = shipDef(s);

  // current allocation of teammates
  const teammates = world.ships.filter(o => o.team === s.team && o.alive);
  const counts = { OG:0, BOMB:0, CAP:0, DEF:0 };
  for (const t of teammates) if (t.aiState) counts[t.aiState.role] = (counts[t.aiState.role] || 0) + 1;

  // If currently carrying armies, always CAP
  if (hasArmies) return "CAP";

  // If team has fewer than 4 planets, defend
  if (teamPlanets.length <= 4 && counts.DEF < 1) return "DEF";

  // Ensure at least one BOMB and one CAP if we have enemy planets to take
  if (enemyPlanets.length > 0) {
    if (counts.BOMB < 1) return "BOMB";
    if (counts.CAP < 1 && def.maxArmies > 0) return "CAP";
    // Assault ships are great capturers
    if (def.maxArmies >= 8 && counts.CAP < 2) return "CAP";
    // Second bomber
    if (counts.BOMB < 2) return "BOMB";
  }

  // Else hunt for kills
  return "OG";
}

function nearestEnemyShip(s, world, filter) {
  let best = null, bd = Infinity;
  for (const o of world.ships) {
    if (!o.alive || o.team === s.team) continue;
    if (filter && !filter(o)) continue;
    const d = Math.hypot(o.x - s.x, o.y - s.y);
    if (d < bd) { best = o; bd = d; }
  }
  return best;
}

function nearestFriendlyPlanet(s, world, filter) {
  let best = null, bd = Infinity;
  for (const p of world.planets) {
    if (p.team !== s.team) continue;
    if (filter && !filter(p)) continue;
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    if (d < bd) { best = p; bd = d; }
  }
  return best;
}

function nearestEnemyPlanet(s, world, filter) {
  let best = null, bd = Infinity;
  for (const p of world.planets) {
    if (p.team === s.team || p.team === "IND") continue;
    if (filter && !filter(p)) continue;
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    if (d < bd) { best = p; bd = d; }
  }
  return best;
}

function aiTick(s, world, dt) {
  if (s.isPlayer) return;
  if (!s.alive) return;
  initAiState(s, world);
  const a = s.aiState;
  const def = shipDef(s);

  if (world.now >= s.aiThinkAt) {
    s.aiThinkAt = world.now + 1.0 + Math.random() * 0.5;
    if (s.armies > 0) {
      a.role = "CAP";
    } else {
      a.role = aiPickRole(s, world);
    }
  }

  // Heal mode: if damaged or low fuel, head to friendly fuel/repair planet
  const needHeal = s.hull < def.maxHull * 0.45 || s.fuel < def.maxFuel * 0.25;
  if (needHeal && !s.orbiting) {
    let target = nearestFriendlyPlanet(s, world,
      p => (p.flags & (FLAG_REPAIR | FLAG_FUEL))) ||
      nearestFriendlyPlanet(s, world);
    if (target) {
      aiCourseTo(s, target.x, target.y, def.maxSpeed);
      if (Math.hypot(target.x - s.x, target.y - s.y) < ORBIT_RADIUS * 1.2) {
        tryOrbit(s, world);
        s.shieldsUp = false;
      }
      return;
    }
  }

  if (s.orbiting) {
    const p = world.planets.find(p => p.id === s.orbiting);
    if (!p) { s.orbiting = null; return; }

    // CAP role at our planet: load armies and leave
    if (a.role === "CAP" && p.team === s.team && p.armies > 6) {
      s.shieldsUp = false;
      beamUpArmies(s, world);
      // If full carrying capacity reached, leave for enemy planet
      const cap = Math.min(def.maxArmies, 1 + s.kills * 2);
      if (s.armies >= cap || s.armies >= def.maxArmies) {
        leaveOrbit(s);
        s.shieldsUp = true;
        // Pick the lowest-armies enemy planet we can find — easiest to capture
        let bestEp = null, bestScore = -Infinity;
        for (const pl of world.planets) {
          if (pl.team === s.team || pl.team === "IND") continue;
          const dist = Math.hypot(pl.x - s.x, pl.y - s.y);
          // lower armies + closer = higher score
          const score = -pl.armies * 200 - dist;
          if (score > bestScore) { bestScore = score; bestEp = pl; }
        }
        if (bestEp) a.planetTarget = bestEp.id;
      }
      return;
    }

    // CAP at enemy planet: bomb if too many armies, else drop / capture
    if ((a.role === "CAP" || s.armies > 0) && p.team !== s.team && p.team !== "IND") {
      if (s.armies > 0 && p.armies > s.armies) {
        // bomb down first
        bombPlanet(s, world);
        return;
      }
      if (s.armies > 0) {
        beamDownArmies(s, world);
        if (s.armies <= 0) {
          leaveOrbit(s);
          s.shieldsUp = true;
          a.role = "OG";
        }
        return;
      }
    }

    // BOMB at enemy planet: bomb while possible, else leave to find another planet
    if (a.role === "BOMB" && p.team !== s.team && p.team !== "IND") {
      const minBomb = 2;
      if (p.armies > minBomb) {
        bombPlanet(s, world);
        return;
      } else {
        // Planet bombed down — go find a different planet or hunt for kills
        leaveOrbit(s);
        s.shieldsUp = true;
        a.planetTarget = null;
        a.role = "OG";
      }
    }

    // DEF at our planet: stay & defend until threatened
    if (a.role === "DEF" && p.team === s.team) {
      const threat = nearestEnemyShip(s, world);
      if (threat && Math.hypot(threat.x - s.x, threat.y - s.y) < 3500) {
        leaveOrbit(s);
        s.shieldsUp = true;
      } else {
        return;
      }
    }

    // Refit if Cruiser/Battleship but role is CAP (need Assault)
    if (a.role === "CAP" && p.team === s.team && (p.flags & FLAG_REPAIR)) {
      if (s.shipClass !== "AS" && def.maxArmies < 10) {
        s.shieldsUp = false;
        startRefit(s, world, "AS");
        return;
      }
    }

    // default: leave orbit if nothing to do
    if (s.hull > def.maxHull * 0.85 && s.fuel > def.maxFuel * 0.7) {
      leaveOrbit(s);
      s.shieldsUp = true;
    } else {
      return;
    }
  }

  // Non-orbiting behavior
  if (a.role === "DEF") {
    const home = nearestFriendlyPlanet(s, world, p => p.flags & FLAG_HOME) || nearestFriendlyPlanet(s, world);
    const threat = nearestEnemyShip(s, world);
    if (threat && Math.hypot(threat.x - s.x, threat.y - s.y) < 4000) {
      aiEngage(s, world, threat);
    } else if (home) {
      aiCourseTo(s, home.x, home.y, def.maxSpeed * 0.7);
      if (Math.hypot(home.x - s.x, home.y - s.y) < ORBIT_RADIUS * 1.2) {
        s.speed = 1.5;
        tryOrbit(s, world);
      }
    }
    return;
  }

  if (a.role === "OG") {
    // hunt closest enemy ship; prefer carriers
    const carrier = nearestEnemyShip(s, world, o => o.armies > 0);
    const target = carrier || nearestEnemyShip(s, world);
    if (target) aiEngage(s, world, target);
    return;
  }

  if (a.role === "BOMB") {
    let ep;
    if (a.planetTarget) ep = world.planets.find(p => p.id === a.planetTarget && p.team !== s.team && p.team !== "IND");
    if (!ep) ep = nearestEnemyPlanet(s, world, p => p.armies > 4);
    if (!ep) ep = nearestEnemyPlanet(s, world);
    if (!ep) return;
    a.planetTarget = ep.id;
    // Engage interceptors if close
    const threat = nearestEnemyShip(s, world);
    if (threat && Math.hypot(threat.x - s.x, threat.y - s.y) < 1500) {
      aiEngage(s, world, threat);
    } else {
      aiCourseTo(s, ep.x, ep.y, def.maxSpeed);
      if (Math.hypot(ep.x - s.x, ep.y - s.y) < ORBIT_RADIUS) {
        s.speed = 1.5;
        if (tryOrbit(s, world)) {
          // immediate first bomb
        }
      }
    }
    return;
  }

  if (a.role === "CAP") {
    // need armies — if none, go to friendly planet with armies
    if (s.armies === 0) {
      const fp = nearestFriendlyPlanet(s, world, p => p.armies > 8 && (p.flags & FLAG_REPAIR));
      const fp2 = fp || nearestFriendlyPlanet(s, world, p => p.armies > 8);
      const target = fp2 || nearestFriendlyPlanet(s, world);
      if (!target) return;
      aiCourseTo(s, target.x, target.y, def.maxSpeed);
      if (Math.hypot(target.x - s.x, target.y - s.y) < ORBIT_RADIUS) {
        s.speed = 1.5;
        tryOrbit(s, world);
      }
    } else {
      // carrying armies — head to enemy planet
      let ep;
      if (a.planetTarget) ep = world.planets.find(p => p.id === a.planetTarget);
      if (!ep || ep.team === s.team) ep = nearestEnemyPlanet(s, world, p => p.armies < 5) || nearestEnemyPlanet(s, world);
      if (!ep) return;
      a.planetTarget = ep.id;
      // dodge threats
      const threat = nearestEnemyShip(s, world);
      if (threat && Math.hypot(threat.x - s.x, threat.y - s.y) < 1800) {
        // try to keep distance; still head to target
        aiCourseTo(s, ep.x, ep.y, def.maxSpeed);
        // fire phaser if very close
        if (Math.hypot(threat.x - s.x, threat.y - s.y) < shipDef(s).phaserRange) firePhaser(s, world, threat);
      } else {
        aiCourseTo(s, ep.x, ep.y, def.maxSpeed);
      }
      if (Math.hypot(ep.x - s.x, ep.y - s.y) < ORBIT_RADIUS) {
        s.speed = 1.5;
        tryOrbit(s, world);
      }
    }
    return;
  }
}

function aiCourseTo(s, x, y, speed) {
  s.desiredHeading = Math.atan2(y - s.y, x - s.x);
  s.desiredSpeed = speed;
}

function aiEngage(s, world, target) {
  const def = shipDef(s);
  const d = Math.hypot(target.x - s.x, target.y - s.y);
  const ang = Math.atan2(target.y - s.y, target.x - s.x);

  // Predict torp lead a little
  const leadT = d / def.torpSpeed;
  const px = target.x + (target.vx || Math.cos(target.heading) * target.speed * WARP_UNITS) * leadT;
  const py = target.y + (target.vy || Math.sin(target.heading) * target.speed * WARP_UNITS) * leadT;
  const aimAng = Math.atan2(py - s.y, px - s.x);

  // Maintain optimal range = 60% phaser range
  const optRange = def.phaserRange * 0.6;
  if (d > def.phaserRange) {
    // approach
    s.desiredHeading = ang;
    s.desiredSpeed = def.maxSpeed * world.aiDifficulty;
  } else if (d < optRange * 0.5) {
    // back off slightly — but still fight
    s.desiredHeading = ang;
    s.desiredSpeed = def.maxSpeed * 0.5;
  } else {
    // flank/circle
    s.desiredHeading = ang + 0.5;
    s.desiredSpeed = def.maxSpeed * 0.7 * world.aiDifficulty;
  }

  // Phaser if in range
  if (d < def.phaserRange && s.phaserCool === 0 && s.fuel > def.phaserFuel * 1.5) {
    firePhaser(s, world, target);
  }
  // Torp if facing close enough
  const facingErr = Math.abs(wrapAngle(aimAng - s.heading));
  if (d < def.torpRange * 0.7 && s.torpCool === 0 && s.fuel > def.torpFuel * 1.5 && facingErr < 0.4) {
    fireTorp(s, world, aimAng);
  }
}
