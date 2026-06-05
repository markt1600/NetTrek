// HUD + message log updates
"use strict";

// ---- Combat chatter feed (5-line scrolling band over the tactical view) ----

const TEAM_CHATTER = {
  FED: {
    attack: [
      "Hostile in range — engaging!",
      "Stand down, your fight ends here.",
      "Locking weapons on your hull!",
      "You will not pass this line!",
      "Phasers hot — fire on my mark!",
    ],
    distress: [
      "Shields buckling — need cover!",
      "Hostiles on me, requesting assist!",
      "Hull's taking a beating, captain!",
      "Multiple contacts, falling back!",
      "I'm pinned down — anyone read me?",
    ],
    dying: [
      "Lost main power — going dark!",
      "Tell command we held the line!",
      "Engines gone — abandon ship!",
      "It's been an honor, captain!",
      "Hull breach — I can't hold her!",
    ],
    victory: [
      "Planet secured for the Federation!",
      "Another world freed!",
      "Mission complete — flag raised!",
      "The system is ours!",
    ],
  },
  ROM: {
    attack: [
      "For the Empire!",
      "Your destruction is inevitable.",
      "We will leave nothing of you.",
      "Tal Shiar protocols — engage!",
      "Praetor will have your ship as a trophy.",
    ],
    distress: [
      "Centurion to fleet — assist immediately!",
      "Cloak failing — I am exposed!",
      "Hostile fire intensifying!",
      "Send the warbirds!",
      "I require support, now!",
    ],
    dying: [
      "I die for Romulus!",
      "The Empire will avenge me!",
      "My ship is lost — long live the Praetor!",
      "Tell the Senate I held the line!",
    ],
    victory: [
      "The Empire expands!",
      "Another world for Romulus!",
      "Praetor will be pleased.",
    ],
  },
  KLI: {
    attack: [
      "Sing the song of battle!",
      "Honor demands your destruction!",
      "Your hull will splinter under my fire!",
      "Cha'! Fire all weapons!",
      "The Empire claims your blood!",
    ],
    distress: [
      "Pack support needed — now!",
      "Shields cracking — assist!",
      "I cannot fight alone!",
      "Brothers, to my side!",
    ],
    dying: [
      "I die a warrior!",
      "Sto-Vo-Kor awaits!",
      "Tell my house I fought to the end!",
      "My blade has not failed me!",
    ],
    victory: [
      "Glorious conquest!",
      "Another world bends the knee!",
      "The Empire grows stronger!",
    ],
  },
  ORI: {
    attack: [
      "Your cargo, your ship — mine!",
      "Profits demand your defeat!",
      "Pay tribute or burn!",
      "The Syndicate collects today!",
      "No mercy for free traders!",
    ],
    distress: [
      "Backup — I'll pay double!",
      "Hull's failing, get over here!",
      "I'm taking serious damage!",
      "Send reinforcements — quickly!",
    ],
    dying: [
      "All that latinum... wasted...",
      "The Syndicate will collect on this!",
      "Going down — bury me in gold!",
    ],
    victory: [
      "Another revenue stream secured!",
      "Profits flow!",
      "The Syndicate prevails!",
    ],
  },
};

