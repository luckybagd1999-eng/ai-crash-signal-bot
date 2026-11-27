
"use strict";

const http = require("http");

const PORT = process.env.PORT || 3000;

// GAME DATA 365
const API_KEY = process.env.GAMEDATA365_API_KEY;
const API_BASE = "https://api.gamedata365.com";

// OPENROUTER
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const AI_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

const ALLOWED_ORIGIN =
  "https://luckybagd1999-eng.github.io";

const server = http.createServer(async (req, res) => {

  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const path = new URL(req.url, "http://localhost").pathname;

  function send(status, data) {
    res.writeHead(status);
    res.end(JSON.stringify(data));
  }

  // PAGE D'ACCUEIL
  if (path === "/") {
    return send(200, {
      name: "AI CRASH API",
      status: "online",
      gameData365: Boolean(API_KEY),
      openRouter: Boolean(OPENROUTER_API_KEY),
      model: AI_MODEL
    });
  }

  // =====================================
  // GAME DATA 365
  // =====================================

  if (path === "/api/live" || path === "/api/history") {

    if (!API_KEY) {
      return send(500, {
        error: "Clé GameData365 non configurée sur Render."
      });
    }

    let endpoint;

    if (path === "/api/live") {
      endpoint = "/v1/crash/live";
    } else {
      endpoint = "/v1/crash/history?game=lucky_jet&limit=100";
    }

    try {
      const response = await fetch(API_BASE + endpoint, {
        headers: {
          "X-API-Key": API_KEY,
          "Accept": "application/json"
        },
        signal: AbortSignal.timeout(20000)
      });

      const data = await response.text();

      res.writeHead(response.status);
      return res.end(data);

    } catch (error) {
      return send(502, {
        error: "Erreur de connexion à GameData365.",
        details: error.message
      });
    }
  }

  // =====================================
  // OPENROUTER AI ANALYSIS
  // =====================================

  if (path === "/api/ai-analysis") {

    if (req.method !== "POST") {
      return send(405, {
        error: "Méthode non autorisée. Utilise POST."
      });
    }

    if (!OPENROUTER_API_KEY) {
      return send(503, {
        error: "Clé OpenRouter absente de Render."
      });
    }

    try {

      // Lecture des données envoyées par le bot
      let body = "";
      let tooLarge = false;

      for await (const chunk of req) {
        body += chunk;

        if (body.length > 100000) {
          tooLarge = true;
          break;
        }
      }

      if (tooLarge) {
        return send(413, {
          error: "Données d'analyse trop volumineuses."
        });
      }

      let input;

      try {
        input = JSON.parse(body);
      } catch {
        return send(400, {
          error: "Format JSON invalide."
        });
      }

      const stats = input.stats;
      const rounds = Array.isArray(input.rounds)
        ? input.rounds.slice(-100)
        : [];

      if (!stats || typeof stats !== "object") {
        return send(400, {
          error: "Statistiques manquantes."
        });
      }

      // Préparation des données pour l'IA
      const analysisData = {
        game: "Lucky Jet",
        statistics: stats,
        recentRounds: rounds,
        regime: input.regime || null
      };

      const systemPrompt = `
Tu es un analyste statistique spécialisé dans
l'étude des historiques de jeux Crash.

Tu analyses exclusivement les données reçues.

IMPORTANT :

1. Lucky Jet est un jeu à résultats aléatoires.
2. Tu ne peux pas connaître le prochain résultat.
3. Tu ne dois jamais présenter une hypothèse comme une certitude.
4. Tu ne dois jamais inventer de données.
5. Tu dois examiner la stabilité, la fréquence des
   coefficients supérieurs ou égaux à 2.00x,
   la volatilité et les changements de régime.
6. Tu dois respecter le seuil minimum de 2.00x.
7. Tu ne dois jamais augmenter artificiellement
   le coefficient central fourni par le moteur statistique.
8. Si les données sont insuffisantes ou contradictoires,
   tu dois rejeter le candidat.

Tu dois rendre UNE décision parmi :

VALIDÉ
À_SURVEILLER
REJETÉ

Signification :

VALIDÉ :
Les données historiques sont relativement cohérentes
et le candidat mérite d'être retenu comme signal indicatif.

À_SURVEILLER :
Il existe des éléments intéressants mais aussi
des incertitudes ou une instabilité.

REJETÉ :
Les données sont trop faibles, contradictoires
ou le seuil de 2.00x n'est pas respecté.

Tu ne prédis jamais un résultat certain.
Tu ne fabriques jamais un coefficient futur.

Réponds uniquement avec un objet JSON valide
respectant exactement cette structure :

{
  "decision": "VALIDÉ",
  "coefficient": 2.00,
  "confidence": 50,
  "reason": "Explication statistique courte",
  "risk": "MODÉRÉ",
  "summary": "Conclusion de l'analyse"
}

Le coefficient doit être exactement celui
du moteur statistique reçu, ou null si aucun
candidat valide n'existe.

Confidence est un score de confiance dans
la qualité de l'analyse, pas une probabilité
de gagner.
`;

      const userPrompt = `
Analyse les données suivantes et prends ta décision.

${JSON.stringify(analysisData)}
`;

      // Appel OpenRouter
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",

        headers: {
          "Authorization": "Bearer " + OPENROUTER_API_KEY,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://luckybagd1999-eng.github.io",
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
              content: userPrompt
            }
          ],

          temperature: 0.1,
          max_tokens: 700
        }),

        signal: AbortSignal.timeout(45000)
      });

      const result = await response.json();

      if (!response.ok) {
        console.error("OpenRouter error:", result);

        return send(502, {
          error: "OpenRouter a refusé la demande.",
          details: result.error?.message || "Erreur du fournisseur IA."
        });
      }

      const content =
        result.choices?.[0]?.message?.content;

      if (!content) {
        return send(502, {
          error: "Réponse vide de Nemotron."
        });
      }

      // Extraction du JSON retourné par le modèle
      let aiResult;

      try {
        const cleaned = content
          .replace(/```json/gi, "")
          .replace(/```/g, "")
          .trim();

        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");

        if (start === -1 || end === -1) {
          throw new Error("JSON absent.");
        }

        aiResult = JSON.parse(
          cleaned.substring(start, end + 1)
        );

      } catch {
        return send(502, {
          error: "Réponse Nemotron non exploitable.",
          raw: content
        });
      }

      // Vérification de la décision
      const allowedDecisions = [
        "VALIDÉ",
        "À_SURVEILLER",
        "REJETÉ"
      ];

      if (!allowedDecisions.includes(aiResult.decision)) {
        return send(502, {
          error: "Décision IA invalide."
        });
      }

      // Le modèle ne peut pas modifier le coefficient.
      const originalCoefficient =
        Number(stats.central);

      const coefficient =
        Number.isFinite(originalCoefficient) &&
        originalCoefficient >= 2
          ? originalCoefficient
          : null;

      if (coefficient === null) {
        aiResult.decision = "REJETÉ";
      }

      return send(200, {
        success: true,
        model: AI_MODEL,
        decision: aiResult.decision,
        coefficient,
        confidence: Math.max(
          0,
          Math.min(100, Number(aiResult.confidence) || 0)
        ),
        reason: String(aiResult.reason || ""),
        risk: String(aiResult.risk || "INCONNU"),
        summary: String(aiResult.summary || ""),
        timestamp: new Date().toISOString()
      });

    } catch (error) {

      console.error("AI ANALYSIS ERROR:", error);

      return send(502, {
        error: "Erreur pendant l'analyse IA.",
        details: error.message
      });
    }
  }

  // =====================================
  // ROUTE INCONNUE
  // =====================================

  return send(404, {
    error: "Endpoint introuvable."
  });

});

server.listen(PORT, "0.0.0.0", () => {
  console.log("AI CRASH API démarrée sur le port " + PORT);
  console.log("GameData365 :", Boolean(API_KEY));
  console.log("OpenRouter :", Boolean(OPENROUTER_API_KEY));
  console.log("Modèle IA :", AI_MODEL);
});
    
