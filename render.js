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
  const scale = W / TACTICAL_RANGE;
  const cx = W / 2, cy = H / 2;
  const w2s = (x, y) => ({ sx: cx + (x - me.x) * scale, sy: cy + (y - me.y) * scale });

  // Starfield
  ctx.fillStyle = "#1a1a2a";
  const starSeed = Math.floor(me.x / 100) * 1000 + Math.floor(me.y / 100);
  const r = rng(starSeed);
  for (let i = 0; i < 120; i++) ctx.fillRect(r() * W, r() * H, 1, 1);

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

  // Firing cone (drawn when lock active)
  if (me.targetLock) {
    const reach = shipDef(me).phaserRange * scale;
    ctx.strokeStyle = "rgba(100, 181, 246, 0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(me.heading - FIRE_CONE) * reach,
               cy + Math.sin(me.heading - FIRE_CONE) * reach);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(me.heading + FIRE_CONE) * reach,
               cy + Math.sin(me.heading + FIRE_CONE) * reach);
    ctx.stroke();

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

function drawShip(ctx, s, sx, sy, scale, world) {
  const def = shipDef(s);
  const t = TEAMS[s.team];
  const isMe = s === world.playerShip;

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(s.heading);

  if (s.shieldsUp) {
    ctx.strokeStyle = isMe ? "#90caf9" : "#444";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, def.radius + 5, 0, Math.PI * 2); ctx.stroke();
  }

  ctx.fillStyle = t.colorDim;
  ctx.strokeStyle = t.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (s.shipClass === "SC") {
    ctx.moveTo(def.radius, 0);
    ctx.lineTo(-def.radius * 0.8, -def.radius * 0.7);
    ctx.lineTo(-def.radius * 0.8, def.radius * 0.7);
  } else if (s.shipClass === "BB") {
    ctx.moveTo(def.radius, 0);
    ctx.lineTo(-def.radius, -def.radius * 0.9);
    ctx.lineTo(-def.radius * 0.6, 0);
    ctx.lineTo(-def.radius, def.radius * 0.9);
  } else {
    ctx.moveTo(def.radius, 0);
    ctx.lineTo(-def.radius * 0.9, -def.radius * 0.85);
    ctx.lineTo(-def.radius * 0.9, def.radius * 0.85);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.rotate(-s.heading);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 9px Courier New";
  ctx.textAlign = "center";
  ctx.fillText(s.shipClass, 0, 3);
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

  // Planets — always visible (geography is known)
  for (const p of world.planets) {
    const x = sx(p.x), y = sy(p.y);
    if (x < -5 || y < -5 || x > W + 5 || y > H + 5) continue;
    const t = TEAMS[p.team] || TEAMS.IND;
    ctx.fillStyle = t.color;
    ctx.beginPath();
    ctx.arc(x, y, world.radarMode === "LONG" ? 2 : 3, 0, Math.PI * 2);
    ctx.fill();
    if (p.flashUntil > world.now) {
      ctx.strokeStyle = "#fff";
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // Ships — only ones within the active scan range
  const scanLimit = range / 2;
  for (const s of world.ships) {
    if (!s.alive) continue;
    const d = Math.hypot(s.x - me.x, s.y - me.y);
    if (d > scanLimit) continue;
    const x = sx(s.x), y = sy(s.y);
    if (x < -5 || y < -5 || x > W + 5 || y > H + 5) continue;
    ctx.fillStyle = TEAMS[s.team].color;
    if (world.radarMode === "LONG") {
      // bare dot only
      ctx.fillRect(x - 2, y - 2, 4, 4);
    } else {
      // SHORT mode: small triangle pointing in heading direction + class letter
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
    // Player self marker
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

  // Mode label
  ctx.fillStyle = "#777";
  ctx.font = "10px Courier New";
  ctx.fillText(world.radarMode === "LONG" ? "LONG RANGE" : "SHORT RANGE", 6, 12);
  ctx.fillText(`${Math.round(range/TACTICAL_RANGE)} screens`, 6, 24);
}
