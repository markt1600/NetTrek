// NetTrek ship model — physics, energy, torpedoes, shields, target lock, captures
"use strict";

function makeShip(opts) {
  const cls = SHIPS[opts.shipClass || "CA"];
  return {
    id: opts.id,
    name: opts.name || "Ship",
    team: opts.team,
    isPlayer: !!opts.isPlayer,
    shipClass: cls.id,
    x: opts.x,
    y: opts.y,
    vx: 0, vy: 0,
    heading: opts.heading || 0,
    desiredHeading: opts.heading || 0,
    speed: 0,
    desiredSpeed: 0,

    // Resources
    energy: cls.maxEnergy,
    shield: cls.maxShield,
    hull: cls.maxHull,
    shieldsUp: true,
    shieldCollapsedUntil: 0,    // shields can't be raised before this time
    cloaked: false,             // cloak: invisible + invulnerable, but no fire

    // Torps
    torpCount: cls.torpMax,
    torpReloadAt: 0,            // time of next torp reload tick

    // Flares (torpedo defense) — per-ship capacity, Demi God carries 20×
    flareCount: cls.flareMax || FLARE_MAX,

    // Targeting
    targetLock: null,           // ship id of locked target (combat lock)
    selectedPlanet: null,       // planet id the player has selected for info / autopilot
    autoPilot: null,            // { type: "ship"|"planet", id, speed } — head-to autopilot
    pendingPhaserShot: null,    // { targetX, targetY, until } — fires when in PHASER_CONE

    // Orbit / capture
    orbiting: null,
    capturing: false,
    captureProgress: 0,
    captureTarget: null,

    // Stats
    kills: 0,
    score: 0,
    deaths: 0,
    planetsTaken: 0,

    // Lifecycle
    alive: true,
    respawnAt: 0,
    deadEffectUntil: 0,

    // Combat cooldowns
    phaserCool: 0,
    torpCool: 0,

    // AI
    aiState: opts.aiState || null,
    aiThinkAt: 0,

    lastDamageFrom: null,
  };
}

function shipDef(s) { return SHIPS[s.shipClass]; }

// Effective stats = base + team bonus from captured planets.
function shipMaxHull(s, world) {
  return shipDef(s).maxHull + (world.teamBonus[s.team] ? world.teamBonus[s.team].hull : 0);
}
function shipMaxShield(s, world) {
  const base = shipDef(s).maxShield + (world.teamBonus[s.team] ? world.teamBonus[s.team].shield : 0);
  // Cadet difficulty: player ship only gets a shield multiplier (default 1×)
  return s.isPlayer ? base * (world.playerShieldMult || 1) : base;
}
function shipMaxTorps(s, world) {
  const base = shipDef(s).torpMax;
  return s.isPlayer ? Math.floor(base * (world.playerTorpMult || 1)) : base;
}
function shipMaxFlares(s, world) {
  const base = shipDef(s).flareMax || FLARE_MAX;
  return s.isPlayer ? Math.floor(base * (world.playerFlareMult || 1)) : base;
}
function shipMaxEnergy(s, world) {
  return shipDef(s).maxEnergy + (world.teamBonus[s.team] ? world.teamBonus[s.team].energy : 0);
}
function shipRepairRate(s, world) {
  const b = world.teamBonus[s.team] || {};
  return shipDef(s).repairBase * (1 + (b.repair || 0));
}
function shipRechargeRate(s, world) {
  const b = world.teamBonus[s.team] || {};
  return shipDef(s).rechargeBase * (1 + (b.recharge || 0));
}

function maxSpeedNow(s, world) {
  const def = shipDef(s);
  const dmgFactor = 0.4 + 0.6 * (s.hull / shipMaxHull(s, world));
  return def.maxSpeed * dmgFactor;
}

