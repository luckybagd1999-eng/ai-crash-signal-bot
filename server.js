
"use strict";

const http = require("http");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GAMEDATA365_API_KEY;
const API_BASE = "https://api.gamedata365.com";
const ALLOWED_ORIGIN =
  "https://luckybagd1999-eng.github.io";

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const path = new URL(req.url, "http://localhost").pathname;

  if (path === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      name: "AI CRASH API",
      status: "online"
    }));
  }

  if (!API_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      error: "Clé GameData365 non configurée sur Render"
    }));
  }

  let endpoint;

  if (path === "/api/live") {
    endpoint = "/v1/crash/live";
  } else if (path === "/api/history") {
    endpoint = "/v1/crash/history?game=lucky_jet&limit=100";
  } else {
    res.writeHead(404);
    return res.end("Endpoint introuvable");
  }

  try {
    const response = await fetch(API_BASE + endpoint, {
      headers: {
        "X-API-Key": API_KEY,
        "Accept": "application/json"
      }
    });

    const data = await response.text();

    res.writeHead(response.status, {
      "Content-Type": "application/json"
    });

    res.end(data);

  } catch (error) {
    res.writeHead(502, {
      "Content-Type": "application/json"
    });

    res.end(JSON.stringify({
      error: "Erreur de connexion à GameData365",
      details: error.message
    }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("AI CRASH API démarrée sur le port " + PORT);
});
