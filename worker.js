// Cloudflare Worker for Discord /lobby command with PNG lobby + player stats card

const DEFAULT_CON_UID = "105695234";
const DEFAULT_CON_AUTH = "6934ffe7e7d60930b3439e8da9159796";
const DEFAULT_FIREFLY_HASH = "aeec512e05bb4b4fba1bec453a639aadded7f5f2";
const DEFAULT_CLIENT = "con-client-web";
const DEFAULT_VERSION = "420";
const DEFAULT_API_VERSION = "20141208";

const BRAND_TITLE = "CONFLICT OF NATIONS LOBBY";
const BRAND_SUBTITLE = "LIVE MATCH & PLAYER STATS";
const BRAND_TAG = "BFO";

const MAX_PLAYERS_RENDERED = 24;
const STATS_BATCH_SIZE = 12;
const REQUEST_TIMEOUT_MS = 10000;

function getConfig(env = {}) {
  return {
    discordPublicKey: String(env.DISCORD_PUBLIC_KEY || "").trim(),
    conUid: String(env.CON_UID || DEFAULT_CON_UID).trim(),
    conAuth: String(env.CON_AUTH || DEFAULT_CON_AUTH).trim(),
    fireflyHash: String(env.CON_HASH || DEFAULT_FIREFLY_HASH).trim(),
    fireflyData: String(env.CON_DATA || "").trim(),
    client: String(env.CON_CLIENT || DEFAULT_CLIENT).trim(),
    version: String(env.CON_VERSION || DEFAULT_VERSION).trim(),
    apiVersion: String(env.CON_API_VERSION || DEFAULT_API_VERSION).trim(),
    extraCookie: String(env.CON_EXTRA_COOKIE || "").trim(),
  };
}
function hexToBytes(hex) {
  const clean = String(hex || "").trim().replace(/^0x/i, "");
  if (clean.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

async function verifyDiscordSignature(rawBody, signatureHex, timestamp, publicKeyHex) {
  if (!publicKeyHex || !signatureHex || !timestamp) return false;
  try {
    const keyBytes = hexToBytes(publicKeyHex);
    const sigBytes = hexToBytes(signatureHex);
    if (keyBytes.length !== 32 || sigBytes.length !== 64) return false;

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["verify"]
    );
    const message = new TextEncoder().encode(String(timestamp) + rawBody);
    return await crypto.subtle.verify("Ed25519", cryptoKey, sigBytes, message);
  } catch (_) {
    return false;
  }
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function safeJsonParse(text) {
  if (!text || typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}
class SessionCookieJar {
  constructor(initialCookie = "") {
    this.map = new Map();
    if (initialCookie) this.parseCookieHeader(initialCookie);
  }

  parseCookieHeader(headerStr) {
    for (const part of String(headerStr || "").split(";")) {
      const idx = part.indexOf("=");
      if (idx > 0) {
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k) this.map.set(k, v);
      }
    }
  }

  ingestSetCookieHeaders(headers) {
    if (!headers) return;
    const list = typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : headers.get("set-cookie")
        ? [headers.get("set-cookie")]
        : [];
    for (const raw of list) {
      for (const entry of String(raw || "").split(/,(?=\s*[A-Za-z0-9_.-]+=)/)) {
        const firstSemi = entry.split(";")[0] || "";
        const eq = firstSemi.indexOf("=");
        if (eq > 0) {
          const k = firstSemi.slice(0, eq).trim();
          const v = firstSemi.slice(eq + 1).trim();
          if (k) this.map.set(k, v);
        }
      }
    }
  }

  set(k, v) {
    if (k && v !== undefined && v !== null) {
      this.map.set(String(k), String(v));
    }
  }

  toHeader() {
    const pairs = [];
    for (const [k, v] of this.map.entries()) {
      pairs.push(`${k}=${v}`);
    }
    return pairs.join("; ");
  }
}

function buildCookieJar(cfg) {
  const jar = new SessionCookieJar();
  const uid = cfg.conUid;
  const auth = cfg.conAuth;
  jar.set("bl_lang", "2");
  jar.set("bl_lang_legacy", "2");
  jar.set("acceptedCookies", "1");
  jar.set("acceptedCookies_legacy", "1");
  jar.set("mobile_con", "0");
  jar.set("mobile_con_legacy", "0");
  if (auth) {
    jar.set("bl_sid", auth);
    jar.set("bl_sid_legacy", auth);
  }
  if (uid) {
    jar.set("puid", uid);
    jar.set("puid_legacy", uid);
  }
  if (auth && uid) {
    const hist = encodeURIComponent(
      `&uid=${uid}&id=${auth}&source=browser-desktop`
    );
    jar.set("sup_hist", hist);
    jar.set("sup_hist_legacy", hist);
  }
  if (cfg.extraCookie) {
    jar.parseCookieHeader(cfg.extraCookie);
  }
  return jar;
}

function encodeFireflyPayloadData(userIds, uid, auth) {
  const list = Array.isArray(userIds)
    ? userIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const rawObj = {
    userIDs: list,
    siteUserID: Number(uid) || 0,
    userAuth: auth || "",
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(rawObj));
  let bin = "";
  for (let i = 0; i < jsonBytes.length; i++) {
    bin += String.fromCharCode(jsonBytes[i]);
  }
  return btoa(bin);
}
async function fetchGameState(gameId, cfg, jar) {
  const cleanId = String(gameId || "").trim();
  const candidateHosts = [
    `https://congs${cleanId}.c.bytro.com`,
    "https://www.conflictnations.com",
  ];

  for (const host of candidateHosts) {
    const url = host.includes("conflictnations.com")
      ? `${host}/index.php?eID=api&key=ingameCon&action=getGameState&gameID=${encodeURIComponent(cleanId)}&outputFormat=json`
      : `${host}/`;

    const body = host.includes("conflictnations.com")
      ? undefined
      : JSON.stringify({
          gameID: Number(cleanId) || cleanId,
          siteUserID: Number(cfg.conUid) || 0,
          userAuth: cfg.conAuth,
          client: cfg.client,
          version: cfg.version,
          actions: [{ action: "UltUpdateGameStateAction" }],
        });

    try {
      const resp = await fetchWithTimeout(url, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": body ? "application/json" : "application/x-www-form-urlencoded",
          "Cookie": jar.toHeader(),
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://www.conflictnations.com/",
        },
        body,
      });
      jar.ingestSetCookieHeaders(resp.headers);
      if (!resp.ok) continue;
      const text = await resp.text();
      const parsed = safeJsonParse(text);
      if (parsed && typeof parsed === "object") {
        return { ok: true, data: parsed, source: host };
      }
    } catch (_) {
      // Try next candidate
    }
  }
  return { ok: false, data: null, error: "Unable to load lobby state" };
}

