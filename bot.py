import os
import io
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
import discord
from discord import app_commands
from PIL import Image, ImageDraw, ImageFont
from flask import Flask

# --- 1. GRATIS HOSTING KEEP-ALIVE SERVER ---
app = Flask(__name__)

@app.route('/')
def home():
    return "ConWW3 Bot is online!"

def run_web():
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)

# --- 2. DISCORD BOT INSTELLINGEN ---
TOKEN = os.environ.get("DISCORD_TOKEN")
CON_USER_ID = os.environ.get("CON_USER_ID", "")
CON_USER_AUTH = os.environ.get("CON_USER_AUTH", "")

class MyClient(discord.Client):
    def __init__(self):
        intents = discord.Intents.default()
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        await self.tree.sync()

client = MyClient()

# --- 3. DATA OPHALEN (ALLE SERVERS TEGELIJK IN 2 SECONDEN) ---
def check_single_server(server: str, game_id: int):
    url = f"https://{server}/"
    payload = {
        "@c": "ultshared.action.UltUpdateGameStateAction",
        "requestID": 1,
        "language": "en",
        "stateType": 9,
        "stateID": "0",
        "version": 382,
        "client": "con-client-mobile-portrait",
        "gameID": game_id
    }
    if CON_USER_ID and CON_USER_AUTH:
        payload["siteUserID"] = int(CON_USER_ID)
        payload["userAuth"] = CON_USER_AUTH
        payload["rights"] = "chat"

    headers = {
        "Content-Type": "application/json",
        "Origin": "https://conflictnations.com",
        "Referer": "https://conflictnations.com/"
    }

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=4)
        if resp.status_code == 200 and "players" in resp.text:
            return resp.json()
    except Exception:
        pass
    return None

def fetch_lobby_data(game_id: str):
    gid = int(game_id)
    servers = [f"congs{i}.c.bytro.com" for i in range(1, 25)]
    
    with ThreadPoolExecutor(max_workers=24) as executor:
        futures = {executor.submit(check_single_server, srv, gid): srv for srv in servers}
        for future in as_completed(futures):
            data = future.result()
            if data:
                return parse_players(data)
    return None

def parse_players(data):
    players = []
    try:
        states = data.get("result", {}).get("states", {})
        for state_key, state_val in states.items():
            if isinstance(state_val, dict) and "players" in state_val:
                raw_players = state_val["players"]
                for pid, p in raw_players.items():
                    if not isinstance(p, dict) or p.get("computer", False):
                        continue
                    name = p.get("name", "")
                    if not name or name == "Unknown":
                        continue
                    alliance = p.get("allianceName", "") or ""
                    kd = p.get("kdRatio", 0.0)
                    winrate = p.get("winRate", 0)
                    level = p.get("level", 1)
                    sc = "Yes" if p.get("securityCouncil", False) else "No"
                    joined = p.get("gamesJoined", 0)
                    solo = p.get("soloWins", 0)
                    coalition = p.get("coalitionWins", 0)
                    
                    players.append({
                        "alliance": str(alliance)[:25],
                        "name": str(name)[:20],
                        "kd": float(kd),
                        "winrate": int(winrate),
                        "level": int(level),
                        "sc": sc,
                        "joined": int(joined),
                        "solo": int(solo),
                        "coalition": int(coalition)
                    })
                if players:
                    break
    except Exception:
        pass
    
    players.sort(key=lambda x: x["kd"], reverse=True)
    return players

# --- 4. TABEL AFBEELDING TEKENEN ---
def create_lobby_image(game_id: str, players: list):
    row_height = 28
    header_height = 110
    width = 920
    height = header_height + (max(len(players), 1) * row_height) + 40

    img = Image.new("RGB", (width, height), color=(18, 22, 31))
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default()

    draw.rectangle([0, 0, width, 80], fill=(26, 32, 44))
    draw.text((20, 15), "CONFLICT OF NATIONS LOBBY VIEW", fill=(148, 163, 184), font=font)
    draw.text((20, 38), f"GAME ID: {game_id}  |  {len(players)} ACTIVE PLAYERS", fill=(255, 255, 255), font=font)

    y_col = 88
    cols = [
        (20, "#"), (60, "ALLIANCE"), (240, "USERNAME"), (410, "K/D"),
        (480, "WIN%"), (550, "LVL"), (610, "SC"), (670, "JOINED"),
        (750, "SOLO"), (820, "COALITION")
    ]
    for x, title in cols:
        draw.text((x, y_col), title, fill=(148, 163, 184), font=font)

    y = header_height
    for idx, p in enumerate(players, start=1):
        bg_color = (24, 29, 40) if idx % 2 == 0 else (30, 36, 48)
        draw.rectangle([10, y, width - 10, y + row_height - 2], fill=bg_color)
        
        draw.text((20, y + 7), str(idx), fill=(203, 213, 225), font=font)
        if p["alliance"]:
            draw.rectangle([55, y + 4, 225, y + row_height - 6], fill=(69, 39, 46))
            draw.text((62, y + 7), p["alliance"], fill=(252, 165, 165), font=font)
        
        draw.text((240, y + 7), p["name"], fill=(255, 255, 255), font=font)
        draw.text((410, y + 7), f"{p['kd']:.2f}", fill=(250, 204, 21), font=font)
        draw.text((480, y + 7), f"{p['winrate']}%", fill=(203, 213, 225), font=font)
        draw.text((550, y + 7), str(p["level"]), fill=(203, 213, 225), font=font)
        sc_color = (74, 222, 128) if p["sc"] == "Yes" else (148, 163, 184)
        draw.text((610, y + 7), p["sc"], fill=sc_color, font=font)
        draw.text((670, y + 7), str(p["joined"]), fill=(203, 213, 225), font=font)
        draw.text((750, y + 7), str(p["solo"]), fill=(203, 213, 225), font=font)
        draw.text((820, y + 7), str(p["coalition"]), fill=(203, 213, 225), font=font)
        y += row_height

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf

# --- 5. SLASH COMMAND IN DISCORD ---
@client.tree.command(name="lobby", description="Haal de spelerslijst en stats op van een CoN WW3 Game ID")
@app_commands.describe(game_id="Het nummer van de game (bijv. 10958625)")
async def lobby(interaction: discord.Interaction, game_id: str):
    await interaction.response.defer()
    clean_id = "".join(filter(str.isdigit, game_id))
    if not clean_id:
        await interaction.followup.send("Geef een geldig Game ID nummer op, bijvoorbeeld `/lobby 10958625`.")
        return

    players = fetch_lobby_data(clean_id)
    if not players:
        await interaction.followup.send(
            f"Kon geen lobby-data ophalen voor Game ID `{clean_id}`. "
            "Waarschijnlijk zijn `CON_USER_ID` en `CON_USER_AUTH` nodig op Render."
        )
        return

    image_buf = create_lobby_image(clean_id, players)
    file = discord.File(fp=image_buf, filename=f"lobby_{clean_id}.png")
    await interaction.followup.send(file=file)

if __name__ == "__main__":
    threading.Thread(target=run_web, daemon=True).start()
    client.run(TOKEN)

