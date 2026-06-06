// Input handling — mouse on tactical/galactic + keyboard
"use strict";

const Input = {
  mouseX: 0, mouseY: 0,
  hoverShipId: null,
  lastClickX: null,
  lastClickY: null,
};

// ---- Shared helpers used by both keyboard and top-bar buttons ----

// Disengage Auto-Lock+Nav (button + flag + chatter). No-op if already off.
function disengageAutoLockNav(world, reason) {
  if (!world.autoLockAndNavigate) return false;
  world.autoLockAndNavigate = false;
  const btn = document.getElementById("btn-autolocknav");
  if (btn) btn.classList.toggle("active", false);
  pushMessage(world, `Auto-Lock+Nav disengaged — ${reason}.`, "warn");
  return true;
}

function engagePlayerAutopilotToTarget(me, world) {
  if (!me || !me.alive) return;
  if (me.targetLock) {
    const t = world.ships.find(o => o.id === me.targetLock && o.alive);
    if (t) { engageAutoPilot(me, world, { type: "ship", id: t.id, name: t.name }); return; }
  }
  if (me.selectedPlanet) {
    const p = world.planets.find(p => p.id === me.selectedPlanet);
    if (p) { engageAutoPilot(me, world, { type: "planet", id: p.id, name: p.name }); return; }
  }
  pushMessage(world, "No target selected. Click a ship or planet first.", "alert");
}

function engagePlayerAutopilotToHome(me, world) {
  if (!me || !me.alive) return;
  const home = world.planets.find(p => p.origTeam === world.playerTeam && (p.flags & FLAG_HOME));
  if (!home) { pushMessage(world, "No home base found.", "alert"); return; }
  // Return-home overrides Auto-Lock+Nav (otherwise it would re-acquire a
  // target on the next tick and abandon the home flight).
  if (world.autoLockAndNavigate) {
    world.autoLockAndNavigate = false;
    const btn = document.getElementById("btn-autolocknav");
    if (btn) btn.classList.toggle("active", false);
    pushMessage(world, "Auto-Lock+Nav disengaged — returning home.", "warn");
  }
  me.selectedPlanet = home.id;
  if (me.targetLock) me.targetLock = null;
  engageAutoPilot(me, world, { type: "planet", id: home.id, name: home.name });
}

function cycleZoom(world, delta) {
  if (!world) return;
  const lvl = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, (world.zoomLevel || 0) + delta));
  world.zoomLevel = lvl;
  pushMessage(world, `Tactical zoom: ${ZOOM_LEVELS[lvl]}× (${ZOOM_LEVELS[lvl] * TACTICAL_RANGE}u across).`);
  const el = document.getElementById("zoom-level");
  if (el) el.textContent = ZOOM_LEVELS[lvl] + "×";
}

