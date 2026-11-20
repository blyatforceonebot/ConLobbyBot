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
    "version": 382,
    "client": "con-client-mobile-portrait",
    "siteUserID": CON_USER_ID,
    "adminLevel": 0,
    "gameID": Number(gameId),
    "playerID": 0,
    "rights": "chat",
    "userAuth": CON_USER_AUTH,
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
    if (text.includes("players") || text.includes("kdRatio")) {
      return { serverNum, data: JSON.parse(text) };
    }
  } catch (e) {}
  return null;
}

async function fetchPlayerProfile(serverNum, gameId, siteUserId) {
  if (!siteUserId || siteUserId <= 0) return null;
  const url = new URL("/", "https://congs" + serverNum + ".c.bytro.com").toString();
  const payload = {
    "@c": "ultshared.action.UltGetUserDetailsAction",
    "requestID": 2,
    "language": "en",
    "targetUserID": Number(siteUserId),
    "version": 382,
    "client": "con-client-mobile-portrait",
    "siteUserID": CON_USER_ID,
    "adminLevel": 0,
    "gameID": Number(gameId),
    "playerID": 0,
    "rights": "chat",
    "userAuth": CON_USER_AUTH,
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
    return resp.ok ? await resp.json() : null;
  } catch (e) {
    return null;
  }
}

function parseStatNumbers(p, prof) {
  const res = prof?.result || prof || {};
  const u = res.userDetails || res.user || res.profile || res;
  const stats = u.stats || res.stats || p.stats || {};
  const kills = Number(u.kills ?? u.killsVsPlayers ?? stats.kills ?? p.kills ?? 0);
  const deaths = Number(u.deaths ?? u.deathsVsPlayers ?? stats.deaths ?? p.deaths ?? 0);
  const kd = Number(u.kdRatio ?? stats.kdRatio ?? p.kdRatio ?? (deaths > 0 ? kills / deaths : kills) ?? 0);
  const joined = Number(u.gamesJoined ?? stats.gamesJoined ?? p.gamesJoined ?? 0);
  const solo = Number(u.soloWins ?? stats.soloWins ?? p.soloWins ?? 0);
  const coalition = Number(u.coalitionWins ?? stats.coalitionWins ?? p.coalitionWins ?? 0);
  const winrate = Number(u.winRate ?? stats.winRate ?? p.winRate ?? (joined > 0 ? Math.round(((solo + coalition) / joined) * 100) : 0));
  const level = Number(u.level ?? u.rank ?? stats.level ?? p.level ?? 1);
  return { kd, winrate, level };
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
  let subrequests = 0;

  try {
    let found = null;
    const priority = Array.of(12, 15, 14, 13, 11, 16, 10, 17, 9, 18, 8, 19, 7, 20, 6, 21, 5, 22, 4, 23, 3, 24, 2, 1);

    for (let i = 0; i < priority.length; i += 6) {
      const batch = priority.slice(i, i + 6);
      subrequests += batch.length;
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

    const capped = rawPlayers.slice(0, 50);
    const maxProfCalls = Math.max(0, 45 - subrequests);
    const profiles = new Array(capped.length).fill(null);
    const toFetch = new Array();

    for (let i = 0; i < capped.length; i++) {
      const uid = capped.at(i).siteUserID || capped.at(i).userID || capped.at(i).playerID;
      if (uid && uid > 0 && toFetch.length < maxProfCalls) {
        toFetch.push({ index: i, uid: uid });
      }
    }

    subrequests += toFetch.length;
    await Promise.all(toFetch.map(async (item) => {
      profiles[item.index] = await fetchPlayerProfile(found.serverNum, gameId, item.uid);
    }));

    const enriched = capped.map((p, idx) => ({
      name: String(p.name || "Unknown"),
      ...parseStatNumbers(p, profiles.at(idx))
    }));
    enriched.sort((a, b) => b.kd - a.kd);

    // Korte debug-regel zodat we zien op welke server hij zit en wat de eerste profiel-response bevat
    const firstProf = profiles.find(x => x !== null);
    const sampleRaw = firstProf ? JSON.stringify(firstProf).slice(0, 140) : ("pKeys:" + Object.keys(capped.at(0) || {}).join(","));
    let textOut = "**CON LOBBY " + gameId + " (Srv " + found.serverNum + " | " + rawPlayers.length + "p)**\n`" + sampleRaw + "`\n```\n";

    for (let i = 0; i < enriched.length; i++) {
      const p = enriched.at(i);
      const line = String(i + 1).padStart(2) + " " + p.name.slice(0, 12).padEnd(12) + " KD:" + p.kd.toFixed(2) + " W:" + p.winrate + "% L:" + p.level + "\n";
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



