
"use strict";

/* =========================================
   AI CRASH SIGNAL BOT
   Jeu : Lucky Jet
   API : GameData365 via Render
========================================= */

const CONFIG = {
  API: "https://ai-crash-signal-bot.onrender.com",
  HISTORY_LIMIT: 100,
  RECENT_WINDOW: 20,
  REFRESH_MS: 60000,
  MIN_COEFFICIENT: 2.00,
  MIN_PREPARATION_SECONDS: 60
};

const $ = id => document.getElementById(id);

let analysing = false;
let nextEstimatedTime = null;
let lastRoundTimestamp = null;

/* =========================================
   OUTILS MATHÉMATIQUES
========================================= */

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  return n % 2
    ? sorted[Math.floor(n / 2)]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);

  return sorted[low] +
    (sorted[high] - sorted[low]) * (position - low);
}

function formatMultiplier(value) {
  return Number(value).toFixed(2) + "x";
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

/* =========================================
   CONNEXION API
========================================= */

async function getHistory() {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 15000);

  try {
    const response = await fetch(
      CONFIG.API + "/api/history",
      {
        method: "GET",
        headers: {
          "Accept": "application/json"
        },
        cache: "no-store",
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error("Erreur HTTP " + response.status);
    }

    const data = await response.json();

    if (!Array.isArray(data.rounds)) {
      throw new Error("Historique absent de la réponse API.");
    }

    return data;

  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Délai dépassé : Render ne répond pas.");
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}

/* =========================================
   NORMALISATION DES MANCHES
========================================= */

function normalizeRounds(data) {
  return data.rounds
    .map(round => {
      let timestamp;

      if (typeof round.timestamp === "number") {
        timestamp = round.timestamp;

        if (timestamp < 100000000000) {
          timestamp *= 1000;
        }
      } else {
        timestamp = new Date(round.timestamp).getTime();
      }

      return {
        multiplier: Number(round.multiplier),
        timestamp
      };
    })
    .filter(round =>
      Number.isFinite(round.multiplier) &&
      round.multiplier > 0 &&
      Number.isFinite(round.timestamp)
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-CONFIG.HISTORY_LIMIT);
}

/* =========================================
   ANALYSE STATISTIQUE RENFORCÉE
========================================= */

function analyseStrict(rounds) {
  if (rounds.length < CONFIG.HISTORY_LIMIT) {
    return {
      valid: false,
      reason: "Historique insuffisant : 100 manches nécessaires."
    };
  }

  const all = rounds.map(r => r.multiplier);
  const recent = all.slice(-20);
  const previous = all.slice(-40, -20);

  const central = median(recent);
  const low = quantile(recent, 0.25);
  const high = quantile(recent, 0.75);

  const countAbove2 = recent.filter(
    value => value >= CONFIG.MIN_COEFFICIENT
  ).length;

  const countAbove2All = all.filter(
    value => value >= CONFIG.MIN_COEFFICIENT
  ).length;

  const previousMedian = median(previous);

  const condition1 = central >= CONFIG.MIN_COEFFICIENT;
  const condition2 = countAbove2 >= 8;
  const condition3 = countAbove2All >= 30;
  const condition4 = previousMedian >= 1.50;

  const valid =
    condition1 &&
    (condition2 || condition3) &&
    condition4;

  return {
    valid,
    central,
    low,
    high,
    countAbove2,
    countAbove2All,
    previousMedian
  };
}

/* =========================================
   ESTIMATION TEMPORELLE INDICATIVE
========================================= */

function analyseTime(rounds) {
  const intervals = [];

  for (let i = 1; i < rounds.length; i++) {
    const seconds =
      (rounds[i].timestamp - rounds[i - 1].timestamp) / 1000;

    if (seconds >= 1 && seconds <= 600) {
      intervals.push(seconds);
    }
  }

  if (intervals.length < 5) {
    throw new Error("Données temporelles insuffisantes.");
  }

  const typicalInterval = median(intervals.slice(-20));
  const latestTimestamp = rounds[rounds.length - 1].timestamp;

  const estimatedTime = Math.max(
    latestTimestamp + typicalInterval * 1000,
    Date.now() + CONFIG.MIN_PREPARATION_SECONDS * 1000
  );

  return {
    time: estimatedTime,
    latestTimestamp
  };
}

/* =========================================
   AFFICHAGE SANS SIGNAL
========================================= */

function displayNoSignal(reason) {
  nextEstimatedTime = null;
  lastRoundTimestamp = null;

  setText("coefficient", "AUCUN SIGNAL");
  setText("range", "--");
  setText("estimatedTime", "--:--:--");
  setText("countdown", "--:--");
  setText("signalStatus", reason);

  setText("nextCoefficient", "EN ATTENTE");
  setText("nextRange", "--");
  setText("nextTime", "--:--:--");
  setText("nextCountdown", "--:--");
  setText("nextStatus", "Aucune configuration retenue.");
}

/* =========================================
   AFFICHAGE DU SIGNAL
========================================= */

function displaySignal(stats, timing) {
  setText("coefficient", formatMultiplier(stats.central));

  setText(
    "range",
    formatMultiplier(stats.low) +
    " – " +
    formatMultiplier(stats.high)
  );

  setText("nextCoefficient", formatMultiplier(stats.central));

  setText(
    "nextRange",
    formatMultiplier(stats.low) +
    " – " +
    formatMultiplier(stats.high)
  );

  nextEstimatedTime = timing.time;
  lastRoundTimestamp = timing.latestTimestamp;

  setText(
    "signalStatus",
    "Candidat statistique détecté · Référence ≥ 2.00x"
  );

  setText(
    "nextStatus",
    "Estimation expérimentale, non garantie."
  );

  updateCountdown();
}

/* =========================================
   COMPTE À REBOURS
========================================= */

function formatRemaining(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return [hours, minutes, secs]
    .map(value => String(value).padStart(2, "0"))
    .join(":");
}

function updateCountdown() {
  if (!nextEstimatedTime) return;

  const remaining = Math.max(
    0,
    Math.floor((nextEstimatedTime - Date.now()) / 1000)
  );

  const time = new Date(nextEstimatedTime).toLocaleTimeString(
    "fr-FR",
    {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }
  );

  setText("estimatedTime", time);
  setText("nextTime", time);

  const countdown = remaining === 0
    ? "ÉCHÉANCE"
    : formatRemaining(remaining);

  setText("countdown", countdown);
  setText("nextCountdown", countdown);
}

/* =========================================
   ANALYSE PRINCIPALE
========================================= */

async function runAnalysis() {
  if (analysing) return;

  analysing = true;

  try {
    setText("signalStatus", "Récupération des données...");
    setText("nextStatus", "Analyse des 100 dernières manches...");

    const data = await getHistory();
    const rounds = normalizeRounds(data);

    if (rounds.length < CONFIG.HISTORY_LIMIT) {
      displayNoSignal(
        "Historique insuffisant : " +
        rounds.length +
        "/100 manches."
      );
      return;
    }

    const stats = analyseStrict(rounds);

    if (!stats.valid) {
      displayNoSignal(
        "Aucun candidat : filtre statistique non satisfait."
      );
      console.log("Critères analysés :", stats);
      return;
    }

    const timing = analyseTime(rounds);

    if (
      lastRoundTimestamp === timing.latestTimestamp &&
      nextEstimatedTime &&
      nextEstimatedTime > Date.now()
    ) {
      timing.time = nextEstimatedTime;
    }

    displaySignal(stats, timing);

    console.log("ANALYSE TERMINÉE", {
      nombreManches: rounds.length,
      mediane20: stats.central,
      quartile25: stats.low,
      quartile75: stats.high,
      manchesSuperieures2x: stats.countAbove2,
      totalSuperieures2x: stats.countAbove2All,
      medianePrecedente: stats.previousMedian
    });

  } catch (error) {
    console.error("ERREUR AI CRASH BOT :", error);
    displayNoSignal("ERREUR : " + error.message);

  } finally {
    analysing = false;
  }
}

/* =========================================
   INITIALISATION
========================================= */

function initialize() {
  console.log("AI CRASH SIGNAL BOT démarré.");

  runAnalysis();

  setInterval(updateCountdown, 1000);
  setInterval(runAnalysis, CONFIG.REFRESH_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
