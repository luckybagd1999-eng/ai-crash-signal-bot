
"use strict";

/* =========================================
   AI CRASH SIGNAL BOT
   LUCKY JET - ADAPTIVE INTELLIGENCE
========================================= */

const CONFIG = {
  API: "https://ai-crash-signal-bot.onrender.com",
  HISTORY_LIMIT: 100,
  REFRESH_MS: 60000,
  MIN_COEFFICIENT: 2.00,
  MIN_ROUNDS: 40,
  MIN_HITS: 2,
  MIN_PREPARATION_SECONDS: 60,
  REQUEST_TIMEOUT: 15000,
  WINDOWS: [10, 20, 30, 50, 100]
};

const $ = id => document.getElementById(id);

let analysing = false;
let nextEstimatedTime = null;
let lastRoundTimestamp = null;

/* =========================================
   OUTILS MATHÉMATIQUES
========================================= */

function median(values) {
  if (!values.length) return 0;

  const s = [...values].sort((a, b) => a - b);
  const n = s.length;

  return n % 2
    ? s[Math.floor(n / 2)]
    : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function quantile(values, q) {
  if (!values.length) return 0;

  const s = [...values].sort((a, b) => a - b);
  const p = (s.length - 1) * q;
  const low = Math.floor(p);
  const high = Math.ceil(p);

  return s[low] + (s[high] - s[low]) * (p - low);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;

  const mean = average(values);

  return Math.sqrt(
    average(values.map(v => (v - mean) ** 2))
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatMultiplier(value) {
  return Number(value).toFixed(2) + "x";
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

/* =========================================
   CONNEXION API
========================================= */

async function getHistory() {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    CONFIG.REQUEST_TIMEOUT
  );

  try {
    const response = await fetch(
      CONFIG.API + "/api/history",
      {
        method: "GET",
        headers: { "Accept": "application/json" },
        cache: "no-store",
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error("Erreur HTTP " + response.status);
    }

    const data = await response.json();

    if (!Array.isArray(data.rounds)) {
      throw new Error("Historique API invalide.");
    }

    return data;

  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Délai API dépassé.");
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}

/* =========================================
   NORMALISATION
========================================= */

function normalizeRounds(data) {
  return data.rounds
    .map(round => {
      const multiplierValue =
        round.multiplier ??
        round.coefficient ??
        round.crash_point ??
        round.crashPoint ??
        round.result ??
        round.value;

      const multiplier = Number(multiplierValue);

      const rawTimestamp =
        round.timestamp ??
        round.created_at ??
        round.createdAt ??
        round.date ??
        round.time;

      let timestamp = null;

      if (typeof rawTimestamp === "number") {
        timestamp = rawTimestamp;

        if (timestamp < 100000000000) {
          timestamp *= 1000;
        }
      } else if (rawTimestamp) {
        const parsed = Date.parse(rawTimestamp);
        if (Number.isFinite(parsed)) timestamp = parsed;
      }

      return { multiplier, timestamp };
    })
    .filter(r =>
      Number.isFinite(r.multiplier) &&
      r.multiplier >= 1
    )
    .sort((a, b) => {
      if (a.timestamp && b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      return 0;
    })
    .slice(-CONFIG.HISTORY_LIMIT);
}

/* =========================================
   DÉTECTION DES CHANGEMENTS
========================================= */

function analyseRegime(rounds) {
  const values = rounds.map(r => r.multiplier);

  const recent = values.slice(-20);
  const previous = values.slice(-40, -20);

  if (recent.length < 20 || previous.length < 20) {
    return {
      state: "DONNÉES INSUFFISANTES",
      details: "Comparaison des périodes indisponible.",
      strongChange: false
    };
  }

  const recentMedian = median(recent);
  const previousMedian = median(previous);

  const recentRate =
    recent.filter(v => v >= 2).length / recent.length;

  const previousRate =
    previous.filter(v => v >= 2).length / previous.length;

  const recentVolatility = standardDeviation(recent);
  const previousVolatility = standardDeviation(previous);

  const medianChange = Math.abs(
    recentMedian - previousMedian
  );

  const frequencyChange = Math.abs(
    recentRate - previousRate
  );

  const volatilityRatio = previousVolatility > 0
    ? recentVolatility / previousVolatility
    : 1;

  const strongChange =
    medianChange >= 0.75 ||
    frequencyChange >= 0.30 ||
    volatilityRatio >= 2.20 ||
    volatilityRatio <= 0.45;

  const moderateChange =
    medianChange >= 0.35 ||
    frequencyChange >= 0.20 ||
    volatilityRatio >= 1.60 ||
    volatilityRatio <= 0.65;

  let state = "STABLE";
  let details = "Distribution historique relativement stable.";

  if (strongChange) {
    state = "CHANGEMENT IMPORTANT";
    details = "Variation importante détectée. Analyse récente prioritaire.";
  } else if (moderateChange) {
    state = "CHANGEMENT DÉTECTÉ";
    details = "Variation statistique détectée. Fenêtres réévaluées.";
  }

  return {
    state,
    details,
    strongChange,
    recentRate,
    previousRate,
    medianChange,
    frequencyChange,
    volatilityRatio
  };
}

/* =========================================
   ÉVALUATION DES FENÊTRES
========================================= */

function evaluateWindow(rounds, size) {
  if (rounds.length < size) return null;

  const sample = rounds
    .slice(-size)
    .map(r => r.multiplier);

  // On étudie les manches ayant atteint au moins 2x.
  const successful = sample.filter(
    value => value >= CONFIG.MIN_COEFFICIENT
  );

  if (successful.length < CONFIG.MIN_HITS) {
    return null;
  }

  const central = median(successful);
  const low = quantile(successful, 0.25);
  const high = quantile(successful, 0.75);

  const hitRate = successful.length / sample.length;

  const deviation = standardDeviation(successful);

  const relativeSpread = central > 0
    ? (high - low) / central
    : 1;

  const stabilityScore = clamp(
    100 - relativeSpread * 100,
    0,
    100
  );

  const frequencyScore = hitRate * 100;

  const sampleQuality = size >= 50 ? 100 :
    size >= 30 ? 85 :
    size >= 20 ? 70 : 55;

  const score = Math.round(
    frequencyScore * 0.45 +
    stabilityScore * 0.40 +
    sampleQuality * 0.15
  );

  return {
    size,
    central,
    low,
    high,
    hitRate,
    successfulCount: successful.length,
    deviation,
    stabilityScore,
    score
  };
}

/* =========================================
   MOTEUR ADAPTATIF
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
      reason:
        "Aucune fenêtre ne contient au moins " +
        CONFIG.MIN_HITS +
        " manches ayant atteint 2.00x."
    };
  }

  // Priorité au score statistique.
  // En cas d'égalité, priorité à la fenêtre la plus large.
  evaluations.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return b.size - a.size;
  });

  const best = evaluations[0];

  let light = "RED";
  let lightLabel = "ROUGE — INSTABILITÉ STATISTIQUE";

  if (
    best.score >= 75 &&
    !regime.strongChange
  ) {
    light = "GREEN";
    lightLabel = "VERT — STABILITÉ HISTORIQUE";
  } else if (
    best.score >= 50 &&
    !regime.strongChange
  ) {
    light = "ORANGE";
    lightLabel = "ORANGE — STABILITÉ MODÉRÉE";
  }

  return {
    valid: true,
    central: best.central,
    low: best.low,
    high: best.high,
    score: best.score,
    hitRate: best.hitRate,
    successfulCount: best.successfulCount,
    windowSize: best.size,
    light,
    lightLabel,
    regime,
    evaluations
  };
}

/* =========================================
   FEUX LUMINEUX
========================================= */

function updateTrafficLight(light, label) {
  ["lightGreen", "lightOrange", "lightRed"].forEach(id => {
    const el = $(id);
    if (el) el.classList.remove("active");
  });

  const mapping = {
    GREEN: "lightGreen",
    ORANGE: "lightOrange",
    RED: "lightRed"
  };

  if (mapping[light]) {
    const selected = $(mapping[light]);
    if (selected) selected.classList.add("active");
  }

  setText("lightLabel", label);
}

/* =========================================
   ESTIMATION HORAIRE FACULTATIVE
========================================= */

function analyseTime(rounds) {
  const timedRounds = rounds
    .filter(r => Number.isFinite(r.timestamp));

  if (timedRounds.length < 6) {
    return null;
  }

  const intervals = [];

  for (let i = 1; i < timedRounds.length; i++) {
    const seconds = (
      timedRounds[i].timestamp -
      timedRounds[i - 1].timestamp
    ) / 1000;

    if (seconds >= 1 && seconds <= 600) {
      intervals.push(seconds);
    }
  }

  if (intervals.length < 5) {
    return null;
  }

  const typicalInterval = median(intervals.slice(-20));
  const latest = timedRounds[timedRounds.length - 1].timestamp;

  return {
    latestTimestamp: latest,
    time: Math.max(
      latest + typicalInterval * 1000,
      Date.now() + CONFIG.MIN_PREPARATION_SECONDS * 1000
    )
  };
}

/* =========================================
   AFFICHAGE SANS CANDIDAT
========================================= */

function displayNoSignal(reason) {
  nextEstimatedTime = null;
  lastRoundTimestamp = null;

  setText("coefficient", "AUCUN SIGNAL");
  setText("range", "--");
  setText("estimatedTime", "--:--:--");
  setText("countdown", "--:--:--");
  setText("signalStatus", reason);

  updateTrafficLight("NONE", "AUCUN CANDIDAT");
}

/* =========================================
   AFFICHAGE DU CANDIDAT
========================================= */

function displaySignal(stats, timing) {
  setText(
    "coefficient",
    formatMultiplier(stats.central)
  );

  setText(
    "range",
    formatMultiplier(stats.low) +
    " – " +
    formatMultiplier(stats.high)
  );

  setText(
    "signalStatus",
    "Analyse de " + stats.successfulCount +
    " manches ≥ 2.00x · Fenêtre " +
    stats.windowSize + " manches"
  );

  updateTrafficLight(
    stats.light,
    stats.lightLabel
  );

  if (timing) {
    if (
      lastRoundTimestamp === timing.latestTimestamp &&
      nextEstimatedTime &&
      nextEstimatedTime > Date.now()
    ) {
      timing.time = nextEstimatedTime;
    }

    nextEstimatedTime = timing.time;
    lastRoundTimestamp = timing.latestTimestamp;

    updateCountdown();
  } else {
    nextEstimatedTime = null;
    lastRoundTimestamp = null;
    setText("estimatedTime", "--:--:--");
    setText("countdown", "--:--:--");
  }
}

/* =========================================
   AFFICHAGE ADAPTATIF
========================================= */

function displayAdaptation(stats) {
  setText("adaptationStatus", stats.regime.state);

  let details = stats.regime.details;

  if (stats.valid) {
    details +=
      " Fenêtre retenue : " + stats.windowSize +
      " manches. Score descriptif : " +
      stats.score + "/100.";
  } else {
    details += " " + stats.reason;
  }

  setText("adaptationDetails", details);
}

/* =========================================
   COMPTE À REBOURS
========================================= */

function updateCountdown() {
  if (!nextEstimatedTime) return;

  const remaining = Math.max(
    0,
    Math.floor((nextEstimatedTime - Date.now()) / 1000)
  );

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;

  const countdown = [h, m, s]
    .map(v => String(v).padStart(2, "0"))
    .join(":");

  const time = new Date(nextEstimatedTime)
    .toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });

  setText("estimatedTime", time);
  setText(
    "countdown",
    remaining === 0 ? "ÉCHÉANCE" : countdown
  );
}

/* =========================================
   ANALYSE PRINCIPALE
========================================= */

async function runAnalysis() {
  if (analysing) return;

  analysing = true;

  try {
    setText("signalStatus", "RÉCUPÉRATION DES DONNÉES...");
    setText("adaptationStatus", "ANALYSE EN COURS");

    const data = await getHistory();
    const rounds = normalizeRounds(data);

    if (rounds.length < CONFIG.MIN_ROUNDS) {
      displayNoSignal(
        "Historique insuffisant : " +
        rounds.length + "/" +
        CONFIG.MIN_ROUNDS + " manches."
      );

      setText(
        "adaptationStatus",
        "DONNÉES INSUFFISANTES"
      );

      setText(
        "adaptationDetails",
        "Vérifie le nombre de manches retournées par l'API."
      );

      return;
    }

    const stats = adaptiveAnalysis(rounds);

    displayAdaptation(stats);

    if (!stats.valid) {
      displayNoSignal(stats.reason);

      console.log("Fenêtres analysées :", CONFIG.WINDOWS);
      console.log("Résultat :", stats);

      return;
    }

    // L'heure est facultative :
    // son absence ne bloque plus le signal.
    const timing = analyseTime(rounds);

    displaySignal(stats, timing);

    console.log("AI CRASH ADAPTIVE ANALYSIS", {
      totalManches: rounds.length,
      coefficientCentral: stats.central,
      fourchette: [stats.low, stats.high],
      scoreDescriptif: stats.score,
      feu: stats.light,
      fenetre: stats.windowSize,
      manchesSuperieuresA2: stats.successfulCount,
      tauxHistorique: stats.hitRate,
      evaluations: stats.evaluations
    });

  } catch (error) {
    console.error("AI CRASH BOT :", error);

    displayNoSignal("ERREUR : " + error.message);

    setText("adaptationStatus", "ERREUR");
    setText("adaptationDetails", error.message);

  } finally {
    analysing = false;
  }
}

/* =========================================
   INITIALISATION
========================================= */

function initialize() {
  console.log("AI CRASH ADAPTIVE INTELLIGENCE démarré.");

  runAnalysis();

  setInterval(updateCountdown, 1000);
  setInterval(runAnalysis, CONFIG.REFRESH_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
        }
     
