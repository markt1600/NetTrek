// NetTrek constants — teams, ship classes, planet types, capture mechanics
"use strict";

// Universe is 100 "screens" on a side. One screen = TACTICAL_RANGE units across.
const TACTICAL_RANGE = 3000;                  // tactical view: 1 screen
const RADAR_SHORT_RANGE = 5 * TACTICAL_RANGE;  // short radar: 5 screens (15,000u)
const RADAR_LONG_RANGE  = 20 * TACTICAL_RANGE; // long radar: 20 screens (60,000u)
const GALAXY_SIZE = 100 * TACTICAL_RANGE;     // 100 × 100 screens (300,000u)
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

// Torpedoes (must be defined before SHIPS since ship class defs reference these)
const TORP_MAX_RANGE = RADAR_SHORT_RANGE + 1000;  // max travel distance before fizzle
const TORP_HIT_NEAR_RANGE = TACTICAL_RANGE;       // 1 screen — 100% hit
const TORP_HIT_FAR_RANGE  = RADAR_SHORT_RANGE;    // 5 screens — 20% hit
const TORP_HIT_NEAR_PROB  = 1.0;
const TORP_HIT_FAR_PROB   = 0.2;
const TORP_HOMING_TURN    = 0.7;                  // rad/sec — torps gently track target

// Flares (torp defense)
const FLARE_MAX = 3;
const FLARE_DIVERT_PROB = 0.5;

// Ship class base stats.
//   maxEnergy is the single resource powering warp, phasers, torps, and shields.
//   shieldDrain is energy/sec consumed while shields are up.
//   torpMax is the magazine size; torpReloadTime is seconds per reloaded torp.
const SHIPS = {
  SC: { id: "SC", name: "Scout",
        maxSpeed: 12, accel: 1.6, turnRate: 3.0,
        maxEnergy: 5000, maxShield: 80, maxHull: 80,
        phaserDmg: 75, phaserRange: 1800, phaserEnergy: 350, phaserCool: 1.1,
        torpSpeed: 1400, torpDmg: 25, torpRange: TORP_MAX_RANGE, torpEnergy: 200, torpCool: 0.35,
        torpMax: 4, torpReloadTime: 3.0,
        shieldDrain: 5,
        rechargeBase: 12, repairBase: 0.6,
        radius: 11 },
  DD: { id: "DD", name: "Destroyer",
        maxSpeed: 10, accel: 1.2, turnRate: 2.4,
        maxEnergy: 7000, maxShield: 95, maxHull: 95,
        phaserDmg: 85, phaserRange: 2000, phaserEnergy: 450, phaserCool: 1.4,
        torpSpeed: 1300, torpDmg: 32, torpRange: TORP_MAX_RANGE, torpEnergy: 260, torpCool: 0.4,
        torpMax: 6, torpReloadTime: 2.5,
        shieldDrain: 7,
        rechargeBase: 14, repairBase: 0.7,
        radius: 12 },
  CA: { id: "CA", name: "Cruiser",
        maxSpeed: 9, accel: 1.0, turnRate: 2.0,
        maxEnergy: 10000, maxShield: 110, maxHull: 110,
        phaserDmg: 100, phaserRange: 2200, phaserEnergy: 550, phaserCool: 1.5,
        torpSpeed: 1200, torpDmg: 38, torpRange: TORP_MAX_RANGE, torpEnergy: 320, torpCool: 0.45,
        torpMax: 8, torpReloadTime: 2.5,
        shieldDrain: 9,
        rechargeBase: 16, repairBase: 0.8,
        radius: 13 },
  BB: { id: "BB", name: "Battleship",
        maxSpeed: 7, accel: 0.7, turnRate: 1.5,
        maxEnergy: 14000, maxShield: 150, maxHull: 150,
        phaserDmg: 110, phaserRange: 2400, phaserEnergy: 650, phaserCool: 1.7,
        torpSpeed: 1100, torpDmg: 40, torpRange: TORP_MAX_RANGE, torpEnergy: 400, torpCool: 0.5,
        torpMax: 10, torpReloadTime: 2.0,
        shieldDrain: 12,
        rechargeBase: 14, repairBase: 0.9,
        radius: 15 },
};

const SHIP_ORDER = ["SC", "DD", "CA", "BB"];

// Planet flags (bitmask)
const FLAG_REPAIR = 1;
const FLAG_FUEL = 2;
const FLAG_AGRI = 4;
const FLAG_HOME = 8;

const PLANET_RADIUS = 60;
const ORBIT_RADIUS = 130;
const ORBIT_MAX_SPEED = 2;

// Capture: orbit + hold + no enemies near
const CAPTURE_TIME = 5.0;
const CAPTURE_DANGER_RANGE = 1500;

// Per-captured-planet bonuses applied to the owning team
const BONUS_PER_PLANET = {
  hull:   8,
  shield: 8,
  energy: 400,
  repair: 0.05,
};
// Extra bonuses by planet flag (granted in addition to base)
const BONUS_BY_FLAG = {
  [FLAG_REPAIR]: { hull: 4, shield: 4, repair: 0.10 },
  [FLAG_FUEL]:   { energy: 600, recharge: 0.20 },
  [FLAG_AGRI]:   { energy: 1200 },
  [FLAG_HOME]:   { hull: 30, shield: 30, energy: 1500, repair: 0.20, recharge: 0.20 },
};

// Combat / weapons constants
const PHASER_VISUAL_TIME = 0.35;
const EXPLOSION_TIME = 1.2;
const EXPLOSION_RADIUS = 220;
const EXPLOSION_DMG = 40;
const RESPAWN_TIME = 3.0;

// Scoring
const SCORE_KILL = 10;
const SCORE_PLANET = 25;
const SCORE_DEATH = -10;
const SCORE_PER_SECOND = 1;

const WARP_UNITS = 150;  // u/sec per warp factor — cross-galaxy travel takes a few minutes at warp 9
const PLAYER_LIVES = 1;  // single life — structural health to 0 ends the game

// Progressive system damage thresholds (fraction of max hull)
const SYS_TORPS_MIN_HULL    = 0.50;  // torpedoes go offline below this
const SYS_PHASERS_MIN_HULL  = 0.25;  // phasers go offline below this
const SYS_WARP_MIN_HULL     = 0.10;  // warp drive goes offline below this

// AI respawn pacing
const AI_RESPAWN_TIME = 12.0;

// Shields & combat
const SHIELD_COLLAPSE_DELAY = 2.5; // shields can't be re-raised for this many sec after hitting 0

// Targeting / firing
const FIRE_CONE = Math.PI / 9;     // ±20° — weapons fire only when target is within this cone
const LOCK_RANGE = RADAR_SHORT_RANGE;   // can lock anywhere on short-range radar
const LOCK_BREAK_RANGE = RADAR_LONG_RANGE; // lock auto-breaks when target falls off long radar
const LOCK_COMBAT_SPEED = 4;       // when locked, ship auto-caps desired speed at this


