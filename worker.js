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

    subrequests++;
    const auth = await loginBytroDirect(found.serverNum, gameId);

    const rawPlayers = extractRawPlayers(found.data);
    if (rawPlayers.length === 0) {
      await sendDiscordText(appId, token, "Game ID " + gameId + " found on server " + found.serverNum + ", but no active players were returned.");
      return;
    }

    const capped = rawPlayers.slice(0, 50);
    const maxProfCalls = Math.max(0, 44 - subrequests);
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
      profiles[item.index] = await fetchPlayerProfile(found.serverNum, gameId, item.uid, auth);
    }));

    const enriched = capped.map((p, idx) => ({
      name: String(p.name || "Unknown"),
      ...parseStatNumbers(p, profiles.at(idx))
    }));
    enriched.sort((a, b) => b.kd - a.kd);

    const firstProf = profiles.find(x => x !== null);
    const profText = firstProf ? JSON.stringify(firstProf) : "";
    const sampleRaw = (profText && !profText.includes("Exception"))
      ? profText.slice(0, 110)
      : ("p0:" + JSON.stringify(capped.at(1) || capped.at(0) || {}).slice(0, 110));

    let textOut = "**CON LOBBY " + gameId + " (Srv " + found.serverNum + " | Login:" + auth.loggedIn + " c:" + auth.cookie.length + ")**\n`" + sampleRaw + "`\n```\n";

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

    subrequests++;
    const auth = await loginBytroDirect(found.serverNum, gameId);

    const rawPlayers = extractRawPlayers(found.data);
    if (rawPlayers.length === 0) {
      await sendDiscordText(appId, token, "Game ID " + gameId + " found on server " + found.serverNum + ", but no active players were returned.");
      return;
    }

    const capped = rawPlayers.slice(0, 50);
    const maxProfCalls = Math.max(0, 44 - subrequests);
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
      profiles[item.index] = await fetchPlayerProfile(found.serverNum, gameId, item.uid, auth);
    }));

    const enriched = capped.map((p, idx) => ({
      name: String(p.name || "Unknown"),
      ...parseStatNumbers(p, profiles.at(idx))
    }));
    enriched.sort((a, b) => b.kd - a.kd);

    const firstProf = profiles.find(x => x !== null);
    const profText = firstProf ? JSON.stringify(firstProf) : "";
    const sampleRaw = (profText && !profText.includes("Exception"))
      ? profText.slice(0, 110)
      : ("p0:" + JSON.stringify(capped.at(1) || capped.at(0) || {}).slice(0, 110));

    let textOut = "**CON LOBBY " + gameId + " (Srv " + found.serverNum + " | Login:" + auth.loggedIn + " c:" + auth.cookie.length + ")**\n`" + sampleRaw + "`\n```\n";

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





