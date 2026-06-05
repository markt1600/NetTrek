// AI ship controller — simple, opportunistic.
//
// States:
//   HUNT     — chase + fight nearest enemy
//   CAPTURE  — orbit + capture a nearby enemy/neutral planet
//   FLEE     — head to friendly planet to heal
//   DEFEND   — anchor near home, intercept enemies entering threat range
//
// Each AI re-thinks every ~1s and at state-transition points.
"use strict";

const DEFENDER_PATROL_RADIUS = 8000;   // friendlies stay within this of home
const DEFENDER_THREAT_RANGE  = 30000;  // engage enemies that come this close to home

function initAiState(s) {
  if (s.isPlayer) return;
  if (s.aiState) return;
  s.aiState = { mode: "HUNT", planetTarget: null, lastThink: -999 };
}

function aiTick(s, world, dt) {
  if (s.isPlayer || !s.alive) return;
  initAiState(s);
  const a = s.aiState;
  const def = shipDef(s);

  if (world.now - a.lastThink > 1.0) {
    a.lastThink = world.now;
    // RESCUE persists until the rescue function ends it; allow FLEE to override if hurt.
    if (a.mode === "RESCUE" && s.hull > shipMaxHull(s, world) * 0.3) {
      // keep current RESCUE state
    } else {
      a.mode = aiChooseMode(s, world);
    }
  }

  // FLEE: head to nearest friendly planet (preferably repair/fuel)
  if (a.mode === "FLEE") {
    let target = nearestPlanet(s, world, p => p.team === s.team && (p.flags & (FLAG_REPAIR | FLAG_FUEL)));
    target = target || nearestPlanet(s, world, p => p.team === s.team);
    if (!target) { a.mode = "HUNT"; return; }
    if (s.orbiting === target.id) {
      // sit and heal until full
      if (s.hull >= shipMaxHull(s, world) * 0.9 && s.energy >= shipMaxEnergy(s, world) * 0.7) {
        leaveOrbit(s); a.mode = "HUNT";
      }
      return;
    }
    aiCourseTo(s, target.x, target.y, def.maxSpeed);
    if (Math.hypot(target.x - s.x, target.y - s.y) < ORBIT_RADIUS) {
      s.speed = 1.5;
      tryOrbit(s, world);
      s.shieldsUp = false;
    }
    return;
  }

  // CAPTURE: orbit and hold an enemy/neutral planet
  if (a.mode === "CAPTURE") {
    let target = null;
    if (a.planetTarget) target = world.planets.find(p => p.id === a.planetTarget && p.team !== s.team);
    if (!target) target = pickCaptureTarget(s, world);
    if (!target) { a.mode = "HUNT"; return; }
    a.planetTarget = target.id;

    // If a strong threat is nearby (enemy ship), engage it instead
    const threat = nearestEnemyShip(s, world);
    if (threat && Math.hypot(threat.x - s.x, threat.y - s.y) < def.phaserRange * 1.1) {
      aiEngage(s, world, threat);
      // also still try to orbit if we're at the planet
      if (s.orbiting === target.id) tryBeginCapture(s, world);
      return;
    }

    if (s.orbiting === target.id) {
      // already orbiting capture target — keep capturing
      tryBeginCapture(s, world);
      // if blocked by enemy in danger range, the capture progress just won't tick.
      return;
    }
    aiCourseTo(s, target.x, target.y, def.maxSpeed);
    if (Math.hypot(target.x - s.x, target.y - s.y) < ORBIT_RADIUS) {
      s.speed = 1.5;
      const orbited = tryOrbit(s, world);
      if (orbited && orbited.id === target.id) tryBeginCapture(s, world);
    }
    return;
  }

  // RESCUE: friendly ships answer the player's SOS — fly to the player,
  // engage any enemies in their proximity, hang around briefly if it's quiet.
  if (a.mode === "RESCUE") {
    const target = world.ships.find(o => o.id === a.rescueTarget && o.alive);
    if (!target) { a.mode = "DEFEND"; return; }
    // Any enemy attacking the rescue target?
    let threat = null, bd = Infinity;
    for (const o of world.ships) {
      if (!o.alive || o.team === s.team) continue;
      const d = Math.hypot(o.x - target.x, o.y - target.y);
      if (d < 6000 && d < bd) { threat = o; bd = d; }
    }
    if (threat) {
      a.rescueUntil = Math.max(a.rescueUntil, world.now + 6); // keep going while enemies present
      aiEngage(s, world, threat);
      return;
    }
    // No threats. If timer expired, head home.
    if (world.now > a.rescueUntil) {
      a.mode = "DEFEND";
      if (a.rescueTarget === (world.playerShip && world.playerShip.id)) {
        pushMessage(world, `${s.team} ${s.name}: area clear, returning to base.`);
      }
      return;
    }
    // Quietly circle the protected ship
    const dt = Math.hypot(target.x - s.x, target.y - s.y);
    if (dt > 2500) {
      aiCourseTo(s, target.x, target.y, def.maxSpeed);
    } else {
      const ang = Math.atan2(s.y - target.y, s.x - target.x) + 0.6;
      aiCourseTo(s, target.x + Math.cos(ang) * 1800, target.y + Math.sin(ang) * 1800, def.maxSpeed * 0.5);
    }
    return;
  }

  // DEFEND: friendly ships patrol home and intercept enemies that come close.
  if (a.mode === "DEFEND") {
    const home = world.planets.find(p => p.origTeam === s.team && (p.flags & FLAG_HOME));
    if (!home) { a.mode = "HUNT"; return; }
    // If any enemy is within threat range of home or me, attack it
    let threat = null, bd = Infinity;
    for (const o of world.ships) {
      if (!o.alive || o.team === s.team) continue;
      const dHome = Math.hypot(o.x - home.x, o.y - home.y);
      const dMe   = Math.hypot(o.x - s.x, o.y - s.y);
      const closest = Math.min(dHome, dMe);
      if (closest < DEFENDER_THREAT_RANGE && closest < bd) {
        threat = o; bd = closest;
      }
    }
    if (threat) {
      aiEngage(s, world, threat);
      return;
    }
    // No threat — patrol home (orbit it if we're close, else drift back)
    if (s.orbiting === home.id) {
      // top up while orbiting
      if (s.hull >= shipMaxHull(s, world) * 0.95 && s.energy >= shipMaxEnergy(s, world) * 0.9) {
        leaveOrbit(s);
      }
      return;
    }
    const dHome = Math.hypot(home.x - s.x, home.y - s.y);
    if (dHome > DEFENDER_PATROL_RADIUS) {
      aiCourseTo(s, home.x, home.y, def.maxSpeed);
      if (dHome < ORBIT_RADIUS) {
        s.speed = 1.5;
        tryOrbit(s, world);
      }
    } else {
      // gentle patrol — circle home slowly
      const ang = Math.atan2(s.y - home.y, s.x - home.x) + 0.6;
      aiCourseTo(s, home.x + Math.cos(ang) * 2000, home.y + Math.sin(ang) * 2000, def.maxSpeed * 0.4);
    }
    return;
  }

  // HUNT: chase and fight nearest enemy in scan range
  const t = nearestEnemyShip(s, world);
  if (t) {
    aiEngage(s, world, t);
  } else {
    // No targets in scan — head toward an enemy/neutral planet (gives them something to do)
    const cap = pickCaptureTarget(s, world);
    if (cap) aiCourseTo(s, cap.x, cap.y, def.maxSpeed);
    else aiCourseTo(s, GALAXY_SIZE/2, GALAXY_SIZE/2, def.maxSpeed * 0.6);
  }
}

