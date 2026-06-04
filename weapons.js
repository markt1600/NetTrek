// Weapons: phasers (instant beam), torpedoes (projectiles)
"use strict";

function firePhaser(s, world, targetShip) {
  if (!s.alive) return false;
  if (s.phaserCool > 0) return false;
  const def = shipDef(s);
  if (s.fuel < def.phaserFuel) return false;
  if (!targetShip || !targetShip.alive) return false;
  if (targetShip.team === s.team) return false;
  const d = Math.hypot(targetShip.x - s.x, targetShip.y - s.y);
  if (d > def.phaserRange) return false;

  // Damage scales with distance (linear falloff)
  const dmg = def.phaserDmg * (1 - 0.5 * d / def.phaserRange);
  damageShip(targetShip, dmg, s, world);
  s.fuel -= def.phaserFuel;
  s.phaserCool = def.phaserCool;

  world.beams.push({
    fromId: s.id, toX: targetShip.x, toY: targetShip.y,
    fromX: s.x, fromY: s.y, until: world.now + PHASER_VISUAL_TIME,
    color: TEAMS[s.team].color,
  });
  return true;
}

function fireTorp(s, world, ang) {
  if (!s.alive) return false;
  if (s.torpCool > 0) return false;
  const def = shipDef(s);
  if (s.fuel < def.torpFuel) return false;
  s.fuel -= def.torpFuel;
  s.torpCool = def.torpCool;
  const a = (ang === undefined) ? s.heading : ang;
  world.torps.push({
    id: world.nextTorpId++,
    ownerId: s.id,
    team: s.team,
    x: s.x + Math.cos(a) * 20,
    y: s.y + Math.sin(a) * 20,
    vx: Math.cos(a) * def.torpSpeed,
    vy: Math.sin(a) * def.torpSpeed,
    dmg: def.torpDmg,
    range: def.torpRange,
    traveled: 0,
    alive: true,
  });
  return true;
}

function torpTick(t, world, dt) {
  if (!t.alive) return;
  t.x += t.vx * dt;
  t.y += t.vy * dt;
  t.traveled += Math.hypot(t.vx, t.vy) * dt;
  if (t.traveled > t.range) { t.alive = false; return; }
  if (t.x < 0 || t.y < 0 || t.x > GALAXY_SIZE || t.y > GALAXY_SIZE) { t.alive = false; return; }

  // collide with ships
  for (const s of world.ships) {
    if (!s.alive || s.team === t.team) continue;
    const def = shipDef(s);
    const r = def.radius + 12;
    if (Math.hypot(s.x - t.x, s.y - t.y) < r) {
      const owner = world.ships.find(o => o.id === t.ownerId);
      damageShip(s, t.dmg, owner, world);
      t.alive = false;
      return;
    }
  }
}

// Phaser auto-pick: closest in-range enemy (player uses click target)
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
