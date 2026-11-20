const PUBLIC_KEY = "d4b2c5584aab9b59d22fcedfe90d62bbfc748e963613516db18212d40a1e32b6";
const DEFAULT_CON_USER = "Blyatforceone";
const DEFAULT_CON_PASS = "12345Qwerty.";

function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  const view = new DataView(arr.buffer);
  for (let i = 0; i < hex.length; i += 2) {
    view.setUint8(i / 2, parseInt(hex.slice(i, i + 2), 16));
  }
  return arr;
}

async function verifyDiscordSignature(request, bodyText) {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp) return false;
  const data = new TextEncoder().encode(timestamp + bodyText);
  const sigBytes = hexToBytes(signature);
  const keyBytes = hexToBytes(PUBLIC_KEY);
  for (const algo of Array.of("Ed25519", "NODE-ED25519")) {
    try {
      const key = await crypto.subtle.importKey("raw", keyBytes, { name: algo, namedCurve: algo }, false, Array.of("verify"));
      if (await crypto.subtle.verify(algo, key, sigBytes, data)) return true;
    } catch (e) {}
  }
  return false;
}

async function sendDiscordText(appId, token, content) {
  const path = Array.of("api", "v10", "webhooks", appId, token, "messages", "@original").join("/");
  await fetch(new URL(path, "https://discord.com").toString(), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "DiscordBot (https://workers.dev, 1.0)"
    },
    body: JSON.stringify({ content: content.slice(0, 1990) })
  });
}

async function sendDiscordImage(appId, token, caption, pngBuffer) {
  const path = Array.of("api", "v10", "webhooks", appId, token, "messages", "@original").join("/");
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content: caption }));
  form.append("files", new Blob(Array.of(pngBuffer), { type: "image/png" }), "lobby.png");
  await fetch(new URL(path, "https://discord.com").toString(), {
    method: "PATCH",
    headers: { "User-Agent": "DiscordBot (https://workers.dev, 1.0)" },
    body: form
  });
}

async function loginBytro(env) {
  const user = env?.CON_USER || DEFAULT_CON_USER;
  const pass = env?.CON_PASS || DEFAULT_CON_PASS;
  const attempts = Array.of(
    {
      url: "https://conflictnations.com",
      body: new URLSearchParams({ user: user, pass: pass, client: "con-client-mobile-portrait", version: "420" }).toString()
    },
    {
      url: "https://conflictnations.com",
      body: new URLSearchParams({ user: user, pass: pass, client: "con-client-mobile-portrait" }).toString()
    },
    {
      url: "https://conflictnations.com",
      body: new URLSearchParams({ username: user, password: pass, client: "con-client-mobile-portrait" }).toString()
    }
  );
  let info = "";
  for (const a of attempts) {
    try {
      const resp = await fetch(a.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "ConflictOfNations/420 CFNetwork/1498.700.2 Darwin/23.6.0",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: a.body
      });
      const text = await resp.text();
      const uid = text.match(/(?:siteUserID|userID|uid)["'=:\s]+(\d{5,12})/i);
      const auth = text.match(/(?:userAuth|auth|uberAuth|token)["'=:\s]+([a-f0-9]{32,40})/i) || text.match(/([a-f0-9]{40})/i);
      if (uid && auth) {
        return { siteUserID: Number(uid.at(1)), userAuth: auth.at(1), version: 420 };
      }
      info += resp.status + ":" + text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 14) + "|";
    } catch (e) {
      info += "ERR|";
    }
  }
  return { error: info.slice(0, 42) || "FAIL" };
}
async function checkServer(serverNum, gameId, session) {
  const validSession = session && session.siteUserID ? session : null;
  const url = new URL("/", "https://congs" + serverNum + ".c.bytro.com").toString();
  const payload = {
    "@c": "ultshared.action.UltUpdateGameStateAction",
    "requestID": 1,
    "language": "en",
    "lastCallDuration": 0,
    "actions": Array.of("java.util.LinkedList", new Array()),
    "stateIDs": null,
    "tstamps": null,
    "version": validSession ? validSession.version : 420,
    "client": "con-client-mobile-portrait",
    "siteUserID": validSession ? validSession.siteUserID : 0,
    "adminLevel": 0,
    "gameID": Number(gameId),
    "playerID": 0,
    "rights": "chat",
    "userAuth": validSession ? validSession.userAuth : "",
    "tstamp": String(Math.floor(Date.now() / 1000))
  };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://conflictnations.com",
        "Referer": "https://conflictnations.com"
      },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    if (text.includes("players") || text.includes("UltPlayerProfile")) {
      return { serverNum, data: JSON.parse(text) };
    }
  } catch (e) {}
  return null;
}

