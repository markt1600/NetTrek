// NetTrek ship model — physics, state, helpers
"use strict";

function makeShip(opts) {
  const cls = SHIPS[opts.shipClass || "CA"];
  return {
    id: opts.id,
    name: opts.name || "Player",
    team: opts.team,
    isPlayer: !!opts.isPlayer,
    shipClass: cls.id,
    x: opts.x,
    y: opts.y,
    vx: 0, vy: 0,
    heading: opts.heading || 0,     // radians, 0 = east
    desiredHeading: opts.heading || 0,
    speed: 0,                       // current warp factor
    desiredSpeed: 0,                // commanded warp
    fuel: cls.maxFuel,
    shield: cls.maxShield,
    hull: cls.maxHull,
    shieldsUp: true,
    cloaked: false,                 // not implemented but reserved
    orbiting: null,                 // planet id
    bombing: false,
    armies: 0,
    kills: 0,
    score: 0,
    deaths: 0,
    planetsTaken: 0,
    alive: true,
    respawnAt: 0,
    phaserCool: 0,                  // time until phaser ready
    torpCool: 0,
    tractoring: null,               // target ship id
    pressoring: null,
    tracEnergyAccum: 0,
    repairing: false,
    refitting: false,
    refitEndsAt: 0,
    targetLock: null,               // for AI targeting
    aiState: opts.aiState || null,
    aiThinkAt: 0,
    actionCool: 0,                  // shared cool for bomb/beam (per side)
    lastDamageFrom: null,
    deadEffectUntil: 0,
    fireBeam: null,                 // {tx,ty,until,color} for visualization
  };
}

function shipDef(s) { return SHIPS[s.shipClass]; }

function maxSpeedNow(s) {
  const def = shipDef(s);
  // damage reduces max speed
  const dmgFactor = 0.4 + 0.6 * (s.hull / def.maxHull);
  return def.maxSpeed * dmgFactor;
}

function shipTick(s, world, dt) {
  if (!s.alive) {
    if (world.now >= s.respawnAt) respawnShip(s, world);
    return;
  }

  // Refit completion
  if (s.refitting && world.now >= s.refitEndsAt) {
    finishRefit(s);
  }

  // Turning toward desired heading
  const def = shipDef(s);
  let dh = wrapAngle(s.desiredHeading - s.heading);
  const turnStep = def.turnRate * dt;
  if (Math.abs(dh) <= turnStep) s.heading = s.desiredHeading;
  else s.heading += Math.sign(dh) * turnStep;
  s.heading = normAngle(s.heading);

  // Speed control — accel toward desired
  const maxS = maxSpeedNow(s);
  let targetSpeed = Math.min(s.desiredSpeed, maxS);
  if (s.orbiting) targetSpeed = 0;
  // Fuel cost: warp^2 * 2 per second
  const fuelDrain = s.speed * s.speed * 1.6 * dt;
  if (s.fuel < fuelDrain && targetSpeed > 2) targetSpeed = Math.min(targetSpeed, 2);
  if (s.speed < targetSpeed) s.speed = Math.min(targetSpeed, s.speed + def.accel * dt);
  else if (s.speed > targetSpeed) s.speed = Math.max(targetSpeed, s.speed - def.accel * 1.8 * dt);
  s.fuel = Math.max(0, s.fuel - fuelDrain);

  // Movement
  if (s.orbiting) {
    // orbit motion: rotate around planet
    const p = world.planets.find(p => p.id === s.orbiting);
    if (p) {
      let ang = Math.atan2(s.y - p.y, s.x - p.x) + 0.6 * dt;
      s.x = p.x + Math.cos(ang) * ORBIT_RADIUS;
      s.y = p.y + Math.sin(ang) * ORBIT_RADIUS;
      s.heading = ang + Math.PI / 2;
    }
  } else {
    const v = s.speed * WARP_UNITS;
    s.x += Math.cos(s.heading) * v * dt;
    s.y += Math.sin(s.heading) * v * dt;
    s.x = Math.max(20, Math.min(GALAXY_SIZE - 20, s.x));
    s.y = Math.max(20, Math.min(GALAXY_SIZE - 20, s.y));
  }

  // Cooldowns
  s.phaserCool = Math.max(0, s.phaserCool - dt);
  s.torpCool = Math.max(0, s.torpCool - dt);
  s.actionCool = Math.max(0, s.actionCool - dt);

  // Refuel & repair
  let refuelRate = def.refuelBase;
  let repairRate = def.repairBase;
  if (s.orbiting) {
    const p = world.planets.find(p => p.id === s.orbiting);
    if (p && p.team === s.team) {
      if (p.flags & FLAG_FUEL) refuelRate *= 3.0;
      if (p.flags & FLAG_REPAIR) repairRate *= 4.0;
    }
  }
  if (!s.shieldsUp) {
    // refit / repair / refuel boosted when shields down
    refuelRate *= 2.5;
    repairRate *= 2.5;
  }
  s.fuel = Math.min(def.maxFuel, s.fuel + refuelRate * dt);

  // Repair: shields first, then hull. Slow if damaged.
  if (s.shield < def.maxShield) {
    s.shield = Math.min(def.maxShield, s.shield + repairRate * 6 * dt);
  } else if (s.hull < def.maxHull) {
    s.hull = Math.min(def.maxHull, s.hull + repairRate * dt);
  }

  // Tractor / pressor
  if (s.tractoring || s.pressoring) {
    const targetId = s.tractoring || s.pressoring;
    const t = world.ships.find(o => o.id === targetId && o.alive);
    if (!t) { s.tractoring = null; s.pressoring = null; }
    else if (Math.hypot(t.x - s.x, t.y - s.y) > TRACTOR_RANGE) {
      s.tractoring = null; s.pressoring = null;
    } else if (s.fuel < TRACTOR_FUEL * dt) {
      s.tractoring = null; s.pressoring = null;
    } else {
      s.fuel -= TRACTOR_FUEL * dt;
      const ang = Math.atan2(t.y - s.y, t.x - s.x);
      const dir = s.tractoring ? 1 : -1;
      const force = TRACTOR_FORCE * WARP_UNITS * dt;
      // push target along ang (negative for tractor — pulled toward you, so target moves opposite of out-ang)
      t.x -= Math.cos(ang) * force * dir;
      t.y -= Math.sin(ang) * force * dir;
      // also nudge self the other way slightly
      s.x += Math.cos(ang) * force * dir * 0.4;
      s.y += Math.sin(ang) * force * dir * 0.4;
    }
  }
}

