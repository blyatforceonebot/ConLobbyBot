const PUBLIC_KEY = "d4b2c5584aab9b59d22fcedfe90d62bbfc748e963613516db18212d40a1e32b6";
const CON_USER_ID = 91668627;
const CON_USER_AUTH = "5a1bbe76f2d8d122d537f65f99aa57dee37d91b1";

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes.set(Uint8Array.of(parseInt(hex.substr(i, 2), 16)), i / 2);
  }
  return bytes;
}

async function verifyDiscordSignature(request, bodyText) {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(PUBLIC_KEY),
      { name: "Ed25519" },
      false,
      Array.of("verify")
    );

    const encoder = new TextEncoder();
    const data = encoder.encode(timestamp + bodyText);
    return await crypto.subtle.verify("Ed25519", key, hexToBytes(signature), data);
  } catch (e) {
    return false;
  }
}

async function checkServer(serverNum, gameId) {
  const url = `https://congs${serverNum}://`;
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://conflictnations.com",
        "Referer": "https://conflictnations.com/"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const text = await resp.text();
    if (text.includes("players") || text.includes("kdRatio")) {
      return JSON.parse(text);
    }
  } catch (e) {
    clearTimeout(timeout);
  }
  return null;
}

function extractPlayers(data) {
  const players = new Array();
  const states = data?.result?.states || {};
  for (const val of Object.values(states)) {
    if (val && typeof val === "object" && val.players) {
      for (const p of Object.values(val.players)) {
        if (!p || typeof p !== "object" || p.computer) continue;
        const name = p.name || "";
        if (!name || name === "Unknown") continue;
        players.push({
          alliance: (p.allianceName || "").slice(0, 18),
          name: name.slice(0, 18),
          kd: Number(p.kdRatio || 0).toFixed(2),
          winrate: Number(p.winRate || 0),
          level: Number(p.level || 1),
          sc: p.securityCouncil ? "Yes" : "No",
          joined: Number(p.gamesJoined || 0),
          solo: Number(p.soloWins || 0),
          coalition: Number(p.coalitionWins || 0)
        });
      }
      if (players.length > 0) break;
    }
  }
  players.sort((a, b) => Number(b.kd) - Number(a.kd));
  return players;
}

async function fetchAndRespond(appId, token, gameId) {
  const webhookUrl = `https://discord.com{appId}/${token}/messages/@original`;
  const priority = Array.of(12, 15, 14, 13, 11, 16, 10, 17, 9, 18, 8, 19, 7, 20, 6, 21, 5, 22, 4, 23, 3, 24, 2, 1);

  let foundData = null;
  for (let i = 0; i < priority.length; i += 8) {
    const batch = priority.slice(i, i + 8);
    const results = await Promise.all(batch.map(num => checkServer(num, gameId)));
    foundData = results.find(r => r !== null);
    if (foundData) break;
  }

  if (!foundData) {
    await fetch(webhookUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `Could not fetch lobby data for Game ID \`${gameId}\`. The game may have ended or a fresh session token is required.`
      })
    });
    return;
  }

  const players = extractPlayers(foundData);
  if (players.length === 0) {
    await fetch(webhookUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `No active human players found in Game ID \`${gameId}\`.`
      })
    });
    return;
  }

  let table = `# | ALLIANCE          | USERNAME           | K/D  | WIN% | LVL | SC  | JOIN | SOLO | COAL\n`;
  table += `--+-------------------+--------------------+------+------+-----+-----+------+------+-----\n`;
  players.forEach((p, idx) => {
    const num = String(idx + 1).padEnd(2);
    const all = p.alliance.padEnd(17);
    const usr = p.name.padEnd(18);
    const kd = String(p.kd).padEnd(4);
    const win = `${p.winrate}%`.padEnd(4);
    const lvl = String(p.level).padEnd(3);
    const sc = p.sc.padEnd(3);
    const jnd = String(p.joined).padEnd(4);
    const sol = String(p.solo).padEnd(4);
    const col = String(p.coalition).padEnd(4);
    table += `${num}| ${all} | ${usr} | ${kd} | ${win} | ${lvl} | ${sc} | ${jnd} | ${sol} | ${col}\n`;
  });

  const content = `**CONFLICT OF NATIONS LOBBY VIEW — GAME ID: ${gameId} (${players.length} ACTIVE PLAYERS)**\n\`\`\`\n${table.slice(0, 1850)}\n\`\`\``;

  await fetch(webhookUrl, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("ConWW3 Bot Worker is active!", { status: 200 });
    }

    const bodyText = await request.text();
    const isValid = await verifyDiscordSignature(request, bodyText);
    if (!isValid) {
      return new Response("Invalid request signature", { status: 401 });
    }

    const interaction = JSON.parse(bodyText);

    if (interaction.type === 1) {
      return new Response(JSON.stringify({ type: 1 }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (interaction.type === 2 && interaction.data?.name === "lobby") {
      const firstOpt = interaction.data.options ? interaction.data.options.at(0) : null;
      const rawId = String(firstOpt?.value || "");
      const cleanId = rawId.replace(/\D/g, "");

      if (!cleanId) {
        return new Response(JSON.stringify({
          type: 4,
          data: { content: "Please enter a valid Game ID number, e.g. `/lobby 10956179`." }
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