async function fetchUserDetailsBatch(serverNum, gameId, siteUserIDs, session) {
  const statsMap = new Map();
  if (!session || !session.siteUserID || siteUserIDs.length === 0) return statsMap;
  const url = new URL("/", "https://congs" + serverNum + ".c.bytro.com").toString();
  const subActions = siteUserIDs.map((uid, idx) => ({
    "@c": "ultshared.action.UltGetUserDetailsAction",
    "requestID": idx + 2,
    "userID": Number(uid)
  }));
  const payload = {
    "@c": "ultshared.action.UltUpdateGameStateAction",
    "requestID": 1,
    "language": "en",
    "lastCallDuration": 0,
    "actions": Array.of("java.util.LinkedList", subActions),
    "stateIDs": null,
    "tstamps": null,
    "version": session.version,
    "client": "con-client-mobile-portrait",
    "siteUserID": session.siteUserID,
    "adminLevel": 0,
    "gameID": Number(gameId),
    "playerID": 0,
    "rights": "chat",
    "userAuth": session.userAuth,
    "tstamp": String(Math.floor(Date.now() / 1000))
  };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://conflictnations.com",
        "Referer": "https://conflictnations.com"
      },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) return statsMap;
    const data = await resp.json();
    const results = data?.result?.actions || data?.result?.results || new Array();
    const list = Array.isArray(results) ? results : new Array();
    for (const item of list) {
      const u = item?.user || item?.result || item;
      const uid = Number(u?.userID ?? u?.siteUserID ?? u?.id ?? 0);
      if (!uid) continue;
      const kills = Number(u?.kills ?? u?.unitsKilled ?? u?.stats?.kills ?? 0);
      const losses = Number(u?.losses ?? u?.unitsLost ?? u?.stats?.losses ?? 0);
      const kd = losses > 0 ? (kills / losses).toFixed(2) : kills.toFixed(2);
      const played = Number(u?.gamesPlayed ?? u?.roundsPlayed ?? u?.stats?.gamesPlayed ?? 0);
      const won = Number(u?.gamesWon ?? u?.soloWins ?? u?.coalitionWins ?? u?.stats?.gamesWon ?? 0);
      const winPct = played > 0 ? Math.round((won / played) * 100) + "%" : "0%";
      const level = Number(u?.rank ?? u?.level ?? u?.userLevel ?? 0);
      const hasSC = Boolean(u?.securityCouncil || u?.premium || u?.isPremium || u?.highCommand);
      statsMap.set(uid, { kd, winPct, level, sc: hasSC ? "Y" : "N" });
    }
  } catch (e) {}
  return statsMap;
}