function wrapAngle(a) {
  while (a > Math.PI) a -= 2*Math.PI;
  while (a < -Math.PI) a += 2*Math.PI;
  return a;
}
function normAngle(a) {
  while (a > Math.PI) a -= 2*Math.PI;
  while (a < -Math.PI) a += 2*Math.PI;
  return a;
}

function damageShip(s, dmg, source, world) {
  if (!s.alive) return;
  let remaining = dmg;
  if (s.shieldsUp && s.shield > 0) {
    const absorbed = Math.min(s.shield, remaining * 0.66);
    s.shield -= absorbed;
    remaining -= absorbed;
  }
  if (remaining > 0) {
    s.hull -= remaining;
  }
  s.lastDamageFrom = source ? source.id : null;
  if (s.hull <= 0) {
    killShip(s, source, world);
  }
}

function killShip(s, killer, world) {
  if (!s.alive) return;
  s.alive = false;
  s.deaths++;
  s.score += SCORE_DEATH;
  s.respawnAt = world.now + RESPAWN_TIME;
  s.deadEffectUntil = world.now + EXPLOSION_TIME;
  s.armies = 0;   // armies die with ship
  s.kills = 0;    // reset for capture rules
  s.tractoring = null;
  s.pressoring = null;
  s.orbiting = null;

  // Explosion: damage nearby ENEMY ships only (avoid teamkill cascades)
  for (const o of world.ships) {
    if (o === s || !o.alive || o.team === s.team) continue;
    const d = Math.hypot(o.x - s.x, o.y - s.y);
    if (d < EXPLOSION_RADIUS) {
      const dmg = EXPLOSION_DMG * (1 - d / EXPLOSION_RADIUS);
      damageShip(o, dmg, s, world);
    }
  }

  if (killer && killer.alive && killer.team !== s.team) {
    killer.kills += 1;
    killer.score += SCORE_KILL;
  }

  pushMessage(world, `${s.team}: ${s.name} destroyed${killer ? " by " + killer.name + " (" + killer.team + ")" : ""}.`,
    s.isPlayer ? "alert" : (killer && killer.isPlayer ? "you" : ""));
}

