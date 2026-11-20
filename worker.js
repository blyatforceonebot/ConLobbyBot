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

async function sendDiscordImage(appId, token, caption, pngBytes) {
  const path = Array.of("api", "v10", "webhooks", appId, token, "messages", "@original").join("/");
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content: caption }));
  form.append("files[0]", new Blob([pngBytes], { type: "image/png" }), "lobby.png");
  await fetch(new URL(path, "https://discord.com").toString(), {
    method: "PATCH",
    headers: { "User-Agent": "DiscordBot (https://workers.dev, 1.0)" },
    body: form
  });
}

async function loginBytro(env) {
  if (!env.CON_USER || !env.CON_PASS) return { error: "NO_ENV" };
  const endpoints = [
    "https://conflictnations.com",
    "https://conflictnations.com"
  ];
  let lastStatus = "0";
  for (const ep of endpoints) {
    try {
      const form = new URLSearchParams();
      form.set("user", env.CON_USER);
      form.set("pass", env.CON_PASS);
      form.set("username", env.CON_USER);
      form.set("password", env.CON_PASS);
      form.set("login", "1");
      const resp = await fetch(ep, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
          "Origin": "https://conflictnations.com",
          "Referer": "https://conflictnations.com"
        },
        body: form.toString()
      });
      lastStatus = String(resp.status);
      const text = await resp.text();
      const uidMatch = text.match(/"?(?:siteUserID|userID|uid)"?\s*[:=]\s*"?(\d{5,12})"?/i);
      const authMatch = text.match(/"?(?:userAuth|auth|token)"?\s*[:=]\s*"([a-f0-9]{40})"/i) || text.match(/([a-f0-9]{40})/i);
      const verMatch = text.match(/"?(?:version|clientVersion)"?\s*[:=]\s*"?(\d{3,6})"?/i);
      if (uidMatch && authMatch) {
        return {
          siteUserID: Number(uidMatch[1]),
          userAuth: authMatch[1],
          version: verMatch ? Number(verMatch[1]) : 420
        };
      }
    } catch (e) {
      lastStatus = "ERR";
    }
  }
  return { error: lastStatus };
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
  const statsMap = {};
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
    const results = data?.result?.actions || data?.result?.results || [];
    const list = Array.isArray(results) ? results : [];
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
      statsMap[uid] = { kd, winPct, level, sc: hasSC ? "Y" : "N" };
    }
  } catch (e) {}
  return statsMap;
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

    const authStatus = session && session.siteUserID ? "Auth:OK" : ("Auth:Fail(" + (session?.error || "?") + ")");
    let textOut = "**BlyatForceOne | LOBBY " + gameId + " (S" + found.serverNum + " | " + players.length + " Active | " + authStatus + ")**\n```\n";
    textOut += "#  Player    Nat   VP Tm  K/D  Win% Lv SC\n";

    for (let i = 0; i < players.length; i++) {
      const p = players.at(i);
      const st = statsMap[p.siteUserID] || { kd: "-", winPct: "-", level: "-", sc: "-" };
      const teamStr = p.team > 0 ? ("T" + p.team).padEnd(3) : "---";
      const nationShort = (p.nation || "").slice(0, 5).padEnd(5);
      const line =
        String(i + 1).padStart(2) + " " +
        p.name.slice(0, 9).padEnd(9) + " " +
        nationShort + " " +
        String(p.vps).padStart(4) + " " +
        teamStr + " " +
        String(st.kd).padStart(4) + " " +
        String(st.winPct).padStart(4) + " " +
        String(st.level).padStart(2) + " " +
        st.sc + "\n";
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













