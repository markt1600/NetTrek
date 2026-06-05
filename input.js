// Input handling — mouse on tactical/galactic + keyboard
"use strict";

const Input = {
  mouseX: 0, mouseY: 0,
  hoverShipId: null,
  lastClickX: null,
  lastClickY: null,
};

// ---- Shared helpers used by both keyboard and top-bar buttons ----

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
    let best = null, bd = 60;
    for (const s of world.ships) {
      if (!s.alive || s === world.playerShip) continue;
      const d = Math.hypot(s.x - wx, s.y - wy);
      if (d < bd) { best = s; bd = d; }
    }
    Input.hoverShipId = best ? best.id : null;
  });

  tac.addEventListener("mousedown", e => {
    const me = world.playerShip;
    if (!me || !me.alive) return;
    const { wx, wy } = tacticalToWorld(e);
    if (e.button === 2) {
      // Right-click sets course AND drops any target lock / autopilot
      if (me.orbiting) leaveOrbit(me);
      if (me.targetLock) { me.targetLock = null; pushMessage(world, "Target lock released.", "warn"); }
      clearAutoPilot(me, world, "manual course set");
      me.desiredHeading = Math.atan2(wy - me.y, wx - me.x);
      // If the ship was stopped, give it a kick — feature 1
      if (me.desiredSpeed <= 0) me.desiredSpeed = 1;
      Input.lastClickX = wx; Input.lastClickY = wy;
    } else if (e.button === 0) {
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
      clearAutoPilot(me, world, "manual course set");
      me.desiredHeading = Math.atan2(clickedShip.y - me.y, clickedShip.x - me.x);
      if (me.desiredSpeed <= 0) me.desiredSpeed = 1;
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

    if (k >= "0" && k <= "9") {
      const v = parseInt(k, 10);
      me.desiredSpeed = v;
      if (me.orbiting && v > 0) leaveOrbit(me);
      clearAutoPilot(me, world, "manual speed change");
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
      const r = tryOrbit(me, world);
      if (r && r.team) {
        // immediate orbit
        pushMessage(world, `Entering orbit of ${r.name}${r.team !== me.team ? " (" + r.team + ")" : ""}.`);
      } else if (r && r.pending) {
        if (r.tooFast) pushMessage(world, `Decelerating to orbit ${r.planet.name} (still ${Math.round(r.dist)}u away).`, "warn");
        else           pushMessage(world, `Approaching ${r.planet.name} for orbit (${Math.round(r.dist)}u).`, "warn");
      } else {
        pushMessage(world, "No planet nearby to orbit.", "alert");
      }
      return;
    }

    if (k === "c") {
      if (!me.orbiting) { pushMessage(world, "Must orbit a planet first (O).", "alert"); return; }
      const p = world.planets.find(p => p.id === me.orbiting);
      if (!p) return;
      if (p.team === me.team) { pushMessage(world, `${p.name} is already yours.`, "warn"); return; }
      if (me.capturing && me.captureTarget === p.id) {
        pushMessage(world, "Already capturing.", "warn");
        return;
      }
      if (beginCapture(me, world)) {
        pushMessage(world, `Capture sequence started: ${p.name}. Hold orbit, keep enemies away.`, "you");
      }
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