function extractPlayersFromState(gameState) {
  const players = [];
  const seen = new Set();

  function walk(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 7) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    const maybeId = node.userID ?? node.siteUserID ?? node.playerID ?? node.ownerID;
    const maybeName =
      node.username ?? node.userName ?? node.leaderName ?? node.playerName ?? node.name;
    const maybeNation =
      node.nationName ?? node.countryName ?? node.nation ?? node.country ?? "";

    if (
      maybeId !== undefined &&
      maybeId !== null &&
      String(maybeId).trim() !== "" &&
      String(maybeId) !== "0" &&
      maybeName &&
      typeof maybeName === "string"
    ) {
      const idStr = String(maybeId).trim();
      if (!seen.has(idStr)) {
        seen.add(idStr);
        players.push({
          userId: idStr,
          name: String(maybeName).trim(),
          nation: String(maybeNation || "").trim(),
          alliance: String(node.allianceTag || node.allianceName || node.alliance || "").trim(),
          vp: Number(node.vp ?? node.victoryPoints ?? node.points ?? 0) || 0,
        });
      }
    }

    for (const val of Object.values(node)) {
      if (val && typeof val === "object") walk(val, depth + 1);
    }
  }

  walk(gameState, 0);
  players.sort((a, b) => b.vp - a.vp);
  return players;
}