function aiChooseMode(s, world) {
  // Flee if damaged or low energy
  if (s.hull < shipMaxHull(s, world) * 0.4 || s.energy < shipMaxEnergy(s, world) * 0.25) {
    return "FLEE";
  }

  // Friendly defenders: anchor at the player's home and intercept incoming enemies.
  if (s.team === world.playerTeam) return "DEFEND";

  // Enemy AI — prefer capture; hunt only if an enemy is genuinely close.
  const huntRange = 2200 * (world.aiDifficulty || 1.0);
  const close = nearestEnemyShip(s, world);
  if (close && Math.hypot(close.x - s.x, close.y - s.y) < huntRange) return "HUNT";

  if (pickCaptureTarget(s, world)) return "CAPTURE";
  return "HUNT";
}

// AI's scanning range — they can't see enemies past the long-range scanner distance.
const AI_SCAN_RANGE = RADAR_LONG_RANGE;

function nearestEnemyShip(s, world, maxRange) {
  const cap = maxRange || AI_SCAN_RANGE;
  let best = null, bd = cap;
  for (const o of world.ships) {
    if (!o.alive || o.team === s.team) continue;
    if (o.cloaked) continue;          // cloaked = invisible to AI
    const d = Math.hypot(o.x - s.x, o.y - s.y);
    if (d < bd) { best = o; bd = d; }
  }
  return best;
}