function shipTick(s, world, dt) {
  if (!s.alive) {
    if (world.now >= s.respawnAt) respawnShip(s, world);
    return;
  }

  // --- Auto-Lock & Navigate: only acts on contacts CONFIRMED as enemy, i.e.
  // those inside short-radar range (the only range at which IFF is clear). ---
  if (s.isPlayer && world.autoLockAndNavigate) {
    const cur = s.targetLock ? world.ships.find(o => o.id === s.targetLock && o.alive) : null;
    const tooFar = cur && Math.hypot(cur.x - s.x, cur.y - s.y) > RADAR_SHORT_RANGE;
    if (!cur || tooFar) {
      // Find nearest enemy inside short radar (≤ RADAR_SHORT_RANGE)
      let candidate = null, bd = RADAR_SHORT_RANGE;
      for (const o of world.ships) {
        if (!o.alive || o.team === s.team) continue;
        const d = Math.hypot(o.x - s.x, o.y - s.y);
        if (d < bd) { candidate = o; bd = d; }
      }
      if (candidate) {
        if (candidate.id !== s.targetLock) {
          s.targetLock = candidate.id;
          s.selectedPlanet = null;
          // Auto-lock+nav OVERRIDES orbit — break out and pursue.
          if (s.orbiting) leaveOrbit(s);
          pushMessage(world, `Auto-lock + nav: ${candidate.team} ${candidate.shipClass} ${candidate.name}.`, "you");
        }
      } else if (tooFar) {
        // No confirmed enemy in short range — drop the stale lock + autopilot
        s.targetLock = null;
        if (s.autoPilot && s.autoPilot.type === "ship") s.autoPilot = null;
      }
    }
    // Maintain autopilot chasing the current lock
    if (s.targetLock) {
      const t = world.ships.find(o => o.id === s.targetLock && o.alive);
      if (t && (!s.autoPilot || s.autoPilot.type !== "ship" || s.autoPilot.id !== t.id)) {
        s.autoPilot = { type: "ship", id: t.id, speed: AUTOPILOT_SPEED };
        if (s.orbiting) leaveOrbit(s);  // also drop orbit when re-engaging
      }
    }
  }

  // --- Autopilot: head toward selected target / home ---
  if (s.isPlayer && s.autoPilot) {
    const ap = s.autoPilot;
    let tgt = null;
    if (ap.type === "planet") tgt = world.planets.find(p => p.id === ap.id);
    else if (ap.type === "ship") tgt = world.ships.find(o => o.id === ap.id && o.alive);
    if (!tgt) {
      s.autoPilot = null;
      pushMessage(world, "Autopilot disengaged — target lost.", "warn");
    } else {
      s.desiredHeading = Math.atan2(tgt.y - s.y, tgt.x - s.x);
      s.desiredSpeed = ap.speed || AUTOPILOT_SPEED;
      if (ap.type === "planet") {
        const dToPlanet = Math.hypot(tgt.x - s.x, tgt.y - s.y);
        if (dToPlanet < ORBIT_RADIUS * 1.4 && s.speed <= ORBIT_MAX_SPEED) {
          // arrived — lock orbit on THIS planet specifically (don't pick "nearest")
          s.orbiting = tgt.id;
          s.speed = 0;
          s.desiredSpeed = 0;
          s.pendingOrbit = null;
          const wantCapture = ap.captureOnArrival && tgt.team !== s.team;
          s.autoPilot = null;
          pushMessage(world, `Autopilot complete — orbiting ${tgt.name}.`, "you");
          if (wantCapture) {
            if (tgt.defenseMaxHull > 0 && tgt.defenseHull > 0) {
              // Defenses still up — attack them first, capture once destroyed.
              s.attackingDefenses = tgt.id;
              pushMessage(world, `${tgt.name}'s defenses still active — engaging turret before capture.`, "you");
            } else if (beginCapture(s, world)) {
              pushMessage(world, `Auto-capture sequence started: ${tgt.name}. Hold position, keep enemies away.`, "you");
            }
          }
        } else if (dToPlanet < ORBIT_RADIUS * 2.5) {
          // close — decelerate to orbital speed
          s.desiredSpeed = 1;
        }
      } else if (ap.type === "ship") {
        // For ship targets, autopilot disengages at combat range — UNLESS
        // Auto-Lock&Navigate is on (we want to keep pursuing if the enemy moves).
        const dToShip = Math.hypot(tgt.x - s.x, tgt.y - s.y);
        if (dToShip < shipDef(s).phaserRange && !world.autoLockAndNavigate) {
          s.autoPilot = null;
          pushMessage(world, `Autopilot complete — engaging ${tgt.name}.`, "you");
        }
      }
    }
  }

  // --- Cloak: drain 20% max energy per second; auto-drop when empty ---
  if (s.cloaked) {
    const drainPerSec = shipMaxEnergy(s, world) * CLOAK_ENERGY_DRAIN_FRACTION;
    s.energy -= drainPerSec * dt;
    if (s.energy <= 0) {
      s.energy = 0;
      s.cloaked = false;
      if (s.isPlayer) pushMessage(world, "Cloak collapsed — energy depleted.", "alert");
    }
  }

  // --- Auto-Defend: shields up when enemies near, flare incoming torps ---
  if (s.isPlayer && world.autoDefendEnabled) {
    // Raise shields if any enemy is within short-radar range
    if (!s.shieldsUp && world.now >= s.shieldCollapsedUntil) {
      let enemyNear = false;
      for (const o of world.ships) {
        if (!o.alive || o.team === s.team) continue;
        if (Math.hypot(o.x - s.x, o.y - s.y) < RADAR_SHORT_RANGE) { enemyNear = true; break; }
      }
      if (enemyNear && s.shield > 0) {
        s.shieldsUp = true;
        pushMessage(world, "AUTO-DEFEND: shields raised — enemy in short range.", "you");
      }
    }
    // Auto-Defend deploys flares only on torps within 500u, AND no more than
    // 2 flares per individual torpedo (so a single lucky torp can't drain the
    // whole magazine). Torps that get diverted (willHit=false) drop out
    // automatically; ones that survive 2 flares are accepted as inevitable.
    const AUTO_FLARE_RANGE = 500;
    const AUTO_FLARE_PER_TORP = 2;
    if (s.flareCount > 0) {
      let closest = null, bd = Infinity;
      for (const t of world.torps) {
        if (!t.alive || t.team === s.team) continue;
        if (t.targetId !== s.id || !t.willHit) continue;
        if ((t.flaresAgainst || 0) >= AUTO_FLARE_PER_TORP) continue;
        const d = Math.hypot(t.x - s.x, t.y - s.y);
        if (d < bd) { closest = t; bd = d; }
      }
      if (closest && bd < AUTO_FLARE_RANGE) {
        const r = deployFlare(s, world, AUTO_FLARE_PER_TORP);
        pushMessage(world, "AUTO-DEFEND: " + r.msg, r.msgKind);
      }
    }
  }

  // --- Targeting: auto-pilot toward locked target ---
  if (s.targetLock) {
    const t = world.ships.find(o => o.id === s.targetLock);
    if (!t || !t.alive) {
      s.targetLock = null;
    } else {
      const d = Math.hypot(t.x - s.x, t.y - s.y);
      if (d > LOCK_BREAK_RANGE) {
        s.targetLock = null;
        if (s.isPlayer) pushMessage(world, "Target lock broken (out of range).", "warn");
      } else {
        s.desiredHeading = Math.atan2(t.y - s.y, t.x - s.x);
        // Suggest combat speed: cap at LOCK_COMBAT_SPEED unless user holds higher manually.
        // We only DOWN-cap (so user can still go slower). The cap forces deceleration.
        if (s.desiredSpeed > LOCK_COMBAT_SPEED) s.desiredSpeed = LOCK_COMBAT_SPEED;
      }
    }
  }

  // --- Auto-Defend EVASION: incoming locked torps + can't deploy flares
  // (no magazine OR energy too low) → run at warp 6 straight away from the
  // torp centroid until the threat clears. Overrides orbit and the target-
  // lock speed cap. Crucially we do NOT clear s.autoPilot — that means once
  // the torps are gone, an active Auto-Lock+Nav (or manual autopilot) snaps
  // right back to its target on the next tick. Survival first, hunt resumes.
  const canFlare = s.flareCount > 0 && s.energy >= FLARE_ENERGY_COST;
  if (s.isPlayer && world.autoDefendEnabled && !canFlare) {
    let ix = 0, iy = 0, count = 0;
    for (const t of world.torps) {
      if (!t.alive || t.team === s.team) continue;
      if (t.targetId !== s.id || !t.willHit) continue;
      ix += t.x; iy += t.y;
      count++;
    }
    if (count > 0) {
      const cx = ix / count, cy = iy / count;
      // Direction FROM torp centroid TO ship = flee vector.
      s.desiredHeading = Math.atan2(s.y - cy, s.x - cx);
      s.desiredSpeed = 6;
      if (s.orbiting) leaveOrbit(s);
      if (!s._evading) {
        s._evading = true;
        const reason = s.flareCount === 0 ? "no flares" : "energy too low for flare";
        pushMessage(world, `AUTO-DEFEND: ${reason} — evasive maneuvers at warp 6 (${count} torpedo${count > 1 ? "es" : ""} inbound).`, "warn");
      }
    } else if (s._evading) {
      s._evading = false;
      const tail = world.autoLockAndNavigate ? " — Auto-Lock+Nav resuming attack." : " — resuming course.";
      pushMessage(world, `AUTO-DEFEND: threat clear${tail}`, "you");
    }
  } else if (s._evading) {
    // Auto-Defend turned off mid-evasion, or we picked up flares / energy again.
    s._evading = false;
  }

  // --- Turning ---
  const def = shipDef(s);
  let dh = wrapAngle(s.desiredHeading - s.heading);
  const turnStep = def.turnRate * dt;
  if (Math.abs(dh) <= turnStep) s.heading = s.desiredHeading;
  else s.heading += Math.sign(dh) * turnStep;
  s.heading = wrapAngle(s.heading);

  // --- Speed / movement ---
  const maxS = maxSpeedNow(s, world);
  let targetSpeed = Math.min(s.desiredSpeed, maxS);
  if (s.orbiting) targetSpeed = 0;
  // Warp drive offline if structural health below threshold
  if (s.hull / shipMaxHull(s, world) < SYS_WARP_MIN_HULL) targetSpeed = 0;
  // Energy drain halved across the board for longer engagements.
  const warpDrain = s.speed * s.speed * 0.8 * dt;
  if (s.energy < warpDrain && targetSpeed > 2) targetSpeed = Math.min(targetSpeed, 2);
  if (s.speed < targetSpeed) s.speed = Math.min(targetSpeed, s.speed + def.accel * dt);
  else if (s.speed > targetSpeed) s.speed = Math.max(targetSpeed, s.speed - def.accel * 1.8 * dt);
  s.energy = Math.max(0, s.energy - warpDrain);

  if (s.orbiting) {
    const p = world.planets.find(p => p.id === s.orbiting);
    if (p) {
      const ang = Math.atan2(s.y - p.y, s.x - p.x) + 0.6 * dt;
      s.x = p.x + Math.cos(ang) * ORBIT_RADIUS;
      s.y = p.y + Math.sin(ang) * ORBIT_RADIUS;
      s.heading = ang + Math.PI / 2;
      // Orbiting your own HOME refits every resource pro-rata over
      // HOME_REFIT_TIME seconds (20% of max per second). Implication: if
      // you're being attacked while docked, your shields can still deplete
      // and you can be destroyed before they finish reloading.
      if (p.team === s.team && (p.flags & FLAG_HOME)) {
        const rate = 1 / HOME_REFIT_TIME;
        const maxE = shipMaxEnergy(s, world);
        const maxSh = shipMaxShield(s, world);
        const maxHu = shipMaxHull(s, world);
        const maxTp = shipMaxTorps(s, world);
        const maxFl = shipMaxFlares(s, world);
        s.energy = Math.min(maxE,  s.energy + maxE  * rate * dt);
        s.shield = Math.min(maxSh, s.shield + maxSh * rate * dt);
        s.hull   = Math.min(maxHu, s.hull   + maxHu * rate * dt);
        // Discrete resources accumulate fractionally
        s._homeTorpAccum  = (s._homeTorpAccum  || 0) + maxTp * rate * dt;
        s._homeFlareAccum = (s._homeFlareAccum || 0) + maxFl * rate * dt;
        while (s._homeTorpAccum >= 1 && s.torpCount < maxTp) {
          s.torpCount += 1; s._homeTorpAccum -= 1;
        }
        while (s._homeFlareAccum >= 1 && s.flareCount < maxFl) {
          s.flareCount += 1; s._homeFlareAccum -= 1;
        }
        // Clear shield-collapse cooldown immediately so shields can re-engage.
        s.shieldCollapsedUntil = 0;
      } else {
        s._homeTorpAccum = 0;
        s._homeFlareAccum = 0;
      }
    }
  } else {
    const v = s.speed * WARP_UNITS;
    s.x += Math.cos(s.heading) * v * dt;
    s.y += Math.sin(s.heading) * v * dt;
    s.x = Math.max(20, Math.min(GALAXY_SIZE - 20, s.x));
    s.y = Math.max(20, Math.min(GALAXY_SIZE - 20, s.y));
  }

  // --- Cooldowns ---
  s.phaserCool = Math.max(0, s.phaserCool - dt);
  s.torpCool = Math.max(0, s.torpCool - dt);

  // --- Shield drain & collapse logic ---
  if (s.shieldsUp) {
    const drain = def.shieldDrain * 0.5 * dt;
    if (s.energy >= drain) {
      s.energy -= drain;
    } else {
      // Brown-out: shields collapse if energy runs out
      s.energy = 0;
      collapseShields(s, world, "Energy depleted");
    }
  }
  if (s.shield <= 0 && s.shieldsUp) {
    collapseShields(s, world, "Shields collapsed");
  }

  // --- Energy recharge ---
  let recharge = shipRechargeRate(s, world);
  if (s.orbiting) {
    const p = world.planets.find(p => p.id === s.orbiting);
    if (p && p.team === s.team && (p.flags & FLAG_FUEL)) recharge *= 3.0;
  }
  if (!s.shieldsUp) recharge *= 1.6; // recharge faster with shields down
  const maxE = shipMaxEnergy(s, world);
  s.energy = Math.min(maxE, s.energy + recharge * dt);

  // --- Repair (shield HP regen, then hull) ---
  let repairRate = shipRepairRate(s, world);
  if (s.orbiting) {
    const p = world.planets.find(p => p.id === s.orbiting);
    if (p && p.team === s.team && (p.flags & FLAG_REPAIR)) repairRate *= 4.0;
  }
  if (!s.shieldsUp) repairRate *= 2.0;
  const maxSh = shipMaxShield(s, world);
  const maxHu = shipMaxHull(s, world);
  if (!s.shieldsUp) {
    // shields only regenerate while DOWN
    if (s.shield < maxSh) s.shield = Math.min(maxSh, s.shield + repairRate * 8 * dt);
  }
  if (s.hull < maxHu) s.hull = Math.min(maxHu, s.hull + repairRate * dt);

  // --- Torp reload ---
  const torpMax = shipMaxTorps(s, world);
  if (s.torpCount < torpMax) {
    let reloadTime = def.torpReloadTime;
    if (s.orbiting) {
      const p = world.planets.find(p => p.id === s.orbiting);
      if (p && p.team === s.team && (p.flags & FLAG_REPAIR)) reloadTime *= 0.5;
    }
    if (world.now >= s.torpReloadAt) {
      s.torpCount = Math.min(torpMax, s.torpCount + 1);
      s.torpReloadAt = world.now + reloadTime;
    }
  } else {
    s.torpReloadAt = world.now + def.torpReloadTime;
  }

  // --- Auto-fire when locked + in cone + ready (only if Auto-Fire is enabled) ---
  if (s.targetLock && s.isPlayer && world.autoFireEnabled) {
    autoFireAtTarget(s, world);
  }

  // --- Queued phaser shot (player only) — fires when ship has rotated into cone ---
  if (s.isPlayer && s.pendingPhaserShot) {
    updatePendingPhaser(s, world);
  }

  // --- Auto-attack planet defenses (player only). Runs while orbiting a
  //     non-friendly home planet whose turret is still alive; fires phasers
  //     straight at the planet each cooldown until defenses drop to 0, then
  //     auto-starts the capture sequence. ---
  if (s.isPlayer && s.attackingDefenses) {
    const p = world.planets.find(pp => pp.id === s.attackingDefenses);
    if (!p) {
      s.attackingDefenses = null;
    } else if (p.team === s.team || p.defenseHull <= 0) {
      // Defenses down (or planet already ours) — switch to capture
      s.attackingDefenses = null;
      if (p.team !== s.team && beginCapture(s, world)) {
        pushMessage(world, `Defenses destroyed — capture sequence started: ${p.name}.`, "you");
      }
    } else if (s.orbiting === p.id && !s.cloaked &&
               s.hull / shipMaxHull(s, world) >= SYS_PHASERS_MIN_HULL &&
               s.phaserCool === 0 &&
               s.energy >= phaserEnergyCost(s, world)) {
      firePhaserAt(s, world, p.x, p.y);
    } else if (!s.orbiting) {
      // Drifted out of orbit somehow — give up.
      s.attackingDefenses = null;
    }
  }

  // --- Capture progress ---
  updateCapture(s, world, dt);

  // --- Pending-orbit autopilot completion ---
  maybeCompletePendingOrbit(s, world);
}

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function collapseShields(s, world, reason) {
  if (!s.shieldsUp) return;
  s.shieldsUp = false;
  s.shieldCollapsedUntil = world.now + SHIELD_COLLAPSE_DELAY;
  if (s.isPlayer) pushMessage(world, reason + "!", "alert");
}

