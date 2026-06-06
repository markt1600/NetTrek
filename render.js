// Rendering — tactical canvas (centered on player) and galactic map
"use strict";

function drawAll(world) {
  drawTactical(world);
  drawGalactic(world);
}

function drawTactical(world) {
  const cv = document.getElementById("tactical");
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  const me = world.playerShip;
  const zoomMult = ZOOM_LEVELS[world.zoomLevel || 0];
  const range = TACTICAL_RANGE * zoomMult;
  const scale = W / range;
  const cx = W / 2, cy = H / 2;
  const w2s = (x, y) => ({ sx: cx + (x - me.x) * scale, sy: cy + (y - me.y) * scale });

  // World-space starfield: stars live at fixed galactic coordinates, so as the
  // ship flies, they parallax past. Cell-based deterministic placement avoids
  // any per-frame randomness (no flicker). Cell size grows with zoom so the
  // density stays subtle at any view scale.
  drawStarField(ctx, me, range, scale, cx, cy, W, H);

  // Planets
  for (const p of world.planets) {
    const { sx, sy } = w2s(p.x, p.y);
    if (sx < -100 || sx > W + 100 || sy < -100 || sy > H + 100) continue;
    drawPlanet(ctx, p, sx, sy, PLANET_RADIUS * scale, true, world);
  }

  // Phaser beams
  for (const b of world.beams) {
    const fr = w2s(b.fromX, b.fromY);
    const to = w2s(b.toX, b.toY);
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = Math.max(0, (b.until - world.now) / PHASER_VISUAL_TIME);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(fr.sx, fr.sy); ctx.lineTo(to.sx, to.sy); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Hit impacts — small flash + expanding ring on each weapon hit.
  if (world.impacts) {
    for (const imp of world.impacts) {
      const { sx, sy } = w2s(imp.x, imp.y);
      if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;
      const life = (world.now - imp.bornAt) / (imp.until - imp.bornAt);
      const alpha = Math.max(0, 1 - life);
      if (imp.kind === "torp") {
        // Bigger orange explosion ring + flash
        ctx.strokeStyle = `rgba(255, 152, 0, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, 6 + life * 28, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(255, 220, 120, ${alpha * 0.7})`;
        ctx.beginPath();
        ctx.arc(sx, sy, 6, 0, Math.PI * 2);
        ctx.fill();
      } else if (imp.kind === "phaser") {
        // Smaller yellow sparkle
        const col = imp.shieldHit ? "rgba(120, 200, 255," : "rgba(255, 230, 120,";
        ctx.strokeStyle = `${col}${alpha})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 3 + life * 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `${col}${alpha * 0.8})`;
        ctx.beginPath();
        ctx.arc(sx, sy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Flare bursts (drawn behind torps so torps show on top)
  if (world.flareEffects) {
    for (const f of world.flareEffects) {
      const { sx, sy } = w2s(f.x, f.y);
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
      const life = (world.now - f.bornAt) / (f.until - f.bornAt);
      const alpha = Math.max(0, 1 - life);
      const r = 2 + life * 4;
      ctx.fillStyle = `rgba(255, 220, 120, ${alpha})`;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255, 255, 220, ${alpha * 0.9})`;
      ctx.beginPath(); ctx.arc(sx, sy, 1.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Torps
  for (const t of world.torps) {
    if (!t.alive) continue;
    const { sx, sy } = w2s(t.x, t.y);
    const incoming = (t.targetId === me.id && t.team !== me.team && t.willHit);
    if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) {
      // off tactical view — skip, but we still want to count incoming for radar alert
      continue;
    }
    if (incoming) {
      // Red incoming torpedo: bigger, with halo + distance label
      ctx.fillStyle = "#ef5350";
      ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#ef5350";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.stroke();
      const d = Math.hypot(t.x - me.x, t.y - me.y);
      ctx.fillStyle = "#ef5350";
      ctx.font = "bold 10px Courier New";
      ctx.fillText(`▲ ${Math.round(d)}u`, sx + 10, sy + 4);
    } else if (t.diverted) {
      // Diverted torp — dim gray
      ctx.fillStyle = "#777";
      ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = TEAMS[t.team].color;
      ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Ships
  for (const s of world.ships) {
    if (!s.alive) {
      if (s.deadEffectUntil > world.now) {
        const { sx, sy } = w2s(s.x, s.y);
        const t = (s.deadEffectUntil - world.now) / EXPLOSION_TIME;
        ctx.strokeStyle = "#ffb84d";
        ctx.globalAlpha = t;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx, sy, (1 - t) * EXPLOSION_RADIUS * scale, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      continue;
    }
    const { sx, sy } = w2s(s.x, s.y);
    if (sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) continue;
    drawShip(ctx, s, sx, sy, scale, world);
  }

  // Player's last destination marker
  if (Input.lastClickX !== null) {
    const { sx, sy } = w2s(Input.lastClickX, Input.lastClickY);
    ctx.strokeStyle = "#64b5f6";
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(sx - 6, sy); ctx.lineTo(sx + 6, sy);
    ctx.moveTo(sx, sy - 6); ctx.lineTo(sx, sy + 6);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Player phaser range ring
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, shipDef(me).phaserRange * scale, 0, Math.PI * 2);
  ctx.stroke();

  // Lock range ring (faint) when no lock yet
  if (!me.targetLock && me.alive) {
    ctx.strokeStyle = "#333";
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.arc(cx, cy, LOCK_RANGE * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Firing cones — always visible so player can see where weapons can fire.
  // Outer wider arc = phaser (±30°), inner narrower arc = torpedoes (±20°).
  // They brighten when a target is locked or a phaser shot is queued.
  {
    const reach = shipDef(me).phaserRange * scale;
    const bright = !!(me.targetLock || me.pendingPhaserShot);
    ctx.lineWidth = 1;
    // Phaser cone (wider)
    ctx.strokeStyle = bright ? "rgba(255, 200, 100, 0.45)" : "rgba(255, 200, 100, 0.13)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(me.heading - PHASER_CONE) * reach,
               cy + Math.sin(me.heading - PHASER_CONE) * reach);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(me.heading + PHASER_CONE) * reach,
               cy + Math.sin(me.heading + PHASER_CONE) * reach);
    ctx.stroke();
    // Torpedo cone (narrower, slightly bluer)
    ctx.strokeStyle = bright ? "rgba(100, 181, 246, 0.55)" : "rgba(100, 181, 246, 0.18)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(me.heading - FIRE_CONE) * reach,
               cy + Math.sin(me.heading - FIRE_CONE) * reach);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(me.heading + FIRE_CONE) * reach,
               cy + Math.sin(me.heading + FIRE_CONE) * reach);
    ctx.stroke();
  }

  // Queued phaser shot marker — a pulsing reticle at the click point
  if (me.pendingPhaserShot) {
    const p = me.pendingPhaserShot;
    const { sx, sy } = w2s(p.targetX, p.targetY);
    const inCone = angleErrToPoint(me, p.targetX, p.targetY) <= PHASER_CONE;
    ctx.strokeStyle = inCone ? "#4caf50" : "#ffc107";
    ctx.lineWidth = 1.5;
    const r = 10 + 2 * Math.sin(world.now * 8);
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx - 14, sy); ctx.lineTo(sx - 7, sy);
    ctx.moveTo(sx + 14, sy); ctx.lineTo(sx + 7, sy);
    ctx.moveTo(sx, sy - 14); ctx.lineTo(sx, sy - 7);
    ctx.moveTo(sx, sy + 14); ctx.lineTo(sx, sy + 7);
    ctx.stroke();
  }

  if (me.targetLock) {

    // Lock reticle on target (only draw if target is on-screen)
    const t = world.ships.find(o => o.id === me.targetLock && o.alive);
    if (t) {
      const tp = w2s(t.x, t.y);
      const inCone = inFiringCone(me, t);
      const reticleColor = inCone ? "#4caf50" : "#ffc107";
      const onScreen = (tp.sx >= 0 && tp.sx <= W && tp.sy >= 0 && tp.sy <= H);
      const d = Math.hypot(t.x - me.x, t.y - me.y);

      if (onScreen) {
        ctx.strokeStyle = reticleColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tp.sx, tp.sy, 24, 0, Math.PI * 2);
        ctx.stroke();
        const b = 14;
        ctx.beginPath();
        ctx.moveTo(tp.sx - b, tp.sy - 24); ctx.lineTo(tp.sx - 24, tp.sy - 24); ctx.lineTo(tp.sx - 24, tp.sy - b);
        ctx.moveTo(tp.sx + b, tp.sy - 24); ctx.lineTo(tp.sx + 24, tp.sy - 24); ctx.lineTo(tp.sx + 24, tp.sy - b);
        ctx.moveTo(tp.sx - b, tp.sy + 24); ctx.lineTo(tp.sx - 24, tp.sy + 24); ctx.lineTo(tp.sx - 24, tp.sy + b);
        ctx.moveTo(tp.sx + b, tp.sy + 24); ctx.lineTo(tp.sx + 24, tp.sy + 24); ctx.lineTo(tp.sx + 24, tp.sy + b);
        ctx.stroke();
        // Live distance label under reticle
        ctx.fillStyle = reticleColor;
        ctx.font = "bold 11px Courier New";
        ctx.textAlign = "center";
        ctx.fillText(`${Math.round(d)}u`, tp.sx, tp.sy + 38);
        if (inCone && d < shipDef(me).phaserRange) {
          ctx.fillText("FIRE READY", tp.sx, tp.sy - 34);
        }
        ctx.textAlign = "left";
      } else {
        // Off-screen lock — show an arrow at the edge pointing toward the target,
        // with the live distance number, so you always know where it is.
        const ang = Math.atan2(t.y - me.y, t.x - me.x);
        const margin = 30;
        // ray from center to edge along ang, clip to viewport
        const hx = W / 2, hy = H / 2;
        const half = Math.min(W, H) / 2 - margin;
        const ex = hx + Math.cos(ang) * half;
        const ey = hy + Math.sin(ang) * half;
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(ang);
        ctx.fillStyle = reticleColor;
        ctx.beginPath();
        ctx.moveTo(10, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = reticleColor;
        ctx.font = "bold 11px Courier New";
        ctx.textAlign = "center";
        ctx.fillText(`${Math.round(d)}u`, ex, ey + 20);
        ctx.textAlign = "left";
      }
    }
  }

  // Capture danger ring (only when capturing)
  if (me.capturing) {
    ctx.strokeStyle = "#ff9800";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, CAPTURE_DANGER_RANGE * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Dead overlay
  if (!me.alive) {
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ef5350";
    ctx.font = "bold 36px Courier New";
    ctx.textAlign = "center";
    ctx.fillText("YOUR SHIP DESTROYED", W/2, H/2 - 10);
    ctx.font = "16px Courier New";
    ctx.fillStyle = "#d7d7e0";
    const sec = Math.max(0, me.respawnAt - world.now).toFixed(1);
    if (world.playerLives > 0) {
      ctx.fillText(`Respawning in ${sec}s — Lives left: ${world.playerLives}`, W/2, H/2 + 24);
    } else {
      ctx.fillText("GAME OVER", W/2, H/2 + 24);
    }
    ctx.textAlign = "left";
  }

  if (world.paused && me.alive) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 36px Courier New";
    ctx.textAlign = "center";
    ctx.fillText("PAUSED", W/2, H/2);
    ctx.textAlign = "left";
  }
}

function drawPlanet(ctx, p, sx, sy, r, big, world) {
  const t = TEAMS[p.team] || TEAMS.IND;
  r = Math.max(big ? 8 : 3, r);
  ctx.fillStyle = t.colorDim;
  ctx.strokeStyle = t.color;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  // Defense ring on home planets — green/yellow/red by turret health.
  if (p.defenseMaxHull > 0 && big) {
    const frac = p.defenseHull / p.defenseMaxHull;
    let ringColor;
    if (frac > 0.75) ringColor = "#4caf50";
    else if (frac > 0.25) ringColor = "#ffc107";
    else if (frac > 0) ringColor = "#ef5350";
    else ringColor = "#555";
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 2;
    ctx.setLineDash(p.defenseRebuilding ? [3, 3] : [5, 3]);
    ctx.beginPath(); ctx.arc(sx, sy, r + 8, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    // Defense % readout centered inside the planet, with a rebuild countdown
    // on the line below when the turret is regenerating.
    const pct = Math.round(frac * 100);
    let textColor;
    if (p.defenseRebuilding) textColor = "#ff9800";
    else if (frac > 0.75)    textColor = "#aed581";
    else if (frac > 0.25)    textColor = "#ffd54f";
    else                     textColor = "#ef9a9a";
    ctx.fillStyle = textColor;
    ctx.font = "bold 11px Courier New";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (p.defenseRebuilding) {
      const remain = Math.max(0, (1 - frac) * PLANET_DEFENSE_REBUILD_TIME);
      ctx.fillText(`${pct}%`, sx, sy - 6);
      ctx.font = "9px Courier New";
      ctx.fillText(`${remain.toFixed(1)}s`, sx, sy + 6);
    } else {
      ctx.fillText(`${pct}%`, sx, sy);
    }
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
  }

  // Selection highlight if this is the player's currently selected planet
  if (world.playerShip && world.playerShip.selectedPlanet === p.id) {
    ctx.strokeStyle = "#ffc107";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(sx, sy, r + 6, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  if (p.flashUntil > world.now) {
    ctx.strokeStyle = "#ffb84d";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(sx, sy, r + 4, 0, Math.PI * 2); ctx.stroke();
  }

  // Capture progress arc — if any ship is actively capturing
  let capShip = null;
  for (const s of world.ships) {
    if (s.alive && s.capturing && s.captureTarget === p.id) { capShip = s; break; }
  }
  if (capShip) {
    const frac = Math.min(1, capShip.captureProgress / CAPTURE_TIME);
    ctx.strokeStyle = TEAMS[capShip.team].color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx, sy, r + 6, -Math.PI/2, -Math.PI/2 + frac * Math.PI * 2);
    ctx.stroke();
  }

  if (big) {
    ctx.fillStyle = "#fff";
    ctx.font = "11px Courier New";
    ctx.fillText(p.name, sx + r + 4, sy + 4);
    ctx.fillStyle = t.color;
    ctx.font = "10px Courier New";
    ctx.fillText(p.team, sx + r + 4, sy + 16);

    let ix = sx - r;
    let iy = sy + r + 12;
    if (p.flags & FLAG_REPAIR) { drawWrench(ctx, ix, iy); ix += 12; }
    if (p.flags & FLAG_FUEL) { drawFuel(ctx, ix, iy); ix += 12; }
    if (p.flags & FLAG_AGRI) { drawAgri(ctx, ix, iy); ix += 12; }
    if (p.flags & FLAG_HOME) {
      ctx.fillStyle = "#ffd54f"; ctx.font = "10px Courier New";
      ctx.fillText("HOME", ix, iy + 8);
    }
  }
}

function drawWrench(ctx, x, y) {
  ctx.strokeStyle = "#9e9e9e"; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x+1, y); ctx.lineTo(x+9, y+8);
  ctx.moveTo(x+9, y+0); ctx.lineTo(x+9, y+3);
  ctx.moveTo(x+9, y+5); ctx.lineTo(x+9, y+8);
  ctx.stroke();
}
function drawFuel(ctx, x, y) {
  ctx.strokeStyle = "#ffc107"; ctx.lineWidth = 1;
  ctx.strokeRect(x+1, y+1, 7, 8);
  ctx.fillStyle = "#ffc107";
  ctx.fillRect(x+2, y+5, 5, 3);
}
function drawAgri(ctx, x, y) {
  ctx.strokeStyle = "#4caf50"; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x+5, y+9); ctx.lineTo(x+5, y+3);
  ctx.moveTo(x+5, y+3); ctx.lineTo(x+2, y+1);
  ctx.moveTo(x+5, y+3); ctx.lineTo(x+8, y+1);
  ctx.moveTo(x+5, y+5); ctx.lineTo(x+2, y+3);
  ctx.moveTo(x+5, y+5); ctx.lineTo(x+8, y+3);
  ctx.stroke();
}

// Deterministic background starfield in world coordinates.
// Each cell of the world grid contains 1–2 stars; their positions, sizes and
// brightnesses are pseudo-random but stable across frames. As the player ship
// moves, stars come into and out of view — giving a sense of motion.
function drawStarField(ctx, me, range, scale, cx, cy, W, H) {
  // Bigger cells at higher zoom keep the total star count bounded.
  const cellSize = Math.max(140, range / 22);
  const halfRange = range / 2;
  const minCX = Math.floor((me.x - halfRange) / cellSize);
  const maxCX = Math.floor((me.x + halfRange) / cellSize);
  const minCY = Math.floor((me.y - halfRange) / cellSize);
  const maxCY = Math.floor((me.y + halfRange) / cellSize);
  for (let gy = minCY; gy <= maxCY; gy++) {
    for (let gx = minCX; gx <= maxCX; gx++) {
      // Hash the cell coords into a seed; mulberry32 used elsewhere via rng()
      const seed = ((gx * 73856093) ^ (gy * 19349663)) >>> 0;
      const r = rng(seed);
      const n = r() < 0.7 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const wx = (gx + r()) * cellSize;
        const wy = (gy + r()) * cellSize;
        const b = 0.15 + r() * 0.45;            // brightness 0.15–0.60
        const sz = r() < 0.93 ? 1 : 2;          // mostly 1px, occasional 2px
        const sx_ = cx + (wx - me.x) * scale;
        const sy_ = cy + (wy - me.y) * scale;
        if (sx_ < -2 || sy_ < -2 || sx_ > W + 2 || sy_ > H + 2) continue;
        ctx.fillStyle = `rgba(190, 200, 230, ${b.toFixed(2)})`;
        ctx.fillRect(sx_, sy_, sz, sz);
      }
    }
  }
}

// ---- Starship silhouettes (top-down, facing +X) ----
// Each takes a radius `r`; shapes are made of saucer + hull + nacelles.
// Fill & stroke are already set by the caller.

function drawScout(ctx, r) {
  // Saucer (small disc, forward)
  ctx.beginPath();
  ctx.ellipse(r * 0.30, 0, r * 0.55, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // Slim hull strip
  ctx.beginPath();
  ctx.moveTo(-r * 0.60,  r * 0.12);
  ctx.lineTo( r * 0.20,  r * 0.16);
  ctx.lineTo( r * 0.20, -r * 0.16);
  ctx.lineTo(-r * 0.60, -r * 0.12);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Single nacelle below, mirrored above (small ones)
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(-r * 0.20, sgn * r * 0.45, r * 0.55, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.20, sgn * r * 0.14);
    ctx.lineTo(-r * 0.20, sgn * r * 0.35);
    ctx.stroke();
  }
}

function drawDestroyer(ctx, r) {
  // Pointed saucer
  ctx.beginPath();
  ctx.moveTo(r * 0.95, 0);
  ctx.quadraticCurveTo(r * 0.55,  r * 0.40, r * 0.00,  r * 0.30);
  ctx.lineTo(-r * 0.20,  r * 0.20);
  ctx.lineTo(-r * 0.20, -r * 0.20);
  ctx.lineTo(r * 0.00, -r * 0.30);
  ctx.quadraticCurveTo(r * 0.55, -r * 0.40, r * 0.95, 0);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Engineering hull
  ctx.beginPath();
  ctx.rect(-r * 0.75, -r * 0.22, r * 0.55, r * 0.44);
  ctx.fill(); ctx.stroke();
  // Two nacelles (one each side)
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(-r * 0.40, sgn * r * 0.60, r * 0.70, r * 0.14, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.40, sgn * r * 0.22);
    ctx.lineTo(-r * 0.40, sgn * r * 0.50);
    ctx.stroke();
  }
}

function drawCruiser(ctx, r) {
  // Classic saucer (large disc forward)
  ctx.beginPath();
  ctx.ellipse(r * 0.30, 0, r * 0.75, r * 0.60, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // Neck + engineering hull
  ctx.beginPath();
  ctx.moveTo(-r * 0.10, -r * 0.10);
  ctx.lineTo(-r * 0.10,  r * 0.10);
  ctx.lineTo(-r * 0.85,  r * 0.22);
  ctx.lineTo(-r * 0.85, -r * 0.22);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Two long nacelles, top + bottom, suspended by pylons
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(-r * 0.45, sgn * r * 0.65, r * 0.85, r * 0.15, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // Pylon
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, sgn * r * 0.22);
    ctx.lineTo(-r * 0.45, sgn * r * 0.52);
    ctx.lineTo(-r * 0.35, sgn * r * 0.22);
    ctx.stroke();
  }
}

function drawBattleship(ctx, r) {
  // Wide bulky saucer (more rectangular)
  ctx.beginPath();
  ctx.moveTo(r * 0.95,  0);
  ctx.lineTo(r * 0.55,  r * 0.55);
  ctx.lineTo(-r * 0.10,  r * 0.55);
  ctx.lineTo(-r * 0.30,  r * 0.30);
  ctx.lineTo(-r * 0.30, -r * 0.30);
  ctx.lineTo(-r * 0.10, -r * 0.55);
  ctx.lineTo(r * 0.55, -r * 0.55);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Twin engineering hulls (parallel)
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.rect(-r * 0.90, sgn * r * 0.10 - r * 0.18, r * 0.65, r * 0.36);
    ctx.fill(); ctx.stroke();
  }
  // Outer nacelles
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(-r * 0.55, sgn * r * 0.78, r * 0.75, r * 0.14, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, sgn * r * 0.45);
    ctx.lineTo(-r * 0.55, sgn * r * 0.65);
    ctx.stroke();
  }
  // Centerline bridge bump
  ctx.beginPath();
  ctx.ellipse(r * 0.25, 0, r * 0.15, r * 0.18, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
}