const FONT_HEX = {
  " ": "0000000000", "!": "00005f0000", "#": "147f147f14", "%": "2313086462",
  "(": "001c224100", ")": "0041221c00", "+": "08083e0808", ",": "0050300000",
  "-": "0808080808", ".": "0060600000", "/": "2010080402", ":": "0036360000",
  "0": "3e5149453e", "1": "00427f4000", "2": "4261514946", "3": "2141454b31",
  "4": "1814127f10", "5": "2745454539", "6": "3c4a494930", "7": "0171090503",
  "8": "3649494936", "9": "064949291e", "=": "1414141414", "?": "0201510906",
  "A": "7e1111117e", "B": "7f49494936", "C": "3e41414122", "D": "7f4141221c",
  "E": "7f49494941", "F": "7f09090901", "G": "3e4149497a", "H": "7f0808087f",
  "I": "00417f4100", "J": "2040413f01", "K": "7f08142241", "L": "7f40404040",
  "M": "7f020c027f", "N": "7f0408107f", "O": "3e4141413e", "P": "7f09090906",
  "Q": "3e4151215e", "R": "7f09192946", "S": "4649494931", "T": "01017f0101",
  "U": "3f4040403f", "V": "1f2040201f", "W": "3f4038403f", "X": "6314081463",
  "Y": "0708700807", "Z": "6151494543", "_": "4040404040", "|": "00007f0000"
};
async function buildBlackLobbyPng(gameId, serverNum, players, statsMap, authStatus) {
  const maxRows = Math.min(players.length, 64);
  const scale = 2;
  const width = 940;
  const rowH = 24;
  const headerH = 66;
  const height = headerH + maxRows * rowH + 16;
  const stride = 1 + width * 3;
  const raw = new Uint8Array(height * stride);
  const view = new DataView(raw.buffer);

  function setPx(x, y, r, g, b) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = y * stride + 1 + x * 3;
    view.setUint8(idx, r);
    view.setUint8(idx + 1, g);
    view.setUint8(idx + 2, b);
  }

  function fillRect(x0, y0, w, h, r, g, b) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) setPx(x, y, r, g, b);
    }
  }

  function drawText(txt, x0, y0, r, g, b) {
    const up = String(txt || "").toUpperCase();
    for (let c = 0; c < up.length; c++) {
      const hex = FONT_HEX[up.charAt(c)] || FONT_HEX[" "];
      for (let col = 0; col < 5; col++) {
        const bits = parseInt(hex.slice(col * 2, col * 2 + 2), 16);
        for (let row = 0; row < 7; row++) {
          if (bits & (1 << row)) {
            fillRect(x0 + c * 6 * scale + col * scale, y0 + row * scale, scale, scale, r, g, b);
          }
        }
      }
    }
  }

  fillRect(0, 38, width, 24, 24, 24, 24);
  drawText("BLYATFORCEONE - LOBBY #" + gameId + " (S" + serverNum + " | " + players.length + " ACTIVE | " + authStatus + ")", 16, 14, 255, 255, 255);
  drawText("#", 16, 43, 220, 220, 220);
  drawText("PLAYER", 56, 43, 220, 220, 220);
  drawText("NATION", 250, 43, 220, 220, 220);
  drawText("VP", 445, 43, 220, 220, 220);
  drawText("TEAM", 520, 43, 220, 220, 220);
  drawText("K/D", 615, 43, 220, 220, 220);
  drawText("WIN%", 700, 43, 220, 220, 220);
  drawText("LV", 790, 43, 220, 220, 220);
  drawText("SC", 855, 43, 220, 220, 220);

  for (let i = 0; i < maxRows; i++) {
    const p = players.at(i);
    const st = statsMap.get(p.siteUserID) || { kd: "-", winPct: "-", level: "-", sc: "-" };
    const y = headerH + i * rowH;
    if (i % 2 === 1) fillRect(0, y, width, rowH, 14, 14, 14);
    fillRect(12, y + rowH - 1, width - 24, 1, 35, 35, 35);
    const ty = y + 5;
    drawText(String(i + 1), 16, ty, 180, 180, 180);
    drawText(p.name.slice(0, 15), 56, ty, 255, 255, 255);
    drawText((p.nation || "-").slice(0, 15), 250, ty, 230, 230, 230);
    drawText(String(p.vps), 445, ty, 255, 255, 255);
    drawText(p.team > 0 ? ("T" + p.team) : "-", 520, ty, 200, 200, 200);
    drawText(String(st.kd), 615, ty, 255, 255, 255);
    drawText(String(st.winPct), 700, ty, 255, 255, 255);
    drawText(String(st.level), 790, ty, 255, 255, 255);
    drawText(String(st.sc), 855, ty, st.sc === "Y" ? 80 : 255, 255, st.sc === "Y" ? 120 : 255);
  }

  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  writer.write(raw);
  writer.close();
  const compBuf = new Uint8Array(await new Response(cs.readable).arrayBuffer());

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf.at(i);
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) dv.setUint8(4 + i, type.charCodeAt(i));
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  const ihdr = new Uint8Array(13);
  const idv = new DataView(ihdr.buffer);
  idv.setUint32(0, width);
  idv.setUint32(4, height);
  idv.setUint8(8, 8);
  idv.setUint8(9, 2);

  const sig = new Uint8Array(Array.of(137, 80, 78, 71, 13, 10, 26, 10));
  const c1 = chunk("IHDR", ihdr);
  const c2 = chunk("IDAT", compBuf);
  const c3 = chunk("IEND", new Uint8Array(0));
  const png = new Uint8Array(sig.length + c1.length + c2.length + c3.length);
  png.set(sig, 0);
  png.set(c1, sig.length);
  png.set(c2, sig.length + c1.length);
  png.set(c3, sig.length + c1.length + c2.length);
  return png;
}