function parseUserStatsRecord(userObj) {
  if (!userObj || typeof userObj !== "object") return null;
  const id = String(userObj.id ?? userObj.userID ?? userObj.siteUserID ?? "").trim();
  if (!id) return null;

  const rankProgress = userObj.rankProgress && typeof userObj.rankProgress === "object"
    ? userObj.rankProgress
    : {};
  const gameStats = userObj.gameStats && typeof userObj.gameStats === "object"
    ? userObj.gameStats
    : {};
  const gameStatsScore = gameStats.gameStatsScore && typeof gameStats.gameStatsScore === "object"
    ? gameStats.gameStatsScore
    : {};

  const level = Number(
    rankProgress.currentRankLevel ?? userObj.currentRankLevel ?? userObj.level ?? userObj.rankLevel ?? 0
  ) || 0;

  const gamesPlayed = Number(
    gameStatsScore.gamesJoin ?? gameStats.gamesJoin ?? gameStats.gamesPlayed ?? userObj.gamesPlayed ?? 0
  ) || 0;

  const soloWins = Number(
    gameStatsScore.soloVictory ?? gameStats.soloVictory ?? 0
  ) || 0;
  const coalitionWins = Number(
    gameStatsScore.coalitionVictory ?? gameStats.coalitionVictory ?? 0
  ) || 0;
  const wins = Number(
    userObj.wins ?? gameStats.wins ?? (soloWins + coalitionWins)
  ) || 0;

  const kills = Number(
    userObj.kills ?? gameStats.kills ?? gameStats.unitsKilled ?? rankProgress.militaryScore ?? 0
  ) || 0;
  const losses = Number(
    userObj.losses ?? gameStats.losses ?? gameStats.unitsLost ?? 0
  ) || 0;

  const winPct = gamesPlayed > 0 ? ((wins / gamesPlayed) * 100).toFixed(1) : "0.0";
  const kd = losses > 0 ? (kills / losses).toFixed(2) : kills > 0 ? kills.toFixed(2) : "0.00";

  const allianceTag = String(
    userObj.allianceTag ||
    userObj.allianceName ||
    (userObj.alliance && (userObj.alliance.tag || userObj.alliance.name)) ||
    ""
  ).trim();

  const isSc = Boolean(
    userObj.hasSecurityCouncil ||
    userObj.securityCouncil ||
    userObj.sc ||
    (userObj.subscription && userObj.subscription.sc)
  );

  return {
    userId: id,
    username: String(userObj.username || userObj.userName || "").trim(),
    level,
    gamesPlayed,
    wins,
    winPct,
    kills,
    losses,
    kd,
    alliance: allianceTag,
    sc: isSc,
  };
}
async function fetchStatsViaFirefly(userIds, cfg, jar) {
  const statsById = new Map();
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { statsById, error: "No user IDs" };
  }

  const params = new URLSearchParams({
    eID: "api",
    key: "ingameCon",
    action: "getUserDetailsFirefly",
    hash: cfg.fireflyHash,
    outputFormat: "json",
    apiVersion: cfg.apiVersion,
  });

  const url = `https://www.conflictnations.com/index.php?${params.toString()}`;
  const encodedData = cfg.fireflyData || encodeFireflyPayloadData(userIds, cfg.conUid, cfg.conAuth);
  const formBody = new URLSearchParams({ data: encodedData });

  try {
    const resp = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Cookie": jar.toHeader(),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://www.conflictnations.com",
        "Referer": "https://www.conflictnations.com/",
      },
      body: formBody.toString(),
    });
    jar.ingestSetCookieHeaders(resp.headers);

    const text = await resp.text();
    const parsed = safeJsonParse(text);
    if (!parsed || typeof parsed !== "object") {
      return { statsById, error: `Firefly HTTP ${resp.status}` };
    }

    const candidates = [];
    if (parsed.result && typeof parsed.result === "object") {
      if (Array.isArray(parsed.result)) candidates.push(...parsed.result);
      else if (parsed.result.users && typeof parsed.result.users === "object") {
        candidates.push(...Object.values(parsed.result.users));
      } else {
        candidates.push(parsed.result);
      }
    }
    if (parsed.users && typeof parsed.users === "object") {
      candidates.push(...Object.values(parsed.users));
    }

    for (const item of candidates) {
      const rec = parseUserStatsRecord(item);
      if (rec && rec.userId) {
        statsById.set(rec.userId, rec);
      }
    }

    const msg = String(parsed.resultMessage || parsed.error || "").trim();
    return {
      statsById,
      error: statsById.size === 0 ? (msg || `Firefly HTTP ${resp.status}`) : "",
    };
  } catch (err) {
    return { statsById, error: String(err && err.message ? err.message : err) };
  }
}