// Cloak toggle. Returns an error string if the request was rejected.
// Engaging requires ≥20% max energy (one full second of cloak operation).
function toggleCloak(s, world) {
  if (s.cloaked) {
    s.cloaked = false;
    if (s.isPlayer) pushMessage(world, "Cloak DISENGAGED.", "you");
    return null;
  }
  const maxE = shipMaxEnergy(s, world);
  if (s.energy < maxE * CLOAK_ENERGY_DRAIN_FRACTION) {
    return `Insufficient energy to engage cloak (need ${Math.round(CLOAK_ENERGY_DRAIN_FRACTION * 100)}%).`;
  }
  s.cloaked = true;
  // Drop any incoming torpedo locks — they lose track the moment we vanish.
  for (const t of world.torps) {
    if (t.alive && t.targetId === s.id) {
      t.willHit = false;
      t.diverted = true;
    }
  }
  if (s.isPlayer) pushMessage(world, "Cloak ENGAGED — weapons offline, torpedo locks broken.", "you");
  return null;
}

// Damage routing: shields up → shield HP only; shields down → hull.
// hitKind: "phaser" | "torp" | undefined (no animation spawned for undefined,
// used for explosion-radius damage cascades).
function damageShip(s, dmg, source, world, hitKind) {
  if (!s.alive) return;
  // Cloak hides you from sensors and prevents enemies from targeting you, but
  // your ship is still physically present — phaser beams and torpedoes that
  // happen to cross your path can still hit you.
  let remaining = dmg;
  if (s.shieldsUp && s.shield > 0) {
    if (s.shield >= remaining) {
      s.shield -= remaining;
      remaining = 0;
    } else {
      remaining -= s.shield;
      s.shield = 0;
      collapseShields(s, world, "Shields collapsed under fire");
      remaining *= 0.5;
    }
  }
  if (remaining > 0) s.hull -= remaining;
  s.lastDamageFrom = source ? source.id : null;

  // Visible hit indicator at the impact point
  if (hitKind) {
    world.impacts = world.impacts || [];
    world.impacts.push({
      x: s.x, y: s.y,
      kind: hitKind,
      shieldHit: s.shieldsUp && s.shield > 0,
      bornAt: world.now,
      until: world.now + (hitKind === "torp" ? 0.6 : 0.35),
    });
    if (typeof fxFromShip === "function") fxFromShip(s, world, (v) => playHitSound(hitKind, v));
  }

  // Distress chatter when an AI ship gets hurt
  if (hitKind && typeof maybeChatter === "function") {
    const hullPct = s.hull / shipMaxHull(s, world);
    if (hullPct < 0.5 && hullPct > 0.15) maybeChatter(s, world, "distress", 0.05);
  }

  if (s.hull <= 0) killShip(s, source, world);
}

