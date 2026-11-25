
"use strict";

/* =========================================
   AI CRASH SIGNAL BOT — LUCKY JET
   Signal minimal + délai de préparation
========================================= */

const CONFIG = {
  API: "https://ai-crash-signal-bot.onrender.com",
  HISTORY_LIMIT: 100,
  RECENT_WINDOW: 20,
  REFRESH_MS: 60000,
  MIN_PREPARATION_SECONDS: 60
};

const $ = id => document.getElementById(id);

let nextEstimatedTime = null;
let countdownTimer = null;
let refreshTimer = null;
let analysing = false;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
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

function showError(message) {
  $("coefficient").textContent = "Indisponible";
  $("range").textContent = "--";
  $("estimatedTime").textContent = "--:--:--";
  $("countdown").textContent = "Actualisation...";
  console.error("AI CRASH BOT :", message);
}

async function getData(endpoint) {
  const response = await fetch(CONFIG.API + endpoint, {
    headers: { "Accept": "application/json" },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Erreur HTTP " + response.status);
  }

  return response.json();
}

/* =========================================
   HISTORIQUE
========================================= */

function normalizeRounds(data) {
  if (!Array.isArray(data.rounds)) {
    throw new Error("Historique indisponible.");
  }

  return data.rounds
    .map(round => ({
      multiplier: Number(round.multiplier),
      timestamp: new Date(round.timestamp).getTime()
    }))
    .filter(round =>
      Number.isFinite(round.multiplier) &&
      round.multiplier > 0 &&
      Number.isFinite(round.timestamp)
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-CONFIG.HISTORY_LIMIT);
}

/* =========================================
   ANALYSE DU COEFFICIENT
========================================= */

function analyseCoefficient(rounds) {
  const recent = rounds
    .slice(-CONFIG.RECENT_WINDOW)
    .map(round => round.multiplier);

  if (recent.length < CONFIG.RECENT_WINDOW) {
    throw new Error("20 manches nécessaires.");
  }

  return {
    central: median(recent),
    low: quantile(recent, 0.25),
    high: quantile(recent, 0.75)
  };
}

/* =========================================
   ANALYSE TEMPORELLE
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

  const latestTimestamp =
    rounds[rounds.length - 1].timestamp;

  const minimumTime =
    Date.now() + CONFIG.MIN_PREPARATION_SECONDS * 1000;

  /*
    Projection du prochain créneau théorique.
    On conserve les intervalles historiques,
    mais on impose un minimum de 60 secondes
    à partir de la publication du signal.
  */

  let estimatedTime = latestTimestamp + typicalInterval * 1000;

  while (estimatedTime < minimumTime) {
    estimatedTime += typicalInterval * 1000;
  }

  return estimatedTime;
}

/* =========================================
   AFFICHAGE DU SIGNAL
========================================= */

function displaySignal(coefficient, estimatedTime) {
  $("coefficient").textContent =
    formatMultiplier(coefficient.central);

  $("range").textContent =
    formatMultiplier(coefficient.low) +
    " – " +
    formatMultiplier(coefficient.high);

  nextEstimatedTime = estimatedTime;

  updateCountdown();
}

/* =========================================
   COMPTE À REBOURS
========================================= */

function updateCountdown() {
  if (!nextEstimatedTime) return;

  $("estimatedTime").textContent =
    new Date(nextEstimatedTime).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });

  const remaining = Math.floor(
    (nextEstimatedTime - Date.now()) / 1000
  );

  if (remaining <= 0) {
    $("countdown").textContent = "Actualisation...";
    return;
  }

  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;

  $("countdown").textContent = [
    hours,
    minutes,
    seconds
  ].map(value => String(value).padStart(2, "0")).join(":");
}

/* =========================================
   ANALYSE PRINCIPALE
========================================= */

async function runAnalysis() {
  if (analysing) return;

  analysing = true;

  try {
    const history = await getData("/api/history");
    const rounds = normalizeRounds(history);

    if (rounds.length < CONFIG.RECENT_WINDOW) {
      throw new Error("Historique insuffisant.");
    }

    const coefficient = analyseCoefficient(rounds);
    const estimatedTime = analyseTime(rounds);

    displaySignal(coefficient, estimatedTime);

  } catch (error) {
    showError(error.message);

  } finally {
    analysing = false;
  }
}

/* =========================================
   INITIALISATION
========================================= */

function initialize() {
  runAnalysis();

  if (countdownTimer) clearInterval(countdownTimer);
  if (refreshTimer) clearInterval(refreshTimer);

  countdownTimer = setInterval(updateCountdown, 1000);
  refreshTimer = setInterval(runAnalysis, CONFIG.REFRESH_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
         }