function pickChatter(team, category) {
  const pool = (TEAM_CHATTER[team] && TEAM_CHATTER[team][category]) || [];
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Per-ship 8s throttle keeps chatter from spamming
function maybeChatter(s, world, category, chance) {
  if (!s || !s.alive || s.isPlayer || !world) return;
  if (chance != null && Math.random() > chance) return;
  if (s._lastChatter != null && (world.now - s._lastChatter) < 8) return;
  const line = pickChatter(s.team, category);
  if (!line) return;
  s._lastChatter = world.now;
  pushChatter(world, line, s);
}

// Bypasses throttle — for meaningful events that should always show (dying, victory)
function forceChatter(s, world, category) {
  if (!s || s.isPlayer || !world) return;
  const line = pickChatter(s.team, category);
  if (!line) return;
  s._lastChatter = world.now;
  pushChatter(world, line, s);
}

function pushChatter(world, text, s) {
  if (!world) return;
  world.chatter = world.chatter || [];
  world.chatter.push({ text, team: s.team, name: s.name, bornAt: world.now });
  while (world.chatter.length > 5) world.chatter.shift();
  renderChatter(world);
}

function renderChatter(world) {
  const div = document.getElementById("chatter");
  if (!div) return;
  div.innerHTML = "";
  for (const c of (world.chatter || [])) {
    const team = TEAMS[c.team] || TEAMS.IND;
    const row = document.createElement("div");
    row.className = "chatter-line";
    row.style.borderLeftColor = team.color;
    const nm = document.createElement("span");
    nm.className = "chatter-name";
    nm.style.color = team.color;
    nm.textContent = c.name + ": ";
    row.appendChild(nm);
    row.appendChild(document.createTextNode(c.text));
    div.appendChild(row);
  }
}

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

  // Hover tooltip (cursor-following info for ship/planet under mouse)
  renderHoverTip(world);

  // Auto-fade chatter after 20 seconds
  if (world.chatter && world.chatter.length) {
    const before = world.chatter.length;
    world.chatter = world.chatter.filter(c => world.now - c.bornAt < 20);
    if (world.chatter.length !== before) renderChatter(world);
  }

  // ---- Top bar ----
  setText("top-speed", `Warp ${me.speed.toFixed(1)} / ${def.maxSpeed}`);

  let targetText = "No target selected — click a ship or planet.";
  if (me.targetLock) {
    const t = world.ships.find(o => o.id === me.targetLock && o.alive);
    if (t) {
      const d = Math.hypot(t.x - me.x, t.y - me.y);
      const team = TEAMS[t.team];
      targetText = `TARGET ▸ ${team.name} ${shipDef(t).name} "${t.name}" @ ${Math.round(d)}u`;
      // Live hull/shield readout when target is inside short-range radar
      if (d <= RADAR_SHORT_RANGE) {
        const hullPct = Math.round(100 * t.hull / shipMaxHull(t, world));
        const shieldPct = Math.round(100 * t.shield / shipMaxShield(t, world));
        const shieldStat = t.shieldsUp ? `${shieldPct}% UP` : (t.shield > 0 ? `${shieldPct}% DOWN` : "DOWN");
        targetText += `  ·  Hull ${hullPct}%  ·  Shield ${shieldStat}`;
      }
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

  // Mode indicators: Auto-Fire, Auto-Lock+Navigate, Auto-Defend, SOS, Autopilot
  const modes = [];
  if (world.autoFireEnabled) modes.push("● AUTO-FIRE");
  if (world.autoLockAndNavigate) modes.push("● AUTO-LOCK+NAV");
  if (world.autoDefendEnabled) modes.push("● AUTO-DEFEND");
  // SOS active = any friendly is currently in RESCUE mode targeting the player
  let sosResponders = 0;
  for (const f of world.ships) {
    if (f.team !== me.team || f.isPlayer || !f.alive) continue;
    if (f.aiState && f.aiState.mode === "RESCUE" && f.aiState.rescueTarget === me.id) sosResponders++;
  }
  if (sosResponders > 0) modes.push(`<span class="sos-status">▲ SOS · ${sosResponders} INBOUND</span>`);
  // Pulse the SOS button while responders are en route
  const sosBtn = document.getElementById("btn-sos");
  if (sosBtn) sosBtn.classList.toggle("sos-pending", sosResponders > 0);
  if (me.cloaked) modes.push("◐ CLOAKED");
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
  // top-status mixes plain mode strings and one HTML span (SOS), so use innerHTML
  const ts = document.getElementById("top-status");
  if (ts) ts.innerHTML = modes.join("&nbsp;&nbsp;");

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
    // Color thresholds: green 75–100%, yellow 25–75%, red 0–25%
    setBar("bar-shield", shieldPct, "green", "yellow", "red", 0.75, 0.25);
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
  const torpsLabel = `${me.torpCount} / ${shipMaxTorps(me, world)}`;
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
  } else if (me.energy < phaserEnergyCost(me, world)) {
    if (phaserBox) phaserBox.classList.add("offline");
    setText("hud-phaser-status", "Insufficient Energy");
  } else {
    if (phaserBox) phaserBox.classList.remove("offline");
    setBar("bar-phaser", readiness, "green", "yellow", "red");
    setText("hud-phaser-status", me.phaserCool > 0 ? `${me.phaserCool.toFixed(1)}s` : "READY");
  }

  setText("hud-flares", `${me.flareCount} / ${shipMaxFlares(me, world)}`);

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

  // Big capture progress banner at the top of the tactical view
  const capBanner = document.getElementById("capture-banner");
  if (capBanner) {
    if (me.capturing && me.captureTarget) {
      const p = world.planets.find(x => x.id === me.captureTarget);
      if (p) {
        const frac = Math.min(1, me.captureProgress / CAPTURE_TIME);
        const remaining = Math.max(0, CAPTURE_TIME - me.captureProgress);
        capBanner.classList.remove("hidden");
        setText("cap-planet", p.name + (p.team !== me.team ? ` (${p.team})` : ""));
        const fill = document.getElementById("cap-bar-fill");
        if (fill) fill.style.width = (frac * 100) + "%";
        setText("cap-pct", Math.round(frac * 100) + "%");
        setText("cap-time", remaining.toFixed(1) + "s");
      } else {
        capBanner.classList.add("hidden");
      }
    } else {
      capBanner.classList.add("hidden");
    }
  }
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
  const distLine = `
      <div class="ti-dist">
        <span class="ti-dist-val">${Math.round(d)}u</span>
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
      <div class="ti-row"><span>Torps</span><span>${t.torpCount} / ${shipMaxTorps(t, world)}</span></div>
      <div class="ti-row"><span>Speed</span><span>warp ${t.speed.toFixed(1)}</span></div>`;
  } else if (d < RADAR_SHORT_RANGE) {
    const hullFrac = t.hull / shipMaxHull(t, world);
    const [label, cls] = tier(hullFrac);
    body = `
      <div class="ti-row"><span>Class</span><span>${def.name}</span></div>
      <div class="ti-row"><span>Hull</span><span class="ti-${cls}">${label}</span></div>
      <div class="ti-hint">Move within ${TACTICAL_RANGE}u for full scan.</div>`;
  } else if (d < RADAR_LONG_RANGE) {
    body = `
      <div class="ti-row"><span>Type</span><span>unknown</span></div>
      <div class="ti-hint">Long-range contact. Move within ${RADAR_SHORT_RANGE}u for ship class.</div>`;
  } else {
    body = `<div class="ti-hint">Out of scanner range.</div>`;
  }
  return `
    <h3 style="color:${team.color}">TARGET · ${team.name}</h3>
    ${distLine}
    ${body}`;
}