function killShip(s, killer, world) {
  if (!s.alive) return;
  // Last words from the dying ship — bypass throttle so it always shows.
  if (typeof forceChatter === "function" && Math.random() < 0.7) forceChatter(s, world, "dying");
  s.alive = false;
  s.deaths++;
  s.score += SCORE_DEATH;
  s.respawnAt = world.now + (s.isPlayer ? RESPAWN_TIME : AI_RESPAWN_TIME);
  s.deadEffectUntil = world.now + EXPLOSION_TIME;
  s.orbiting = null;
  s.capturing = false;
  s.captureProgress = 0;
  s.captureTarget = null;
  s.targetLock = null;

  for (const o of world.ships) {
    if (o === s || !o.alive || o.team === s.team) continue;
    const d = Math.hypot(o.x - s.x, o.y - s.y);
    if (d < EXPLOSION_RADIUS) {
      damageShip(o, EXPLOSION_DMG * (1 - d / EXPLOSION_RADIUS), s, world);
    }
  }

  if (killer && killer.alive && killer.team !== s.team) {
    killer.kills += 1;
    killer.score += SCORE_KILL;
  }

  pushMessage(world, `${s.team}: ${s.name} destroyed${killer ? " by " + killer.name + " (" + killer.team + ")" : ""}.`,
    s.isPlayer ? "alert" : (killer && killer.isPlayer ? "you" : ""));

  if (s.isPlayer) {
    world.playerLives -= 1;
    if (world.playerLives <= 0) {
      endGame(world, false, "You have been destroyed.");
    }
  }
}

