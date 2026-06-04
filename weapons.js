// Weapons: phasers (instant beam), torpedoes (homing, probabilistic hit)
"use strict";

function firePhaser(s, world, targetShip) {
  if (!s.alive) return false;
  if (s.phaserCool > 0) return false;
  // Phasers offline below the structural-health threshold
  if (s.hull / shipMaxHull(s, world) < SYS_PHASERS_MIN_HULL) return false;
  const def = shipDef(s);
  if (s.energy < def.phaserEnergy) return false;
  if (!targetShip || !targetShip.alive) return false;
  if (targetShip.team === s.team) return false;
  const d = Math.hypot(targetShip.x - s.x, targetShip.y - s.y);
  if (d > def.phaserRange) return false;

  const dmg = def.phaserDmg * (1 - 0.5 * d / def.phaserRange);
  damageShip(targetShip, dmg, s, world);
  s.energy -= def.phaserEnergy;
  s.phaserCool = def.phaserCool;

  world.beams.push({
    fromId: s.id, toX: targetShip.x, toY: targetShip.y,
    fromX: s.x, fromY: s.y, until: world.now + PHASER_VISUAL_TIME,
    color: TEAMS[s.team].color,
  });
  return true;
}

// fireTorp(s, world, ang, target?). If target is provided, the torp is locked
// onto that ship: it will gently home, and its hit outcome is rolled once at
// launch based on distance — 100% at 1 screen, 20% at 5 screens.
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
    vx: Math.cos(a) * def.torpSpeed,
    vy: Math.sin(a) * def.torpSpeed,
    speed: def.torpSpeed,
    dmg: def.torpDmg,
    range: def.torpRange,
    traveled: 0,
    alive: true,
    targetId,
    willHit,
    diverted: false,
  });
  return true;
}

function torpTick(t, world, dt) {
  if (!t.alive) return;

  // Homing: gently turn toward target if alive AND torp is still 'will hit'.
  // Diverted/missing torps fly straight from their last vector so visually pass by.
  if (t.targetId && t.willHit) {
    const target = world.ships.find(s => s.id === t.targetId);
    if (target && target.alive) {
      const desired = Math.atan2(target.y - t.y, target.x - t.x);
      const curr = Math.atan2(t.vy, t.vx);
      let dAng = desired - curr;
      while (dAng > Math.PI) dAng -= 2 * Math.PI;
      while (dAng < -Math.PI) dAng += 2 * Math.PI;
      const maxTurn = TORP_HOMING_TURN * dt;
      const turn = Math.max(-maxTurn, Math.min(maxTurn, dAng));
      const newAng = curr + turn;
      t.vx = Math.cos(newAng) * t.speed;
      t.vy = Math.sin(newAng) * t.speed;
    }
  }

  t.x += t.vx * dt;
  t.y += t.vy * dt;
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
      damageShip(s, t.dmg, owner, world);
      t.alive = false;
      return;
    }
  }
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
