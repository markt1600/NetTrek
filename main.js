// Main entry — wires screens together, runs the game loop
"use strict";

let world = null;
let nextShipId = 1;

function newWorld(playerTeam, playerClass, difficulty) {
  const planets = generateGalaxy(playerTeam, Math.floor(Math.random() * 1e9));

  const w = {
    activeTeams: TEAM_IDS.slice(),
    playerTeam,
    aiDifficulty: difficulty,
    planets,
    ships: [],
    torps: [],
    beams: [],
    nextTorpId: 1,
    messages: [],
    now: 0,
    state: "playing",
    paused: false,
    startedAt: Date.now(),
    playerShip: null,
    playerLives: PLAYER_LIVES,
    teamBonus: {},
    endResult: null,
    radarMode: "SHORT",
    zoomLevel: 0,
    autoFireEnabled: true,       // auto-fire weapons at locked target when in cone + range
    autoLockAndNavigate: false,  // continuously lock nearest enemy AND autopilot to it
    autoDefendEnabled: false,    // auto-raise shields + auto-flare when threats appear
  };
  recomputeBonuses(w);

  // Player ship spawn at their home planet
  const home = planets.find(p => p.origTeam === playerTeam && (p.flags & FLAG_HOME));
  const me = makeShip({
    id: nextShipId++, name: "You", team: playerTeam, shipClass: playerClass,
    x: home.x + 100, y: home.y, heading: 0, isPlayer: true,
  });
  w.ships.push(me);
  w.playerShip = me;

  // Two friendly AI defenders spawn at the player's home and patrol there,
  // intercepting incoming enemies.
  {
    const friendlyNames = ["Sulu", "Chekov", "Uhura"];
    for (let i = 0; i < 2; i++) {
      const ang = (i / 2) * Math.PI * 2 + Math.PI / 3;
      const sh = makeShip({
        id: nextShipId++,
        name: friendlyNames[i],
        team: playerTeam,
        shipClass: pickAiClass(),
        x: home.x + Math.cos(ang) * 350,
        y: home.y + Math.sin(ang) * 350,
        heading: ang,
      });
      w.ships.push(sh);
    }
  }

  // AI bots: each enemy team gets one defender at its home AND one patroller
  // wandering in mid-galaxy near the player, so the player has nearby contacts
  // to interact with without flying for 3 minutes.
  const enemyTeams = TEAM_IDS.filter(t => t !== playerTeam);
  const patrollersPerTeam = difficulty >= 1.4 ? 2 : 1;
  for (const team of enemyTeams) {
    const tHome = planets.find(p => p.origTeam === team && (p.flags & FLAG_HOME));
    const names = botNames(team);

    // Defender at home
    let nameIdx = 0;
    {
      const ang = Math.random() * Math.PI * 2;
      const sh = makeShip({
        id: nextShipId++,
        name: names[nameIdx++] || (team + "-H"),
        team,
        shipClass: pickAiClass(),
        x: tHome.x + Math.cos(ang) * 250,
        y: tHome.y + Math.sin(ang) * 250,
        heading: ang,
      });
      w.ships.push(sh);
    }

    // Patroller(s) — spawn somewhere within long-radar range of the player so
    // there's something to do from minute one.
    for (let i = 0; i < patrollersPerTeam; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = RADAR_SHORT_RANGE + Math.random() * (RADAR_LONG_RANGE - RADAR_SHORT_RANGE);
      let px = w.playerShip.x + Math.cos(ang) * dist;
      let py = w.playerShip.y + Math.sin(ang) * dist;
      // keep within galaxy
      px = Math.max(2000, Math.min(GALAXY_SIZE - 2000, px));
      py = Math.max(2000, Math.min(GALAXY_SIZE - 2000, py));
      const sh = makeShip({
        id: nextShipId++,
        name: names[nameIdx++] || (team + "-P" + i),
        team,
        shipClass: pickAiClass(),
        x: px, y: py,
        heading: ang + Math.PI,
      });
      w.ships.push(sh);
    }
  }

  return w;
}

function pickAiClass() {
  const arr = ["CA","CA","DD","DD","SC","BB"];
  return arr[Math.floor(Math.random() * arr.length)];
}

function botNames(team) {
  const base = {
    FED: ["Picard","Kirk","Sisko","Janeway","Archer"],
    ROM: ["Tomalak","Sela","Donatra","Nero","Tal'aura"],
    KLI: ["Worf","Kor","Kang","Koloth","Martok"],
    ORI: ["Verad","Devik","Garon","Brakzz","Krezzin"],
  };
  return (base[team] || []).slice();
}

function tick(world, dt) {
  if (world.paused) return;
  world.now += dt;

  for (const s of world.ships) aiTick(s, world, dt);
  for (const s of world.ships) shipTick(s, world, dt);

  for (const t of world.torps) torpTick(t, world, dt);
  world.torps = world.torps.filter(t => t.alive);

  world.beams = world.beams.filter(b => b.until > world.now);
  if (world.impacts) world.impacts = world.impacts.filter(i => i.until > world.now);

  // Flare visual effects: drift outward, then fade
  if (!world.flareEffects) world.flareEffects = [];
  for (const f of world.flareEffects) {
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.vx *= 0.94; f.vy *= 0.94;
  }
  world.flareEffects = world.flareEffects.filter(f => world.now < f.until);

  // Recompute bonuses occasionally to handle slow shifts in planet ownership
  if (!world._bonusRecomputeAt) world._bonusRecomputeAt = 0;
  if (world.now > world._bonusRecomputeAt) {
    world._bonusRecomputeAt = world.now + 1.0;
    recomputeBonuses(world);
  }
}

