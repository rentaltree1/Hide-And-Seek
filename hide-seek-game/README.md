# Hide & Seek Zone

A real-time multiplayer hide-and-seek game played on real-world maps. The game owner draws a play zone on a map, picks who's a hider and who's a seeker, and starts the game. Anyone who leaves the zone has their location revealed to everyone. The zone shrinks over time, forcing hiders to relocate.

## What you need (everything free)

| What | Why | Cost |
|---|---|---|
| **Node.js 18+** | To run the server (only needed if testing locally) | Free — nodejs.org |
| **GitHub account** | To upload the code so Render can deploy it | Free — github.com |
| **Render.com account** | To host the server online with HTTPS | Free tier, no credit card |
| **A modern phone browser** | To play (Chrome, Safari, Firefox all work) | Free |

## Deploy in 5 minutes (Render.com)

1. Make a free GitHub account at github.com if you don't have one.
2. Click **New repository**, name it anything (e.g. `hide-seek`), set it to **Public**, and create it.
3. Click **uploading an existing file**, drag in everything from this folder, and commit.
4. Make a free account at render.com.
5. Click **New +** → **Web Service** → connect your GitHub → pick your repo.
6. Render auto-detects Node.js. Settings:
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
7. Click **Create Web Service**. Wait ~2 minutes for it to build.
8. You'll get a URL like `https://hide-seek-xyz.onrender.com`. That's your game server.

Share that URL with your friend. Everyone opens it in their phone browser.

## Test locally first (optional)

```
npm install
npm start
```

Open `http://localhost:3000` in your browser. Note: geolocation only works over HTTPS or on `localhost`, so testing across phones requires deploying first.

## How to play

**Game owner:**
1. Tap **Create a Game**, pick a name and password, enter your name.
2. In the lobby, tap on the map to set the play zone center, drag the slider for radius.
3. Set how often the zone shrinks and by how much.
4. Toggle asymmetric shrinking if you want the zone to shift sides as it shrinks.
5. Assign each player a role using the Hider/Seeker buttons next to their name.
6. Tap **Start Game**.

**Players joining:**
1. Tap **Join a Game**, enter the same game name and password the owner gave you.
2. Wait in the lobby. The owner assigns your role.
3. When the game starts, you'll see the map with the zone.

**During the game:**
- Stay inside the green circle to keep your location hidden.
- If you leave the circle, your name and location appear on everyone else's map.
- The circle shrinks on a timer — keep moving!
- The owner can end the game at any time.

## Free hosting alternatives

Render is recommended, but if you'd rather use something else:

- **Glitch.com** — paste code directly in browser, instant URL. Apps sleep after 5 min.
- **Railway.app** — free trial credits, easy GitHub deploy.
- **Fly.io** — generous free tier, requires credit card.
- **Replit.com** — in-browser editor, free Node.js hosting with caveats.

All of these support Node.js and WebSockets, which is what this app needs.

## Notes & limits

- **Location accuracy:** Phones with GPS outdoors are accurate to 3–10m. Indoors or on Wi-Fi only, accuracy drops to 30–100m, which can cause false "out of zone" triggers.
- **Keep the browser foregrounded:** Mobile browsers may pause GPS updates if the tab goes into the background. Tell players to keep the app open.
- **Render free tier sleeps:** After 15 min of inactivity, the server sleeps. The next request takes ~30s to wake it up. Just refresh and wait.
- **HTTPS required:** Geolocation only works over HTTPS in browsers. Render gives you HTTPS automatically.

## File structure

```
hide-seek-game/
├── server.js              Node.js + Socket.IO backend
├── package.json           Dependencies
├── public/
│   ├── index.html         Menu, lobby, and game views
│   ├── style.css          Styles
│   └── client.js          Frontend logic, map, geolocation
└── README.md              This file
```
