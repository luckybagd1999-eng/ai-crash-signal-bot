
"use strict";

/* =========================================
   AI CRASH SIGNAL BOT
   Jeu : Lucky Jet
   API : GameData365
   Moteur : Analyse statistique adaptative
   Fenêtres : 10 / 20 / 30 / 50 / 100
========================================= */

const CONFIG = {
  API_URL: "https://ai-crash-signal-bot.onrender.com/api/history",
  HISTORY_LIMIT: 100,
  REFRESH_MS: 60000,
  COUNTDOWN_MS: 1000,
  MIN_COEFFICIENT: 2.00,
  MIN_ROUNDS: 40,
  MIN_PREPARATION_SECONDS: 60,
  REQUEST_TIMEOUT: 15000,
  WINDOWS: [10, 20, 30, 50, 100]
};

let lastRoundTimestamp = null;
let estimatedNextTime = null;
let countdownInterval = null;
let refreshInterval = null;
let analysisInProgress = false;

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

function standardDeviation(values) {
  if (values.length < 2) return 0;

  const avg = average(values);
  const variance = average(
    values.map(value => Math.pow(value - avg, 2))
  );

  return Math.sqrt(variance);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatCoefficient(value) {
  return Number(value).toFixed(2) + "x";
}

function formatTime(date) {
  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

/* =========================================
   AFFICHAGE
========================================= */

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setLight(activeLight) {
  ["lightGreen", "lightOrange", "lightRed"].forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.classList.remove("active", "on");
    }
  });

  if (!activeLight) return;

  const selected = document.getElementById(activeLight);
  if (selected) {
    selected.classList.add("active");
  }
}

function displayNoSignal(message) {
  setText("coefficient", "AUCUN SIGNAL");
  setText("range", "--");
  setText("lightLabel", "AUCUN CANDIDAT");
  setText("estimatedTime", "--:--:--");
  setText("countdown", "--:--:--");
  setText("signalStatus", message);

  setLight(null);
}

function displaySignal(result) {
  setText(
    "coefficient",
    formatCoefficient(result.central)
  );

  setText(
    "range",
    formatCoefficient(result.low) +
    " – " +
    formatCoefficient(result.high)
  );

  setText("lightLabel", result.lightLabel);

  setText(
    "signalStatus",
    "CANDIDAT STATISTIQUE IDENTIFIÉ"
  );

  if (result.light === "GREEN") {
    setLight("lightGreen");
  } else if (result.light === "ORANGE") {
    setLight("lightOrange");
  } else {
    setLight("lightRed");
  }
}

/* =========================================
   RÉCUPÉRATION DES DONNÉES
========================================= */

async function getHistory() {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    CONFIG.REQUEST_TIMEOUT
  );

  try {
    const response = await fetch(
      CONFIG.API_URL + "?limit=" + CONFIG.HISTORY_LIMIT,
      {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error("Erreur API : " + response.status);
    }

    const data = await response.json();

    const rounds = Array.isArray(data)
      ? data
      : data.rounds || data.history || data.results || [];

    if (!Array.isArray(rounds) || rounds.length === 0) {
      throw new Error("Aucune manche reçue.");
    }

    return rounds;
  } finally {
    clearTimeout(timeout);
  }
}

/* =========================================
   NORMALISATION DES MANCHES
========================================= */