async function resolvePlayerStats(players, gameId, cfg, jar) {
  const statsById = new Map();
  const targetIds = players.slice(0, STATS_BATCH_SIZE).map((p) => p.userId);
  if (targetIds.length === 0) {
    return { statsById, statusText: "STATS: 0/0 (NO PLAYERS)" };
  }

  // Primary attempt via UltGetUserDetailsAction on game server
  let rpcError = "";
  try {
    const rpcUrl = `https://congs${String(gameId || "").trim()}.c.bytro.com/`;
    const resp = await fetchWithTimeout(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": jar.toHeader(),
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.conflictnations.com/",
      },
      body: JSON.stringify({
        gameID: Number(gameId) || gameId,
        siteUserID: Number(cfg.conUid) || 0,
        userAuth: cfg.conAuth,
        client: cfg.client,
        version: cfg.version,
        actions: [{ action: "UltGetUserDetailsAction", userIDs: targetIds }],
      }),
    });
    jar.ingestSetCookieHeaders(resp.headers);
    const text = await resp.text();
    const parsed = safeJsonParse(text);
    if (parsed && typeof parsed === "object") {
      const users = parsed.users || (parsed.result && parsed.result.users) || null;
      if (users && typeof users === "object") {
        for (const u of Object.values(users)) {
          const rec = parseUserStatsRecord(u);
          if (rec && rec.userId) statsById.set(rec.userId, rec);
        }
      }
      if (statsById.size === 0 && text.includes("UltAuthenticationException")) {
        rpcError = "UltAuthenticationException";
      }
    }
  } catch (err) {
    rpcError = String(err && err.message ? err.message : err);
  }

  // Fallback to getUserDetailsFirefly if primary lookup returned no stats
  let fireflyError = "";
  if (statsById.size === 0) {
    const ff = await fetchStatsViaFirefly(targetIds, cfg, jar);
    for (const [k, v] of ff.statsById.entries()) {
      statsById.set(k, v);
    }
    fireflyError = ff.error;
  }

  const loadedCount = statsById.size;
  const totalCount = targetIds.length;
  let statusText = `STATS: ${loadedCount}/${totalCount}`;
  if (loadedCount === 0) {
    const reason = fireflyError || rpcError || "AUTH CHECK";
    statusText = `STATS: 0/${totalCount} (${reason.slice(0, 28).toUpperCase()})`;
  }

  return { statsById, statusText };
}
const FONT_5X7 = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "!": [4, 4, 4, 4, 4, 0, 4],
  '"': [10, 10, 10, 0, 0, 0, 0],
  "#": [10, 31, 10, 10, 31, 10, 0],
  "$": [4, 15, 20, 14, 5, 30, 4],
  "%": [25, 26, 4, 8, 22, 19, 0],
  "&": [12, 18, 20, 8, 21, 18, 13],
  "'": [4, 4, 8, 0, 0, 0, 0],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
  "*": [0, 21, 14, 31, 14, 21, 0],
  "+": [0, 4, 4, 31, 4, 4, 0],
  ",": [0, 0, 0, 0, 0, 4, 8],
  "-": [0, 0, 0, 31, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 12, 12],
  "/": [1, 2, 4, 8, 16, 0, 0],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [30, 1, 1, 14, 16, 16, 31],
  "3": [30, 1, 1, 14, 1, 1, 30],
  "4": [18, 18, 18, 31, 2, 2, 2],
  "5": [31, 16, 16, 30, 1, 1, 30],
  "6": [14, 16, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 1, 14],
  ":": [0, 12, 12, 0, 12, 12, 0],
  ";": [0, 12, 12, 0, 12, 12, 8],
  "<": [2, 4, 8, 16, 8, 4, 2],
  "=": [0, 0, 31, 0, 31, 0, 0],
  ">": [16, 8, 4, 2, 4, 8, 16],
  "?": [14, 17, 1, 2, 4, 0, 4],
  "@": [14, 17, 23, 21, 23, 16, 14],
  "A": [14, 17, 17, 31, 17, 17, 17],
  "B": [30, 17, 17, 30, 17, 17, 30],
  "C": [14, 17, 16, 16, 16, 17, 14],
  "D": [28, 18, 17, 17, 17, 18, 28],
  "E": [31, 16, 16, 30, 16, 16, 31],
  "F": [31, 16, 16, 30, 16, 16, 16],
  "G": [14, 17, 16, 23, 17, 17, 15],
  "H": [17, 17, 17, 31, 17, 17, 17],
  "I": [14, 4, 4, 4, 4, 4, 14],
  "J": [7, 2, 2, 2, 18, 18, 12],
  "K": [17, 18, 20, 24, 20, 18, 17],
  "L": [16, 16, 16, 16, 16, 16, 31],
  "M": [17, 27, 21, 21, 17, 17, 17],
  "N": [17, 25, 21, 19, 17, 17, 17],
  "O": [14, 17, 17, 17, 17, 17, 14],
  "P": [30, 17, 17, 30, 16, 16, 16],
  "Q": [14, 17, 17, 17, 21, 18, 13],
  "R": [30, 17, 17, 30, 20, 18, 17],
  "S": [15, 16, 16, 14, 1, 1, 30],
  "T": [31, 4, 4, 4, 4, 4, 4],
  "U": [17, 17, 17, 17, 17, 17, 14],
  "V": [17, 17, 17, 17, 17, 10, 4],
  "W": [17, 17, 17, 21, 21, 27, 17],
  "X": [17, 17, 10, 4, 10, 17, 17],
  "Y": [17, 17, 10, 4, 4, 4, 4],
  "Z": [31, 1, 2, 4, 8, 16, 31],
  "[": [14, 8, 8, 8, 8, 8, 14],
  "\\": [16, 8, 4, 2, 1, 0, 0],
  "]": [14, 2, 2, 2, 2, 2, 14],
  "^": [4, 10, 17, 0, 0, 0, 0],
  "_": [0, 0, 0, 0, 0, 0, 31],
  "`": [8, 4, 2, 0, 0, 0, 0],
  "|": [4, 4, 4, 4, 4, 4, 4],
};

