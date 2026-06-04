// HUD + message log updates
"use strict";

function pushMessage(world, text, kind) {
  world.messages.push({ text, kind: kind || "", at: world.now });
  if (world.messages.length > 50) world.messages.shift();
  // also push to DOM
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
  setBar("bar-hull", me.hull / def.maxHull, "green", "yellow", "red");
  setBar("bar-shield", me.shield / def.maxShield, "blue", "blue", "red");
  setBar("bar-fuel", me.fuel / def.maxFuel, "yellow", "yellow", "red");
  setText("hud-speed", `${me.speed.toFixed(1)} / ${def.maxSpeed}`);
  setText("hud-heading", Math.round(((me.heading * 180 / Math.PI) + 450) % 360) + "°");
  setText("hud-shields", me.shieldsUp ? "UP" : "DOWN");
  setText("hud-kills", me.kills.toString());
  setText("hud-armies", `${me.armies} / ${def.maxArmies}`);
  setText("hud-score", me.score.toString());

  // team bars
  const bars = document.getElementById("team-bars");
  if (bars) {
    const counts = {};
    for (const t of TEAM_IDS) counts[t] = 0;
    counts.IND = 0;
    for (const p of world.planets) counts[p.team] = (counts[p.team] || 0) + 1;
    bars.innerHTML = "";
    for (const tid of TEAM_IDS) {
      if (!world.activeTeams.includes(tid) && counts[tid] === 0) continue;
      const t = TEAMS[tid];
      const pct = (counts[tid] / 40) * 100;
      const row = document.createElement("div");
      row.className = "team-bar";
      row.innerHTML = `
        <span style="color:${t.color}">${tid}</span>
        <span class="pip"><span class="pip-fill" style="width:${pct}%;background:${t.color}"></span></span>
        <span style="text-align:right">${counts[tid]}</span>
      `;
      bars.appendChild(row);
    }
    if (counts.IND > 0) {
      const row = document.createElement("div");
      row.className = "team-bar";
      row.innerHTML = `
        <span style="color:#888">IND</span>
        <span class="pip"><span class="pip-fill" style="width:${(counts.IND/40)*100}%;background:#888"></span></span>
        <span style="text-align:right">${counts.IND}</span>
      `;
      bars.appendChild(row);
    }
  }
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