function respawnShip(s, world) {
  const friendly = world.planets.filter(p => p.team === s.team);
  let home;
  if (friendly.length > 0) {
    home = friendly[Math.floor(Math.random() * friendly.length)];
  } else {
    home = world.planets.find(p => p.origTeam === s.team && (p.flags & FLAG_HOME));
  }
  s.alive = true;
  s.hull = shipMaxHull(s, world);
  s.shield = shipMaxShield(s, world);
  s.energy = shipMaxEnergy(s, world);
  s.torpCount = shipMaxTorps(s, world);
  s.flareCount = shipMaxFlares(s, world);
  s.shieldsUp = true;
  s.shieldCollapsedUntil = 0;
  s.speed = 0;
  s.desiredSpeed = 0;
  s.targetLock = null;
  if (home) {
    const ang = Math.random() * Math.PI * 2;
    s.x = home.x + Math.cos(ang) * (ORBIT_RADIUS + 40);
    s.y = home.y + Math.sin(ang) * (ORBIT_RADIUS + 40);
    s.heading = ang + Math.PI / 2;
    s.desiredHeading = s.heading;
  }
}

// tryOrbit: if a planet is nearby AND speed is low → lock orbit immediately.
// If a planet is nearby but speed is too high → auto-decelerate and head at it;
// returns { pending: true, planet } so the input layer can give the player a
// useful message. Caller is expected to check the return.
function tryOrbit(s, world) {
  // Larger search window so the player can press O when "near" a planet
  let nearest = null, ndist = Infinity;
  for (const p of world.planets) {
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    if (d < ORBIT_RADIUS * 3 && d < ndist) { nearest = p; ndist = d; }
  }
  if (!nearest) return false;
  if (ndist < ORBIT_RADIUS * 1.4 && s.speed <= ORBIT_MAX_SPEED) {
    s.orbiting = nearest.id;
    s.speed = 0;
    s.desiredSpeed = 0;
    s.pendingOrbit = null;
    return nearest;
  }
  // Pending — autopilot to the planet at low speed
  s.pendingOrbit = nearest.id;
  s.desiredHeading = Math.atan2(nearest.y - s.y, nearest.x - s.x);
  s.desiredSpeed = 1;
  return { pending: true, planet: nearest, dist: ndist, tooFast: s.speed > ORBIT_MAX_SPEED };
}