class PixelCanvas {
  constructor(width, height, bgColor = [15, 21, 32, 255]) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 4);
    this.fillRect(0, 0, width, height, bgColor);
  }

  setPixel(x, y, rgba) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return;
    const idx = (iy * this.width + ix) * 4;
    const alpha = (rgba[3] ?? 255) / 255;
    if (alpha >= 1) {
      this.pixels[idx] = rgba[0];
      this.pixels[idx + 1] = rgba[1];
      this.pixels[idx + 2] = rgba[2];
      this.pixels[idx + 3] = 255;
    } else if (alpha > 0) {
      this.pixels[idx] = Math.round(rgba[0] * alpha + this.pixels[idx] * (1 - alpha));
      this.pixels[idx + 1] = Math.round(rgba[1] * alpha + this.pixels[idx + 1] * (1 - alpha));
      this.pixels[idx + 2] = Math.round(rgba[2] * alpha + this.pixels[idx + 2] * (1 - alpha));
      this.pixels[idx + 3] = 255;
    }
  }

  fillRect(x, y, w, h, rgba) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        this.setPixel(px, py, rgba);
      }
    }
  }

  drawRectOutline(x, y, w, h, rgba, thickness = 1) {
    this.fillRect(x, y, w, thickness, rgba);
    this.fillRect(x, y + h - thickness, w, thickness, rgba);
    this.fillRect(x, y, thickness, h, rgba);
    this.fillRect(x + w - thickness, y, thickness, h, rgba);
  }

  drawText(text, x, y, rgba, scale = 2) {
    const upper = String(text || "").toUpperCase();
    let cursorX = Math.floor(x);
    const cursorY = Math.floor(y);
    for (let i = 0; i < upper.length; i++) {
      const ch = upper[i];
      const glyph = FONT_5X7[ch] || FONT_5X7["?"];
      for (let row = 0; row < 7; row++) {
        const bits = glyph[row];
        for (let col = 0; col < 5; col++) {
          if (bits & (1 << (4 - col))) {
            this.fillRect(
              cursorX + col * scale,
              cursorY + row * scale,
              scale,
              scale,
              rgba
            );
          }
        }
      }
      cursorX += 6 * scale;
    }
  }

  drawEmblem(x, y, size = 44) {
    const gold = [218, 175, 68, 255];
    const navy = [20, 32, 52, 255];
    const crimson = [178, 46, 46, 255];
    const cream = [240, 236, 224, 255];

    this.fillRect(x, y, size, size, navy);
    this.drawRectOutline(x, y, size, size, gold, 2);
    this.fillRect(x + 4, y + 4, size - 8, 8, crimson);
    this.fillRect(x + 4, y + size - 12, size - 8, 8, crimson);
    this.drawText(BRAND_TAG, x + Math.floor((size - 18 * 2) / 2), y + 15, cream, 2);
  }
}
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function makePngChunk(typeStr, dataBytes) {
  const typeBytes = new TextEncoder().encode(typeStr);
  const len = dataBytes.length;
  const out = new Uint8Array(12 + len);
  const view = new DataView(out.buffer);
  view.setUint32(0, len, false);
  out.set(typeBytes, 4);
  out.set(dataBytes, 8);
  const crcInput = concatBytes(typeBytes, dataBytes);
  view.setUint32(8 + len, crc32(crcInput), false);
  return out;
}

