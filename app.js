
"use strict";

const CONFIG = {
  API: "https://ai-crash-signal-bot.onrender.com",
  HISTORY_LIMIT: 100,
  RECENT_WINDOW: 20,
  REFRESH_MS: 60000,
  COUNTDOWN_MS: 1000,
  MIN_COEFFICIENT: 2.00,
  MIN_PREPARATION_SECONDS: 60
};

const $ = id => document.getElementById(id);

let analysing = false;
let nextEstimatedTime = null;
let lastRoundTimestamp = null;
let refreshTimer = null;
let countdownTimer = null;

function median(values) {
  const sorted = [...values].sort((a,b) => a-b);
  const n = sorted.length;
  return n % 2
    ? sorted[Math.floor(n/2)]
    : (sorted[n/2-1] + sorted[n/2])/2;
}

function quantile(values, q) {
  const sorted = [...values].sort((a,b) => a-b);
  const p = (sorted.length-1)*q;
  const low = Math.floor(p);
  const high = Math.ceil(p);

  return sorted[low] +
    (sorted[high]-sorted[low])*(p-low);
}

function fmt(value) {
  return Number(value).toFixed(2) + "x";
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

async function getHistory() {
  const response = await fetch(
    CONFIG.API + "/api/history",
    {
      headers: {"Accept":"application/json"},
      cache:"no-store"
    }
  );

  if (!response.ok) {
    throw new Error("API indisponible : " + response.status);
  }

  return response.json();
}

function normalizeRounds(data) {
  if (!Array.isArray(data.rounds)) {
    throw new Error("Historique non disponible");
  }

  return data.rounds.map(round => ({
    multiplier: Number(round.multiplier),
    timestamp: new Date(round.timestamp).getTime()
  }))
  .filter(round =>
    Number.isFinite(round.multiplier) &&
    round.multiplier > 0 &&
    Number.isFinite(round.timestamp)
  )
  .sort((a,b) => a.timestamp-b.timestamp)
  .slice(-CONFIG.HISTORY_LIMIT);
}

/* =========================================
   FILTRE STATISTIQUE STRICT
========================================= */

function analyseStrict(rounds) {
  if (rounds.length < CONFIG.HISTORY_LIMIT) {
    return {
      valid:false,
      reason:"100 manches complètes nécessaires"
    };
  }

  const all = rounds.map(r => r.multiplier);
  const recent = all.slice(-CONFIG.RECENT_WINDOW);

  const median100 = median(all);
  const median20 = median(recent);

  const q25_100 = quantile(all,0.25);
  const q25_20 = quantile(recent,0.25);
  const q75_20 = quantile(recent,0.75);

  const conditions = [
    median100 >= CONFIG.MIN_COEFFICIENT,
    median20 >= CONFIG.MIN_COEFFICIENT,
    q25_100 >= CONFIG.MIN_COEFFICIENT,
    q25_20 >= CONFIG.MIN_COEFFICIENT
  ];

  const valid = conditions.every(Boolean);

  return {
    valid,
    central:median20,
    low:q25_20,
    high:q75_20,
    median100,
    q25_100,
    median20,
    q25_20
  };
}

/* =========================================
   ANALYSE TEMPORELLE
========================================= */

function estimateNextTime(rounds) {
  const intervals = [];

  for (let i=1; i<rounds.length; i++) {
    const seconds =
      (rounds[i].timestamp-rounds[i-1].timestamp)/1000;

    if (seconds >= 1 && seconds <= 600) {
      intervals.push(seconds);
    }
  }

  if (intervals.length < 5) {
    throw new Error("Intervalles temporels insuffisants");
  }

  const typicalInterval = median(intervals.slice(-20));
  const latest = rounds[rounds.length-1].timestamp;
  const now = Date.now();

  let estimate = latest + typicalInterval*1000;

  while (
    estimate < now + CONFIG.MIN_PREPARATION_SECONDS*1000
  ) {
    estimate += typicalInterval*1000;
  }

  return {
    time:estimate,
    latestTimestamp:latest
  };
}

/* =========================================
   AFFICHAGE SANS SIGNAL
========================================= */

function noSignal(reason) {
  nextEstimatedTime = null;
  lastRoundTimestamp = null;

  setText("coefficient","AUCUN SIGNAL");
  setText("range","--");
  setText("estimatedTime","--:--:--");
  setText("countdown","--:--");
  setText("signalStatus",reason);

  setText("nextCoefficient","AUCUN SIGNAL");
  setText("nextRange","--");
  setText("nextTime","--:--:--");
  setText("nextCountdown","--:--");
  setText("nextStatus","Les critères stricts de 2.00x ne sont pas réunis.");
}

/* =========================================
   AFFICHAGE DU SIGNAL
========================================= */

function displaySignal(stats, timing) {
  setText("coefficient",fmt(stats.central));
  setText("range",fmt(stats.low)+" – "+fmt(stats.high));

  setText("nextCoefficient",fmt(stats.central));
  setText("nextRange",fmt(stats.low)+" – "+fmt(stats.high));

  nextEstimatedTime = timing.time;
  lastRoundTimestamp = timing.latestTimestamp;

  setText(
    "signalStatus",
    "Tous les critères statistiques du filtre 2.00x sont satisfaits."
  );

  setText(
    "nextStatus",
    "Estimation expérimentale de la prochaine manche."
  );

  updateCountdown();
}

/* =========================================
   COMPTE À REBOURS
========================================= */

function updateOneCountdown(timeId,countdownId) {
  if (!nextEstimatedTime) return;

  const target = new Date(nextEstimatedTime);

  setText(timeId,target.toLocaleTimeString("fr-FR",{
    hour:"2-digit",
    minute:"2-digit",
    second:"2-digit",
    hour12:false
  }));

  const remaining = Math.max(
    0,
    Math.floor((nextEstimatedTime-Date.now())/1000)
  );

  const hours = Math.floor(remaining/3600);
  const minutes = Math.floor((remaining%3600)/60);
  const seconds = remaining%60;

  const value = [hours,minutes,seconds]
    .map(n=>String(n).padStart(2,"0"))
    .join(":");

  setText(countdownId,
    remaining === 0 ? "ÉCHÉANCE" : value
  );
}

function updateCountdown() {
  if (!nextEstimatedTime) return;

  updateOneCountdown("estimatedTime","countdown");
  updateOneCountdown("nextTime","nextCountdown");
}

/* =========================================
   ANALYSE PRINCIPALE
========================================= */

async function runAnalysis() {
  if (analysing) return;

  analysing = true;

  try {
    const data = await getHistory();
    const rounds = normalizeRounds(data);

    if (rounds.length < CONFIG.HISTORY_LIMIT) {
      noSignal("Historique insuffisant : 100 manches nécessaires.");
      return;
    }

    const stats = analyseStrict(rounds);

    if (!stats.valid) {
      noSignal(
        "AUCUN SIGNAL — filtre strict 2.00x non satisfait."
      );
      return;
    }

    const timing = estimateNextTime(rounds);

    /*
      Ne pas repousser l'heure à chaque actualisation
      si aucune nouvelle manche n'est arrivée.
    */
    if (
      lastRoundTimestamp === timing.latestTimestamp &&
      nextEstimatedTime &&
      nextEstimatedTime > Date.now()
    ) {
      displaySignal(stats,{
        time:nextEstimatedTime,
        latestTimestamp:timing.latestTimestamp
      });
    } else {
      displaySignal(stats,timing);
    }

  } catch(error) {
    noSignal("Données indisponibles : " + error.message);
    console.error(error);

  } finally {
    analysing = false;
  }
}

/* =========================================
   INITIALISATION
========================================= */

function initialize() {
  runAnalysis();

  if (refreshTimer) clearInterval(refreshTimer);
  if (countdownTimer) clearInterval(countdownTimer);

  refreshTimer = setInterval(
    runAnalysis,
    CONFIG.REFRESH_MS
  );

  countdownTimer = setInterval(
    updateCountdown,
    CONFIG.COUNTDOWN_MS
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded",initialize);
} else {
  initialize();
}
