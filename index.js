const mineflayer = require("mineflayer");
const { Movements, pathfinder, goals } = require("mineflayer-pathfinder");
const { GoalBlock } = goals;
const config = require("./settings.json");
const express = require("express");
const http = require("http");
const https = require("https");
const setupLeaveRejoin = require("./leaveRejoin");

// ============================================================
// EXPRESS SERVER
// ============================================================
const app = express();
const PORT = process.env.PORT || 5000;

const allBotsState = config.bots.map((cfg, i) => ({
  index: i,
  name: cfg.name,
  server: cfg.server.ip,
  connected: false,
  startTime: Date.now(),
  reconnectAttempts: 0,
  coords: null,
}));

app.get("/", (req, res) => {
  const rows = allBotsState
    .map((s) => {
      const uptime = Math.floor((Date.now() - s.startTime) / 1000);
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      const sec = uptime % 60;
      const coordStr = s.coords
        ? `${Math.floor(s.coords.x)}, ${Math.floor(s.coords.y)}, ${Math.floor(s.coords.z)}`
        : "Unknown";
      const statusColor = s.connected ? "#4ade80" : "#f87171";
      const statusText = s.connected ? "Online" : "Reconnecting...";
      return `
      <div class="bot-card">
        <h2><span class="dot" style="background:${statusColor};box-shadow:0 0 8px ${statusColor};"></span>${s.name}</h2>
        <div class="row"><span class="label">Status</span><span class="val" style="color:${statusColor}">${statusText}</span></div>
        <div class="row"><span class="label">Server</span><span class="val">${s.server}</span></div>
        <div class="row"><span class="label">Uptime</span><span class="val">${h}h ${m}m ${sec}s</span></div>
        <div class="row"><span class="label">Coordinates</span><span class="val">${coordStr}</span></div>
        <div class="row"><span class="label">Reconnects</span><span class="val">${s.reconnectAttempts}</span></div>
      </div>`;
    })
    .join("");

  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>MafiaMC Bots Dashboard</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #f8fafc; min-height: 100vh; padding: 30px 20px; }
    h1 { text-align: center; color: #2dd4bf; margin-bottom: 30px; font-size: 26px; letter-spacing: 1px; }
    .grid { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; }
    .bot-card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 24px; width: 320px; box-shadow: 0 0 30px rgba(45,212,191,0.1); }
    .bot-card h2 { font-size: 18px; color: #ccfbf1; margin-bottom: 16px; display: flex; align-items: center; gap: 10px; }
    .dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
    .row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding: 8px 10px; background: #0f172a; border-radius: 8px; border-left: 3px solid #2dd4bf; }
    .label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
    .val { font-size: 14px; font-weight: bold; color: #2dd4bf; }
    .footer { text-align: center; color: #475569; font-size: 12px; margin-top: 30px; }
  </style>
  <script>setInterval(() => location.reload(), 5000);</script>
</head>
<body>
  <h1>MafiaMC Bots</h1>
  <div class="grid">${rows}</div>
  <p class="footer">Auto-refreshes every 5 seconds</p>
</body>
</html>`);
});

app.get("/health", (req, res) => {
  res.json(
    allBotsState.map((s) => ({
      name: s.name,
      server: s.server,
      status: s.connected ? "connected" : "disconnected",
      uptime: Math.floor((Date.now() - s.startTime) / 1000),
      coords: s.coords,
      reconnectAttempts: s.reconnectAttempts,
    })),
  );
});

app.get("/ping", (req, res) => res.send("pong"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Server] HTTP server started on port ${PORT}`);
});

// ============================================================
// SELF-PING
// ============================================================
setInterval(
  () => {
    const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    const protocol = url.startsWith("https") ? https : http;
    protocol
      .get(`${url}/ping`, () => {})
      .on("error", (err) => {
        console.log(`[KeepAlive] Self-ping failed: ${err.message}`);
      });
  },
  10 * 60 * 1000,
);
console.log("[KeepAlive] Self-ping started (every 10 min)");

setInterval(
  () => {
    const mem = process.memoryUsage();
    console.log(`[Memory] Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  },
  5 * 60 * 1000,
);

// ============================================================
// PER-BOT LOGIC
// ============================================================
function startBot(botConfig, stateRef) {
  let bot = null;
  let activeIntervals = [];
  let reconnectTimeout = null;
  const label = `[${botConfig.name}]`;

  function clearAllIntervals() {
    activeIntervals.forEach((id) => clearInterval(id));
    activeIntervals = [];
  }

  function addInterval(cb, delay) {
    const id = setInterval(cb, delay);
    activeIntervals.push(id);
    return id;
  }

  function scheduleReconnect() {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    stateRef.reconnectAttempts++;
    const delay = Math.min(3000 + stateRef.reconnectAttempts * 1000, 20000);
    console.log(
      `${label} Reconnecting in ${delay / 1000}s (attempt #${stateRef.reconnectAttempts})`,
    );
    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      createBot();
    }, delay);
  }

  function createBot() {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (bot) {
      clearAllIntervals();
      try {
        bot.removeAllListeners();
        bot.end();
      } catch (e) {}
      bot = null;
    }

    console.log(
      `${label} Connecting to ${botConfig.server.ip}:${botConfig.server.port}`,
    );

    try {
      bot = mineflayer.createBot({
        username: botConfig["bot-account"].username,
        password: botConfig["bot-account"].password || undefined,
        auth: botConfig["bot-account"].type,
        host: botConfig.server.ip,
        port: botConfig.server.port,
        version: botConfig.server.version,
        hideErrors: false,
        checkTimeoutInterval: 120000,
      });

      bot.loadPlugin(pathfinder);

      const connectionTimeout = setTimeout(() => {
        if (!stateRef.connected) {
          console.log(`${label} Connection timeout`);
          scheduleReconnect();
        }
      }, 60000);

      bot.once("spawn", () => {
        clearTimeout(connectionTimeout);
        stateRef.connected = true;
        stateRef.reconnectAttempts = 0;
        console.log(`${label} Spawned on server!`);

        const mcData = require("minecraft-data")(botConfig.server.version);
        const defaultMove = new Movements(bot, mcData);
        defaultMove.allowFreeMotion = false;
        defaultMove.canDig = false;

        if (botConfig.movement["circle-walk"].enabled)
          startCircleWalk(bot, defaultMove, botConfig, stateRef, addInterval);
        if (botConfig.movement["random-jump"].enabled)
          startRandomJump(bot, botConfig, stateRef, addInterval);
        if (botConfig.movement["look-around"].enabled)
          startLookAround(bot, botConfig, stateRef, addInterval);

        setupLeaveRejoin(bot, createBot);

        bot.on("entityMoved", () => {
          if (bot && bot.entity) stateRef.coords = bot.entity.position;
        });
      });

      bot.on("kicked", (reason) => {
        console.log(`${label} Kicked: ${reason}`);
      });

      bot.on("end", (reason) => {
        console.log(`${label} Disconnected: ${reason || "Unknown"}`);
        stateRef.connected = false;
        stateRef.coords = null;
        clearAllIntervals();
        scheduleReconnect();
      });

      bot.on("error", (err) => {
        console.log(`${label} Error: ${err.message}`);
      });
    } catch (err) {
      console.log(`${label} Failed to create bot: ${err.message}`);
      scheduleReconnect();
    }
  }

  createBot();
}

// ============================================================
// MOVEMENT
// ============================================================
function startCircleWalk(bot, defaultMove, cfg, stateRef, addInterval) {
  const radius = cfg.movement["circle-walk"].radius;
  let angle = 0;
  let lastPathTime = 0;
  addInterval(() => {
    if (!bot || !stateRef.connected) return;
    const now = Date.now();
    if (now - lastPathTime < 2000) return;
    lastPathTime = now;
    try {
      const x = bot.entity.position.x + Math.cos(angle) * radius;
      const z = bot.entity.position.z + Math.sin(angle) * radius;
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(
        new GoalBlock(
          Math.floor(x),
          Math.floor(bot.entity.position.y),
          Math.floor(z),
        ),
      );
      angle += Math.PI / 4;
    } catch (e) {}
  }, cfg.movement["circle-walk"].speed);
}

function startRandomJump(bot, cfg, stateRef, addInterval) {
  addInterval(() => {
    if (!bot || !stateRef.connected) return;
    try {
      bot.setControlState("jump", true);
      setTimeout(() => {
        if (bot) bot.setControlState("jump", false);
      }, 300);
    } catch (e) {}
  }, cfg.movement["random-jump"].interval);
}

function startLookAround(bot, cfg, stateRef, addInterval) {
  addInterval(() => {
    if (!bot || !stateRef.connected) return;
    try {
      bot.look(
        Math.random() * Math.PI * 2,
        ((Math.random() - 0.5) * Math.PI) / 4,
        true,
      );
    } catch (e) {}
  }, cfg.movement["look-around"].interval);
}

// ============================================================
// CRASH RECOVERY
// ============================================================
process.on("uncaughtException", (err) => {
  console.log(`[FATAL] ${err.message}`);
});
process.on("unhandledRejection", (reason) => {
  console.log(`[FATAL] ${reason}`);
});
process.on("SIGTERM", () => {
  process.exit(0);
});
process.on("SIGINT", () => {
  process.exit(0);
});

// ============================================================
// START ALL BOTS
// ============================================================
console.log("=".repeat(50));
console.log(`  Minecraft AFK Bot - Running ${config.bots.length} bots`);
console.log("=".repeat(50));
config.bots.forEach((b, i) =>
  console.log(`[Bot ${i + 1}] ${b.name} -> ${b.server.ip}:${b.server.port}`),
);
console.log("=".repeat(50));

config.bots.forEach((botConfig, i) => {
  setTimeout(() => startBot(botConfig, allBotsState[i]), i * 3000);
});