function normalizeRounds(rawRounds) {
  const normalized = [];

  for (const round of rawRounds) {
    let multiplier = null;

    if (typeof round === "number") {
      multiplier = round;
    } else if (typeof round === "string") {
      multiplier = parseFloat(round);
    } else if (round && typeof round === "object") {
      const possibleValues = [
        round.multiplier,
        round.coefficient,
        round.crash_point,
        round.crashPoint,
        round.result,
        round.value,
        round.x
      ];

      for (const value of possibleValues) {
        if (value !== undefined && value !== null) {
          multiplier = parseFloat(value);
          if (Number.isFinite(multiplier)) break;
        }
      }
    }

    if (
      !Number.isFinite(multiplier) ||
      multiplier < 1
    ) {
      continue;
    }

    let timestamp = null;

    if (round && typeof round === "object") {
      const possibleDates = [
        round.timestamp,
        round.created_at,
        round.createdAt,
        round.date,
        round.time,
        round.started_at
      ];

      for (const value of possibleDates) {
        if (value === undefined || value === null) continue;

        if (typeof value === "number") {
          timestamp = value < 1000000000000
            ? value * 1000
            : value;
        } else {
          const parsed = Date.parse(value);
          if (Number.isFinite(parsed)) timestamp = parsed;
        }

        if (timestamp) break;
      }
    }

    normalized.push({
      multiplier,
      timestamp
    });
  }

  normalized.sort((a, b) => {
    if (a.timestamp && b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    return 0;
  });

  return normalized.slice(-CONFIG.HISTORY_LIMIT);
}

/* =========================================
   ANALYSE DES CHANGEMENTS STATISTIQUES
========================================= */

function analyseRegime(rounds) {
  if (rounds.length < 40) {
    return {
      state: "DONNÉES INSUFFISANTES",
      description: "Collecte statistique en cours."
    };
  }

  const values = rounds.map(r => r.multiplier);

  const recent = values.slice(-20);
  const previous = values.slice(-40, -20);

  const recentMedian = median(recent);
  const previousMedian = median(previous);

  const recentFrequency =
    recent.filter(v => v >= 2).length / recent.length;

  const previousFrequency =
    previous.filter(v => v >= 2).length / previous.length;

  const recentVolatility = standardDeviation(recent);
  const previousVolatility = standardDeviation(previous);

  const medianDifference = Math.abs(
    recentMedian - previousMedian
  );

  const frequencyDifference = Math.abs(
    recentFrequency - previousFrequency
  );

  const volatilityRatio = previousVolatility > 0
    ? recentVolatility / previousVolatility
    : 1;

  if (
    medianDifference >= 0.75 ||
    frequencyDifference >= 0.30 ||
    volatilityRatio >= 2.20 ||
    volatilityRatio <= 0.45
  ) {
    return {
      state: "CHANGEMENT IMPORTANT",
      description: "Variation importante détectée. Analyse récente prioritaire."
    };
  }

  if (
    medianDifference >= 0.35 ||
    frequencyDifference >= 0.20 ||
    volatilityRatio >= 1.60 ||
    volatilityRatio <= 0.65
  ) {
    return {
      state: "CHANGEMENT DÉTECTÉ",
      description: "Distribution en évolution. Adaptation des fenêtres."
    };
  }

  return {
    state: "STABLE",
    description: "Distribution récente relativement stable."
  };
}

/* =========================================
   ÉVALUATION DE CHAQUE FENÊTRE
========================================= */

function evaluateWindow(rounds, size) {
  if (rounds.length < size) return null;

  const sample = rounds
    .slice(-size)
    .map(r => r.multiplier);

  const central = median(sample);
  const low = quantile(sample, 0.25);
  const high = quantile(sample, 0.75);

  const hitRate =
    sample.filter(v => v >= 2).length / size;

  const deviation = standardDeviation(sample);

  const relativeSpread = central > 0
    ? (high - low) / central
    : 1;

  const relativeDeviation = central > 0
    ? deviation / central
    : 1;

  const stabilityScore = clamp(
    100 - relativeSpread * 100,
    0,
    100
  );

  const volatilityScore = clamp(
    100 - relativeDeviation * 70,
    0,
    100
  );

  const frequencyScore = hitRate * 100;

  const sampleScore = size === 10 ? 50 :
    size === 20 ? 65 :
    size === 30 ? 75 :
    size === 50 ? 90 : 100;

  const score =
    stabilityScore * 0.40 +
    volatilityScore * 0.25 +
    frequencyScore * 0.20 +
    sampleScore * 0.15;

  return {
    size,
    central,
    low,
    high,
    hitRate,
    deviation,
    stabilityScore,
    score
  };
}

/* =========================================
   SÉLECTION ADAPTATIVE
========================================= */

function adaptiveAnalysis(rounds) {
  const regime = analyseRegime(rounds);

  const evaluations = CONFIG.WINDOWS
    .map(size => evaluateWindow(rounds, size))
    .filter(Boolean);

  if (!evaluations.length) {
    return {
      valid: false,
      regime,
      reason: "Historique insuffisant."
    };
  }

  // On conserve uniquement les fenêtres dont
  // le coefficient central atteint 2.00x.
  const eligible = evaluations.filter(
    item => item.central >= CONFIG.MIN_COEFFICIENT
  );

  if (!eligible.length) {
    return {
      valid: false,
      regime,
      evaluations,
      reason: "Aucun coefficient central ne satisfait le seuil de 2.00x."
    };
  }

  // La fenêtre est choisie selon la stabilité
  // et la qualité statistique, pas selon le
  // coefficient central le plus élevé.
  eligible.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return b.size - a.size;
  });

  const best = eligible[0];

  // Comparaison avec les autres fenêtres
  // pour détecter une divergence statistique.
  const otherMedians = eligible
    .filter(item => item.size !== best.size)
    .map(item => item.central);

  const medianAgreement = otherMedians.length
    ? 100 - clamp(
        (standardDeviation(otherMedians) /
          Math.max(best.central, 1)) * 100,
        0,
        100
      )
    : 50;

  const finalScore =
    best.score * 0.80 +
    medianAgreement * 0.20;

  let light = "RED";
  let lightLabel = "ROUGE · INSTABILITÉ";

  if (
    finalScore >= 80 &&
    regime.state === "STABLE"
  ) {
    light = "GREEN";
    lightLabel = "VERT · STABILITÉ HISTORIQUE";
  } else if (
    finalScore >= 60 &&
    regime.state !== "CHANGEMENT IMPORTANT"
  ) {
    light = "ORANGE";
    lightLabel = "ORANGE · STABILITÉ MODÉRÉE";
  }

  return {
    valid: true,
    central: best.central,
    low: best.low,
    high: best.high,
    score: finalScore,
    hitRate: best.hitRate,
    windowSize: best.size,
    light,
    lightLabel,
    regime
  };
}