// ---- Hover tooltips ----
function renderHoverTip(world) {
  const tip = document.getElementById("hover-tip");
  if (!tip) return;
  const h = Input.hover;
  const me = world.playerShip;
  if (!h || !me || (!h.shipId && !h.planetId)) {
    tip.classList.add("hidden");
    return;
  }
  let html = "";
  if (h.planetId) {
    const p = world.planets.find(x => x.id === h.planetId);
    if (p) {
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      html = planetHoverContent(p, d, h.source, world);
    }
  } else if (h.shipId) {
    const s = world.ships.find(x => x.id === h.shipId);
    if (s && s.alive) {
      const d = Math.hypot(s.x - me.x, s.y - me.y);
      html = shipHoverContent(s, d, h.source, world);
    }
  }
  if (!html) { tip.classList.add("hidden"); return; }
  tip.innerHTML = html;
  tip.classList.remove("hidden");
  // Offset from cursor and keep within viewport
  let x = h.clientX + 16, y = h.clientY + 16;
  const r = tip.getBoundingClientRect();
  if (x + r.width  > window.innerWidth)  x = h.clientX - r.width  - 12;
  if (y + r.height > window.innerHeight) y = h.clientY - r.height - 12;
  tip.style.left = x + "px";
  tip.style.top  = y + "px";
}