function encodeCanvasToPng(canvas) {
  const { width, height, pixels } = canvas;
  const rowStride = width * 4 + 1;
  const rawScanlines = new Uint8Array(rowStride * height);

  for (let y = 0; y < height; y++) {
    const srcStart = y * width * 4;
    const dstStart = y * rowStride;
    rawScanlines[dstStart] = 0; // Filter type 0 (None)
    rawScanlines.set(pixels.subarray(srcStart, srcStart + width * 4), dstStart + 1);
  }

  // Wrap raw scanlines in uncompressed DEFLATE blocks inside a zlib stream
  const maxBlock = 65535;
  const numBlocks = Math.max(1, Math.ceil(rawScanlines.length / maxBlock));
  const deflateBlocks = [];
  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const chunk = rawScanlines.subarray(offset, Math.min(rawScanlines.length, offset + maxBlock));
    offset += chunk.length;
    const isFinal = b === numBlocks - 1 ? 1 : 0;
    const header = new Uint8Array(5);
    header[0] = isFinal;
    const len = chunk.length;
    const nlen = (~len) & 0xffff;
    header[1] = len & 0xff;
    header[2] = (len >>> 8) & 0xff;
    header[3] = nlen & 0xff;
    header[4] = (nlen >>> 8) & 0xff;
    deflateBlocks.push(header, chunk);
  }

  const adler = adler32(rawScanlines);
  const adlerBytes = new Uint8Array(4);
  new DataView(adlerBytes.buffer).setUint32(0, adler, false);
  const zlibStream = concatBytes(new Uint8Array([0x78, 0x01]), ...deflateBlocks, adlerBytes);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return concatBytes(
    signature,
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", zlibStream),
    makePngChunk("IEND", new Uint8Array(0))
  );
}

