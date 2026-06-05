// Weapons: phasers (instant beam), torpedoes (homing, probabilistic hit)
"use strict";

function firePhaser(s, world, targetShip) {
  if (!s.alive) return false;
  if (s.phaserCool > 0) return false;
  if (s.hull / shipMaxHull(s, world) < SYS_PHASERS_MIN_HULL) return false;
  const def = shipDef(s);
  const cost = phaserEnergyCost(s, world);
  if (s.energy < cost) return false;
  if (!targetShip || !targetShip.alive) return false;
  if (targetShip.team === s.team) return false;
  const d = Math.hypot(targetShip.x - s.x, targetShip.y - s.y);
  if (d > def.phaserRange) return false;

  const dmg = def.phaserDmg * (1 - 0.5 * d / def.phaserRange);
  damageShip(targetShip, dmg, s, world, "phaser");
  s.energy -= cost;
  s.phaserCool = def.phaserCool;

  world.beams.push({
    fromId: s.id, toX: targetShip.x, toY: targetShip.y,
    fromX: s.x, fromY: s.y, until: world.now + PHASER_VISUAL_TIME,
    color: TEAMS[s.team].color,
  });
  if (typeof fxFromShip === "function") fxFromShip(s, world, playPhaserSound);
  return true;
}

// fireTorp(s, world, ang, target?). If target is provided, the torp is locked
// onto that ship: it will gently home, and its hit outcome is rolled once at
// launch based on distance — 100% close-in, 20% at the far edge of short radar.
function fireTorp(s, world, ang, target) {
  if (!s.alive) return false;
  if (s.torpCool > 0) return false;
  if (s.torpCount <= 0) return false;
  // Torpedo bays offline below the structural-health threshold
  if (s.hull / shipMaxHull(s, world) < SYS_TORPS_MIN_HULL) return false;
  const def = shipDef(s);
  if (s.energy < def.torpEnergy) return false;
  s.energy -= def.torpEnergy;
  s.torpCount -= 1;
  s.torpCool = def.torpCool;
  if (s.torpReloadAt <= world.now) s.torpReloadAt = world.now + def.torpReloadTime;
  const a = (ang === undefined) ? s.heading : ang;

  let willHit = true;
  let targetId = null;
  if (target) {
    const d = Math.hypot(target.x - s.x, target.y - s.y);
    willHit = Math.random() < torpHitProbability(d);
    targetId = target.id;
  }

  world.torps.push({
    id: world.nextTorpId++,
    ownerId: s.id,
    team: s.team,
    x: s.x + Math.cos(a) * 20,
    y: s.y + Math.sin(a) * 20,
    heading: a,
    speed: TORP_INITIAL_SPEED,
    maxSpeed: TORP_TOP_SPEED,
    accel: TORP_ACCEL,
    dmg: def.torpDmg,
    range: def.torpRange,
    traveled: 0,
    alive: true,
    targetId,
    willHit,
    diverted: false,
  });
  if (typeof fxFromShip === "function") fxFromShip(s, world, playTorpSound);
  return true;
}

function torpTick(t, world, dt) {
  if (!t.alive) return;

  // Accelerate up to top speed (warp 5)
  if (t.speed < t.maxSpeed) {
    t.speed = Math.min(t.maxSpeed, t.speed + t.accel * dt);
  }

  // Homing: gently turn toward target if alive AND torp is still 'will hit'.
  if (t.targetId && t.willHit) {
    const target = world.ships.find(s => s.id === t.targetId);
    if (target && target.alive) {
      const desired = Math.atan2(target.y - t.y, target.x - t.x);
      let dAng = desired - t.heading;
      while (dAng > Math.PI) dAng -= 2 * Math.PI;
      while (dAng < -Math.PI) dAng += 2 * Math.PI;
      const maxTurn = TORP_HOMING_TURN * dt;
      t.heading += Math.max(-maxTurn, Math.min(maxTurn, dAng));
    }
  }

  const vx = Math.cos(t.heading) * t.speed;
  const vy = Math.sin(t.heading) * t.speed;
  t.x += vx * dt;
  t.y += vy * dt;
  t.traveled += t.speed * dt;
  if (t.traveled > t.range) { t.alive = false; return; }
  if (t.x < 0 || t.y < 0 || t.x > GALAXY_SIZE || t.y > GALAXY_SIZE) { t.alive = false; return; }

  // Collision: damage only if (no target) or (target with willHit) or (collateral
  // hit on a non-target enemy that we happen to fly into).
  for (const s of world.ships) {
    if (!s.alive || s.team === t.team) continue;
    const def = shipDef(s);
    const r = def.radius + 12;
    if (Math.hypot(s.x - t.x, s.y - t.y) < r) {
      // Diverted/miss torp targeting THIS ship passes through harmlessly.
      if (t.targetId === s.id && !t.willHit) continue;
      const owner = world.ships.find(o => o.id === t.ownerId);
      damageShip(s, t.dmg, owner, world, "torp");
      t.alive = false;
      return;
    }
  }
}

// Directional phaser — fires a beam in the direction of (wx,wy).
// Hits the first enemy ship along the ray within phaserRange. Even with no
// target hit, the energy is spent and the visual beam is drawn.
function firePhaserAt(s, world, wx, wy) {
  if (!s.alive) return false;
  if (s.phaserCool > 0) return false;
  if (s.hull / shipMaxHull(s, world) < SYS_PHASERS_MIN_HULL) return false;
  const def = shipDef(s);
  const cost = phaserEnergyCost(s, world);
  if (s.energy < cost) return false;

  const ang = Math.atan2(wy - s.y, wx - s.x);
  const cosA = Math.cos(ang), sinA = Math.sin(ang);
  let hit = null, hitDist = def.phaserRange;
  for (const o of world.ships) {
    if (!o.alive || o.team === s.team) continue;
    const dx = o.x - s.x, dy = o.y - s.y;
    const along = dx * cosA + dy * sinA;
    if (along <= 0 || along > def.phaserRange) continue;
    const perp = Math.abs(-dx * sinA + dy * cosA);
    if (perp > shipDef(o).radius + 14) continue;
    if (along < hitDist) { hit = o; hitDist = along; }
  }
  const endX = s.x + cosA * hitDist;
  const endY = s.y + sinA * hitDist;

  if (hit) {
    const dmg = def.phaserDmg * (1 - 0.5 * hitDist / def.phaserRange);
    damageShip(hit, dmg, s, world, "phaser");
  }
  s.energy -= cost;
  s.phaserCool = def.phaserCool;
  world.beams.push({
    fromId: s.id, fromX: s.x, fromY: s.y,
    toX: endX, toY: endY, until: world.now + PHASER_VISUAL_TIME,
    color: TEAMS[s.team].color,
  });
  if (typeof fxFromShip === "function") fxFromShip(s, world, playPhaserSound);
  return true;
}

function phaserBestTarget(s, world) {
  const def = shipDef(s);
  let best = null, bd = Infinity;
  for (const o of world.ships) {
    if (!o.alive || o.team === s.team) continue;
    const d = Math.hypot(o.x - s.x, o.y - s.y);
    if (d < def.phaserRange && d < bd) { best = o; bd = d; }
  }
  return best;
}
