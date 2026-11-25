
"use strict";

/* =========================================
   AI CRASH SIGNAL BOT
   Jeu : Lucky Jet
   API : GameData365
   Historique : 100 manches
   Analyse récente : 20 manches
========================================= */

const CONFIG = {
  API_BASE: "https://api.gamedata365.com",
  GAME_ID: "lucky_jet",
  HISTORY_LIMIT: 100,
  RECENT_WINDOW: 20
};

const $ = id => document.getElementById(id);

let analysisInProgress = false;

/* =========================================
   AFFICHAGE ET DIAGNOSTIC
========================================= */

function display(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function setStatus(message) {
  display("status", message);
}

function reportError(message) {
  console.error("[AI CRASH BOT]", message);
  setStatus("Erreur : " + message);
}

/* Détecte les erreurs JavaScript */
window.addEventListener("error", event => {
  reportError("Erreur JavaScript : " + event.message);
});

window.addEventListener("unhandledrejection", event => {
  const reason = event.reason;
  reportError(
    "Erreur inattendue : " +
    (reason?.message || String(reason))
  );
});

/* =========================================
   OUTILS MATHÉMATIQUES
========================================= */

function average(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values) {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function variance(values) {
  if (values.length < 2) return 0;

  const mean = average(values);

  return average(
    values.map(x => Math.pow(x - mean, 2))
  );
}

function standardDeviation(values) {
  return Math.sqrt(variance(values));
}

function percentage(condition, values) {
  if (!values.length) return 0;

  return 100 *
    values.filter(condition).length /
    values.length;
}

function quantile(values, q) {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) return sorted[lower];

  return sorted[lower] +
    (sorted[upper] - sorted[lower]) *
    (position - lower);
}

function wilsonInterval(successes, total) {
  if (!total) return [0, 0];

  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + z * z / total;

  const center =
    (p + z * z / (2 * total)) / denominator;

  const margin =
    z * Math.sqrt(
      p * (1 - p) / total +
      z * z / (4 * total * total)
    ) / denominator;

  return [
    100 * (center - margin),
    100 * (center + margin)
  ];
}

/* =========================================
   CORRÉLATION SUCCESSIVE
========================================= */

function correlation(values) {
  if (values.length < 3) return 0;

  const x = values.slice(0, -1);
  const y = values.slice(1);

  const mx = average(x);
  const my = average(y);

  let numerator = 0;
  let sumX = 0;
  let sumY = 0;

  for (let i = 0; i < x.length; i++) {
    numerator += (x[i] - mx) * (y[i] - my);
    sumX += Math.pow(x[i] - mx, 2);
    sumY += Math.pow(y[i] - my, 2);
  }

  const denominator = Math.sqrt(sumX * sumY);

  return denominator ? numerator / denominator : 0;
}

/* =========================================
   SÉRIES ET SÉQUENCES
========================================= */

function longestStreak(values, condition) {
  let current = 0;
  let longest = 0;

  for (const value of values) {
    if (condition(value)) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}

function runsTest(values) {
  if (values.length < 2) {
    return { runs: 0, z: 0 };
  }

  const binary = values.map(x => x < 2 ? 1 : 0);

  const n1 = binary.filter(x => x === 1).length;
  const n2 = binary.length - n1;

  if (n1 === 0 || n2 === 0) {
    return { runs: 1, z: 0 };
  }

  let runs = 1;

  for (let i = 1; i < binary.length; i++) {
    if (binary[i] !== binary[i - 1]) runs++;
  }

  const n = n1 + n2;
  const expected = 1 + (2 * n1 * n2) / n;

  const standardError = Math.sqrt(
    (2 * n1 * n2 * (2 * n1 * n2 - n)) /
    (n * n * (n - 1))
  );

  return {
    runs,
    z: standardError
      ? (runs - expected) / standardError
      : 0
  };
}

/* =========================================
   CONNEXION API
========================================= */

async function apiRequest(endpoint, apiKey) {
  let response;

  try {
    response = await fetch(
      CONFIG.API_BASE + endpoint,
      {
        method: "GET",
        headers: {
          "X-API-Key": apiKey,
          "Accept": "application/json"
        }
      }
    );
  } catch (error) {
    throw new Error(
      "Connexion impossible à GameData365. " +
      "Vérifie le réseau et les autorisations CORS de l'API."
    );
  }

  if (!response.ok) {
    let details = "";

    try {
      const body = await response.json();
      details = body.message || body.error || "";
    } catch (_) {}

    throw new Error(
      "Erreur HTTP " + response.status +
      (details ? " : " + details : "")
    );
  }

  let data;

  try {
    data = await response.json();
  } catch (_) {
    throw new Error("La réponse de l'API n'est pas un JSON valide.");
  }

  if (data.status === "error") {
    throw new Error(
      data.message || data.error || "Erreur GameData365."
    );
  }

  return data;
}

/* =========================================
   NORMALISATION HISTORIQUE
========================================= */

function normalizeRounds(history) {
  let rounds = [];

  if (Array.isArray(history.rounds)) {
    rounds = history.rounds;
  } else if (Array.isArray(history.data?.rounds)) {
    rounds = history.data.rounds;
  } else if (Array.isArray(history.results)) {
    rounds = history.results;
  } else if (Array.isArray(history.data)) {
    rounds = history.data;
  }

  return rounds
    .filter(round => {
      const multiplier = Number(
        round.multiplier ?? round.coefficient
      );

      return Number.isFinite(multiplier) && multiplier >= 1;
    })
    .map(round => ({
      id: round.round_id || round.id || null,
      multiplier: Number(
        round.multiplier ?? round.coefficient
      ),
      timestamp:
        round.timestamp ||
        round.created_at ||
        round.date ||
        null
    }))
    .sort((a, b) => {
      if (!a.timestamp || !b.timestamp) return 0;

      return new Date(b.timestamp) - new Date(a.timestamp);
    });
}

/* =========================================
   ANALYSE STATISTIQUE
========================================= */

function calculateAnalysis(rounds) {
  const values = rounds.map(x => x.multiplier);

  if (values.length < CONFIG.RECENT_WINDOW) {
    throw new Error(
      "Historique insuffisant : " +
      values.length +
      " manches reçues, 20 nécessaires."
    );
  }

  const recent = values.slice(0, 20);
  const previous = values.slice(20, 40);

  const lowCount = values.filter(x => x < 2).length;
  const highCount = values.filter(x => x >= 5).length;
  const extremeCount = values.filter(x => x >= 10).length;

  return {
    sampleSize: values.length,

    mean: average(values),
    median: median(values),
    variance: variance(values),
    deviation: standardDeviation(values),

    q25: quantile(values, 0.25),
    q75: quantile(values, 0.75),
    q90: quantile(values, 0.90),

    under2: percentage(x => x < 2, values),
    over2: percentage(x => x >= 2, values),
    over5: percentage(x => x >= 5, values),
    over10: percentage(x => x >= 10, values),

    lowCount,
    highCount,
    extremeCount,

    lowInterval: wilsonInterval(
      lowCount,
      values.length
    ),

    recentMean: average(recent),
    recentMedian: median(recent),
    recentLow: percentage(x => x < 2, recent),
    recentHigh: percentage(x => x >= 5, recent),

    previousMean: previous.length
      ? average(previous)
      : null,

    meanDifference: previous.length
      ? average(recent) - average(previous)
      : null,

    correlation: correlation(values),

    longestLowStreak: longestStreak(
      values,
      x => x < 2
    ),

    longestHighStreak: longestStreak(
      values,
      x => x >= 5
    ),

    runs: runsTest(values),
    recentValues: recent
  };
}

/* =========================================
   AFFICHAGE DES RÉSULTATS
========================================= */

function format(value) {
  return Number(value).toFixed(2);
}

function displayResults(stats) {
  display("count", stats.sampleSize);
  display("mean", format(stats.mean) + "x");
  display("median", format(stats.median) + "x");
  display("volatility", format(stats.deviation));

  display("under2", stats.under2.toFixed(1) + "%");
  display("over5", stats.over5.toFixed(1) + "%");

  display("recentMean", format(stats.recentMean) + "x");
  display("recentLow", stats.recentLow.toFixed(1) + "%");
  display("recentHigh", stats.recentHigh.toFixed(1) + "%");

  display(
    "difference",
    stats.meanDifference === null
      ? "Données insuffisantes"
      : (stats.meanDifference > 0 ? "+" : "") +
        format(stats.meanDifference) + "x"
  );

  const results = $("results");

  if (results) {
    results.innerHTML = stats.recentValues.map(value => {
      const color =
        value < 2 ? "red" :
        value >= 5 ? "green" : "blue";

      return `
        <div class="result ${color}">
          ${format(value)}x
        </div>
      `;
    }).join("");
  }

  display(
    "interpretation",
    stats.meanDifference === null
      ? "Pas assez de données pour comparer deux fenêtres."
      : "La moyenne des 20 dernières manches est " +
        (stats.meanDifference > 0
          ? "supérieure"
          : stats.meanDifference < 0
            ? "inférieure"
            : "identique") +
        " à celle des 20 précédentes. Cela ne prouve pas un changement de probabilité."
  );

  const interval = stats.lowInterval;

  display(
    "diagnostic",
    `Échantillon : ${stats.sampleSize} manches. ` +
    `Sous 2x : ${stats.under2.toFixed(1)}%. ` +
    `IC 95% : ${interval[0].toFixed(1)}% à ${interval[1].toFixed(1)}%. ` +
    `Corrélation : ${stats.correlation.toFixed(3)}. ` +
    `Test des séquences Z : ${stats.runs.z.toFixed(2)}. ` +
    `Plus longue série sous 2x : ${stats.longestLowStreak}. ` +
    `Ces indicateurs décrivent l'historique et ne garantissent pas le prochain résultat.`
  );
}

/* =========================================
   ANALYSE COMPLÈTE
========================================= */

async function runAnalysis() {
  if (analysisInProgress) return;

  const key = $("apiKey")?.value.trim();

  if (!key) {
    setStatus("Saisis ta clé API GameData365.");
    return;
  }

  analysisInProgress = true;

  const button = $("analyze");

  if (button) button.disabled = true;

  setStatus("Connexion à GameData365...");

  try {
    const [live, history] = await Promise.all([
      apiRequest("/v1/crash/live", key),

      apiRequest(
        `/v1/crash/history?game=${encodeURIComponent(CONFIG.GAME_ID)}&limit=${CONFIG.HISTORY_LIMIT}`,
        key
      )
    ]);

    const rounds = normalizeRounds(history);

    if (!rounds.length) {
      throw new Error(
        "Aucune manche trouvée dans la réponse historique. Vérifie le format retourné par l'API."
      );
    }

    const game = Array.isArray(live.games)
      ? live.games.find(item => item.game_id === CONFIG.GAME_ID)
      : null;

    if (game) {
      const multiplier = game.latest?.multiplier;

      display(
        "live",
        multiplier !== undefined
          ? format(multiplier) + "x"
          : "—"
      );

      display(
        "feed",
        game.stale ? "DONNÉES ANCIENNES" : "EN DIRECT"
      );
    } else {
      display("live", "—");
      display("feed", "DONNÉES REÇUES");
    }

    const stats = calculateAnalysis(rounds);

    displayResults(stats);

    setStatus(
      `Analyse terminée : ${stats.sampleSize} manches analysées.`
    );

  } catch (error) {
    console.error(error);

    reportError(
      error.message ||
      "Une erreur inconnue est survenue."
    );

  } finally {
    analysisInProgress = false;

    if (button) button.disabled = false;
  }
}

/* =========================================
   INITIALISATION ROBUSTE
========================================= */

function initializeBot() {
  const button = $("analyze");
  const apiInput = $("apiKey");

  if (!button) {
    reportError(
      "Bouton introuvable. Vérifie id=\"analyze\" dans index.html."
    );
    return;
  }

  if (!apiInput) {
    reportError(
      "Champ API introuvable. Vérifie id=\"apiKey\" dans index.html."
    );
    return;
  }

  button.addEventListener("click", runAnalysis);

  setStatus("Application chargée. En attente de connexion API.");

  console.log("AI CRASH SIGNAL BOT : initialisation réussie.");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeBot);
} else {
  initializeBot();
     }