// Per-tick check: if pendingOrbit is set and conditions are now met, lock the orbit.
function maybeCompletePendingOrbit(s, world) {
  if (s.orbiting || !s.pendingOrbit) return;
  const p = world.planets.find(p => p.id === s.pendingOrbit);
  if (!p) { s.pendingOrbit = null; return; }
  const d = Math.hypot(p.x - s.x, p.y - s.y);
  if (d > ORBIT_RADIUS * 4) { s.pendingOrbit = null; return; } // drifted away
  if (d < ORBIT_RADIUS * 1.4 && s.speed <= ORBIT_MAX_SPEED) {
    s.orbiting = p.id;
    s.speed = 0;
    s.desiredSpeed = 0;
    s.pendingOrbit = null;
    if (s.isPlayer) pushMessage(world, `Entered orbit of ${p.name}.`, "you");
  }
}

function leaveOrbit(s) {
  s.orbiting = null;
  s.capturing = false;
  s.captureProgress = 0;
  s.captureTarget = null;
  s.attackingDefenses = null;
}

// Shield toggle (player). Returns reason string if denied.
function toggleShields(s, world) {
  if (s.shieldsUp) {
    s.shieldsUp = false;
    return null;
  }
  if (world.now < s.shieldCollapsedUntil) {
    const wait = (s.shieldCollapsedUntil - world.now).toFixed(1);
    return `Shields rebooting (${wait}s)`;
  }
  if (s.shield <= 0) return "Shields have no charge";
  s.shieldsUp = true;
  return null;
}

// --- Target lock helpers ---
function acquireLock(s, world, target) {
  if (!target || !target.alive || target.team === s.team) return false;
  const d = Math.hypot(target.x - s.x, target.y - s.y);
  if (d > LOCK_RANGE) return false;
  s.targetLock = target.id;
  return true;
}

function nearestEnemyForLock(s, world) {
  let best = null, bd = LOCK_RANGE;
  for (const o of world.ships) {
    if (!o.alive || o.team === s.team) continue;
    if (o.cloaked) continue;
    const d = Math.hypot(o.x - s.x, o.y - s.y);
    if (d < bd) { best = o; bd = d; }
  }
  return best;
}

// SOS — call friendly ships to player's aid. Available only when within
// short-radar range of home. Sets friendlies to RESCUE mode.
const SOS_RESCUE_DURATION = 10.0;   // seconds friendlies hang around when no enemies
function triggerSOS(me, world) {
  if (!me || !me.alive) return false;
  const home = world.planets.find(p => p.origTeam === world.playerTeam && (p.flags & FLAG_HOME));
  if (!home) { pushMessage(world, "SOS failed — no home base.", "alert"); return false; }
  const dHome = Math.hypot(home.x - me.x, home.y - me.y);
  if (dHome > RADAR_SHORT_RANGE) {
    pushMessage(world, `SOS unavailable — out of home short-range radar (${Math.round(dHome)}u from home, max ${RADAR_SHORT_RANGE}u).`, "alert");
    return false;
  }
  let count = 0;
  for (const f of world.ships) {
    if (f.team !== me.team || !f.alive || f.isPlayer) continue;
    if (!f.aiState) f.aiState = {};
    f.aiState.mode = "RESCUE";
    f.aiState.rescueTarget = me.id;
    f.aiState.rescueUntil = world.now + SOS_RESCUE_DURATION;
    if (f.orbiting) leaveOrbit(f);
    count++;
  }
  if (count === 0) pushMessage(world, "SOS sent — no friendlies available.", "warn");
  else pushMessage(world, `SOS sent — ${count} friendly ship(s) en route.`, "you");
  return true;
}

// Cancel any active autopilot — called by manual course/speed changes.
function clearAutoPilot(s, world, reason) {
  if (s.autoPilot) {
    s.autoPilot = null;
    if (s.isPlayer && world && reason) pushMessage(world, "Autopilot disengaged — " + reason + ".", "warn");
  }
}

// Engage autopilot toward selected target (ship lock or planet).
// Optional `captureOnArrival` flag (planets only) starts a capture sequence
// the instant the autopilot locks orbit.
function engageAutoPilot(s, world, opts) {
  if (!opts || !opts.type || opts.id === undefined || opts.id === null) {
    if (s.isPlayer) pushMessage(world, "Autopilot needs a target — click a ship or planet first.", "alert");
    return false;
  }
  s.autoPilot = {
    type: opts.type,
    id: opts.id,
    speed: opts.speed || AUTOPILOT_SPEED,
    captureOnArrival: !!opts.captureOnArrival,
  };
  if (s.orbiting) leaveOrbit(s);
  if (s.isPlayer) {
    const tail = opts.captureOnArrival ? " (will begin capture on arrival)" : "";
    pushMessage(world, `Autopilot engaged → ${opts.name || opts.id} at warp ${s.autoPilot.speed}${tail}.`, "you");
  }
  return true;
}

function inFiringCone(s, target) {
  const ang = Math.atan2(target.y - s.y, target.x - s.x);
  const err = Math.abs(wrapAngle(ang - s.heading));
  return err <= FIRE_CONE;
}
function inPhaserCone(s, target) {
  const ang = Math.atan2(target.y - s.y, target.x - s.x);
  const err = Math.abs(wrapAngle(ang - s.heading));
  return err <= PHASER_CONE;
}
function angleErrToPoint(s, x, y) {
  const ang = Math.atan2(y - s.y, x - s.x);
  return Math.abs(wrapAngle(ang - s.heading));
}

// queuePhaserAt: try to fire immediately if the click is already in cone;
// otherwise record a pending shot that fires automatically once the ship
// rotates enough.
function queuePhaserAt(s, world, wx, wy) {
  if (angleErrToPoint(s, wx, wy) <= PHASER_CONE) {
    if (firePhaserAt(s, world, wx, wy)) return { fired: true };
  }
  s.pendingPhaserShot = { targetX: wx, targetY: wy, until: world.now + PHASER_QUEUE_TTL };
  return { fired: false, queued: true };
}