function cleanName(rawName) {
  const cleaned = String(rawName || "Unknown").replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u200E\u200F\u202A-\u202E]/g, "").trim();
  return cleaned || "Player";
}

function parseLobbyPlayer(p) {
  const vps = Number(p.vps ?? p.victoryPoints ?? p.points ?? 0);
  const team = Number(p.teamID ?? p.coalitionID ?? 0);
  const nation = String(p.nationName ?? "");
  const siteUserID = Number(p.siteUserID ?? p.userID ?? 0);
  return { name: cleanName(p.name), vps, team, nation, siteUserID };
}

function extractRawPlayers(data) {
  const list = new Array();
  for (const val of Object.values(data?.result?.states || {})) {
    if (val && typeof val === "object" && val.players) {
      for (const p of Object.values(val.players)) {
        if (!p || typeof p !== "object" || p.computer) continue;
        if (p.name && p.name !== "Unknown") list.push(p);
      }
      if (list.length > 0) break;
    }
  }
  return list;
}

async function fetchAndRespond(appId, token, gameId, env) {
  try {
    const session = await loginBytro(env);
    let found = null;
    const priority = Array.of(12, 15, 14, 13, 11, 16, 10, 17, 9, 18, 8, 19, 7, 20, 6, 21, 5, 22, 4, 23, 3, 24, 2, 1);

    for (let i = 0; i < priority.length; i += 6) {
      const batch = priority.slice(i, i + 6);
      const results = await Promise.all(batch.map(num => checkServer(num, gameId, session)));
      found = results.find(r => r !== null);
      if (found) break;
    }

    if (!found) {
      await sendDiscordText(appId, token, "Could not find Game ID " + gameId + " on servers 1-24.");
      return;
    }

    const rawPlayers = extractRawPlayers(found.data);
    if (rawPlayers.length === 0) {
      await sendDiscordText(appId, token, "Game ID " + gameId + " found on server " + found.serverNum + ", but no active players were returned.");
      return;
    }

    const players = rawPlayers.map(p => parseLobbyPlayer(p));
    players.sort((a, b) => b.vps - a.vps);

    const uids = players.map(p => p.siteUserID).filter(id => id > 0);
    const statsMap = await fetchUserDetailsBatch(found.serverNum, gameId, uids, session);
    const authStatus = session && session.siteUserID ? "AUTH:OK" : ("AUTH:" + (session?.error || "FAIL"));

    const pngBytes = await buildBlackLobbyPng(gameId, found.serverNum, players, statsMap, authStatus);
    await sendDiscordImage(
      appId,
      token,
      "**BlyatForceOne | Lobby " + gameId + "** (Server " + found.serverNum + " • " + players.length + " Active)",
      pngBytes
    );
  } catch (fatalErr) {
    try {
      await sendDiscordText(appId, token, "Worker error: " + String(fatalErr).slice(0, 200));
    } catch (e) {}
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("BlyatForceOne Bot Worker is active!", { status: 200 });
    }
    const bodyText = await request.text();
    if (!(await verifyDiscordSignature(request, bodyText))) {
      return new Response("Invalid request signature", { status: 401 });
    }
    const interaction = JSON.parse(bodyText);
    if (interaction.type === 1) {
      return new Response(JSON.stringify({ type: 1 }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (interaction.type === 2 && interaction.data?.name === "lobby") {
      const cleanId = String(interaction.data.options?.at(0)?.value || "").replace(/\D/g, "");
      if (!cleanId) {
        return new Response(JSON.stringify({
          type: 4,
          data: { content: "Please enter a valid Game ID number, e.g. /lobby 10956179." }
        }), { headers: { "Content-Type": "application/json" } });
      }
      ctx.waitUntil(fetchAndRespond(interaction.application_id, interaction.token, cleanId, env));
      return new Response(JSON.stringify({ type: 5 }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response("Unknown command", { status: 400 });
  }
};



























