const PUBLIC_KEY = "d4b2c5584aab9b59d22fcedfe90d62bbfc748e963613516db18212d40a1e32b6";
const CON_USER_ID = 91668627;
const CON_USER_AUTH = "5a1bbe76f2d8d122d537f65f99aa57dee37d91b1";

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
    headers: { "Content-Type": "application/json", "User-Agent": "DiscordBot (https://workers.dev, 1.0)" },
    body: JSON.stringify({ content })
  });
}

async function sendDiscordImage(appId, token, imageBytes, filename, caption) {
  const path = Array.of("api", "v10", "webhooks", appId, token, "messages", "@original").join("/");
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content: caption, attachments: Array.of({ id: 0, filename }) }));
  form.append("files", new Blob(Array.of(imageBytes), { type: "image/png" }), filename);
  await fetch(new URL(path, "https://discord.com").toString(), {
    method: "PATCH",
    headers: { "User-Agent": "DiscordBot (https://workers.dev, 1.0)" },
    body: form
  });
}

async function checkServer(serverNum, gameId) {
  const url = new URL("/", "https://congs" + serverNum + ".c.bytro.com").toString();
  const payload = {
    "@c": "ultshared.action.UltUpdateGameStateAction", "requestID": 1, "language": "en", "lastCallDuration": 0,
    "actions": Array.of("java.util.LinkedList", new Array()), "stateIDs": null, "tstamps": null, "version": 382,
    "client": "con-client-mobile-portrait", "siteUserID": CON_USER_ID, "adminLevel": 0, "gameID": Number(gameId),
    "playerID": 0, "rights": "chat", "userAuth": CON_USER_AUTH, "tstamp": String(Math.floor(Date.now() / 1000))
  };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": "https://conflictnations.com", "Referer": "https://conflictnations.com/" },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    if (text.includes("players") || text.includes("kdRatio")) return { serverNum, data: JSON.parse(text) };
  } catch (e) {}
  return null;
}

