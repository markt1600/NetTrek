// Main entry — wires screens together, runs the game loop
"use strict";

let world = null;
let nextShipId = 1;

function newWorld(playerTeam, playerClass, difficulty, playerShieldMult, playerTorpMult, playerFlareMult) {
  const planets = generateGalaxy(playerTeam, Math.floor(Math.random() * 1e9));

  const w = {
    activeTeams: TEAM_IDS.slice(),
    playerTeam,
    aiDifficulty: difficulty,
    playerShieldMult: playerShieldMult || 1,
    playerTorpMult:   playerTorpMult   || 1,
    playerFlareMult:  playerFlareMult  || 1,
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
  // Apply player-only difficulty bonuses to the initial loadout (Cadet etc.)
  me.torpCount  = shipMaxTorps(me, w);
  me.flareCount = shipMaxFlares(me, w);
  me.shield     = shipMaxShield(me, w);

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

  // Enemy AI: each enemy home spawns at least 4 ships. With enemy bases now
  // placed near the player (1 in short radar, 2 in long radar), patrollers
  // are no longer needed — combat starts as soon as the player engages.
  const enemyTeams = TEAM_IDS.filter(t => t !== playerTeam);
  const shipsPerEnemyBase = 4 + (difficulty >= 1.4 ? 1 : 0) + (difficulty >= 1.8 ? 1 : 0);
  for (const team of enemyTeams) {
    const tHome = planets.find(p => p.origTeam === team && (p.flags & FLAG_HOME));
    const names = botNames(team);
    for (let i = 0; i < shipsPerEnemyBase; i++) {
      const ang = (i / shipsPerEnemyBase) * Math.PI * 2 + Math.random() * 0.4;
      const radius = 280 + (i % 2) * 120;
      const sh = makeShip({
        id: nextShipId++,
        name: names[i] || (team + "-" + (i+1)),
        team,
        shipClass: pickAiClass(),
        x: tHome.x + Math.cos(ang) * radius,
        y: tHome.y + Math.sin(ang) * radius,
        heading: ang,
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

  // Planet defenses — home planets fire phasers at enemies within range
  planetDefenseTick(world, dt);

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

  // Audio: torpedo-lock alarm tracks any incoming hostile willHit torp
  if (world.playerShip && world.playerShip.alive) {
    const pid = world.playerShip.id;
    const ptm = world.playerShip.team;
    let incoming = false;
    for (const t of world.torps) {
      if (t.alive && t.team !== ptm && t.targetId === pid && t.willHit) { incoming = true; break; }
    }
    if (incoming && !world._alarmOn) { startTorpAlarm(); world._alarmOn = true; }
    else if (!incoming && world._alarmOn) { stopTorpAlarm(); world._alarmOn = false; }
  } else if (world._alarmOn) {
    stopTorpAlarm(); world._alarmOn = false;
  }
}

function endGame(world, won, msg) {
  if (world.state !== "playing") return;
  world.state = "ended";
  stopAmbient();
  stopTorpAlarm();
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
  // Audio must be initialized in response to a user gesture (Engage click).
  initAudio();
  playIntroFanfare();
  setTimeout(() => { if (world && world.state === "playing") startAmbient(); }, 3700);

  const team = document.getElementById("team-select").value;
  const ship = document.getElementById("ship-select").value;
  const diffRaw = document.getElementById("diff-select").value;
  // "cadet" is a special value: same AI behaviour as Lieutenant, but the
  // player gets 10× shield HP, 3× torpedoes, and 3× flares.
  let diff, shieldMult, torpMult, flareMult;
  if (diffRaw === "cadet") {
    diff = 1.0; shieldMult = 10; torpMult = 3; flareMult = 3;
  } else {
    diff = parseFloat(diffRaw); shieldMult = 1; torpMult = 1; flareMult = 1;
  }
  world = newWorld(team, ship, diff, shieldMult, torpMult, flareMult);
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
  btn("btn-help",      () => openHelp());
  btn("btn-help-close",() => closeHelp());
  btn("btn-mute",      () => {
    muteAudio(!Audio.muted);
    const b = document.getElementById("btn-mute");
    if (b) b.textContent = Audio.muted ? "🔇" : "🔊";
    if (Audio.muted) { stopAmbient(); stopTorpAlarm(); if (world) world._alarmOn = false; }
    else if (world && world.state === "playing") startAmbient();
  });
  // Click on the dark backdrop closes too
  const helpEl = document.getElementById("help-overlay");
  if (helpEl) helpEl.addEventListener("click", (e) => {
    if (e.target === helpEl) closeHelp();
  });
});

function openHelp() {
  const el = document.getElementById("help-overlay");
  if (!el) return;
  el.classList.remove("hidden");
  if (world) world.paused = true;
}
function closeHelp() {
  const el = document.getElementById("help-overlay");
  if (!el) return;
  el.classList.add("hidden");
  if (world) world.paused = false;
}
function isHelpOpen() {
  const el = document.getElementById("help-overlay");
  return el && !el.classList.contains("hidden");
}