function shipHoverContent(s, d, source, world) {
  const team = TEAMS[s.team];
  const isLongRadar = source === "radar" && world.radarMode === "LONG";
  if (isLongRadar) {
    // No IFF on long-range radar
    return `
      <div class="tip-title">Unknown contact</div>
      <div class="tip-row dim">Move within short-range radar to identify.</div>
      <div class="tip-row">Distance: ${Math.round(d)}u</div>`;
  }
  const def = shipDef(s);
  const hullPct = Math.round(100 * s.hull / shipMaxHull(s, world));
  const shieldPct = Math.round(100 * s.shield / shipMaxShield(s, world));
  if (source === "tactical") {
    const energyPct = Math.round(100 * s.energy / shipMaxEnergy(s, world));
    const hullCls = hullPct > 75 ? "tip-good" : hullPct > 25 ? "tip-warn" : "tip-crit";
    const shieldCls = shieldPct > 75 ? "tip-good" : shieldPct > 25 ? "tip-warn" : "tip-crit";
    return `
      <div class="tip-title" style="color:${team.color}">${team.name} ${def.name} "${s.name}"</div>
      <div class="tip-row">Hull: <span class="${hullCls}">${hullPct}%</span></div>
      <div class="tip-row">Shield: <span class="${shieldCls}">${shieldPct}%</span> ${s.shieldsUp ? "UP" : "DOWN"}</div>
      <div class="tip-row">Energy: ${energyPct}%</div>
      <div class="tip-row">Torps: ${s.torpCount}/${shipMaxTorps(s, world)}</div>
      <div class="tip-row">Speed: warp ${s.speed.toFixed(1)}</div>
      <div class="tip-row">Distance: ${Math.round(d)}u</div>`;
  }
  // SHORT radar
  const tier = hullPct > 66 ? ["Good", "tip-good"]
              : hullPct > 33 ? ["Damaged", "tip-warn"]
              : ["Critical", "tip-crit"];
  return `
    <div class="tip-title" style="color:${team.color}">${team.name} ${def.name}</div>
    <div class="tip-row">${s.name}</div>
    <div class="tip-row">Hull: <span class="${tier[1]}">${tier[0]}</span></div>
    <div class="tip-row">Distance: ${Math.round(d)}u</div>`;
}

function planetHoverContent(p, d, source, world) {
  const team = TEAMS[p.team] || TEAMS.IND;
  const isLongRadar = source === "radar" && world.radarMode === "LONG";
  if (isLongRadar) {
    return `
      <div class="tip-title">Planet — ${p.name}</div>
      <div class="tip-row dim">Switch to short-range radar for owner.</div>
      <div class="tip-row">Distance: ${Math.round(d)}u</div>`;
  }
  const flags = planetFlagsStr(p) || "—";
  let defStat = "none";
  let defCls = "";
  if (p.defenseMaxHull > 0) {
    if (p.defenseHull <= 0) { defStat = "DESTROYED"; defCls = "tip-crit"; }
    else {
      const pct = Math.round(100 * p.defenseHull / p.defenseMaxHull);
      defStat = `${pct}%`;
      defCls = pct > 75 ? "tip-good" : pct > 25 ? "tip-warn" : "tip-crit";
    }
  }
  return `
    <div class="tip-title" style="color:${team.color}">${p.name}</div>
    <div class="tip-row">Owner: <span style="color:${team.color}">${team.name}</span></div>
    <div class="tip-row">Type: ${flags}</div>
    <div class="tip-row">Defenses: <span class="${defCls}">${defStat}</span></div>
    <div class="tip-row">Distance: ${Math.round(d)}u</div>`;
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
    </div>
    <div class="ti-row"><span>Owner</span><span style="color:${team.color}">${team.name}</span></div>
    <div class="ti-row"><span>Type</span><span>${flags}</span></div>
    ${defenseLine(p)}
    ${captureNote}`;
}

function defenseLine(p) {
  if (!p.defenseMaxHull) return "";
  const frac = p.defenseHull / p.defenseMaxHull;
  const pct = Math.round(frac * 100);
  let cls = "ti-good";
  if (frac <= 0)           cls = "ti-crit";
  else if (frac <= 0.25)   cls = "ti-crit";
  else if (frac <= 0.75)   cls = "ti-warn";
  const label = p.defenseHull <= 0 ? "DESTROYED" : `${pct}%`;
  return `<div class="ti-row"><span>Defenses</span><span class="${cls}">${label}</span></div>`;
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
function setBar(id, frac, hi, mid, lo, hiThresh, midThresh) {
  if (hiThresh === undefined) hiThresh = 0.6;
  if (midThresh === undefined) midThresh = 0.3;
  const el = document.getElementById(id);
  if (!el) return;
  el.style.width = Math.max(0, Math.min(100, frac * 100)) + "%";
  el.className = "bar-fill " + (frac > hiThresh ? hi : frac > midThresh ? mid : lo);
}
