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

  setText("hud-ship", `${def.name} (${me.shipClass})`);
  setText("hud-lives", world.playerLives.toString());
  setBar("bar-hull", me.hull / shipMaxHull(me, world), "green", "yellow", "red");
  setBar("bar-shield", me.shield / shipMaxShield(me, world), "blue", "blue", "red");
  setBar("bar-energy", me.energy / shipMaxEnergy(me, world), "yellow", "yellow", "red");
  setText("hud-speed", `${me.speed.toFixed(1)} / ${def.maxSpeed}`);

  let shieldStat = me.shieldsUp ? "UP" : "DOWN";
  if (!me.shieldsUp && world.now < me.shieldCollapsedUntil) {
    shieldStat = `REBOOT ${(me.shieldCollapsedUntil - world.now).toFixed(1)}s`;
  }
  setText("hud-shields", shieldStat);

  setText("hud-torps", `${me.torpCount} / ${def.torpMax}`);
  setBar("bar-torps", me.torpCount / def.torpMax, "green", "yellow", "red");
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

  // Lock indicator + tiered target info
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

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function setBar(id, frac, hi, mid, lo) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.width = Math.max(0, Math.min(100, frac * 100)) + "%";
  el.className = "bar-fill " + (frac > 0.6 ? hi : frac > 0.3 ? mid : lo);
}