async function fetchPlayerProfile(serverNum, gameId, siteUserId) {
  if (!siteUserId || siteUserId <= 0) return null;
  const url = new URL("/", "https://congs" + serverNum + ".c.bytro.com").toString();
  const payload = {
    "@c": "ultshared.action.UltGetUserDetailsAction", "requestID": 2, "language": "en", "targetUserID": Number(siteUserId),
    "version": 382, "client": "con-client-mobile-portrait", "siteUserID": CON_USER_ID, "adminLevel": 0,
    "gameID": Number(gameId), "playerID": 0, "rights": "chat", "userAuth": CON_USER_AUTH, "tstamp": String(Math.floor(Date.now() / 1000))
  };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": "https://conflictnations.com", "Referer": "https://conflictnations.com/" },
      body: JSON.stringify(payload)
    });
    return resp.ok ? await resp.json() : null;
  } catch (e) { return null; }
}
function parseStatNumbers(p, prof) {
  const res = prof?.result || prof || {};
  const u = res.userDetails || res.user || res.profile || res;
  const stats = u.stats || res.stats || p.stats || {};
  const kills = Number(u.kills ?? stats.kills ?? p.kills ?? 0);
  const deaths = Number(u.deaths ?? stats.deaths ?? p.deaths ?? 0);
  const kd = Number(u.kdRatio ?? stats.kdRatio ?? p.kdRatio ?? (deaths > 0 ? kills / deaths : kills) ?? 0);
  const joined = Number(u.gamesJoined ?? stats.gamesJoined ?? p.gamesJoined ?? 0);
  const solo = Number(u.soloWins ?? stats.soloWins ?? p.soloWins ?? 0);
  const coalition = Number(u.coalitionWins ?? stats.coalitionWins ?? p.coalitionWins ?? 0);
  const winrate = Number(u.winRate ?? stats.winRate ?? p.winRate ?? (joined > 0 ? Math.round(((solo + coalition) / joined) * 100) : 0));
  const level = Number(u.level ?? u.rank ?? stats.level ?? p.level ?? 1);
  const sc = Boolean(u.securityCouncil ?? u.isSecurityCouncil ?? p.securityCouncil ?? false);
  const alliance = String(u.allianceName ?? u.allianceTag ?? p.allianceName ?? p.alliance ?? "");
  return { kd, winrate, level, sc, joined, solo, coalition, alliance };
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

function escapeXml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildLobbySvg(gameId, players, totalCount) {
  const rowH = 26, headH = 104, width = 940, height = headH + players.length * rowH + 24;
  let rowsSvg = "";
  players.forEach((p, idx) => {
    const y = headH + idx * rowH;
    const bg = idx % 2 === 0 ? "#161b26" : "#1c2331";
    const kdColor = p.kd >= 2.0 ? "#facc15" : p.kd >= 1.0 ? "#38bdf8" : "#e2e8f0";
    rowsSvg += '<rect x="12" y="' + y + '" width="' + (width - 24) + '" height="' + (rowH - 2) + '" rx="4" fill="' + bg + '"/>';
    rowsSvg += '<text x="26" y="' + (y + 17) + '" fill="#94a3b8" font-size="13">' + (idx + 1) + '</text>';
    if (p.alliance) {
      rowsSvg += '<rect x="62" y="' + (y + 4) + '" width="165" height="' + (rowH - 10) + '" rx="4" fill="#3f232c"/>';
      rowsSvg += '<text x="70" y="' + (y + 17) + '" fill="#fda4af" font-size="12" font-weight="bold">' + escapeXml(p.alliance.slice(0, 20)) + '</text>';
    }
    rowsSvg += '<text x="242" y="' + (y + 17) + '" fill="#ffffff" font-size="13" font-weight="bold">' + escapeXml(p.name.slice(0, 20)) + '</text>';
    rowsSvg += '<text x="430" y="' + (y + 17) + '" fill="' + kdColor + '" font-size="13" font-weight="bold">' + p.kd.toFixed(2) + '</text>';
    rowsSvg += '<text x="500" y="' + (y + 17) + '" fill="#cbd5e1" font-size="13">' + p.winrate + '%</text>';
    rowsSvg += '<text x="570" y="' + (y + 17) + '" fill="#cbd5e1" font-size="13">' + p.level + '</text>';
    rowsSvg += '<text x="630" y="' + (y + 17) + '" fill="' + (p.sc ? "#4ade80" : "#94a3b8") + '" font-size="13" font-weight="bold">' + (p.sc ? "Yes" : "No") + '</text>';
    rowsSvg += '<text x="695" y="' + (y + 17) + '" fill="#cbd5e1" font-size="13">' + p.joined + '</text>';
    rowsSvg += '<text x="775" y="' + (y + 17) + '" fill="#cbd5e1" font-size="13">' + p.solo + '</text>';
    rowsSvg += '<text x="845" y="' + (y + 17) + '" fill="#cbd5e1" font-size="13">' + p.coalition + '</text>';
  });
  return '<svg xmlns="http://w3.org" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"><rect width="100%" height="100%" fill="#0f131a"/><rect x="0" y="0" width="100%" height="74" fill="#18202c"/><text x="24" y="28" fill="#94a3b8" font-family="sans-serif" font-size="12" font-weight="bold">CONFLICT OF NATIONS LOBBY VIEW</text><text x="24" y="54" fill="#ffffff" font-family="sans-serif" font-size="20" font-weight="bold">GAME ID: ' + escapeXml(gameId) + '  •  ' + totalCount + ' ACTIVE PLAYERS (SHOWING ' + players.length + ')</text><g font-family="sans-serif" font-size="11" font-weight="bold" fill="#94a3b8"><text x="26" y="92">#</text><text x="64" y="92">ALLIANCE</text><text x="242" y="92">USERNAME</text><text x="430" y="92">K/D</text><text x="500" y="92">WIN%</text><text x="570" y="92">LVL</text><text x="630" y="92">SC</text><text x="695" y="92">JOINED</text><text x="775" y="92">SOLO</text><text x="845" y="92">COALITION</text></g><g font-family="monospace, sans-serif">' + rowsSvg + '</g></svg>';
}

async function fetchAndRespond(appId, token, gameId) {
  try {
    const priority = Array.of(12, 15, 14, 13, 11, 16, 10, 17, 9, 18, 8, 19, 7, 20, 6, 21, 5, 22, 4, 23, 3, 24, 2, 1);
    let found = null;
    let callsUsed = 0;
    for (let i = 0; i < priority.length; i += 4) {
      const batch = priority.slice(i, i + 4);
      callsUsed += batch.length;
      const results = await Promise.all(batch.map(num => checkServer(num, gameId)));
      found = results.find(r => r !== null);
      if (found) break;
    }
    if (!found) {
      await sendDiscordText(appId, token, "Could not fetch lobby data for Game ID " + gameId + ".");
      return;
    }
    const rawPlayers = extractRawPlayers(found.data);
    const maxProf = Math.max(0, Math.min(50, 48 - callsUsed));
    const capped = rawPlayers.slice(0, 50);
    const profBatch = capped.slice(0, maxProf);
    const profiles = await Promise.all(profBatch.map(p => fetchPlayerProfile(found.serverNum, gameId, p.siteUserID || p.userID)));
    const enriched = capped.map((p, idx) => ({ name: String(p.name || "Unknown"), ...parseStatNumbers(p, profiles.at(idx)) }));
    enriched.sort((a, b) => b.kd - a.kd);

    const svg = buildLobbySvg(gameId, enriched, rawPlayers.length);
    const totalHeight = 104 + enriched.length * 26 + 24;
    const pngResp = await fetch(new URL("/chart", "https://quickchart.io").toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "png", width: 940, height: totalHeight, backgroundColor: "#0f131a", chart: svg })
    });
    if (pngResp.ok) {
      const pngBuffer = await pngResp.arrayBuffer();
      if (pngBuffer.byteLength > 200) {
        await sendDiscordImage(appId, token, pngBuffer, "lobby_" + gameId + ".png", "**Conflict of Nations Lobby View — Game ID: " + gameId + " (" + rawPlayers.length + " Active Players)**");
        return;
      }
    }
    let textOut = "**CONFLICT OF NATIONS LOBBY VIEW — GAME ID: " + gameId + " (" + rawPlayers.length + " ACTIVE PLAYERS)**\n";
    enriched.slice(0, 35).forEach((p, i) => {
      textOut += String(i + 1).padEnd(3) + " | " + p.name.padEnd(18) + " | K/D: " + p.kd.toFixed(2) + " | WIN: " + p.winrate + "% | LVL: " + p.level + "\n";
    });
    await sendDiscordText(appId, token, textOut.slice(0, 1950));
  } catch (fatalErr) {
    await sendDiscordText(appId, token, "Worker error: " + String(fatalErr).slice(0, 200));
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("ConWW3 Bot Worker is active!", { status: 200 });
    const bodyText = await request.text();
    if (!(await verifyDiscordSignature(request, bodyText))) return new Response("Invalid request signature", { status: 401 });
    const interaction = JSON.parse(bodyText);
    if (interaction.type === 1) return new Response(JSON.stringify({ type: 1 }), { headers: { "Content-Type": "application/json" } });
    if (interaction.type === 2 && interaction.data?.name === "lobby") {
      const cleanId = String(interaction.data.options?.at(0)?.value || "").replace(/\D/g, "");
      if (!cleanId) return new Response(JSON.stringify({ type: 4, data: { content: "Please enter a valid Game ID number, e.g. /lobby 10956179." } }), { headers: { "Content-Type": "application/json" } });
      ctx.waitUntil(fetchAndRespond(interaction.application_id, interaction.token, cleanId));
      return new Response(JSON.stringify({ type: 5 }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("Unknown command", { status: 400 });
  }
};




