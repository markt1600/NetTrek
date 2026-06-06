// NetTrek constants — teams, ship classes, planet types, capture mechanics
"use strict";

// Universe coordinates are in plain units. TACTICAL_RANGE is the size of the
// tactical viewport; the radar / galaxy values are multiples of that for layout.
const TACTICAL_RANGE = 3000;                   // tactical view width in units
const RADAR_SHORT_RANGE = 5 * TACTICAL_RANGE;  // short radar: 15,000u across
const RADAR_LONG_RANGE  = 20 * TACTICAL_RANGE; // long radar: 60,000u across
const GALAXY_SIZE = 100 * TACTICAL_RANGE;      // 300,000 × 300,000 universe
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
const TORP_MAX_RANGE = RADAR_SHORT_RANGE;         // max travel distance = short radar (15,000u)
const TORP_HIT_NEAR_RANGE = TACTICAL_RANGE;       // close-in (~3,000u) — 100% hit
const TORP_HIT_FAR_RANGE  = RADAR_SHORT_RANGE;    // ~15,000u — 20% hit
const TORP_HIT_NEAR_PROB  = 1.0;
const TORP_HIT_FAR_PROB   = 0.2;
const TORP_HOMING_TURN    = 0.7;                  // rad/sec — torps gently track target
// Torpedoes launch slow and accelerate. Top speed = warp 5. Accel = 2× Scout's
// (Scout = 1.6 warp/sec, so torp = 3.2 warp/sec = 480 u/sec²).
const TORP_TOP_SPEED   = 5 * 150;                 // warp 5 (150 u/warp) = 750 u/s
const TORP_ACCEL       = 3.2 * 150;               // 480 u/sec² — 2× Scout acceleration
const TORP_INITIAL_SPEED = 60;                    // small initial v so direction is well-defined

// Flares (torp defense)
const FLARE_MAX = 20;
const FLARE_DIVERT_PROB = 0.8;

// Cloak ability — when engaged the ship is invisible / invulnerable but
// cannot fire and burns this fraction of MAX energy per second.
const CLOAK_ENERGY_DRAIN_FRACTION = 0.20;

// Phaser cost as a fraction of the ship's MAX energy — same per shot regardless
// of upgrades; you can fire as long as you have at least this much energy.
const PHASER_ENERGY_FRACTION = 0.05;

// Ship class base stats.
//   maxEnergy is the single resource powering warp, phasers, torps, and shields.
//   shieldDrain is energy/sec consumed while shields are up.
//   torpMax is the magazine size; torpReloadTime is seconds per reloaded torp.
//   phaserDmg is per shot (sustained / harass weapon).
//   torpDmg is per hit (heavy hitter, but requires ammo and lead-aim).
const SHIPS = {
  SC: { id: "SC", name: "Scout",
        maxSpeed: 12, accel: 1.6, turnRate: 3.0,
        maxEnergy: 5000, maxShield: 80, maxHull: 80,
        phaserDmg: 25, phaserRange: 1800, phaserCool: 1.0,
        torpDmg: 60, torpRange: TORP_MAX_RANGE, torpEnergy: 200, torpCool: 0.45,
        torpMax: 4, torpReloadTime: 12.0,
        shieldDrain: 5,
        rechargeBase: 12, repairBase: 0.6,
        radius: 11 },
  DD: { id: "DD", name: "Destroyer",
        maxSpeed: 10, accel: 1.2, turnRate: 2.4,
        maxEnergy: 7000, maxShield: 95, maxHull: 95,
        phaserDmg: 30, phaserRange: 2000, phaserCool: 1.2,
        torpDmg: 75, torpRange: TORP_MAX_RANGE, torpEnergy: 260, torpCool: 0.55,
        torpMax: 6, torpReloadTime: 11.0,
        shieldDrain: 7,
        rechargeBase: 14, repairBase: 0.7,
        radius: 12 },
  CA: { id: "CA", name: "Cruiser",
        maxSpeed: 9, accel: 1.0, turnRate: 2.0,
        maxEnergy: 10000, maxShield: 110, maxHull: 110,
        phaserDmg: 35, phaserRange: 2200, phaserCool: 1.3,
        torpDmg: 90, torpRange: TORP_MAX_RANGE, torpEnergy: 320, torpCool: 0.6,
        torpMax: 8, torpReloadTime: 10.0,
        shieldDrain: 9,
        rechargeBase: 16, repairBase: 0.8,
        radius: 13 },
  BB: { id: "BB", name: "Battleship",
        maxSpeed: 7, accel: 0.7, turnRate: 1.5,
        maxEnergy: 14000, maxShield: 150, maxHull: 150,
        phaserDmg: 40, phaserRange: 2400, phaserCool: 1.5,
        torpDmg: 110, torpRange: TORP_MAX_RANGE, torpEnergy: 400, torpCool: 0.7,
        torpMax: 10, torpReloadTime: 8.0,
        shieldDrain: 12,
        rechargeBase: 14, repairBase: 0.9,
        radius: 15 },
};

// Helper — phaser energy cost for ship s (depends on max energy, including bonuses).
function phaserEnergyCost(s, world) {
  return shipMaxEnergy(s, world) * PHASER_ENERGY_FRACTION;
}

const SHIP_ORDER = ["SC", "DD", "CA", "BB"];

// Planet flags (bitmask)
const FLAG_REPAIR = 1;
const FLAG_FUEL = 2;
const FLAG_AGRI = 4;
const FLAG_HOME = 8;

const PLANET_RADIUS = 120;
const ORBIT_RADIUS = 200;
const ORBIT_MAX_SPEED = 4;

// Home-planet phaser defenses — only HOME planets get these.
const PLANET_DEFENSE_HULL    = 150;     // same as a Battleship hull
const PLANET_DEFENSE_RANGE   = 1000;    // engages enemies within this radius
const PLANET_DEFENSE_DMG     = 35;      // per-shot damage
const PLANET_DEFENSE_COOL    = 0.2;     // seconds between shots
const PLANET_DEFENSE_BEAM_TIME = 0.3;

// Home refit — full reload of every resource takes this many seconds, pro
// rata. So at 20% of max per second: 0%→100% in 5s, 80%→100% in 1s.
const HOME_REFIT_TIME = 5.0;

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
const FIRE_CONE = Math.PI / 9;     // ±20° (torpedo firing arc — narrow, requires aim)
const PHASER_CONE = Math.PI / 6;   // ±30° (phaser firing arc — wider but still not 360°)
const PHASER_QUEUE_TTL = 3.0;      // queued phaser shot expires after this many seconds
const LOCK_RANGE = RADAR_SHORT_RANGE;   // can lock anywhere on short-range radar
const LOCK_BREAK_RANGE = RADAR_LONG_RANGE; // lock auto-breaks when target falls off long radar
const LOCK_COMBAT_SPEED = 4;       // when locked, ship auto-caps desired speed at this

// Autopilot
const AUTOPILOT_SPEED = 4;         // default warp used by "go to target" and "return home"

// Tactical view zoom — multiplier on TACTICAL_RANGE shown
const ZOOM_LEVELS = [1, 2, 4, 8];