function drawShip(ctx, s, sx, sy, scale, world) {
  const def = shipDef(s);
  const t = TEAMS[s.team];
  const isMe = s === world.playerShip;
  const r = def.radius;

  // Cloaked: enemies/friendlies vanish entirely; player ship blinks in and
  // out (a step-function blink so the captain can still track position but
  // it's visually clear they are not "really there" to onlookers).
  if (s.cloaked) {
    if (!isMe) return;
    const period = 0.55;                       // ~1.8 Hz blink cycle
    const phase = (world.now / period) % 1;
    const visible = phase < 0.55;              // ~55% of cycle visible
    ctx.save();
    ctx.globalAlpha = visible ? 0.85 : 0.05;
  }

  // --- Health-state visuals (apply to all ships including the player) ---
  const maxH = shipMaxHull(s, world);
  const maxS = shipMaxShield(s, world);
  const hullFrac = maxH > 0 ? s.hull / maxH : 0;
  const shieldFrac = maxS > 0 ? s.shield / maxS : 0;
  // Shield ring color: green > 75%, yellow > 25%, red below
  let shieldRingColor;
  if (shieldFrac > 0.75)      shieldRingColor = "#4caf50";
  else if (shieldFrac > 0.25) shieldRingColor = "#ffc107";
  else                        shieldRingColor = "#ef5350";
  // Damaged-hull red pulse (everyone except the player) when hull < 50%
  let bodyStroke = t.color;
  if (!isMe && hullFrac > 0 && hullFrac < 0.5) {
    // Smooth pulse — alternate between team color and a bright red
    const pulse = 0.5 + 0.5 * Math.sin(world.now * 8);
    if (pulse > 0.5) bodyStroke = "#ff3b3b";
  }

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(s.heading);

  if (s.shieldsUp) {
    // Player ring stays blue (distinctive "you" marker); others reflect strength.
    ctx.strokeStyle = isMe ? "#90caf9" : shieldRingColor;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, Math.PI * 2); ctx.stroke();
  }

  ctx.fillStyle = t.colorDim;
  ctx.strokeStyle = bodyStroke;
  ctx.lineWidth = 1.5;

  // Top-down starship silhouettes per class. All ships face +X (heading 0 = right).
  if (s.shipClass === "SC")      drawScout(ctx, r);
  else if (s.shipClass === "DD") drawDestroyer(ctx, r);
  else if (s.shipClass === "BB") drawBattleship(ctx, r);
  else if (s.shipClass === "DG") drawBattleship(ctx, r); // Demi God reuses BB silhouette at 3× radius
  else                            drawCruiser(ctx, r); // CA / default

  // Engine glow
  ctx.fillStyle = "#ffd166";
  ctx.beginPath();
  ctx.arc(-r * 0.95, 0, Math.max(1, r * 0.12), 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(-s.heading);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 8px Courier New";
  ctx.textAlign = "center";
  ctx.fillText(s.shipClass, 0, r + 12);
  ctx.textAlign = "left";

  ctx.restore();

  if (isMe) {
    ctx.strokeStyle = "#fff";
    ctx.setLineDash([2, 2]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, def.radius + 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.fillStyle = TEAMS[s.team].color;
    ctx.font = "10px Courier New";
    ctx.textAlign = "center";
    ctx.fillText(`${s.team}-${s.shipClass}`, sx, sy - def.radius - 8);
    ctx.textAlign = "left";
  }

  if (s.cloaked) ctx.restore();
}

// Radar: replaces the old galactic map. Centered on the player ship.
// Two modes:
//   SHORT — RADAR_SHORT_RANGE across (~5 screens). Shows ship class markers.
//   LONG  — RADAR_LONG_RANGE across (~20 screens). Shows ships as bare contact dots.
function drawGalactic(world) {
  const cv = document.getElementById("galactic");
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  const me = world.playerShip;
  const range = (world.radarMode === "LONG") ? RADAR_LONG_RANGE : RADAR_SHORT_RANGE;
  // World-to-screen mapping centered on player
  const sx = (x) => W/2 + ((x - me.x) / range) * W;
  const sy = (y) => H/2 + ((y - me.y) / range) * H;

  // Crosshair
  ctx.strokeStyle = "#1a1a2a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W/2, 0); ctx.lineTo(W/2, H);
  ctx.moveTo(0, H/2); ctx.lineTo(W, H/2);
  ctx.stroke();

  // Range rings (every 5 screens for context)
  const ringStep = TACTICAL_RANGE * (world.radarMode === "LONG" ? 5 : 1);
  ctx.strokeStyle = "#1a1a2a";
  for (let r = ringStep; r <= range / 2; r += ringStep) {
    const pr = (r / range) * W;
    ctx.beginPath(); ctx.arc(W/2, H/2, pr, 0, Math.PI * 2); ctx.stroke();
  }

  // Planets are geography — always visible. In LONG mode all planets show in
  // generic green (no ownership leaked). In SHORT mode the team color is shown.
  const longMode = world.radarMode === "LONG";
  for (const p of world.planets) {
    const x = sx(p.x), y = sy(p.y);
    if (x < -5 || y < -5 || x > W + 5 || y > H + 5) continue;
    const planetColor = longMode ? "#4caf50" : (TEAMS[p.team] || TEAMS.IND).color;
    ctx.fillStyle = planetColor;
    ctx.beginPath();
    ctx.arc(x, y, longMode ? 2.5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (p.flashUntil > world.now) {
      ctx.strokeStyle = "#fff";
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // Ships — only ones within the active scan range.
  // LONG: generic light contact, no friend/foe color (just "a ship is here").
  // SHORT: friendly = team color; enemy = red (IFF clear at close range).
  const scanLimit = range / 2;
  for (const s of world.ships) {
    if (!s.alive) continue;
    const d = Math.hypot(s.x - me.x, s.y - me.y);
    if (d > scanLimit) continue;
    const x = sx(s.x), y = sy(s.y);
    if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
    const isFriendly = s.team === me.team;

    if (longMode) {
      // All ships shown as a uniform pale contact square — no IFF leaked
      ctx.fillStyle = "#dcdcdc";
      ctx.fillRect(x - 2, y - 2, 4, 4);
    } else {
      // SHORT mode: enemy red, friendly team color
      const color = isFriendly ? TEAMS[me.team].color : "#ef5350";
      ctx.fillStyle = color;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(s.heading);
      ctx.beginPath();
      ctx.moveTo(5, 0); ctx.lineTo(-3, -3); ctx.lineTo(-3, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#fff";
      ctx.font = "8px Courier New";
      ctx.fillText(s.shipClass, x + 5, y + 4);
    }

    // Player self marker — always shown
    if (s === me) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
    }
    // Locked target highlight + live distance
    if (me.targetLock && s.id === me.targetLock) {
      ctx.strokeStyle = "#ffc107";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#ffc107";
      ctx.font = "bold 10px Courier New";
      ctx.fillText(`${Math.round(d)}u`, x + 12, y + 4);
    }
  }

  // Torpedoes on radar — small dots, incoming highlighted red
  for (const t of world.torps) {
    if (!t.alive) continue;
    const d = Math.hypot(t.x - me.x, t.y - me.y);
    if (d > scanLimit) continue;
    const x = sx(t.x), y = sy(t.y);
    const incoming = (t.targetId === me.id && t.team !== me.team && t.willHit);
    if (incoming) {
      ctx.fillStyle = "#ef5350";
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#ef5350";
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = TEAMS[t.team].color;
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }

  // Tactical view box
  ctx.strokeStyle = "#444";
  ctx.setLineDash([2, 2]);
  const halfTac = (TACTICAL_RANGE / 2 / range) * W;
  ctx.strokeRect(W/2 - halfTac, H/2 - halfTac, halfTac * 2, halfTac * 2);
  ctx.setLineDash([]);

  // Home base beacon — always visible. Edge arrow + distance if home is off-radar,
  // halo + label if it's in-radar.
  const homeP = world.planets.find(p => p.origTeam === world.playerTeam && (p.flags & FLAG_HOME));
  if (homeP) {
    const homeColor = TEAMS[world.playerTeam].color;
    const hd = Math.hypot(homeP.x - me.x, homeP.y - me.y);
    if (hd <= scanLimit) {
      const hx = sx(homeP.x), hy = sy(homeP.y);
      ctx.strokeStyle = homeColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(hx, hy, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = homeColor;
      ctx.font = "bold 9px Courier New";
      ctx.fillText("HOME", hx + 10, hy - 2);
      ctx.fillText(`${Math.round(hd)}u`, hx + 10, hy + 9);
    } else {
      // Off-radar: arrow at the edge pointing home
      const ang = Math.atan2(homeP.y - me.y, homeP.x - me.x);
      const margin = 18;
      const half = Math.min(W, H) / 2 - margin;
      const ex = W/2 + Math.cos(ang) * half;
      const ey = H/2 + Math.sin(ang) * half;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(ang);
      ctx.fillStyle = homeColor;
      ctx.beginPath();
      ctx.moveTo(9, 0); ctx.lineTo(-5, -6); ctx.lineTo(-5, 6);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = homeColor;
      ctx.font = "bold 10px Courier New";
      ctx.textAlign = "center";
      // place label inside the edge so it's not clipped
      const lx = W/2 + Math.cos(ang) * (half - 18);
      const ly = H/2 + Math.sin(ang) * (half - 18);
      ctx.fillText(`HOME ${Math.round(hd)}u`, lx, ly + 4);
      ctx.textAlign = "left";
    }
  }

  // Mode label
  ctx.fillStyle = "#777";
  ctx.font = "10px Courier New";
  ctx.fillText(world.radarMode === "LONG" ? "LONG RANGE" : "SHORT RANGE", 6, 12);
  ctx.fillText(`${Math.round(range/1000)}k u`, 6, 24);
}