function updatePendingPhaser(s, world) {
  if (!s.pendingPhaserShot) return;
  const p = s.pendingPhaserShot;
  if (world.now > p.until) { s.pendingPhaserShot = null; return; }
  if (angleErrToPoint(s, p.targetX, p.targetY) <= PHASER_CONE) {
    if (firePhaserAt(s, world, p.targetX, p.targetY)) s.pendingPhaserShot = null;
    // if the shot failed (cooling / energy), keep waiting until ttl expires
  }
}

const AUTO_TORP_BURST_SIZE = 2;
const AUTO_TORP_BURST_WINDOW = 2.0;   // seconds

function autoFireAtTarget(s, world) {
  if (!s.targetLock) return;
  const t = world.ships.find(o => o.id === s.targetLock);
  if (!t || !t.alive) return;
  const def = shipDef(s);
  const d = Math.hypot(t.x - s.x, t.y - s.y);
  // Phasers: wider cone (±30°), close-range. Throttled to AUTO_PHASER_INTERVAL
  // (0.5s) regardless of the raw 0.2s cooldown — keeps energy from depleting
  // in a 4-second blast during a long lock. Manual LMB / P-key fires still
  // use the raw cooldown.
  if (inPhaserCone(s, t) && d <= def.phaserRange &&
      s.phaserCool === 0 && s.energy >= phaserEnergyCost(s, world) &&
      (world.now - (s._autoPhaserLastAt || 0)) >= AUTO_PHASER_INTERVAL) {
    if (firePhaser(s, world, t)) s._autoPhaserLastAt = world.now;
  }
  // Torpedoes: narrower cone (±20°). Auto-fire is rate-limited to bursts of
  // 2 torps per 2-second window so a long lock doesn't drain the magazine.
  if (inFiringCone(s, t) && d <= def.torpRange &&
      s.torpCool === 0 && s.torpCount > 0 && s.energy >= def.torpEnergy) {
    if (!s._autoTorpBurstStart || (world.now - s._autoTorpBurstStart) >= AUTO_TORP_BURST_WINDOW) {
      s._autoTorpBurstStart = world.now;
      s._autoTorpBurstCount = 0;
    }
    if ((s._autoTorpBurstCount || 0) < AUTO_TORP_BURST_SIZE) {
      const aimAng = Math.atan2(t.y - s.y, t.x - s.x);
      if (fireTorp(s, world, aimAng, t)) {
        s._autoTorpBurstCount = (s._autoTorpBurstCount || 0) + 1;
      }
    }
  }
}

// Flare deployment — divert the nearest incoming hostile torp targeting `s`.
// Each flare attempts to distract exactly one torpedo, with FLARE_DIVERT_PROB
// chance of success. Always spawns a visible burst from the ship.
// Returns { used: bool, success: bool, msgKind: "you"|"warn"|"alert", msg: str }
function deployFlare(s, world, maxPerTorp) {
  if (s.flareCount <= 0) {
    return { used: false, success: false, msgKind: "alert", msg: "No flares left." };
  }
  if (s.energy < FLARE_ENERGY_COST) {
    return { used: false, success: false, msgKind: "alert", msg: `Insufficient energy for flare (need ${FLARE_ENERGY_COST}).` };
  }
  // Find nearest hostile torp locked on this ship.
  // If maxPerTorp is given, skip torps that have already had that many flares
  // spent against them (used by Auto-Defend to avoid burning the magazine on
  // a single lucky torpedo).
  let target = null, bd = Infinity;
  for (const t of world.torps) {
    if (!t.alive || t.team === s.team) continue;
    if (t.targetId !== s.id) continue;
    if (!t.willHit) continue;
    if (maxPerTorp != null && (t.flaresAgainst || 0) >= maxPerTorp) continue;
    const d = Math.hypot(t.x - s.x, t.y - s.y);
    if (d < bd) { target = t; bd = d; }
  }
  if (!target) {
    return { used: false, success: false, msgKind: "warn", msg: "No incoming torpedo — flare held." };
  }

  s.flareCount -= 1;
  s.energy = Math.max(0, s.energy - FLARE_ENERGY_COST);
  target.flaresAgainst = (target.flaresAgainst || 0) + 1;
  spawnFlareBurst(s, world);

  if (Math.random() < FLARE_DIVERT_PROB) {
    target.willHit = false;
    target.diverted = true;
    return {
      used: true, success: true, msgKind: "you",
      msg: `FLARE SUCCESS — torpedo at ${Math.round(bd)}u diverted. ${s.flareCount} flare(s) left.`,
    };
  }
  return {
    used: true, success: false, msgKind: "alert",
    msg: `FLARE MISS — torpedo at ${Math.round(bd)}u still tracking. ${s.flareCount} flare(s) left.`,
  };
}

function spawnFlareBurst(s, world) {
  if (!world.flareEffects) world.flareEffects = [];
  // Burst of 6 sparks shooting outward in random directions from the ship
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
    const sp = 250 + Math.random() * 150;
    world.flareEffects.push({
      x: s.x, y: s.y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      bornAt: world.now,
      until:  world.now + 1.6,
    });
  }
}

function torpHitProbability(dist) {
  if (dist <= TORP_HIT_NEAR_RANGE) return TORP_HIT_NEAR_PROB;
  if (dist >= TORP_HIT_FAR_RANGE)  return TORP_HIT_FAR_PROB;
  const t = (dist - TORP_HIT_NEAR_RANGE) / (TORP_HIT_FAR_RANGE - TORP_HIT_NEAR_RANGE);
  return TORP_HIT_NEAR_PROB + t * (TORP_HIT_FAR_PROB - TORP_HIT_NEAR_PROB);
}

