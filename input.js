// Input handling — mouse on tactical/galactic + keyboard
"use strict";

const Input = {
  mouseX: 0, mouseY: 0,
  hoverShipId: null,
  lastClickX: null,
  lastClickY: null,
};

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
    const scale = tac.width / TACTICAL_RANGE;
    return {
      wx: me.x + (sx - tac.width/2) / scale,
      wy: me.y + (sy - tac.height/2) / scale,
    };
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
      // Right-click sets course AND drops any target lock
      if (me.orbiting) leaveOrbit(me);
      if (me.targetLock) {
        me.targetLock = null;
        pushMessage(world, "Target lock released.", "warn");
      }
      me.desiredHeading = Math.atan2(wy - me.y, wx - me.x);
      Input.lastClickX = wx; Input.lastClickY = wy;
    } else if (e.button === 0) {
      // Left-click: prefer to lock the clicked enemy if close enough; else manual phaser
      let clicked = null, bd = 60;
      for (const s of world.ships) {
        if (!s.alive || s.team === me.team) continue;
        const d = Math.hypot(s.x - wx, s.y - wy);
        if (d < bd) { clicked = s; bd = d; }
      }
      if (clicked) {
        const dToTarget = Math.hypot(clicked.x - me.x, clicked.y - me.y);
        if (dToTarget <= LOCK_RANGE) {
          if (acquireLock(me, world, clicked)) {
            pushMessage(world, `Target locked: ${clicked.team}/${clicked.shipClass} ${clicked.name}.`, "you");
          }
        } else {
          // out of lock range — try a manual phaser shot
          const ok = firePhaser(me, world, clicked);
          if (!ok) pushMessage(world, "Out of phaser range / cooling.", "alert");
        }
      } else {
        // no target under cursor — phaser the nearest in-range enemy
        const fallback = phaserBestTarget(me, world);
        if (fallback) firePhaser(me, world, fallback);
      }
      Input.lastClickX = wx; Input.lastClickY = wy;
    }
  });

  gal.addEventListener("mousedown", e => {
    const me = world.playerShip;
    if (!me || !me.alive) return;
    const { wx, wy } = galacticToWorld(e);

    // Tolerance for "clicked on a ship dot" depends on zoom level
    const range = (world.radarMode === "LONG") ? RADAR_LONG_RANGE : RADAR_SHORT_RANGE;
    const tol = range / gal.width * 8;  // ~8 px tolerance
    let clickedShip = null, bd = tol;
    for (const s of world.ships) {
      if (!s.alive || s === me) continue;
      const d = Math.hypot(s.x - wx, s.y - wy);
      if (d < bd) { clickedShip = s; bd = d; }
    }

    if (clickedShip) {
      // Lock that ship (info detail set elsewhere by distance) and head to its position
      me.targetLock = clickedShip.id;
      const team = TEAMS[clickedShip.team];
      const known = world.radarMode === "SHORT"
        ? `${team.name} ${clickedShip.shipClass}`
        : `${team.name} contact`;
      pushMessage(world, `Radar lock: ${known}. Heading toward target.`, "you");
      if (me.orbiting) leaveOrbit(me);
      me.desiredHeading = Math.atan2(clickedShip.y - me.y, clickedShip.x - me.x);
      Input.lastClickX = clickedShip.x;
      Input.lastClickY = clickedShip.y;
      return;
    }

    // Plain click: set course
    if (me.orbiting) leaveOrbit(me);
    me.desiredHeading = Math.atan2(wy - me.y, wx - me.x);
    Input.lastClickX = wx; Input.lastClickY = wy;
    pushMessage(world, `Radar course set.`);
  });

  document.addEventListener("keydown", e => {
    if (world.state !== "playing") return;
    const me = world.playerShip;
    if (!me) return;
    const k = e.key.toLowerCase();

    if (k >= "0" && k <= "9") {
      const v = parseInt(k, 10);
      me.desiredSpeed = v;
      if (me.orbiting && v > 0) leaveOrbit(me);
      e.preventDefault();
      return;
    }

    if (k === "t") {
      // If locked + in cone + ready, fire at locked target (probability rolls).
      if (me.targetLock) {
        const t = world.ships.find(o => o.id === me.targetLock && o.alive);
        if (t && inFiringCone(me, t)) {
          const aimAng = Math.atan2(t.y - me.y, t.x - me.x);
          const ok = fireTorp(me, world, aimAng, t);
          if (!ok) pushMessage(world, "Torpedo unavailable (cooling, empty, or low energy).", "alert");
          return;
        }
      }
      // Unguided manual shot — no target, no homing, deterministic hit
      let ang = me.heading;
      if (Input.lastClickX !== null) ang = Math.atan2(Input.lastClickY - me.y, Input.lastClickX - me.x);
      const ok = fireTorp(me, world, ang);
      if (!ok) pushMessage(world, "Torpedo unavailable (cooling, empty, or low energy).", "alert");
      return;
    }

    if (k === "d") {
      const msg = deployFlare(me, world);
      pushMessage(world, msg, msg.startsWith("Flare diverted") ? "you" : "warn");
      return;
    }

    if (k === "s") {
      const denied = toggleShields(me, world);
      if (denied) pushMessage(world, denied, "alert");
      else pushMessage(world, `Shields ${me.shieldsUp ? "UP" : "DOWN"}.`);
      return;
    }

    if (k === "f") {
      // Toggle target lock on nearest enemy in lock range
      if (me.targetLock) {
        me.targetLock = null;
        pushMessage(world, "Target lock released.");
      } else {
        const target = nearestEnemyForLock(me, world);
        if (target) {
          if (acquireLock(me, world, target)) {
            pushMessage(world, `Target locked: ${target.team}/${target.shipClass} ${target.name}.`, "you");
          }
        } else {
          pushMessage(world, "No enemy in lock range.", "warn");
        }
      }
      return;
    }

    if (k === "o") {
      const p = tryOrbit(me, world);
      if (p) pushMessage(world, `Entering orbit of ${p.name}${p.team !== me.team ? " (" + p.team + ")" : ""}.`);
      else pushMessage(world, "No planet within orbit range or speed too high.", "alert");
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
      pushMessage(world, `Radar: ${world.radarMode === "LONG" ? "LONG RANGE (20 screens)" : "SHORT RANGE (5 screens)"}.`);
      return;
    }

    if (k === "escape") {
      world.paused = !world.paused;
      pushMessage(world, world.paused ? "Paused." : "Resumed.");
      return;
    }
  });
}