function endGame(world, won, msg) {
  if (world.state !== "playing") return;
  world.state = "ended";
  world.endResult = won ? "win" : "loss";
  const screen = document.getElementById("end-screen");
  document.getElementById("end-title").textContent = "GAME OVER";
  const elapsed = ((Date.now() - world.startedAt) / 1000).toFixed(0);
  const me = world.playerShip;
  const score = me.score + Math.floor(world.now * SCORE_PER_SECOND);
  document.getElementById("end-stats").innerHTML =
    `${msg}<br><br>` +
    `Time survived: <b>${elapsed}s</b><br>` +
    `Kills: <b>${me.kills}</b><br>` +
    `Planets captured: <b>${me.planetsTaken}</b><br>` +
    `Deaths: <b>${me.deaths}</b><br>` +
    `Final score: <b>${score}</b>`;
  document.getElementById("game-screen").classList.add("hidden");
  screen.classList.remove("hidden");
}

let _last = 0;
function loop(ts) {
  try {
    if (!world || world.state !== "playing") { requestAnimationFrame(loop); return; }
    if (!_last) _last = ts;
    let dt = (ts - _last) / 1000;
    if (dt > 0.1) dt = 0.1;
    _last = ts;
    tick(world, dt);
    drawAll(world);
    updateHud(world);
  } catch (e) {
    // Log but keep the loop alive so a stray bug never freezes the game.
    console.error("Game loop error:", e);
    if (world) pushMessage(world, "Internal error logged to console (game continues).", "alert");
  }
  requestAnimationFrame(loop);
}

function startGame() {
  const team = document.getElementById("team-select").value;
  const ship = document.getElementById("ship-select").value;
  const diff = parseFloat(document.getElementById("diff-select").value);
  world = newWorld(team, ship, diff);
  attachInput(world);

  document.getElementById("message-log").innerHTML = "";
  pushMessage(world, `Welcome aboard, captain. You command the ${SHIPS[ship].name}.`, "you");
  pushMessage(world, `Stay alive. Capture planets to grow stronger. Press C while orbiting an enemy/neutral planet to claim it.`);

  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("end-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  // Sync toggle button visuals to initial world state
  const af = document.getElementById("btn-autofire");
  if (af) af.classList.toggle("active", world.autoFireEnabled);
  const aln = document.getElementById("btn-autolocknav");
  if (aln) aln.classList.toggle("active", world.autoLockAndNavigate);
  const ad = document.getElementById("btn-autodefend");
  if (ad) ad.classList.toggle("active", world.autoDefendEnabled);
  _last = 0;
  requestAnimationFrame(loop);
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("start-btn").addEventListener("click", startGame);
  document.getElementById("end-btn").addEventListener("click", () => {
    document.getElementById("end-screen").classList.add("hidden");
    document.getElementById("start-screen").classList.remove("hidden");
  });
  // Enter starts the game when start or end screen is visible
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const startVis = !document.getElementById("start-screen").classList.contains("hidden");
    const endVis = !document.getElementById("end-screen").classList.contains("hidden");
    if (startVis) { e.preventDefault(); startGame(); }
    else if (endVis) {
      e.preventDefault();
      document.getElementById("end-screen").classList.add("hidden");
      document.getElementById("start-screen").classList.remove("hidden");
    }
  });
  // Radar mode toggle button
  const rt = document.getElementById("radar-toggle");
  if (rt) rt.addEventListener("click", () => {
    if (!world) return;
    world.radarMode = (world.radarMode === "LONG") ? "SHORT" : "LONG";
    rt.textContent = world.radarMode;
  });

  // Top-bar buttons
  const btn = (id, fn) => { const e = document.getElementById(id); if (e) e.addEventListener("click", fn); };
  btn("btn-zoom-in",   () => world && cycleZoom(world, +1));
  btn("btn-zoom-out",  () => world && cycleZoom(world, -1));
  btn("btn-autofire",  () => {
    if (!world) return;
    world.autoFireEnabled = !world.autoFireEnabled;
    pushMessage(world, `Auto-Fire on target: ${world.autoFireEnabled ? "ON" : "OFF"}.`, world.autoFireEnabled ? "you" : "warn");
    document.getElementById("btn-autofire").classList.toggle("active", world.autoFireEnabled);
  });
  btn("btn-autolocknav", () => {
    if (!world) return;
    world.autoLockAndNavigate = !world.autoLockAndNavigate;
    pushMessage(world, `Auto-Lock & Navigate: ${world.autoLockAndNavigate ? "ON" : "OFF"}.`, world.autoLockAndNavigate ? "you" : "warn");
    document.getElementById("btn-autolocknav").classList.toggle("active", world.autoLockAndNavigate);
    if (!world.autoLockAndNavigate && world.playerShip && world.playerShip.autoPilot
        && world.playerShip.autoPilot.type === "ship") {
      world.playerShip.autoPilot = null;
    }
  });
  btn("btn-autodefend", () => {
    if (!world) return;
    world.autoDefendEnabled = !world.autoDefendEnabled;
    pushMessage(world, `Auto-Defend: ${world.autoDefendEnabled ? "ON" : "OFF"}.`, world.autoDefendEnabled ? "you" : "warn");
    document.getElementById("btn-autodefend").classList.toggle("active", world.autoDefendEnabled);
  });
  btn("btn-autopilot", () => world && engagePlayerAutopilotToTarget(world.playerShip, world));
  btn("btn-sos",       () => world && triggerSOS(world.playerShip, world));
  btn("btn-home",      () => world && engagePlayerAutopilotToHome(world.playerShip, world));
});