// --- Capture ---
function beginCapture(s, world) {
  if (!s.orbiting) return false;
  const p = world.planets.find(p => p.id === s.orbiting);
  if (!p) return false;
  if (p.team === s.team) return false;
  s.capturing = true;
  s.captureTarget = p.id;
  s.captureProgress = 0;
  return true;
}

function updateCapture(s, world, dt) {
  if (!s.capturing) return;
  if (!s.orbiting || s.orbiting !== s.captureTarget) {
    s.capturing = false; s.captureProgress = 0; s.captureTarget = null; return;
  }
  const p = world.planets.find(p => p.id === s.captureTarget);
  if (!p) { s.capturing = false; s.captureProgress = 0; return; }
  if (p.team === s.team) { s.capturing = false; s.captureProgress = 0; s.captureTarget = null; return; }
  for (const o of world.ships) {
    if (!o.alive || o.team === s.team) continue;
    if (Math.hypot(o.x - s.x, o.y - s.y) < CAPTURE_DANGER_RANGE) {
      if (s.captureProgress > 0.5 && s.isPlayer) {
        pushMessage(world, `Capture of ${p.name} interrupted — enemy nearby.`, "warn");
      }
      s.captureProgress = 0;
      return;
    }
  }
  s.captureProgress += dt;
  if (s.captureProgress >= CAPTURE_TIME) {
    const oldTeam = p.team;
    p.team = s.team;
    p.flashUntil = world.now + 1.2;
    s.capturing = false;
    s.captureProgress = 0;
    s.captureTarget = null;
    s.planetsTaken += 1;
    s.score += SCORE_PLANET;
    addCaptureBonus(world, s.team, planetBonus(p));
    pushMessage(world, `${s.team}: ${s.name} captured ${p.name} (was ${oldTeam}).`,
      s.isPlayer ? "win" : "");
    if (typeof forceChatter === "function" && !s.isPlayer && Math.random() < 0.7) {
      forceChatter(s, world, "victory");
    }
  }
}

function addCaptureBonus(world, teamId, bonus) {
  if (!world.teamBonus[teamId]) world.teamBonus[teamId] = emptyBonus();
  const tb = world.teamBonus[teamId];
  for (const k of Object.keys(bonus)) tb[k] = (tb[k] || 0) + bonus[k];
}

// ---- Planet defenses ----
// Each home planet has a phaser turret that auto-fires on nearby enemies.
// Damage to the turret is tracked separately from any other planet state.
function planetDefenseTick(world, dt) {
  for (const p of world.planets) {
    if (!p.defenseMaxHull) continue;
    p.defenseCool = Math.max(0, (p.defenseCool || 0) - dt);

    // Rebuild from destruction: heal at a fixed rate (max / REBUILD_TIME per sec).
    // Damage from concurrent attacks just subtracts from the hull, naturally
    // extending the rebuild timer the player perceives. Turret can't fire
    // until rebuild completes (hull back to full).
    if (p.defenseRebuilding) {
      const rebuildRate = p.defenseMaxHull / PLANET_DEFENSE_REBUILD_TIME;
      p.defenseHull = Math.min(p.defenseMaxHull, p.defenseHull + rebuildRate * dt);
      if (p.defenseHull >= p.defenseMaxHull) {
        p.defenseHull = p.defenseMaxHull;
        p.defenseRebuilding = false;
        pushMessage(world, `${p.name}'s defenses back online.`, p.team === world.playerTeam ? "you" : "warn");
      }
      continue;  // no firing while rebuilding
    }

    if (p.defenseHull <= 0) continue;
    if (p.defenseCool > 0) continue;

    // Nearest enemy ship within range (cloaked ships are invisible)
    let target = null, bd = PLANET_DEFENSE_RANGE;
    for (const s of world.ships) {
      if (!s.alive || s.team === p.team) continue;
      if (s.cloaked) continue;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bd) { target = s; bd = d; }
    }
    if (!target) continue;
    // Apply phaser-style damage
    damageShip(target, PLANET_DEFENSE_DMG, null, world, "phaser");
    p.defenseCool = PLANET_DEFENSE_COOL;
    world.beams.push({
      fromId: null, fromX: p.x, fromY: p.y,
      toX: target.x, toY: target.y,
      until: world.now + PLANET_DEFENSE_BEAM_TIME,
      color: (TEAMS[p.team] || TEAMS.IND).color,
    });
  }
}

// Damage a planet's turret. Used when phasers/torps hit a planet from an enemy.
// Damage is allowed during rebuild — keeps the hull low and naturally extends
// how long the turret stays offline.
function damagePlanetDefense(p, dmg, world) {
  if (!p || !p.defenseMaxHull) return;
  if (p.defenseHull <= 0 && !p.defenseRebuilding) return; // fully gone, not rebuilding (shouldn't happen)
  p.defenseHull = Math.max(0, p.defenseHull - dmg);
  p.flashUntil = world.now + 0.4;
  if (p.defenseHull === 0 && !p.defenseRebuilding) {
    p.defenseRebuilding = true;
    pushMessage(world, `${p.name}'s defenses destroyed — rebuilding (~${Math.round(PLANET_DEFENSE_REBUILD_TIME)}s).`, "win");
  }
}

function recomputeBonuses(world) {
  if (!world.teamBonus) world.teamBonus = {};
  for (const t of TEAM_IDS) if (!world.teamBonus[t]) world.teamBonus[t] = emptyBonus();
  for (const s of world.ships) {
    if (!s.alive) continue;
    s.hull = Math.min(s.hull, shipMaxHull(s, world));
    s.shield = Math.min(s.shield, shipMaxShield(s, world));
    s.energy = Math.min(s.energy, shipMaxEnergy(s, world));
  }
}
