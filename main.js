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
  if (!world || world.state !== "playing") { requestAnimationFrame(loop); return; }
  if (!_last) _last = ts;
  let dt = (ts - _last) / 1000;
  if (dt > 0.1) dt = 0.1;
  _last = ts;
  tick(world, dt);
  drawAll(world);
  updateHud(world);
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
  _last = 0;
  requestAnimationFrame(loop);
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("start-btn").addEventListener("click", startGame);
  document.getElementById("end-btn").addEventListener("click", () => {
    document.getElementById("end-screen").classList.add("hidden");
    document.getElementById("start-screen").classList.remove("hidden");
  });
  // Radar mode toggle button
  const rt = document.getElementById("radar-toggle");
  if (rt) rt.addEventListener("click", () => {
    if (!world) return;
    world.radarMode = (world.radarMode === "LONG") ? "SHORT" : "LONG";
    rt.textContent = world.radarMode;
  });
});