function respawnShip(s, world) {
  // Respawn at home planet of team
  const home = world.planets.find(p => p.origTeam === s.team && (p.flags & FLAG_HOME));
  const def = shipDef(s);
  s.alive = true;
  s.hull = def.maxHull;
  s.shield = def.maxShield;
  s.fuel = def.maxFuel;
  s.shieldsUp = true;
  s.speed = 0;
  s.desiredSpeed = 0;
  s.armies = 0;
  s.kills = 0;
  s.refitting = false;
  if (home) {
    const ang = Math.random() * Math.PI * 2;
    s.x = home.x + Math.cos(ang) * ORBIT_RADIUS;
    s.y = home.y + Math.sin(ang) * ORBIT_RADIUS;
    s.heading = ang + Math.PI/2;
    s.desiredHeading = s.heading;
  }
}

function tryOrbit(s, world) {
  if (s.speed > ORBIT_MAX_SPEED) return false;
  let nearest = null, ndist = Infinity;
  for (const p of world.planets) {
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    if (d < ORBIT_RADIUS * 1.4 && d < ndist) { nearest = p; ndist = d; }
  }
  if (!nearest) return false;
  s.orbiting = nearest.id;
  s.speed = 0;
  s.desiredSpeed = 0;
  return nearest;
}

function leaveOrbit(s) { s.orbiting = null; s.bombing = false; }

function startRefit(s, world, newClass) {
  if (!s.orbiting) return false;
  const p = world.planets.find(p => p.id === s.orbiting);
  if (!p || p.team !== s.team) return false;
  if (s.shieldsUp) return false;
  if (!SHIPS[newClass]) return false;
  if (newClass === s.shipClass) return false;
  s.refitting = true;
  s.refitEndsAt = world.now + 4;
  s._refitTo = newClass;
  return true;
}

function finishRefit(s) {
  if (!s._refitTo) { s.refitting = false; return; }
  s.shipClass = s._refitTo;
  const def = shipDef(s);
  s.hull = def.maxHull;
  s.shield = def.maxShield;
  s.fuel = def.maxFuel;
  s.armies = Math.min(s.armies, def.maxArmies);
  s.refitting = false;
  s._refitTo = null;
}

function beamUpArmies(s, world) {
  if (!s.orbiting || s.shieldsUp) return 0;
  if (s.actionCool > 0) return 0;
  const p = world.planets.find(p => p.id === s.orbiting);
  if (!p || p.team !== s.team) return 0;
  const def = shipDef(s);
  const room = def.maxArmies - s.armies;
  // Allow base of 1 carry + 2 per kill
  const allowed = Math.min(1 + s.kills * 2, def.maxArmies);
  const canCarry = Math.max(0, Math.min(room, allowed - s.armies));
  const avail = Math.max(0, p.armies - 4); // leave 4 to defend home
  const take = Math.min(canCarry, avail, 2);  // beam up to 2 at a time
  if (take <= 0) return 0;
  p.armies -= take;
  s.armies += take;
  s.actionCool = 0.6;
  return take;
}

function beamDownArmies(s, world) {
  if (!s.orbiting) return 0;
  if (s.actionCool > 0) return 0;
  const p = world.planets.find(p => p.id === s.orbiting);
  if (!p) return 0;
  if (s.armies <= 0) return 0;
  s.actionCool = 0.7;

  if (p.team === s.team) {
    // reinforce
    const room = ARMY_PLANET_MAX - p.armies;
    const drop = Math.min(s.armies, room, 1);  // 1 at a time
    p.armies += drop;
    s.armies -= drop;
    return drop;
  } else {
    // assault
    let drop = 1;
    if (p.armies === 0) {
      // capture
      const oldTeam = p.team;
      p.team = s.team;
      p.armies = 1;
      s.armies -= 1;
      s.planetsTaken += 1;
      s.score += SCORE_PLANET;
      pushMessage(world, `${s.team}: ${s.name} captured ${p.name} (was ${oldTeam})!`,
        s.isPlayer ? "you" : "");
      return 1;
    } else {
      // contested: each side loses 1
      p.armies -= 1;
      s.armies -= 1;
      return 1;
    }
  }
}

function bombPlanet(s, world) {
  if (!s.orbiting) return 0;
  if (s.actionCool > 0) return 0;
  const p = world.planets.find(p => p.id === s.orbiting);
  if (!p || p.team === s.team) return 0;
  // Cannot bomb below the minimum population
  const MIN_ARMIES_AFTER_BOMB = 2;
  if (p.armies <= MIN_ARMIES_AFTER_BOMB) return 0;
  const killed = Math.min(p.armies - MIN_ARMIES_AFTER_BOMB, 1 + Math.floor(Math.random() * 3));
  if (killed <= 0) return 0;
  p.armies -= killed;
  p.flashUntil = world.now + 0.6;
  s.score += SCORE_BOMB;
  s.actionCool = 0.8;
  return killed;
}