function attachInput(world) {
  const tac = document.getElementById("tactical");
  const gal = document.getElementById("galactic");

  tac.addEventListener("contextmenu", e => e.preventDefault());
  gal.addEventListener("contextmenu", e => e.preventDefault());

  function tacticalToWorld(e) {
    const rect = tac.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (tac.width / rect.width);
    const sy = (e.clientY - rect.top) * (tac.height / rect.height);
    const me = world.playerShip;
    const zoom = ZOOM_LEVELS[world.zoomLevel || 0];
    const range = TACTICAL_RANGE * zoom;
    const scale = tac.width / range;
    return {
      wx: me.x + (sx - tac.width/2) / scale,
      wy: me.y + (sy - tac.height/2) / scale,
    };
  }
  // World-units-per-screen-pixel at the current zoom (used for click tolerances).
  function worldPerPixel() {
    const zoom = ZOOM_LEVELS[world.zoomLevel || 0];
    return (TACTICAL_RANGE * zoom) / tac.width;
  }

  function galacticToWorld(e) {
    // Radar is centered on the player ship; convert screen coords to world coords
    // using the active radar range.
    const rect = gal.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (gal.width / rect.width);
    const sy = (e.clientY - rect.top) * (gal.height / rect.height);
    const me = world.playerShip;
    const range = (world.radarMode === "LONG") ? RADAR_LONG_RANGE : RADAR_SHORT_RANGE;
    return {
      wx: me.x + ((sx - gal.width / 2) / gal.width) * range,
      wy: me.y + ((sy - gal.height / 2) / gal.height) * range,
    };
  }

  tac.addEventListener("mousemove", e => {
    const { wx, wy } = tacticalToWorld(e);
    Input.mouseX = wx; Input.mouseY = wy;
    const shipTol = Math.max(60, worldPerPixel() * 15);
    let bestShip = null, bdShip = shipTol;
    for (const s of world.ships) {
      if (!s.alive || s === world.playerShip) continue;
      const d = Math.hypot(s.x - wx, s.y - wy);
      if (d < bdShip) { bestShip = s; bdShip = d; }
    }
    let bestPlanet = null, bdPlanet = PLANET_RADIUS;
    for (const p of world.planets) {
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < bdPlanet) { bestPlanet = p; bdPlanet = d; }
    }
    Input.hoverShipId = bestShip ? bestShip.id : null;
    Input.hover = {
      source: "tactical",
      clientX: e.clientX, clientY: e.clientY,
      shipId: bestShip ? bestShip.id : null,
      planetId: bestPlanet ? bestPlanet.id : null,
    };
  });
  tac.addEventListener("mouseleave", () => { Input.hover = null; Input.hoverShipId = null; });

  gal.addEventListener("mousemove", e => {
    const { wx, wy } = galacticToWorld(e);
    const range = (world.radarMode === "LONG") ? RADAR_LONG_RANGE : RADAR_SHORT_RANGE;
    const tol = range / gal.width * 12;
    let bestShip = null, bdShip = tol;
    for (const s of world.ships) {
      if (!s.alive || s === world.playerShip) continue;
      const d = Math.hypot(s.x - wx, s.y - wy);
      if (d < bdShip) { bestShip = s; bdShip = d; }
    }
    let bestPlanet = null, bdPlanet = tol * 1.5;
    for (const p of world.planets) {
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < bdPlanet) { bestPlanet = p; bdPlanet = d; }
    }
    Input.hover = {
      source: "radar",
      clientX: e.clientX, clientY: e.clientY,
      shipId: bestShip ? bestShip.id : null,
      planetId: bestPlanet ? bestPlanet.id : null,
    };
  });
  gal.addEventListener("mouseleave", () => { Input.hover = null; });

  tac.addEventListener("mousedown", e => {
    const me = world.playerShip;
    if (!me || !me.alive) return;
    const { wx, wy } = tacticalToWorld(e);
    if (e.button === 2) {
      // Right-click sets course AND drops any target lock / autopilot
      if (me.orbiting) leaveOrbit(me);
      if (me.attackingDefenses) { me.attackingDefenses = null; pushMessage(world, "Defense attack halted.", "warn"); }
      if (me.targetLock) { me.targetLock = null; pushMessage(world, "Target lock released.", "warn"); }
      clearAutoPilot(me, world, "manual course set");
      me.desiredHeading = Math.atan2(wy - me.y, wx - me.x);
      // If the ship was stopped, give it a kick — feature 1
      if (me.desiredSpeed <= 0) me.desiredSpeed = 1;
      Input.lastClickX = wx; Input.lastClickY = wy;
    } else if (e.button === 0) {
      // Manual click cancels any active autopilot — the player is taking the helm.
      if (me.autoPilot) clearAutoPilot(me, world, "manual fire / steer");
      // Check if a planet was clicked first (planets are big and have priority).
      // Tolerance scales with zoom so distant tiny planets are still clickable.
      const planetTol = Math.max(PLANET_RADIUS, worldPerPixel() * 20);
      let clickedPlanet = null;
      for (const p of world.planets) {
        const d = Math.hypot(p.x - wx, p.y - wy);
        if (d < planetTol) { clickedPlanet = p; break; }
      }
      if (clickedPlanet) {
        // Select the planet (clears any ship lock + autopilot)
        me.selectedPlanet = clickedPlanet.id;
        if (me.targetLock) me.targetLock = null;
        pushMessage(world, `Planet selected: ${clickedPlanet.name} (${clickedPlanet.team}).`, "you");
        // If Auto-Lock+Nav is on, treat a new target click as: disengage AL+N
        // and autopilot to the click. Otherwise the next AI-Lock tick would
        // immediately yank the helm back to the nearest enemy ship.
        if (world.autoLockAndNavigate) {
          disengageAutoLockNav(world, `new course: ${clickedPlanet.name}`);
          engageAutoPilot(me, world, { type: "planet", id: clickedPlanet.id, name: clickedPlanet.name });
        }
        Input.lastClickX = wx; Input.lastClickY = wy;
        return;
      }
      // Check for clicked enemy ship — tolerance also scales with zoom.
      const shipTol = Math.max(60, worldPerPixel() * 15);
      let clicked = null, bd = shipTol;
      for (const s of world.ships) {
        if (!s.alive || s.team === me.team) continue;
        const d = Math.hypot(s.x - wx, s.y - wy);
        if (d < bd) { clicked = s; bd = d; }
      }
      if (clicked && Math.hypot(clicked.x - me.x, clicked.y - me.y) <= LOCK_RANGE) {
        me.selectedPlanet = null;
        if (acquireLock(me, world, clicked)) {
          pushMessage(world, `Target locked: ${clicked.team}/${clicked.shipClass} ${clicked.name}.`, "you");
          // Auto-Lock+Nav on + manual new pick → disengage and autopilot to it
          // so the helm doesn't oscillate to whatever AL+N would prefer.
          if (world.autoLockAndNavigate) {
            disengageAutoLockNav(world, `manual target: ${clicked.name}`);
            engageAutoPilot(me, world, { type: "ship", id: clicked.id, name: clicked.name });
          }
        }
      } else {
        // Empty / out-of-range click: drop lock and steer toward the click
        if (me.targetLock) { me.targetLock = null; pushMessage(world, "Target lock released.", "warn"); }
        me.selectedPlanet = null;
        me.desiredHeading = Math.atan2(wy - me.y, wx - me.x);
        if (me.desiredSpeed <= 0) me.desiredSpeed = 1;
      }

      // Queue the phaser shot — fires when inside the ±30° cone
      const r = queuePhaserAt(me, world, wx, wy);
      if (r.queued) {
        pushMessage(world, "Phaser queued — turning into firing arc.", "warn");
      } else if (!r.fired) {
        const hullPct = me.hull / shipMaxHull(me, world);
        if (hullPct < SYS_PHASERS_MIN_HULL) pushMessage(world, "Phasers OFFLINE — structural health below 25%.", "alert");
        else if (me.energy < phaserEnergyCost(me, world)) pushMessage(world, "Insufficient energy for phasers.", "alert");
        else if (me.phaserCool > 0) pushMessage(world, `Phasers cooling (${me.phaserCool.toFixed(1)}s).`, "alert");
      }
      Input.lastClickX = wx; Input.lastClickY = wy;
    }
  });

  gal.addEventListener("mousedown", e => {
    const me = world.playerShip;
    if (!me || !me.alive) return;
    const { wx, wy } = galacticToWorld(e);

    const range = (world.radarMode === "LONG") ? RADAR_LONG_RANGE : RADAR_SHORT_RANGE;
    const tol = range / gal.width * 10;

    // Planets first — bigger and have name labels worth selecting
    let clickedPlanet = null, pbd = tol * 1.5;
    for (const p of world.planets) {
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < pbd) { clickedPlanet = p; pbd = d; }
    }

    let clickedShip = null, bd = tol;
    for (const s of world.ships) {
      if (!s.alive || s === me || s.team === me.team) continue;
      const d = Math.hypot(s.x - wx, s.y - wy);
      if (d < bd) { clickedShip = s; bd = d; }
    }

    if (clickedPlanet) {
      me.selectedPlanet = clickedPlanet.id;
      if (me.targetLock) me.targetLock = null;
      pushMessage(world, `Planet selected: ${clickedPlanet.name} (${clickedPlanet.team}).`, "you");
      if (world.autoLockAndNavigate) {
        disengageAutoLockNav(world, `new course: ${clickedPlanet.name}`);
        engageAutoPilot(me, world, { type: "planet", id: clickedPlanet.id, name: clickedPlanet.name });
      }
      return;
    }

    if (clickedShip) {
      me.targetLock = clickedShip.id;
      me.selectedPlanet = null;
      const team = TEAMS[clickedShip.team];
      const known = world.radarMode === "SHORT"
        ? `${team.name} ${clickedShip.shipClass}`
        : `${team.name} contact`;
      pushMessage(world, `Radar lock: ${known}. Heading toward target.`, "you");
      if (me.orbiting) leaveOrbit(me);
      // Auto-Lock+Nav on + manual radar pick → swap to autopilot so AL+N
      // doesn't snatch the helm back to the nearest enemy on the next tick.
      if (world.autoLockAndNavigate) {
        disengageAutoLockNav(world, `manual target: ${clickedShip.name}`);
        engageAutoPilot(me, world, { type: "ship", id: clickedShip.id, name: clickedShip.name });
      } else {
        clearAutoPilot(me, world, "manual course set");
        me.desiredHeading = Math.atan2(clickedShip.y - me.y, clickedShip.x - me.x);
        if (me.desiredSpeed <= 0) me.desiredSpeed = 1;
      }
      Input.lastClickX = clickedShip.x;
      Input.lastClickY = clickedShip.y;
      return;
    }

    // Plain click on empty radar — drop lock + selection, set new course
    if (me.targetLock) { me.targetLock = null; pushMessage(world, "Target lock released.", "warn"); }
    me.selectedPlanet = null;
    if (me.orbiting) leaveOrbit(me);
    clearAutoPilot(me, world, "manual course set");
    me.desiredHeading = Math.atan2(wy - me.y, wx - me.x);
    if (me.desiredSpeed <= 0) me.desiredSpeed = 1;
    Input.lastClickX = wx; Input.lastClickY = wy;
    pushMessage(world, `Radar course set.`);
  });

  document.addEventListener("keydown", e => {
    if (world.state !== "playing") return;
    const me = world.playerShip;
    if (!me) return;
    const k = e.key.toLowerCase();

    // Help — F1 or ? — works even when paused, and closes via Esc
    if (e.key === "F1" || k === "?") {
      e.preventDefault();
      if (isHelpOpen()) closeHelp(); else openHelp();
      return;
    }
    if (isHelpOpen()) {
      if (k === "escape") { e.preventDefault(); closeHelp(); }
      return; // swallow everything else while help is up
    }
    if (isCadetBriefingOpen()) {
      // Any key dismisses the cadet briefing — most players will hit space/enter.
      e.preventDefault();
      closeCadetBriefing();
      return;
    }

    if (k >= "0" && k <= "9") {
      const v = parseInt(k, 10);
      me.desiredSpeed = v;
      // Speed change is a SPEED change, not an objective change. Keep orbit
      // (orbit caps movement anyway), keep autopilot (just update its target
      // speed so the approach is faster/slower), keep target lock. Use O to
      // leave orbit, right-click for manual course, etc.
      if (me.autoPilot) me.autoPilot.speed = v;
      e.preventDefault();
      return;
    }

    if (k === "f") {
      world.autoFireEnabled = !world.autoFireEnabled;
      pushMessage(world, `Auto-Fire on target: ${world.autoFireEnabled ? "ON" : "OFF"}.`, world.autoFireEnabled ? "you" : "warn");
      const btn = document.getElementById("btn-autofire");
      if (btn) btn.classList.toggle("active", world.autoFireEnabled);
      return;
    }

    if (k === "l") {
      world.autoLockAndNavigate = !world.autoLockAndNavigate;
      pushMessage(world, `Auto-Lock & Navigate: ${world.autoLockAndNavigate ? "ON" : "OFF"}.`, world.autoLockAndNavigate ? "you" : "warn");
      const btn = document.getElementById("btn-autolocknav");
      if (btn) btn.classList.toggle("active", world.autoLockAndNavigate);
      // Engaging: if there's a current target, immediately set autopilot.
      // Disengaging: cancel autopilot if it was chasing the lock.
      if (!world.autoLockAndNavigate && me.autoPilot && me.autoPilot.type === "ship") {
        me.autoPilot = null;
      }
      return;
    }

    if (k === "a") {
      engagePlayerAutopilotToTarget(me, world);
      return;
    }

    if (k === "h") {
      engagePlayerAutopilotToHome(me, world);
      return;
    }

    if (k === "v") {
      world.autoDefendEnabled = !world.autoDefendEnabled;
      pushMessage(world, `Auto-Defend: ${world.autoDefendEnabled ? "ON" : "OFF"}.`, world.autoDefendEnabled ? "you" : "warn");
      const btn = document.getElementById("btn-autodefend");
      if (btn) btn.classList.toggle("active", world.autoDefendEnabled);
      return;
    }

    if (k === "q") {
      triggerSOS(me, world);
      return;
    }

    if (k === "k") {
      const err = toggleCloak(me, world);
      if (err) pushMessage(world, err, "alert");
      return;
    }

    if (k === "m") {
      if (typeof muteAudio === "function") {
        muteAudio(!Audio.muted);
        const b = document.getElementById("btn-mute");
        if (b) b.textContent = Audio.muted ? "🔇" : "🔊";
        pushMessage(world, `Audio ${Audio.muted ? "MUTED" : "ON"}.`);
        if (Audio.muted) { stopAmbient(); stopTorpAlarm(); world._alarmOn = false; }
        else if (world.state === "playing") startAmbient();
      }
      return;
    }

    if (k === "+" || k === "=") {
      cycleZoom(world, +1);
      return;
    }
    if (k === "-" || k === "_") {
      cycleZoom(world, -1);
      return;
    }

    if (k === "p") {
      // Fire a phaser straight from the ship without changing course.
      // If a locked target is in the phaser cone + range, fire at it directly;
      // otherwise discharge in the current heading direction (firePhaserAt).
      let ok = false;
      if (me.targetLock) {
        const t = world.ships.find(o => o.id === me.targetLock && o.alive);
        if (t && inPhaserCone(me, t) && Math.hypot(t.x - me.x, t.y - me.y) <= shipDef(me).phaserRange) {
          ok = firePhaser(me, world, t);
        }
      }
      if (!ok) {
        const reach = shipDef(me).phaserRange;
        const tx = me.x + Math.cos(me.heading) * reach;
        const ty = me.y + Math.sin(me.heading) * reach;
        ok = firePhaserAt(me, world, tx, ty);
      }
      if (!ok) {
        const hullPct = me.hull / shipMaxHull(me, world);
        if (hullPct < SYS_PHASERS_MIN_HULL) pushMessage(world, "Phasers OFFLINE — structural health below 25%.", "alert");
        else if (me.energy < phaserEnergyCost(me, world)) pushMessage(world, "Insufficient energy for phasers.", "alert");
        else if (me.phaserCool > 0) pushMessage(world, `Phasers cooling (${me.phaserCool.toFixed(1)}s).`, "alert");
      }
      return;
    }

    if (k === "t") {
      // Torpedoes always fire in the ship's current heading direction.
      // If a target is locked AND inside the firing cone, the torp homes onto
      // it (with the usual distance-based hit probability).
      const ang = me.heading;
      let target = null;
      if (me.targetLock) {
        const t = world.ships.find(o => o.id === me.targetLock && o.alive);
        if (t && inFiringCone(me, t)) target = t;
      }
      const ok = fireTorp(me, world, ang, target);
      if (!ok) {
        const hullPct = me.hull / shipMaxHull(me, world);
        if (hullPct < SYS_TORPS_MIN_HULL) pushMessage(world, "Torpedo bays OFFLINE — structural health below 50%.", "alert");
        else if (me.torpCount <= 0) pushMessage(world, "Torpedo magazine empty (reloading).", "alert");
        else if (me.energy < shipDef(me).torpEnergy) pushMessage(world, "Insufficient energy for torpedo.", "alert");
        else if (me.torpCool > 0) pushMessage(world, `Torpedo launcher cooling (${me.torpCool.toFixed(1)}s).`, "alert");
      }
      return;
    }

    if (k === "d") {
      const r = deployFlare(me, world);
      pushMessage(world, r.msg, r.msgKind);
      return;
    }

    if (k === "s") {
      const denied = toggleShields(me, world);
      if (denied) pushMessage(world, denied, "alert");
      else pushMessage(world, `Shields ${me.shieldsUp ? "UP" : "DOWN"}.`);
      return;
    }

    if (k === "o") {
      // If a planet is selected (clicked in tactical or radar) and we're not
      // already orbiting it, autopilot there. Otherwise fall through to the
      // local "orbit nearest planet you're already next to" behavior.
      if (me.selectedPlanet && me.orbiting !== me.selectedPlanet) {
        const p = world.planets.find(x => x.id === me.selectedPlanet);
        if (p) {
          const dToPlanet = Math.hypot(p.x - me.x, p.y - me.y);
          // Close enough to drop into orbit immediately?
          if (dToPlanet < ORBIT_RADIUS * 1.4 && me.speed <= ORBIT_MAX_SPEED) {
            me.orbiting = p.id;
            me.speed = 0;
            me.desiredSpeed = 0;
            me.pendingOrbit = null;
            pushMessage(world, `Entering orbit of ${p.name}${p.team !== me.team ? " (" + p.team + ")" : ""}.`, "you");
            return;
          }
          // Otherwise engage autopilot (will decelerate and orbit on arrival)
          if (me.autoPilot && me.autoPilot.type === "planet" && me.autoPilot.id === p.id) {
            pushMessage(world, `Autopilot already en route to ${p.name}.`, "warn");
            return;
          }
          engageAutoPilot(me, world, { type: "planet", id: p.id, name: p.name });
          return;
        }
      }
      const r = tryOrbit(me, world);
      if (r && r.team) {
        pushMessage(world, `Entering orbit of ${r.name}${r.team !== me.team ? " (" + r.team + ")" : ""}.`);
      } else if (r && r.pending) {
        if (r.tooFast) pushMessage(world, `Decelerating to orbit ${r.planet.name} (still ${Math.round(r.dist)}u away).`, "warn");
        else           pushMessage(world, `Approaching ${r.planet.name} for orbit (${Math.round(r.dist)}u).`, "warn");
      } else {
        pushMessage(world, "No planet nearby to orbit. Click one to select it, then press O.", "alert");
      }
      return;
    }

    if (k === "c") {
      // 1) If a planet is selected AND it's a different planet than the one
      //    we're currently orbiting AND it's not ours, break whatever we're
      //    doing and chase it. (engageAutoPilot leaves orbit + cancels any
      //    other autopilot for us.)
      if (me.selectedPlanet && me.selectedPlanet !== me.orbiting) {
        const p = world.planets.find(x => x.id === me.selectedPlanet);
        if (p && p.team === me.team) {
          pushMessage(world, `${p.name} is friendly — nothing to capture.`, "warn");
          return;
        }
        if (p) {
          engageAutoPilot(me, world, {
            type: "planet", id: p.id, name: p.name, captureOnArrival: true,
          });
          return;
        }
      }

      // 2) Already orbiting a non-friendly planet (with no different selection)
      //    → start/continue capture of the orbited planet.
      if (me.orbiting) {
        const p = world.planets.find(p => p.id === me.orbiting);
        if (p && p.team === me.team) {
          pushMessage(world, `${p.name} is already yours. Click a different planet to capture.`, "warn");
          return;
        }
        if (p && me.capturing && me.captureTarget === p.id) {
          pushMessage(world, "Already capturing.", "warn");
          return;
        }
        if (p && beginCapture(me, world)) {
          pushMessage(world, `Capture sequence started: ${p.name}. Hold orbit, keep enemies away.`, "you");
        }
        return;
      }

      pushMessage(world, "Select an enemy/neutral planet first (click it), or orbit one and press C.", "alert");
      return;
    }

    if (k === "r") {
      world.radarMode = (world.radarMode === "LONG") ? "SHORT" : "LONG";
      const btn = document.getElementById("radar-toggle");
      if (btn) btn.textContent = world.radarMode;
      pushMessage(world, `Radar: ${world.radarMode === "LONG" ? "LONG RANGE (" + RADAR_LONG_RANGE + "u)" : "SHORT RANGE (" + RADAR_SHORT_RANGE + "u)"}.`);
      return;
    }

    if (k === "escape") {
      world.paused = !world.paused;
      pushMessage(world, world.paused ? "Paused." : "Resumed.");
      return;
    }
  });
}