/* =========================================
   ESTIMATION INDICATIVE DU TEMPS
========================================= */

function analyseTime(rounds) {
  const timestamps = rounds
    .map(r => r.timestamp)
    .filter(t => Number.isFinite(t));

  if (timestamps.length < 3) {
    return null;
  }

  const intervals = [];

  for (let i = 1; i < timestamps.length; i++) {
    const difference =
      (timestamps[i] - timestamps[i - 1]) / 1000;

    if (difference >= 1 && difference <= 600) {
      intervals.push(difference);
    }
  }

  if (!intervals.length) return null;

  const typicalInterval = median(intervals);
  const lastTimestamp = timestamps[timestamps.length - 1];

  const projected = Math.max(
    lastTimestamp + typicalInterval * 1000,
    Date.now() + CONFIG.MIN_PREPARATION_SECONDS * 1000
  );

  return new Date(projected);
}

function updateCountdown() {
  if (!estimatedNextTime) return;

  const remaining = Math.max(
    0,
    Math.floor((estimatedNextTime.getTime() - Date.now()) / 1000)
  );

  const hours = String(Math.floor(remaining / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
  const seconds = String(remaining % 60).padStart(2, "0");

  setText("countdown", `${hours}:${minutes}:${seconds}`);

  if (remaining === 0) {
    setText("countdown", "EN ATTENTE");
  }
}

/* =========================================
   AFFICHAGE DE L'ADAPTATION
========================================= */

function displayAdaptation(result) {
  setText(
    "adaptationStatus",
    result.regime.state
  );

  let details = result.regime.description;

  if (result.valid) {
    details +=
      " Fenêtre sélectionnée : " +
      result.windowSize +
      " manches. Score de stabilité descriptif : " +
      result.score.toFixed(1) +
      "/100.";
  } else {
    details += " " + result.reason;
  }

  setText("adaptationDetails", details);
}

/* =========================================
   ANALYSE PRINCIPALE
========================================= */

async function runAnalysis() {
  if (analysisInProgress) return;

  analysisInProgress = true;

  try {
    setText("signalStatus", "RÉCUPÉRATION DES DONNÉES...");

    const rawRounds = await getHistory();
    const rounds = normalizeRounds(rawRounds);

    if (rounds.length < CONFIG.MIN_ROUNDS) {
      displayNoSignal(
        "Historique insuffisant : " +
        rounds.length +
        " manches valides."
      );

      setText(
        "adaptationStatus",
        "COLLECTE DES DONNÉES"
      );

      setText(
        "adaptationDetails",
        "Minimum requis : " +
        CONFIG.MIN_ROUNDS +
        " manches valides."
      );

      return;
    }

    const latestTimestamp =
      rounds[rounds.length - 1].timestamp;

    const newRoundDetected =
      latestTimestamp &&
      latestTimestamp !== lastRoundTimestamp;

    if (newRoundDetected) {
      lastRoundTimestamp = latestTimestamp;
    }

    const result = adaptiveAnalysis(rounds);

    displayAdaptation(result);

    if (!result.valid) {
      displayNoSignal(result.reason);
      return;
    }

    displaySignal(result);

    estimatedNextTime = analyseTime(rounds);

    if (estimatedNextTime) {
      setText(
        "estimatedTime",
        formatTime(estimatedNextTime)
      );
      updateCountdown();
    } else {
      setText("estimatedTime", "--:--:--");
      setText("countdown", "--:--:--");
    }

  } catch (error) {
    console.error("Erreur d'analyse :", error);

    setText(
      "signalStatus",
      "ERREUR : " + error.message
    );

  } finally {
    analysisInProgress = false;
  }
}

/* =========================================
   DÉMARRAGE AUTOMATIQUE
========================================= */

function startBot() {
  if (refreshInterval) clearInterval(refreshInterval);
  if (countdownInterval) clearInterval(countdownInterval);

  runAnalysis();

  refreshInterval = setInterval(
    runAnalysis,
    CONFIG.REFRESH_MS
  );

  countdownInterval = setInterval(
    updateCountdown,
    CONFIG.COUNTDOWN_MS
  );
}

document.addEventListener("DOMContentLoaded", startBot);
