
"use strict";

const http = require("http");

const PORT = process.env.PORT || 3000;

const API_KEY = process.env.GAMEDATA365_API_KEY;
const API_BASE = "https://api.gamedata365.com";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const AI_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

const ALLOWED_ORIGIN = "https://luckybagd1999-eng.github.io";
const MIN_COEFFICIENT = 1.50;

const requestCounts = new Map();
let openRouterBlockedUntil = 0;

function send(res, status, data) {
  if (res.writableEnded) return;

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8"
  });

  res.end(JSON.stringify(data));
}

function rateLimit(req) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.socket.remoteAddress
    || "unknown";

  const now = Date.now();
  const entry = requestCounts.get(ip);

  if (!entry || now - entry.start > 60000) {
    requestCounts.set(ip, { start: now, count: 1 });
    return true;
  }

  entry.count++;
  return entry.count <= 15;
}

async function readBody(req) {
  let body = "";

  for await (const chunk of req) {
    body += chunk.toString();

    if (body.length > 100000) {
      throw new Error("BODY_TOO_LARGE");
    }
  }

  return JSON.parse(body);
}

// MODE DE SECOURS STATISTIQUE
function statisticalFallback(stats, reason) {
  const score = Math.max(
    0,
    Math.min(100, Number(stats.score) || 0)
  );

  const coefficient = Number(stats.central);

  const rejected = score < 50 || coefficient < MIN_COEFFICIENT;

  return {
    success: true,
    model: "ANALYSE STATISTIQUE AUTONOME",
    decision: rejected ? "REJETÉ" : "À_SURVEILLER",
    coefficient: rejected ? null : coefficient,
    confidence: score,
    reason: rejected
      ? "Le candidat ne satisfait pas les critères statistiques minimaux."
      : "Candidat conservé par l'analyse statistique. Validation IA indisponible.",
    risk: rejected ? "ÉLEVÉ" : "NON CONFIRMÉ",
    summary: rejected
      ? "Candidat rejeté par le filtre statistique."
      : "Analyse statistique autonome active. Prudence : aucune validation IA.",
    aiUnavailable: true,
    aiError: reason,
    timestamp: new Date().toISOString()
  };
}

function extractAIResult(message) {
  const calls = message?.tool_calls || [];

  for (const call of calls) {
    if (call.function?.name === "submit_analysis") {
      return JSON.parse(call.function.arguments);
    }
  }

  let content = message?.content;

  if (Array.isArray(content)) {
    content = content
      .filter(item => item.type === "text")
      .map(item => item.text || "")
      .join("\n");
  }

  if (typeof content === "string" && content.trim()) {
    const cleaned = content
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.substring(start, end + 1));
    }
  }

  return null;
}

