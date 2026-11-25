
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
  RECENT_WINDOW: 20,
  REFRESH_INTERVAL: 60000
};

const $ = id => document.getElementById(id);

let analysisInProgress = false;

/* =========================================
   OUTILS MATHÉMATIQUES
========================================= */

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
    values.map(value => Math.pow(value - mean, 2))
  );
}

function standardDeviation(values) {
  return Math.sqrt(variance(values));
}

function percentage(condition, values) {
  if (!values.length) return 0;

  return 100 * values.filter(condition).length / values.length;
}

function quantile(values, q) {
  if (!values.length) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) return sorted[lower];

  return sorted[lower] +
    (sorted[upper] - sorted[lower]) * (position - lower);
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
   CORRÉLATION
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

  const binary = values.map(value => value < 2 ? 1 : 0);

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

  const z = standardError
    ? (runs - expected) / standardError
    : 0;

  return { runs, z };
}

/* =========================================
   CONNEXION API
========================================= */

async function apiRequest(endpoint, apiKey) {
  const response = await fetch(
    CONFIG.API_BASE + endpoint,
    {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        "Accept": "application/json"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      "Erreur API HTTP " + response.status
    );
  }

  const data = await response.json();

  if (data.status === "error") {
    throw new Error(
      data.message || data.error || "Erreur GameData365"
    );
  }

  return data;
}

/* =========================================
   NORMALISATION HISTORIQUE
========================================= */

function normalizeRounds(history) {
  const rounds = Array.isArray(history.rounds)
    ? history.rounds
    : [];

  return rounds
    .filter(round =>
      round &&
      Number.isFinite(Number(round.multiplier)) &&
      Number(round.multiplier) >= 1
    )
    .map(round => ({
      id: round.round_id || null,
      multiplier: Number(round.multiplier),
      timestamp: round.timestamp || null
    }))
    .sort((a, b) => {
      if (a.timestamp && b.timestamp) {
        return new Date(b.timestamp) - new Date(a.timestamp);
      }

      return 0;
    });
}

/* =========================================
   ANALYSE STATISTIQUE PRINCIPALE
========================================= */

function calculateAnalysis(rounds) {
  const values = rounds.map(round => round.multiplier);

  if (values.length < CONFIG.RECENT_WINDOW) {
    throw new Error(
      "Historique insuffisant : minimum 20 manches nécessaires."
    );
  }

  const recent = values.slice(0, CONFIG.RECENT_WINDOW);

  const previous = values.slice(
    CONFIG.RECENT_WINDOW,
    CONFIG.RECENT_WINDOW * 2
  );

  const lowCount = values.filter(x => x < 2).length;
  const highCount = values.filter(x => x >= 5).length;
  const extremeCount = values.filter(x => x >= 10).length;

  const recentLow = recent.filter(x => x < 2).length;
  const recentHigh = recent.filter(x => x >= 5).length;

  const interval = wilsonInterval(
    lowCount,
    values.length
  );

  const comparison = previous.length
    ? average(recent) - average(previous)
    : null;

  const runs = runsTest(values);

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

    lowInterval: interval,

    recentMean: average(recent),
    recentMedian: median(recent),
    recentLow: percentage(x => x < 2, recent),
    recentHigh: percentage(x => x >= 5, recent),

    previousMean: previous.length
      ? average(previous)
      : null,

    meanDifference: comparison,

    correlation: correlation(values),

    longestLowStreak: longestStreak(
      values,
      x => x < 2
    ),

    longestHighStreak: longestStreak(
      values,
      x => x >= 5
    ),

    runs,
    recentValues: recent
  };
}

/* =========================================
   AFFICHAGE
========================================= */

function display(id, value) {
  const element = $(id);

  if (element) {
    element.textContent = value;
  }
}

function format(value) {
  return Number(value).toFixed(2);
}

function displayResults(stats) {
  display("count", stats.sampleSize);

  display("mean", format(stats.mean) + "x");
  display("median", format(stats.median) + "x");

  display(
    "volatility",
    format(stats.deviation)
  );

  display(
    "under2",
    stats.under2.toFixed(1) + "%"
  );

  display(
    "over5",
    stats.over5.toFixed(1) + "%"
  );

  display(
    "recentMean",
    format(stats.recentMean) + "x"
  );

  display(
    "recentLow",
    stats.recentLow.toFixed(1) + "%"
  );

  display(
    "recentHigh",
    stats.recentHigh.toFixed(1) + "%"
  );

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
    `Fréquence sous 2x : ${stats.under2.toFixed(1)}%. ` +
    `Intervalle de confiance à 95% : ${interval[0].toFixed(1)}% à ${interval[1].toFixed(1)}%. ` +
    `Corrélation successive : ${stats.correlation.toFixed(3)}. ` +
    `Test des séquences : Z = ${stats.runs.z.toFixed(2)}. ` +
    `Plus longue série sous 2x : ${stats.longestLowStreak}. ` +
    `Ces indicateurs sont descriptifs et ne garantissent aucune prédiction.`
  );
}

/* =========================================
   RÉCUPÉRATION DES DONNÉES LIVE
========================================= */

async function loadLive(apiKey) {
  const data = await apiRequest(
    "/v1/crash/live",
    apiKey
  );

  const game = (data.games || []).find(
    item => item.game_id === CONFIG.GAME_ID
  );

  if (!game) {
    display("feed", "JEU NON TROUVÉ");
    display("live", "—");
    return;
  }

  if (game.latest && game.latest.multiplier !== undefined) {
    display(
      "live",
      format(game.latest.multiplier) + "x"
    );
  } else {
    display("live", "—");
  }

  display(
    "feed",
    game.stale ? "DONNÉES ANCIENNES" : "EN DIRECT"
  );
}

/* =========================================
   ANALYSE COMPLÈTE
========================================= */

async function runAnalysis() {
  if (analysisInProgress) return;

  const key = $("apiKey")?.value.trim();

  if (!key) {
    display("status", "Saisis ta clé API GameData365.");
    return;
  }

  analysisInProgress = true;

  const button = $("analyze");

  if (button) button.disabled = true;

  display("status", "Connexion à GameData365...");

  try {
    const [live, history] = await Promise.all([
      apiRequest("/v1/crash/live", key),
      apiRequest(
        `/v1/crash/history?game=${CONFIG.GAME_ID}&limit=${CONFIG.HISTORY_LIMIT}`,
        key
      )
    ]);

    const rounds = normalizeRounds(history);

    if (rounds.length === 0) {
      throw new Error("Aucune manche historique reçue.");
    }

    const game = (live.games || []).find(
      item => item.game_id === CONFIG.GAME_ID
    );

    if (game) {
      display(
        "live",
        game.latest?.multiplier !== undefined
          ? format(game.latest.multiplier) + "x"
          : "—"
      );

      display(
        "feed",
        game.stale ? "DONNÉES ANCIENNES" : "EN DIRECT"
      );
    }

    const stats = calculateAnalysis(rounds);

    displayResults(stats);

    display(
      "status",
      `Analyse terminée : ${stats.sampleSize} manches reçues.`
    );

  } catch (error) {
    display(
      "status",
      "Erreur : " + error.message +
      ". Vérifie la clé API et les autorisations CORS."
    );

  } finally {
    analysisInProgress = false;

    if (button) button.disabled = false;
  }
}

/* =========================================
   INITIALISATION
========================================= */

document.addEventListener("DOMContentLoaded", () => {
  const button = $("analyze");

  if (button) {
    button.addEventListener("click", runAnalysis);
  }

  display("status", "En attente de connexion API.");
});
                     
