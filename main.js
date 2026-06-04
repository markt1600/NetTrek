// Main entry — wires screens together, manages the game loop
"use strict";

let world = null;
let nextShipId = 1;

function newWorld(playerTeam, difficulty, length) {
  const activeTeams = length === "quick"
    ? [playerTeam, opponentTeams(playerTeam)[0], opponentTeams(playerTeam)[1]].slice(0, 3)
    : TEAM_IDS.slice();
  // Always include playerTeam
  if (!activeTeams.includes(playerTeam)) activeTeams.push(playerTeam);

  const planets = generateGalaxy(activeTeams, Math.floor(Math.random() * 1e9));

  const w = {
    activeTeams,
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
  };

  // Make 4 bots per team + player as bot replacement
  for (const team of activeTeams) {
    const home = planets.find(p => p.origTeam === team && (p.flags & FLAG_HOME));
    const cls = team === playerTeam ? "CA" : pickInitialClass();
    const isPlayer = (team === playerTeam);
    // Player ship
    if (isPlayer) {
      const me = makeShip({
        id: nextShipId++, name: "You", team, shipClass: "CA",
        x: home.x + 100, y: home.y, heading: 0, isPlayer: true,
      });
      me.kills = 0;
      w.ships.push(me);
      w.playerShip = me;
    }
    // Bots — fewer teammates for the player's team since player is one of them
    const numBots = isPlayer ? 3 : 4;
    const names = botNames(team).slice(0, numBots);
    for (let i = 0; i < numBots; i++) {
      const ang = (i / numBots) * Math.PI * 2;
      const sh = makeShip({
        id: nextShipId++,
        name: names[i],
        team,
        shipClass: pickInitialClass(),
        x: home.x + Math.cos(ang) * 250,
        y: home.y + Math.sin(ang) * 250,
        heading: ang,
      });
      w.ships.push(sh);
    }
  }

  return w;
}

function pickInitialClass() {
  // distribution: more cruisers/destroyers, some assault
  const arr = ["CA","CA","DD","DD","SC","BB","AS","AS"];
  return arr[Math.floor(Math.random() * arr.length)];
}

function opponentTeams(team) {
  return TEAM_IDS.filter(t => t !== team);
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

// ---------------- Main game tick ----------------
function tick(world, dt) {
  if (world.paused) return;
  world.now += dt;

  // planet growth
  for (const p of world.planets) planetTickGrow(p, dt);

  // ships AI
  for (const s of world.ships) aiTick(s, world, dt);

  // ship physics
  for (const s of world.ships) shipTick(s, world, dt);

  // torps
  for (const t of world.torps) torpTick(t, world, dt);
  world.torps = world.torps.filter(t => t.alive);

  // beams: drop expired
  world.beams = world.beams.filter(b => b.until > world.now);

  // win check
  checkVictory(world);
}

function checkVictory(world) {
  const counts = {};
  for (const p of world.planets) counts[p.team] = (counts[p.team] || 0) + 1;
  const me = world.playerShip;
  if (!me) return;

  // If player team owns all non-IND planets
  const nonInd = Object.entries(counts).filter(([k]) => k !== "IND");
  const playerCount = counts[me.team] || 0;

  if (nonInd.length === 1 && nonInd[0][0] === me.team) {
    endGame(world, true, "Your team has conquered the galaxy.");
    return;
  }
  if (playerCount === 0) {
    endGame(world, false, "Your team has been eliminated.");
    return;
  }
}

function endGame(world, won, msg) {
  if (world.state !== "playing") return;
  world.state = "ended";
  const screen = document.getElementById("end-screen");
  document.getElementById("end-title").textContent = won ? "Victory" : "Defeat";
  const elapsed = ((Date.now() - world.startedAt) / 1000).toFixed(0);
  const me = world.playerShip;
  document.getElementById("end-stats").innerHTML =
    `${msg}<br><br>` +
    `Time: ${elapsed}s &middot; Score: ${me.score} &middot; ` +
    `Kills: ${me.deaths >= 0 ? me.kills : 0} &middot; ` +
    `Planets taken: ${me.planetsTaken} &middot; ` +
    `Deaths: ${me.deaths}`;
  document.getElementById("game-screen").classList.add("hidden");
  screen.classList.remove("hidden");
}

// ---------------- Loop / bootstrap ----------------
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
  const diff = parseFloat(document.getElementById("diff-select").value);
  const len = document.getElementById("length-select").value;
  world = newWorld(team, diff, len);
  attachInput(world);

  document.getElementById("message-log").innerHTML = "";
  pushMessage(world, `Welcome aboard, ${TEAMS[team].name} captain.`, "you");
  pushMessage(world, `Goal: capture all enemy planets. Press H or click Instructions for controls.`);

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
  document.getElementById("help-btn").addEventListener("click", () => {
    document.getElementById("start-screen").classList.add("hidden");
    document.getElementById("help-screen").classList.remove("hidden");
  });
  document.getElementById("help-back-btn").addEventListener("click", () => {
    document.getElementById("help-screen").classList.add("hidden");
    document.getElementById("start-screen").classList.remove("hidden");
  });
});