const server = http.createServer(async (req, res) => {

  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const path = new URL(req.url, "http://localhost").pathname;

  // PAGE D'ACCUEIL
  if (path === "/") {
    return send(res, 200, {
      name: "AI CRASH API",
      status: "online",
      gameData365: Boolean(API_KEY),
      openRouter: Boolean(OPENROUTER_API_KEY),
      aiMode: Date.now() < openRouterBlockedUntil
        ? "COOLDOWN"
        : "AVAILABLE",
      model: AI_MODEL,
      minimumCoefficient: MIN_COEFFICIENT
    });
  }

  // GAMEDATA365
  if (path === "/api/live" || path === "/api/history") {

    if (req.method !== "GET") {
      return send(res, 405, {
        error: "Méthode non autorisée."
      });
    }

    if (!API_KEY) {
      return send(res, 500, {
        error: "Clé GameData365 absente."
      });
    }

    const endpoint = path === "/api/live"
      ? "/v1/crash/live"
      : "/v1/crash/history?game=lucky_jet&limit=100";

    try {
      const response = await fetch(API_BASE + endpoint, {
        headers: {
          "X-API-Key": API_KEY,
          "Accept": "application/json"
        },
        signal: AbortSignal.timeout(20000)
      });

      const data = await response.text();

      res.writeHead(response.status, {
        "Content-Type": "application/json; charset=utf-8"
      });

      return res.end(data);

    } catch (error) {
      console.error("GAMEDATA365 ERROR:", error.message);

      return send(res, 502, {
        error: "Erreur GameData365.",
        details: error.message
      });
    }
  }

  // ANALYSE IA ET SECOURS STATISTIQUE
  if (path === "/api/ai-analysis") {

    if (req.method !== "POST") {
      return send(res, 405, {
        error: "Utilise la méthode POST."
      });
    }

    if (!rateLimit(req)) {
      return send(res, 429, {
        error: "Trop de demandes. Réessaie dans une minute."
      });
    }

    let input;

    try {
      input = await readBody(req);
    } catch (error) {
      if (error.message === "BODY_TOO_LARGE") {
        return send(res, 413, {
          error: "Données trop volumineuses."
        });
      }

      return send(res, 400, {
        error: "Format JSON invalide."
      });
    }

    const stats = input.stats;

    const rounds = Array.isArray(input.rounds)
      ? input.rounds.slice(-100)
      : [];

    if (
      !stats ||
      !Number.isFinite(Number(stats.central)) ||
      !Number.isFinite(Number(stats.score))
    ) {
      return send(res, 400, {
        error: "Statistiques invalides ou manquantes."
      });
    }

    const originalCoefficient = Number(stats.central);

    if (originalCoefficient < MIN_COEFFICIENT) {
      return send(res, 200, {
        success: true,
        model: "FILTRE STATISTIQUE",
        decision: "REJETÉ",
        coefficient: null,
        confidence: 0,
        reason: "Le seuil minimum de 1.50x n'est pas respecté.",
        risk: "ÉLEVÉ",
        summary: "Candidat rejeté par le filtre statistique."
      });
    }

    // SI OPENROUTER EST INDISPONIBLE
    if (!OPENROUTER_API_KEY) {
      console.log("OpenRouter absent : mode statistique activé.");

      return send(res, 200, statisticalFallback(
        stats,
        "Clé OpenRouter absente."
      ));
    }

    // APRÈS UNE LIMITE QUOTIDIENNE 429
    if (Date.now() < openRouterBlockedUntil) {
      console.log("OpenRouter en pause : mode statistique actif.");

      return send(res, 200, statisticalFallback(
        stats,
        "Limite quotidienne OpenRouter atteinte."
      ));
    }

    const analysisData = {
      game: "Lucky Jet",
      minimumCoefficient: MIN_COEFFICIENT,
      statistics: stats,
      recentRounds: rounds,
      regime: input.regime || null
    };

    const systemPrompt = `
Tu es un analyste statistique spécialisé dans les jeux Crash.

RÈGLES ABSOLUES :

- Le jeu reste aléatoire.
- Tu ne connais pas le prochain résultat.
- Tu ne dois inventer aucune donnée.
- Le seuil minimum est de 1.50x.
- Examine la fréquence, la stabilité, la volatilité
  et les changements de régime.
- Le coefficient central est calculé par le moteur
  statistique. Tu ne dois jamais le modifier.
- Si les données sont faibles ou contradictoires,
  rejette le candidat.
- La confiance mesure la qualité de l'analyse,
  jamais une probabilité de gain.
- Ne promets jamais un résultat futur.

DÉCISIONS POSSIBLES :

VALIDÉ
À_SURVEILLER
REJETÉ

Retourne une seule décision structurée.
Ne prédis jamais un coefficient futur.
`;

    const tools = [
      {
        type: "function",
        function: {
          name: "submit_analysis",
          description: "Retourne la décision finale.",
          parameters: {
            type: "object",
            properties: {
              decision: {
                type: "string",
                enum: ["VALIDÉ", "À_SURVEILLER", "REJETÉ"]
              },
              coefficient: {
                type: ["number", "null"]
              },
              confidence: {
                type: "number"
              },
              reason: {
                type: "string"
              },
              risk: {
                type: "string"
              },
              summary: {
                type: "string"
              }
            },
            required: [
              "decision",
              "coefficient",
              "confidence",
              "reason",
              "risk",
              "summary"
            ],
            additionalProperties: false
          }
        }
      }
    ];

    try {
      console.log("Demande envoyée à Nemotron.");

      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + OPENROUTER_API_KEY,
          "Content-Type": "application/json",
          "HTTP-Referer": ALLOWED_ORIGIN,
          "X-OpenRouter-Title": "AI CRASH SIGNAL BOT"
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user",
              content:
                "Analyse ces données et rends ta décision :\n" +
                JSON.stringify(analysisData)
            }
          ],
          tools,
          tool_choice: {
            type: "function",
            function: {
              name: "submit_analysis"
            }
          },
          temperature: 0.1,
          max_tokens: 1800
        }),
        signal: AbortSignal.timeout(90000)
      });

      const responseText = await response.text();

      let result;

      try {
        result = JSON.parse(responseText);
      } catch {
        console.error("Réponse OpenRouter non JSON.");

        return send(res, 200, statisticalFallback(
          stats,
          "Réponse OpenRouter illisible."
        ));
      }

      if (!response.ok) {
        const errorMessage =
          result.error?.message || "Erreur fournisseur.";

        console.error("OPENROUTER ERROR:", {
          status: response.status,
          error: errorMessage
        });

        // LIMITE QUOTIDIENNE ATTEINTE
        if (
          response.status === 429 &&
          errorMessage.includes("free-models-per-day")
        ) {
          openRouterBlockedUntil = Date.now() + 24 * 60 * 60 * 1000;

          console.log("OpenRouter suspendu pendant 24 heures.");
        }

        return send(res, 200, statisticalFallback(
          stats,
          errorMessage
        ));
      }

      const choice = result.choices?.[0];
      const message = choice?.message;

      console.log("Nemotron finish_reason:", choice?.finish_reason);
      console.log("Nemotron usage:", result.usage || "Non fourni");

      const aiResult = extractAIResult(message);

      if (!aiResult) {
        return send(res, 200, statisticalFallback(
          stats,
          "Nemotron n'a fourni aucune décision exploitable."
        ));
      }

      const allowedDecisions = [
        "VALIDÉ",
        "À_SURVEILLER",
        "REJETÉ"
      ];

      if (!allowedDecisions.includes(aiResult.decision)) {
        return send(res, 200, statisticalFallback(
          stats,
          "Décision Nemotron invalide."
        ));
      }

      const decision = aiResult.decision;

      const confidence = Math.max(
        0,
        Math.min(100, Number(aiResult.confidence) || 0)
      );

      return send(res, 200, {
        success: true,
        model: AI_MODEL,
        decision,
        coefficient: originalCoefficient,
        confidence,
        reason: String(aiResult.reason || ""),
        risk: String(aiResult.risk || "INCONNU"),
        summary: String(aiResult.summary || ""),
        aiUnavailable: false,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error("AI ANALYSIS ERROR:", error.message);

      return send(res, 200, statisticalFallback(
        stats,
        error.message || "Erreur pendant l'analyse IA."
      ));
    }
  }

  return send(res, 404, {
    error: "Endpoint introuvable."
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("AI CRASH API démarrée sur le port " + PORT);
  console.log("GameData365 :", Boolean(API_KEY));
  console.log("OpenRouter :", Boolean(OPENROUTER_API_KEY));
  console.log("Modèle IA :", AI_MODEL);
  console.log("Seuil minimum :", MIN_COEFFICIENT);
});
        
