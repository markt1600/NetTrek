// NetTrek constants — teams, ship classes, planet types
"use strict";

// Galaxy is a 10000x10000 unit square. Tactical view shows ~3000 units across.
const GALAXY_SIZE = 10000;
const TACTICAL_RANGE = 3000; // diameter visible on tactical
const TICK_HZ = 30;
const DT = 1 / TICK_HZ;

const TEAMS = {
  FED: { id: "FED", name: "Federation", color: "#64b5f6", colorDim: "#1f3a5a", short: "FED" },
  ROM: { id: "ROM", name: "Romulans",   color: "#4caf50", colorDim: "#1f4f1f", short: "ROM" },
  KLI: { id: "KLI", name: "Klingons",   color: "#ef5350", colorDim: "#5a1f1f", short: "KLI" },
  ORI: { id: "ORI", name: "Orions",     color: "#ffc107", colorDim: "#5a4a1f", short: "ORI" },
  IND: { id: "IND", name: "Independent",color: "#888888", colorDim: "#333333", short: "IND" },
};

const TEAM_IDS = ["FED", "ROM", "KLI", "ORI"];

// Ship classes: based loosely on Bronco Netrek
//   maxSpeed in warp (units/sec per warp ~= 80; so warp 6 = 480 u/s)
//   maxFuel, maxShield, maxHull, turnRate (rad/sec), phaserDmg, phaserRange,
//   torpSpeed, torpDmg, torpRange (max travel before fizzle), torpFuel,
//   phaserFuel, maxArmies, accel (warp/sec), refuelRate, repairRate
const SHIPS = {
  SC: { id: "SC", name: "Scout",
        maxSpeed: 12, accel: 1.6, turnRate: 3.0,
        maxFuel: 5000, maxShield: 75, maxHull: 75,
        phaserDmg: 75, phaserRange: 1800, phaserFuel: 400, phaserCool: 1.2,
        torpSpeed: 1400, torpDmg: 25, torpRange: 3000, torpFuel: 300, torpCool: 0.4,
        maxArmies: 2, refuelBase: 8, repairBase: 0.5,
        radius: 11 },
  DD: { id: "DD", name: "Destroyer",
        maxSpeed: 10, accel: 1.2, turnRate: 2.2,
        maxFuel: 7000, maxShield: 85, maxHull: 85,
        phaserDmg: 85, phaserRange: 2000, phaserFuel: 500, phaserCool: 1.5,
        torpSpeed: 1300, torpDmg: 35, torpRange: 2800, torpFuel: 350, torpCool: 0.45,
        maxArmies: 5, refuelBase: 10, repairBase: 0.6,
        radius: 12 },
  CA: { id: "CA", name: "Cruiser",
        maxSpeed: 9, accel: 1.0, turnRate: 2.0,
        maxFuel: 10000, maxShield: 100, maxHull: 100,
        phaserDmg: 100, phaserRange: 2200, phaserFuel: 600, phaserCool: 1.6,
        torpSpeed: 1200, torpDmg: 40, torpRange: 2800, torpFuel: 400, torpCool: 0.5,
        maxArmies: 8, refuelBase: 12, repairBase: 0.7,
        radius: 13 },
  BB: { id: "BB", name: "Battleship",
        maxSpeed: 7, accel: 0.7, turnRate: 1.5,
        maxFuel: 14000, maxShield: 130, maxHull: 130,
        phaserDmg: 105, phaserRange: 2400, phaserFuel: 700, phaserCool: 1.8,
        torpSpeed: 1100, torpDmg: 40, torpRange: 2800, torpFuel: 500, torpCool: 0.55,
        maxArmies: 6, refuelBase: 10, repairBase: 0.8,
        radius: 15 },
  AS: { id: "AS", name: "Assault",
        maxSpeed: 8, accel: 0.9, turnRate: 1.8,
        maxFuel: 9000, maxShield: 80, maxHull: 90,
        phaserDmg: 80, phaserRange: 2000, phaserFuel: 550, phaserCool: 1.8,
        torpSpeed: 1100, torpDmg: 30, torpRange: 2800, torpFuel: 450, torpCool: 0.6,
        maxArmies: 20, refuelBase: 10, repairBase: 0.7,
        radius: 14 },
};

const SHIP_ORDER = ["SC", "DD", "CA", "BB", "AS"];

// Planet flags
const FLAG_REPAIR = 1;
const FLAG_FUEL = 2;
const FLAG_AGRI = 4;
const FLAG_HOME = 8;

const PLANET_RADIUS = 60;          // physical radius in galaxy units
const ORBIT_RADIUS = 120;          // distance at which you can orbit
const ORBIT_MAX_SPEED = 2;         // warp 2 max to orbit

// Bombing / armies
const BOMB_RANGE = 160;
const ARMY_BEAM_RANGE = 150;
const ARMY_PLANET_MAX = 30;
const ARMY_GROW_BASE = 1.0 / 14;   // armies/sec for normal planet
const ARMY_GROW_AGRI = 1.0 / 6;    // armies/sec for agri

// Phaser / torp
const SHIELD_PASS = 1.0;           // damage multiplier when shields up (reduces hull)
const HULL_PASS = 1.0;
const SHIELD_REDUCE = 0.5;         // shields absorb half, hull gets rest? No — shields take the hit first; once depleted, hull takes overflow.

// Tractor/pressor
const TRACTOR_RANGE = 1800;
const TRACTOR_FORCE = 1.6;         // warp/sec applied to target
const TRACTOR_FUEL = 20;           // fuel/sec

// Misc
const PHASER_VISUAL_TIME = 0.35;   // seconds the beam stays drawn
const EXPLOSION_TIME = 1.2;
const EXPLOSION_RADIUS = 220;
const EXPLOSION_DMG = 40;
const RESPAWN_TIME = 3.0;

// Score
const SCORE_KILL = 10;
const SCORE_BOMB = 1;
const SCORE_PLANET = 25;
const SCORE_DEATH = -5;

const WARP_UNITS = 80;             // galaxy units / sec per warp factor

const NUM_PLANETS_PER_TEAM = 10;   // 40 planets total