function renderLobbyCardPng(gameId, players, statsById, statsStatusText) {
  const rowHeight = 24;
  const shown = players.slice(0, MAX_PLAYERS_RENDERED);
  const width = 960;
  const height = 132 + Math.max(1, shown.length) * rowHeight + 36;

  const canvas = new PixelCanvas(width, height, [15, 22, 34, 255]);
  const panelBg = [23, 33, 49, 255];
  const rowAlt = [19, 28, 42, 255];
  const gold = [218, 175, 68, 255];
  const white = [242, 245, 249, 255];
  const muted = [156, 173, 198, 255];
  const accent = [76, 175, 130, 255];

  // Top branding banner
  canvas.fillRect(0, 0, width, 76, [11, 16, 26, 255]);
  canvas.fillRect(0, 74, width, 3, gold);
  canvas.drawEmblem(16, 14, 46);
  canvas.drawText(`${BRAND_TITLE} #${String(gameId)}`, 74, 18, white, 2);
  canvas.drawText(`${BRAND_SUBTITLE}  |  PLAYERS: ${players.length}`, 74, 42, muted, 2);
  canvas.drawText(statsStatusText, 530, 28, accent, 2);

  // Table header
  const tableTop = 88;
  canvas.fillRect(16, tableTop, width - 32, rowHeight, panelBg);
  canvas.drawText("PLAYER", 24, tableTop + 5, gold, 2);
  canvas.drawText("NATION", 250, tableTop + 5, gold, 2);
  canvas.drawText("VP", 440, tableTop + 5, gold, 2);
  canvas.drawText("LV", 510, tableTop + 5, gold, 2);
  canvas.drawText("W/P", 575, tableTop + 5, gold, 2);
  canvas.drawText("WIN%", 675, tableTop + 5, gold, 2);
  canvas.drawText("K/D", 775, tableTop + 5, gold, 2);
  canvas.drawText("ALLY", 865, tableTop + 5, gold, 2);

  if (shown.length === 0) {
    canvas.fillRect(16, tableTop + rowHeight, width - 32, rowHeight, rowAlt);
    canvas.drawText("NO PLAYERS FOUND IN LOBBY SNAPSHOT", 24, tableTop + rowHeight + 5, muted, 2);
  } else {
    shown.forEach((p, idx) => {
      const y = tableTop + (idx + 1) * rowHeight;
      if (idx % 2 === 1) canvas.fillRect(16, y, width - 32, rowHeight, rowAlt);
      const st = statsById.get(p.userId);
      const lv = st ? String(st.level) : "-";
      const wp = st ? `${st.wins}/${st.gamesPlayed}` : "-";
      const winPct = st ? `${st.winPct}%` : "-";
      const kd = st ? st.kd : "-";
      const ally = (st && st.alliance) || p.alliance || "-";

      canvas.drawText(p.name.slice(0, 17), 24, y + 5, white, 2);
      canvas.drawText((p.nation || "-").slice(0, 14), 250, y + 5, muted, 2);
      canvas.drawText(String(p.vp), 440, y + 5, white, 2);
      canvas.drawText(lv, 510, y + 5, white, 2);
      canvas.drawText(wp, 575, y + 5, muted, 2);
      canvas.drawText(winPct, 675, y + 5, accent, 2);
      canvas.drawText(kd, 775, y + 5, white, 2);
      canvas.drawText(ally.slice(0, 7), 865, y + 5, gold, 2);
    });
  }

  // Footer
  const footerY = height - 26;
  canvas.drawText(
    `${BRAND_TAG} LOBBY MONITOR  |  SHOWING TOP ${shown.length} OF ${players.length}`,
    16,
    footerY,
    muted,
    2
  );

  return encodeCanvasToPng(canvas);
}
async function handleLobbyCommand(interaction, env, ctx) {
  const cfg = getConfig(env);
  const opts = (interaction.data && interaction.data.options) || [];
  const gameOpt = opts.find((o) => o.name === "id" || o.name === "game_id" || o.name === "lobby");
  const rawGameId = gameOpt ? String(gameOpt.value || "").trim() : "";

  if (!/^\d{4,12}$/.test(rawGameId)) {
    return jsonResponse({
      type: 4,
      data: {
        content: "Please provide a valid numeric game/lobby ID, for example: `/lobby 10482910`.",
        flags: 64,
      },
    });
  }

  // Acknowledge immediately with a deferred response, then update via webhook
  ctx.waitUntil((async () => {
    const jar = buildCookieJar(cfg);
    const stateRes = await fetchGameState(rawGameId, cfg, jar);

    let pngBytes;
    let contentText;

    if (!stateRes.ok || !stateRes.data) {
      const emptyCanvas = new PixelCanvas(760, 180, [15, 22, 34, 255]);
      emptyCanvas.drawEmblem(16, 16, 46);
      emptyCanvas.drawText(`${BRAND_TITLE} #${rawGameId}`, 74, 20, [242, 245, 249, 255], 2);
      emptyCanvas.drawText("UNABLE TO FETCH GAME STATE FOR THIS LOBBY ID", 74, 46, [235, 95, 95, 255], 2);
      emptyCanvas.drawText("CHECK LOBBY ID OR SESSION CREDENTIALS AND TRY AGAIN", 24, 100, [156, 173, 198, 255], 2);
      pngBytes = encodeCanvasToPng(emptyCanvas);
      contentText = `Could not load lobby **#${rawGameId}** (${stateRes.error || "unavailable"}).`;
    } else {
      const players = extractPlayersFromState(stateRes.data);
      const statsRes = await resolvePlayerStats(players, rawGameId, cfg, jar);
      pngBytes = renderLobbyCardPng(rawGameId, players, statsRes.statsById, statsRes.statusText);
      contentText = `Lobby **#${rawGameId}** — **${players.length}** players found | ${statsRes.statusText}`;
    }

    const formData = new FormData();
    formData.append(
      "payload_json",
      JSON.stringify({
        content: contentText,
        attachments: [{ id: 0, filename: `lobby-${rawGameId}.png` }],
      })
    );
    formData.append(
      "files[0]",
      new Blob([pngBytes], { type: "image/png" }),
      `lobby-${rawGameId}.png`
    );

    const webhookUrl = `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
    await fetchWithTimeout(webhookUrl, {
      method: "PATCH",
      body: formData,
    });
  })());

  return jsonResponse({ type: 5 });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "GET") {
      return new Response("Conflict of Nations Lobby Bot Worker is online.", { status: 200 });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const cfg = getConfig(env);
    const rawBody = await request.text();
    const signature = request.headers.get("X-Signature-Ed25519") || "";
    const timestamp = request.headers.get("X-Signature-Timestamp") || "";

    const validSig = await verifyDiscordSignature(
      rawBody,
      signature,
      timestamp,
      cfg.discordPublicKey
    );
    if (!validSig) {
      return new Response("Invalid request signature", { status: 401 });
    }

    const interaction = safeJsonParse(rawBody);
    if (!interaction || typeof interaction !== "object") {
      return new Response("Bad Request", { status: 400 });
    }

    // Discord PING
    if (interaction.type === 1) {
      return jsonResponse({ type: 1 });
    }

    // Slash commands
    if (interaction.type === 2 && interaction.data && interaction.data.name === "lobby") {
      return handleLobbyCommand(interaction, env, ctx);
    }

    return jsonResponse({
      type: 4,
      data: { content: "Unsupported command.", flags: 64 },
    });
  },
};

































