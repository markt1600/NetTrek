// HUD + message log updates
"use strict";

function pushMessage(world, text, kind) {
  if (!world) return;
  world.messages = world.messages || [];
  world.messages.push({ text, kind: kind || "", at: world.now });
  if (world.messages.length > 50) world.messages.shift();
  const log = document.getElementById("message-log");
  if (!log) return;
  const div = document.createElement("div");
  div.className = "msg " + (kind || "");
  div.textContent = text;
  log.appendChild(div);
  while (log.childNodes.length > 50) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function updateHud(world) {
  const me = world.playerShip;
  if (!me) return;
  const def = shipDef(me);

  // ---- Top bar ----
  setText("top-speed", `Warp ${me.speed.toFixed(1)} / ${def.maxSpeed}`);

  let targetText = "No target selected — click a ship or planet.";
  if (me.targetLock) {
    const t = world.ships.find(o => o.id === me.targetLock && o.alive);
    if (t) {
      const d = Math.hypot(t.x - me.x, t.y - me.y);
      const team = TEAMS[t.team];
      targetText = `TARGET ▸ ${team.name} ${shipDef(t).name} "${t.name}" @ ${Math.round(d)}u (${(d/TACTICAL_RANGE).toFixed(1)} screens)`;
    } else { me.targetLock = null; }
  } else if (me.selectedPlanet) {
    const p = world.planets.find(p => p.id === me.selectedPlanet);
    if (p) {
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      const team = TEAMS[p.team] || TEAMS.IND;
      const flagsStr = planetFlagsStr(p);
      targetText = `PLANET ▸ ${p.name} (${team.name}${flagsStr ? " · " + flagsStr : ""}) @ ${Math.round(d)}u`;
    } else { me.selectedPlanet = null; }
  }
  setText("top-target", targetText);

  // Mode indicator: AUTO-LOCK + AUTOPILOT status, comma-separated
  const modes = [];
  if (world.autoTargetEnabled) modes.push("● AUTO-LOCK");
  if (me.autoPilot) {
    const ap = me.autoPilot;
    let nm = ap.id;
    if (ap.type === "ship") {
      const t = world.ships.find(o => o.id === ap.id);
      if (t) nm = t.name;
    } else if (ap.type === "planet") {
      const p = world.planets.find(p => p.id === ap.id);
      if (p) nm = p.name;
    }
    modes.push(`▶ AUTOPILOT → ${nm}`);
  }
  setText("top-status", modes.join("  "));

  setText("hud-ship", `${def.name} (${me.shipClass})`);

  // Structural health (always shown as %)
  const hullPct = me.hull / shipMaxHull(me, world);
  setBar("bar-hull", hullPct, "green", "yellow", "red");
  setText("hud-hull-pct", `${Math.round(hullPct * 100)}%`);

  // Shields — bar visible only when shields are UP. When down/rebooting/empty,
  // hide the bar and show a status word in the same spot.
  const shieldPct = me.shield / shipMaxShield(me, world);
  const shieldBox = document.getElementById("shield-box");
  if (me.shieldsUp) {
    if (shieldBox) shieldBox.classList.remove("offline");
    setBar("bar-shield", shieldPct, "blue", "blue", "red");
    setText("hud-shield-pct", `${Math.round(shieldPct * 100)}% UP`);
  } else {
    if (shieldBox) shieldBox.classList.add("offline");
    let txt;
    if (world.now < me.shieldCollapsedUntil) txt = `REBOOT ${(me.shieldCollapsedUntil - world.now).toFixed(1)}s`;
    else if (me.energy < def.shieldDrain * 2) txt = "Insufficient Energy";
    else txt = "OFFLINE";
    setText("hud-shield-pct", txt);
  }

  setBar("bar-energy", me.energy / shipMaxEnergy(me, world), "yellow", "yellow", "red");
  setText("hud-energy-pct", `${Math.round((me.energy / shipMaxEnergy(me, world)) * 100)}%`);
  setText("hud-speed", `${me.speed.toFixed(1)} / ${def.maxSpeed}`);

  // System-offline warnings (based on structural health)
  toggleClass("warn-torps",   hullPct < SYS_TORPS_MIN_HULL);
  toggleClass("warn-phasers", hullPct < SYS_PHASERS_MIN_HULL);
  toggleClass("warn-warp",    hullPct < SYS_WARP_MIN_HULL);

  // Torpedoes — no bar, just count + status.
  const torpEl = document.getElementById("hud-torps");
  const torpsLabel = `${me.torpCount} / ${def.torpMax}`;
  if (hullPct < SYS_TORPS_MIN_HULL) {
    if (torpEl) { torpEl.textContent = `${torpsLabel} — OFFLINE`; torpEl.className = "weapon-line offline-text"; }
  } else if (me.energy < def.torpEnergy) {
    if (torpEl) { torpEl.textContent = `${torpsLabel} — Insufficient Energy`; torpEl.className = "weapon-line offline-text"; }
  } else if (me.torpCount <= 0) {
    if (torpEl) { torpEl.textContent = `${torpsLabel} — RELOADING`; torpEl.className = "weapon-line warn-text"; }
  } else {
    if (torpEl) { torpEl.textContent = torpsLabel; torpEl.className = "weapon-line"; }
  }

  // Phasers — bar shows cooldown readiness; status text says READY / Xs / OFFLINE / Insufficient.
  const phaserBox = document.getElementById("phaser-box");
  const pdef = def;
  const readiness = pdef.phaserCool > 0 ? Math.max(0, 1 - me.phaserCool / pdef.phaserCool) : 1;
  if (hullPct < SYS_PHASERS_MIN_HULL) {
    if (phaserBox) phaserBox.classList.add("offline");
    setText("hud-phaser-status", "OFFLINE");
  } else if (me.energy < pdef.phaserEnergy) {
    if (phaserBox) phaserBox.classList.add("offline");
    setText("hud-phaser-status", "Insufficient Energy");
  } else {
    if (phaserBox) phaserBox.classList.remove("offline");
    setBar("bar-phaser", readiness, "green", "yellow", "red");
    setText("hud-phaser-status", me.phaserCool > 0 ? `${me.phaserCool.toFixed(1)}s` : "READY");
  }

  setText("hud-flares", `${me.flareCount} / ${FLARE_MAX}`);

  // Incoming torpedo alert — radar border blinks red, with closest distance shown
  let incomingClosest = null;
  for (const t of world.torps) {
    if (!t.alive || t.team === me.team) continue;
    if (t.targetId !== me.id || !t.willHit) continue;
    const d = Math.hypot(t.x - me.x, t.y - me.y);
    if (!incomingClosest || d < incomingClosest.d) incomingClosest = { t, d };
  }
  const radarCv = document.getElementById("galactic");
  if (radarCv) {
    if (incomingClosest) radarCv.classList.add("incoming-alert");
    else radarCv.classList.remove("incoming-alert");
  }
  if (incomingClosest) {
    setText("hud-incoming", `INCOMING ${Math.round(incomingClosest.d)}u`);
    const inc = document.getElementById("hud-incoming-row");
    if (inc) inc.classList.remove("hidden");
  } else {
    const inc = document.getElementById("hud-incoming-row");
    if (inc) inc.classList.add("hidden");
  }

  // Lock indicator + tiered target info (ship or planet)
  const targetInfo = document.getElementById("target-info");
  if (me.targetLock) {
    const t = world.ships.find(o => o.id === me.targetLock && o.alive);
    if (t) {
      const inCone = inFiringCone(me, t);
      const d = Math.hypot(t.x - me.x, t.y - me.y);
      const status = (d < def.phaserRange && inCone) ? "FIRE" : (inCone ? "AIM" : "TURN");
      setText("hud-lock", `${t.team} ${t.shipClass} (${status})`);
      if (targetInfo) {
        targetInfo.classList.remove("hidden");
        targetInfo.innerHTML = renderTargetInfo(t, d, world);
      }
    } else {
      setText("hud-lock", "—");
      if (targetInfo) targetInfo.classList.add("hidden");
    }
  } else if (me.selectedPlanet) {
    const p = world.planets.find(p => p.id === me.selectedPlanet);
    if (p) {
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      setText("hud-lock", `${p.name} (planet)`);
      if (targetInfo) {
        targetInfo.classList.remove("hidden");
        targetInfo.innerHTML = renderPlanetInfo(p, d, world);
      }
    } else {
      setText("hud-lock", "—");
      if (targetInfo) targetInfo.classList.add("hidden");
    }
  } else {
    setText("hud-lock", "—");
    if (targetInfo) targetInfo.classList.add("hidden");
  }

  setBar("bar-cap", me.capturing ? (me.captureProgress / CAPTURE_TIME) : 0, "orange", "orange", "orange");
  setText("hud-kills", me.kills.toString());
  setText("hud-planets", me.planetsTaken.toString());
  const elapsed = Math.floor(world.now);
  setText("hud-time", `${elapsed}s`);
  const totalScore = me.score + Math.floor(world.now * SCORE_PER_SECOND);
  setText("hud-score", totalScore.toString());

  const bars = document.getElementById("team-bars");
  if (bars) {
    const counts = {};
    for (const t of TEAM_IDS) counts[t] = 0;
    counts.IND = 0;
    for (const p of world.planets) counts[p.team] = (counts[p.team] || 0) + 1;
    bars.innerHTML = "";
    const order = [me.team, ...TEAM_IDS.filter(t => t !== me.team), "IND"];
    for (const tid of order) {
      const t = TEAMS[tid];
      if (!t) continue;
      const pct = (counts[tid] / 40) * 100;
      const row = document.createElement("div");
      row.className = "team-bar";
      row.innerHTML = `
        <span style="color:${t.color}">${tid}${tid === me.team ? " *" : ""}</span>
        <span class="pip"><span class="pip-fill" style="width:${pct}%;background:${t.color}"></span></span>
        <span style="text-align:right">${counts[tid]}</span>
      `;
      bars.appendChild(row);
    }
  }
}

// Render target info card. Detail level depends on distance:
//   d < TACTICAL_RANGE      → full stats
//   d < RADAR_SHORT_RANGE   → class + hull tier + team
//   d < RADAR_LONG_RANGE    → team only (just a contact)
// Distance is always shown prominently and updates each frame.
function renderTargetInfo(t, d, world) {
  const team = TEAMS[t.team];
  const def = shipDef(t);

  function pct(v, max) { return Math.round(100 * v / max); }
  function tier(frac) {
    if (frac > 0.66) return ["Good", "good"];
    if (frac > 0.33) return ["Damaged", "warn"];
    return ["Critical", "crit"];
  }
  const screens = (d / TACTICAL_RANGE).toFixed(1);
  const distLine = `
      <div class="ti-dist">
        <span class="ti-dist-val">${Math.round(d)}u</span>
        <span class="ti-dist-sub">${screens} screens</span>
      </div>`;

  let body = "";
  if (d < TACTICAL_RANGE) {
    const hullPct = pct(t.hull, shipMaxHull(t, world));
    const shieldPct = pct(t.shield, shipMaxShield(t, world));
    const energyPct = pct(t.energy, shipMaxEnergy(t, world));
    body = `
      <div class="ti-row"><span>Class</span><span>${def.name}</span></div>
      <div class="ti-row"><span>Name</span><span>${t.name}</span></div>
      <div class="ti-row"><span>Hull</span><span>${hullPct}%</span></div>
      <div class="ti-row"><span>Shield</span><span>${shieldPct}% ${t.shieldsUp ? "(UP)" : "(DOWN)"}</span></div>
      <div class="ti-row"><span>Energy</span><span>${energyPct}%</span></div>
      <div class="ti-row"><span>Torps</span><span>${t.torpCount} / ${def.torpMax}</span></div>
      <div class="ti-row"><span>Speed</span><span>warp ${t.speed.toFixed(1)}</span></div>`;
  } else if (d < RADAR_SHORT_RANGE) {
    const hullFrac = t.hull / shipMaxHull(t, world);
    const [label, cls] = tier(hullFrac);
    body = `
      <div class="ti-row"><span>Class</span><span>${def.name}</span></div>
      <div class="ti-row"><span>Hull</span><span class="ti-${cls}">${label}</span></div>
      <div class="ti-hint">Move closer (within 1 screen) for full scan.</div>`;
  } else if (d < RADAR_LONG_RANGE) {
    body = `
      <div class="ti-row"><span>Type</span><span>unknown</span></div>
      <div class="ti-hint">Long-range contact. Move within ${Math.round(RADAR_SHORT_RANGE/TACTICAL_RANGE)} screens for ship class.</div>`;
  } else {
    body = `<div class="ti-hint">Out of scanner range.</div>`;
  }
  return `
    <h3 style="color:${team.color}">TARGET · ${team.name}</h3>
    ${distLine}
    ${body}`;
}

function planetFlagsStr(p) {
  const parts = [];
  if (p.flags & FLAG_HOME)   parts.push("HOME");
  if (p.flags & FLAG_REPAIR) parts.push("Repair");
  if (p.flags & FLAG_FUEL)   parts.push("Fuel");
  if (p.flags & FLAG_AGRI)   parts.push("Agri");
  return parts.join(", ");
}

function renderPlanetInfo(p, d, world) {
  const team = TEAMS[p.team] || TEAMS.IND;
  const screens = (d / TACTICAL_RANGE).toFixed(1);
  const flags = planetFlagsStr(p) || "—";
  const me = world.playerShip;
  const friendly = p.team === me.team;
  const captureNote = friendly
    ? "<div class=\"ti-hint\">Friendly. Orbit here to repair / refuel.</div>"
    : "<div class=\"ti-hint\">Press <b>C</b> while orbiting to capture (5s hold, no enemies nearby).</div>";
  return `
    <h3 style="color:${team.color}">PLANET · ${p.name}</h3>
    <div class="ti-dist">
      <span class="ti-dist-val">${Math.round(d)}u</span>
      <span class="ti-dist-sub">${screens} screens</span>
    </div>
    <div class="ti-row"><span>Owner</span><span style="color:${team.color}">${team.name}</span></div>
    <div class="ti-row"><span>Type</span><span>${flags}</span></div>
    ${captureNote}`;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function toggleClass(id, on) {
  const el = document.getElementById(id);
  if (!el) return;
  if (on) el.classList.remove("hidden");
  else el.classList.add("hidden");
}
function setBar(id, frac, hi, mid, lo) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.width = Math.max(0, Math.min(100, frac * 100)) + "%";
  el.className = "bar-fill " + (frac > 0.6 ? hi : frac > 0.3 ? mid : lo);
}
