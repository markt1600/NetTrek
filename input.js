// Input handling — mouse on tactical/galactic + keyboard
"use strict";

const Input = {
  mouseX: 0, mouseY: 0,
  hoverShipId: null,
  lastClickX: null,
  lastClickY: null,
  showRefit: false,
};

function attachInput(world) {
  const tac = document.getElementById("tactical");
  const gal = document.getElementById("galactic");

  // Disable context menu on right-click
  tac.addEventListener("contextmenu", e => e.preventDefault());
  gal.addEventListener("contextmenu", e => e.preventDefault());

  function tacticalToWorld(e) {
    const rect = tac.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (tac.width / rect.width);
    const sy = (e.clientY - rect.top) * (tac.height / rect.height);
    const me = world.playerShip;
    const scale = tac.width / TACTICAL_RANGE;
    const wx = me.x + (sx - tac.width/2) / scale;
    const wy = me.y + (sy - tac.height/2) / scale;
    return { wx, wy, sx, sy };
  }

  function galacticToWorld(e) {
    const rect = gal.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (gal.width / rect.width);
    const sy = (e.clientY - rect.top) * (gal.height / rect.height);
    return { wx: (sx / gal.width) * GALAXY_SIZE, wy: (sy / gal.height) * GALAXY_SIZE };
  }

  tac.addEventListener("mousemove", e => {
    const { wx, wy } = tacticalToWorld(e);
    Input.mouseX = wx; Input.mouseY = wy;
    // hover detect
    let best = null, bd = 60;
    for (const s of world.ships) {
      if (!s.alive || s === world.playerShip) continue;
      const d = Math.hypot(s.x - wx, s.y - wy);
      if (d < bd) { best = s; bd = d; }
    }
    Input.hoverShipId = best ? best.id : null;
  });

  tac.addEventListener("mousedown", e => {
    if (!world.playerShip.alive) return;
    const { wx, wy } = tacticalToWorld(e);
    if (e.button === 2) {
      // right click — set course
      const me = world.playerShip;
      if (me.orbiting) leaveOrbit(me);
      me.desiredHeading = Math.atan2(wy - me.y, wx - me.x);
      Input.lastClickX = wx; Input.lastClickY = wy;
      pushMessage(world, `Course set ${Math.round((me.desiredHeading * 180 / Math.PI + 90) % 360)}°.`);
    } else if (e.button === 0) {
      // left click — phaser fire
      const me = world.playerShip;
      // try target under cursor first
      let target = null;
      let bd = 60;
      for (const s of world.ships) {
        if (!s.alive || s.team === me.team) continue;
        const d = Math.hypot(s.x - wx, s.y - wy);
        if (d < bd) { target = s; bd = d; }
      }
      if (!target) target = phaserBestTarget(me, world);
      if (target) {
        const ok = firePhaser(me, world, target);
        if (!ok) pushMessage(world, "Phasers unavailable (out of range, no fuel, or cooling).", "alert");
      }
      Input.lastClickX = wx; Input.lastClickY = wy;
    }
  });

  gal.addEventListener("mousedown", e => {
    if (!world.playerShip.alive) return;
    const { wx, wy } = galacticToWorld(e);
    if (e.button === 2 || e.button === 0) {
      const me = world.playerShip;
      if (me.orbiting) leaveOrbit(me);
      me.desiredHeading = Math.atan2(wy - me.y, wx - me.x);
      Input.lastClickX = wx; Input.lastClickY = wy;
      pushMessage(world, `Galactic course set toward (${Math.round(wx)}, ${Math.round(wy)}).`);
    }
  });

  document.addEventListener("keydown", e => {
    if (world.state !== "playing") return;
    const me = world.playerShip;
    if (!me) return;
    const k = e.key.toLowerCase();

    // numbers — warp
    if (k >= "0" && k <= "9") {
      const v = parseInt(k, 10);
      me.desiredSpeed = v;
      if (me.orbiting && v > 0) leaveOrbit(me);
      pushMessage(world, `Warp ${v} commanded.`);
      e.preventDefault(); return;
    }

    if (k === "t") {
      let ang = me.heading;
      if (Input.lastClickX !== null) ang = Math.atan2(Input.lastClickY - me.y, Input.lastClickX - me.x);
      const ok = fireTorp(me, world, ang);
      if (!ok) pushMessage(world, "Torpedoes unavailable.", "alert");
      e.preventDefault(); return;
    }

    if (k === "s") {
      me.shieldsUp = !me.shieldsUp;
      pushMessage(world, `Shields ${me.shieldsUp ? "UP" : "DOWN"}.`);
      return;
    }

    if (k === "o") {
      const p = tryOrbit(me, world);
      if (p) pushMessage(world, `Entering orbit of ${p.name}.`);
      else pushMessage(world, "No planet within orbit range or speed too high.", "alert");
      return;
    }

    if (k === "b") {
      if (!me.orbiting) { pushMessage(world, "Not in orbit.", "alert"); return; }
      const p = world.planets.find(p => p.id === me.orbiting);
      if (!p) return;
      if (p.team === me.team || p.team === "IND") { pushMessage(world, "Cannot bomb friendly/neutral planet.", "alert"); return; }
      const k2 = bombPlanet(me, world);
      if (k2 > 0) pushMessage(world, `Bombing ${p.name}: -${k2} armies. (${p.armies} left)`, "you");
      else pushMessage(world, `${p.name} has too few armies (4 min) to bomb.`, "alert");
      return;
    }

    if (k === "z") {
      const dropped = beamDownArmies(me, world);
      if (dropped > 0) pushMessage(world, `Beamed ${dropped} armies down.`, "you");
      else pushMessage(world, "No armies to drop or not in orbit.", "alert");
      return;
    }

    if (k === "x") {
      const taken = beamUpArmies(me, world);
      if (taken > 0) pushMessage(world, `Beamed ${taken} armies up.`, "you");
      else pushMessage(world, "Beam-up failed (shields up, no kills, or no armies available).", "alert");
      return;
    }

    if (k === "r") {
      // open refit menu inline — cycle to next ship class
      if (!me.orbiting) { pushMessage(world, "Refit requires orbiting a friendly planet.", "alert"); return; }
      const p = world.planets.find(p => p.id === me.orbiting);
      if (!p || p.team !== me.team) { pushMessage(world, "Refit requires a friendly planet.", "alert"); return; }
      if (me.shieldsUp) { pushMessage(world, "Drop shields to refit (S).", "alert"); return; }
      const idx = SHIP_ORDER.indexOf(me.shipClass);
      const next = SHIP_ORDER[(idx + 1) % SHIP_ORDER.length];
      if (startRefit(me, world, next)) pushMessage(world, `Refitting to ${SHIPS[next].name}...`);
      return;
    }

    if (k === "y") {
      if (Input.hoverShipId) {
        const t = world.ships.find(o => o.id === Input.hoverShipId);
        if (t && t.team !== me.team && t.alive) {
          if (Math.hypot(t.x - me.x, t.y - me.y) <= TRACTOR_RANGE) {
            me.tractoring = t.id;
            me.pressoring = null;
            pushMessage(world, `Tractoring ${t.name}.`);
          } else pushMessage(world, "Target out of tractor range.", "alert");
        }
      }
      return;
    }

    if (k === "u") {
      if (Input.hoverShipId) {
        const t = world.ships.find(o => o.id === Input.hoverShipId);
        if (t && t.team !== me.team && t.alive) {
          if (Math.hypot(t.x - me.x, t.y - me.y) <= TRACTOR_RANGE) {
            me.pressoring = t.id;
            me.tractoring = null;
            pushMessage(world, `Pressoring ${t.name}.`);
          } else pushMessage(world, "Target out of pressor range.", "alert");
        }
      }
      return;
    }

    if (k === "i") {
      me.tractoring = null; me.pressoring = null;
      pushMessage(world, "Beams released.");
      return;
    }

    if (k === "escape") {
      // pause / open menu
      world.paused = !world.paused;
      pushMessage(world, world.paused ? "Paused." : "Resumed.");
      return;
    }
  });
}
