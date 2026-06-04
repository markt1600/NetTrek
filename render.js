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

  function w2s(x, y) {
    return { sx: cx + (x - me.x) * scale, sy: cy + (y - me.y) * scale };
  }

  // Starfield (deterministic)
  ctx.fillStyle = "#1a1a2a";
  const starSeed = Math.floor(me.x / 100) * 1000 + Math.floor(me.y / 100);
  const r = rng(starSeed);
  for (let i = 0; i < 120; i++) {
    ctx.fillRect(r() * W, r() * H, 1, 1);
  }

  // Grid (light)
  ctx.strokeStyle = "#10101a";
  ctx.lineWidth = 1;
  const grid = 1000;
  const offX = ((me.x % grid) - grid) % grid;
  const offY = ((me.y % grid) - grid) % grid;
  for (let gx = -offX; gx < TACTICAL_RANGE; gx += grid) {
    const sx = (gx - TACTICAL_RANGE/2) * scale + cx + (me.x % grid) * scale;
    const x = ((gx) * scale);
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }

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
    ctx.beginPath();
    ctx.moveTo(fr.sx, fr.sy); ctx.lineTo(to.sx, to.sy); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Torps
  for (const t of world.torps) {
    if (!t.alive) continue;
    const { sx, sy } = w2s(t.x, t.y);
    if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 10) continue;
    ctx.fillStyle = TEAMS[t.team].color;
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ships
  for (const s of world.ships) {
    if (!s.alive) {
      // explosion effect
      if (s.deadEffectUntil > world.now) {
        const { sx, sy } = w2s(s.x, s.y);
        const t = (s.deadEffectUntil - world.now) / EXPLOSION_TIME;
        ctx.strokeStyle = "#ffb84d";
        ctx.globalAlpha = t;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, (1 - t) * EXPLOSION_RADIUS * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      continue;
    }
    const { sx, sy } = w2s(s.x, s.y);
    if (sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) continue;
    drawShip(ctx, s, sx, sy, scale, world);
  }

  // Player's command marker (last clicked dest)
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

  // Range circles for player
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 1;
  const def = shipDef(me);
  ctx.beginPath();
  ctx.arc(cx, cy, def.phaserRange * scale, 0, Math.PI * 2);
  ctx.stroke();

  // Dead/respawn overlay
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
    ctx.fillText(`Respawning in ${sec}s`, W/2, H/2 + 24);
    ctx.textAlign = "left";
  }

  // Paused overlay
  if (world.paused && me.alive) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 36px Courier New";
    ctx.textAlign = "center";
    ctx.fillText("PAUSED", W/2, H/2);
    ctx.textAlign = "left";
  }

  // Refit overlay
  if (me.refitting) {
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ffc107";
    ctx.font = "bold 24px Courier New";
    ctx.textAlign = "center";
    const s = Math.max(0, me.refitEndsAt - world.now).toFixed(1);
    ctx.fillText(`REFITTING TO ${SHIPS[me._refitTo].name} (${s}s)`, W/2, H/2);
    ctx.textAlign = "left";
  }
}

function drawPlanet(ctx, p, sx, sy, r, big, world) {
  const t = TEAMS[p.team] || TEAMS.IND;
  r = Math.max(big ? 8 : 3, r);
  // body
  ctx.fillStyle = t.colorDim;
  ctx.strokeStyle = t.color;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  if (p.flashUntil > world.now) {
    ctx.strokeStyle = "#ffb84d";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(sx, sy, r + 4, 0, Math.PI * 2); ctx.stroke();
  }

  if (big) {
    // label
    ctx.fillStyle = "#fff";
    ctx.font = "11px Courier New";
    ctx.fillText(p.name, sx + r + 4, sy + 4);
    ctx.fillStyle = t.color;
    ctx.font = "10px Courier New";
    ctx.fillText(`${p.team} a=${p.armies}`, sx + r + 4, sy + 16);

    // icons
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

  // Shields
  if (s.shieldsUp) {
    ctx.strokeStyle = isMe ? "#90caf9" : "#444";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, def.radius + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Ship triangle/body
  ctx.fillStyle = t.colorDim;
  ctx.strokeStyle = t.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (s.shipClass === "SC") {
    // small triangle
    ctx.moveTo(def.radius, 0);
    ctx.lineTo(-def.radius * 0.8, -def.radius * 0.7);
    ctx.lineTo(-def.radius * 0.8, def.radius * 0.7);
  } else if (s.shipClass === "BB") {
    ctx.moveTo(def.radius, 0);
    ctx.lineTo(-def.radius, -def.radius * 0.9);
    ctx.lineTo(-def.radius * 0.6, 0);
    ctx.lineTo(-def.radius, def.radius * 0.9);
  } else if (s.shipClass === "AS") {
    // wide
    ctx.moveTo(def.radius * 0.9, 0);
    ctx.lineTo(-def.radius * 0.8, -def.radius);
    ctx.lineTo(-def.radius * 0.8, def.radius);
  } else {
    ctx.moveTo(def.radius, 0);
    ctx.lineTo(-def.radius * 0.9, -def.radius * 0.85);
    ctx.lineTo(-def.radius * 0.9, def.radius * 0.85);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Class letter
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
    // name + class + armies above ship
    ctx.fillStyle = TEAMS[s.team].color;
    ctx.font = "10px Courier New";
    ctx.textAlign = "center";
    let lbl = `${s.team}-${s.shipClass}`;
    if (s.armies > 0) lbl += ` +${s.armies}A`;
    ctx.fillText(lbl, sx, sy - def.radius - 8);
    ctx.textAlign = "left";
  }
}

function drawGalactic(world) {
  const cv = document.getElementById("galactic");
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  // sector lines
  ctx.strokeStyle = "#222";
  ctx.beginPath();
  ctx.moveTo(W/2, 0); ctx.lineTo(W/2, H);
  ctx.moveTo(0, H/2); ctx.lineTo(W, H/2);
  ctx.stroke();

  const sx = (x) => (x / GALAXY_SIZE) * W;
  const sy = (y) => (y / GALAXY_SIZE) * H;

  // Planets
  for (const p of world.planets) {
    const t = TEAMS[p.team] || TEAMS.IND;
    ctx.fillStyle = t.color;
    ctx.beginPath();
    ctx.arc(sx(p.x), sy(p.y), 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (p.flashUntil > world.now) {
      ctx.strokeStyle = "#fff";
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(p.y), 6, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // Ships
  for (const s of world.ships) {
    if (!s.alive) continue;
    ctx.fillStyle = TEAMS[s.team].color;
    ctx.fillRect(sx(s.x) - 1.5, sy(s.y) - 1.5, 3, 3);
    if (s === world.playerShip) {
      ctx.strokeStyle = "#fff";
      ctx.beginPath();
      ctx.arc(sx(s.x), sy(s.y), 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Tactical view box
  const me = world.playerShip;
  ctx.strokeStyle = "#fff";
  ctx.setLineDash([2, 2]);
  ctx.strokeRect(
    sx(me.x - TACTICAL_RANGE/2),
    sy(me.y - TACTICAL_RANGE/2),
    sx(TACTICAL_RANGE),
    sy(TACTICAL_RANGE),
  );
  ctx.setLineDash([]);
}