function nearestPlanet(s, world, filter) {
  let best = null, bd = Infinity;
  for (const p of world.planets) {
    if (filter && !filter(p)) continue;
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    if (d < bd) { best = p; bd = d; }
  }
  return best;
}

// Choose an enemy/neutral planet to try to capture. Prefer neutrals first, then enemies.
function pickCaptureTarget(s, world) {
  // Score = -distance, plus bonus for being neutral.
  let best = null, bs = -Infinity;
  for (const p of world.planets) {
    if (p.team === s.team) continue;
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    let score = -d;
    if (p.team === "IND") score += 1500;
    // Avoid planets currently being captured by an enemy ship of equal/greater strength
    if (score > bs) { bs = score; best = p; }
  }
  return best;
}

function tryBeginCapture(s, world) {
  if (s.capturing) return;
  beginCapture(s, world);
}

function aiCourseTo(s, x, y, speed) {
  s.desiredHeading = Math.atan2(y - s.y, x - s.x);
  s.desiredSpeed = speed;
}

function aiEngage(s, world, target) {
  const def = shipDef(s);
  const d = Math.hypot(target.x - s.x, target.y - s.y);
  const ang = Math.atan2(target.y - s.y, target.x - s.x);
  // Occasional combat taunt when actually in firing distance
  if (d < def.phaserRange * 1.5 && typeof maybeChatter === "function") {
    maybeChatter(s, world, "attack", 0.02);
  }

  // Lead for torps
  const leadT = d / TORP_TOP_SPEED;
  const tvx = Math.cos(target.heading) * target.speed * WARP_UNITS;
  const tvy = Math.sin(target.heading) * target.speed * WARP_UNITS;
  const px = target.x + tvx * leadT;
  const py = target.y + tvy * leadT;
  const aimAng = Math.atan2(py - s.y, px - s.x);

  const optRange = def.phaserRange * 0.6;
  if (d > def.phaserRange) {
    s.desiredHeading = ang;
    s.desiredSpeed = def.maxSpeed * (world.aiDifficulty || 1.0);
  } else if (d < optRange * 0.5) {
    s.desiredHeading = ang + Math.PI; // back off
    s.desiredSpeed = def.maxSpeed * 0.6;
  } else {
    s.desiredHeading = ang + 0.4; // flank
    s.desiredSpeed = def.maxSpeed * 0.7 * (world.aiDifficulty || 1.0);
  }

  if (s.orbiting) leaveOrbit(s);

  if (d < def.phaserRange && s.phaserCool === 0 && s.energy > phaserEnergyCost(s, world) * 1.5) {
    firePhaser(s, world, target);
  }
  const facingErr = Math.abs(wrapAngle(aimAng - s.heading));
  // AI can lob torps anywhere on its short-radar; probability rolls at fire time.
  if (d < RADAR_SHORT_RANGE && s.torpCool === 0 && s.torpCount > 0 &&
      s.energy > def.torpEnergy * 1.5 && facingErr < 0.45) {
    fireTorp(s, world, aimAng, target);
  }
}
