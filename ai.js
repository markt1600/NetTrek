// AI ship controller — simple, opportunistic.
//
// States:
//   HUNT     — chase + fight nearest enemy
//   CAPTURE  — orbit + capture a nearby enemy/neutral planet
//   FLEE     — head to friendly planet to heal
//
// Each AI re-thinks every ~1s and at state-transition points.
"use strict";

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
    a.mode = aiChooseMode(s, world);
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

  // Default: prefer capture. Only hunt if an enemy is close enough to be a real threat.
  // This keeps the galaxy from collapsing on the player and gives AI teams something
  // productive to do.
  const huntRange = 2200 * (world.aiDifficulty || 1.0);
  const close = nearestEnemyShip(s, world);
  if (close && Math.hypot(close.x - s.x, close.y - s.y) < huntRange) return "HUNT";

  // Otherwise, try to capture something
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

  // Lead for torps
  const leadT = d / def.torpSpeed;
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

  if (d < def.phaserRange && s.phaserCool === 0 && s.energy > def.phaserEnergy * 1.5) {
    firePhaser(s, world, target);
  }
  const facingErr = Math.abs(wrapAngle(aimAng - s.heading));
  // AI can lob torps anywhere on its short-radar; probability rolls at fire time.
  if (d < RADAR_SHORT_RANGE && s.torpCool === 0 && s.torpCount > 0 &&
      s.energy > def.torpEnergy * 1.5 && facingErr < 0.45) {
    fireTorp(s, world, aimAng, target);
  }
}
