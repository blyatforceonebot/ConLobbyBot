const PUBLIC_KEY = "d4b2c5584aab9b59d22fcedfe90d62bbfc748e963613516db18212d40a1e32b6";

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

async function checkServer(serverNum, gameId) {
  const url = new URL("/", "https://congs" + serverNum + ".c.bytro.com").toString();
  const payload = {
    "@c": "ultshared.action.UltUpdateGameStateAction",
    "requestID": 1,
    "language": "en",
    "lastCallDuration": 0,
    "actions": Array.of("java.util.LinkedList", new Array()),
    "stateIDs": null,
    "tstamps": null,
    "version": 420,
    "client": "con-client-mobile-portrait",
    "siteUserID": 0,
    "adminLevel": 0,
    "gameID": Number(gameId),
    "playerID": 0,
    "rights": "chat",
    "userAuth": "",
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

function cleanName(rawName) {
  // Voorkom dat Arabische/RTL-namen de hele Discord-regel omdraaien
  const cleaned = String(rawName || "Unknown").replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u200E\u200F\u202A-\u202E]/g, "").trim();
  return cleaned || "Player";
}

function parseLobbyPlayer(p) {
  const vps = Number(p.vps ?? p.victoryPoints ?? p.points ?? 0);
  const team = Number(p.teamID ?? p.coalitionID ?? 0);
  const kills = Number(p.kills ?? p.killsVsPlayers ?? 0);
  const deaths = Number(p.deaths ?? p.deathsVsPlayers ?? 0);
  const kd = Number(p.kdRatio ?? (deaths > 0 ? kills / deaths : kills) ?? 0);
  const level = Number(p.level ?? p.rank ?? 0);
  return {
    name: cleanName(p.name),
    vps,
    team,
    kd,
    level,
    siteUserID: Number(p.siteUserID ?? p.userID ?? 0)
  };
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
async function fetchAndRespond(appId, token, gameId) {
  try {
    let found = null;
    const priority = Array.of(12, 15, 14, 13, 11, 16, 10, 17, 9, 18, 8, 19, 7, 20, 6, 21, 5, 22, 4, 23, 3, 24, 2, 1);

    for (let i = 0; i < priority.length; i += 6) {
      const batch = priority.slice(i, i + 6);
      const results = await Promise.all(batch.map(num => checkServer(num, gameId)));
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

    // Toon deel 2 van het ruwe speler-object (vanaf karakter 95) zodat we alle extra velden zien
    const sampleObj = rawPlayers.find(p => p.name && p.name !== "Guest") || rawPlayers.at(0);
    const extraFields = JSON.stringify(sampleObj).slice(95, 235);

    let textOut = "**CON LOBBY " + gameId + " (Server " + found.serverNum + " | " + players.length + " Active)**\n`" + extraFields + "`\n```\n";

    for (let i = 0; i < players.length; i++) {
      const p = players.at(i);
      const teamStr = p.team > 0 ? ("T" + p.team).padEnd(3) : "---";
      const line = String(i + 1).padStart(2) + " " + p.name.slice(0, 14).padEnd(14) + " VP:" + String(p.vps).padStart(4) + " " + teamStr + "\n";
      if (textOut.length + line.length > 1950) break;
      textOut += line;
    }
    textOut += "```";
    await sendDiscordText(appId, token, textOut);
  } catch (fatalErr) {
    try {
      await sendDiscordText(appId, token, "Worker error: " + String(fatalErr).slice(0, 200));
    } catch (e) {}
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("ConWW3 Bot Worker is active!", { status: 200 });
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
      ctx.waitUntil(fetchAndRespond(interaction.application_id, interaction.token, cleanId));
      return new Response(JSON.stringify({ type: 5 }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response("Unknown command", { status: 400 });
  }
};








