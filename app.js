
"use strict";

/* =========================================
   AI CRASH SIGNAL BOT
   Jeu : Lucky Jet
   API : GameData365 via Render
   Historique : 100 manches
   Analyse récente : 20 manches
   Modèle : statistique + temporel
========================================= */

const CONFIG = {
  API_BASE: "https://ai-crash-signal-bot.onrender.com",
  HISTORY_LIMIT: 100,
  RECENT_WINDOW: 20,
  REFRESH_INTERVAL: 60000,
  COUNTDOWN_INTERVAL: 1000
};

const $ = id => document.getElementById(id);

let countdownTimer = null;
let refreshTimer = null;
let nextEstimatedTime = null;

/* =========================================
   OUTILS MATHÉMATIQUES
========================================= */

function average(values) {
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : 0;
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

function stddev(values) {
  if (values.length < 2) return 0;

  const avg = average(values);

  return Math.sqrt(
    average(values.map(value => Math.pow(value - avg, 2)))
  );
}

function percentage(condition, values) {
  if (!values.length) return 0;

  return 100 *
    values.filter(condition).length / values.length;
}

function formatNumber(value, decimals = 2) {
  return Number(value).toFixed(decimals);
}

function formatMultiplier(value) {
  return formatNumber(value, 2) + "x";
}

/* =========================================
   CONNEXION API RENDER
========================================= */

async function request(endpoint) {
  const response = await fetch(CONFIG.API_BASE + endpoint, {
    method: "GET",
    headers: {
      "Accept": "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(
      "Erreur API : " + response.status
    );
  }

  return await response.json();
}

/* =========================================
   RÉCUPÉRATION DES DONNÉES
========================================= */

function getLiveGame(data) {
  const games = data.games || [];

  return games.find(game =>
    game.game_id === "lucky_jet"
  ) || games[0] || null;
}

function normalizeHistory(data) {
  const rounds = Array.isArray(data.rounds)
    ? data.rounds
    : [];

  return rounds
    .map(round => {
      const multiplier = Number(round.multiplier);

      const timestamp = new Date(
        round.timestamp
      ).getTime();

      if (
        !Number.isFinite(multiplier) ||
        multiplier <= 0 ||
        !Number.isFinite(timestamp)
      ) {
        return null;
      }

      return {
        multiplier,
        timestamp,
        round_id: round.round_id || ""
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-CONFIG.HISTORY_LIMIT);
}

/* =========================================
   ANALYSE STATISTIQUE
========================================= */

function analyseStatistics(rounds) {
  const values = rounds.map(round => round.multiplier);

  const recent = values.slice(-CONFIG.RECENT_WINDOW);
  const previous = values.slice(
    -CONFIG.RECENT_WINDOW * 2,
    -CONFIG.RECENT_WINDOW
  );

  const mean100 = average(values);
  const median100 = median(values);
  const volatility = stddev(values);

  const recentMean = average(recent);
  const recentMedian = median(recent);

  const q25 = quantile(recent, 0.25);
  const q75 = quantile(recent, 0.75);

  const under2 = percentage(
    value => value < 2,
    values
  );

  const over5 = percentage(
    value => value >= 5,
    values
  );

  const recentUnder2 = percentage(
    value => value < 2,
    recent
  );

  const recentOver5 = percentage(
    value => value >= 5,
    recent
  );

  const difference = previous.length
    ? recentMean - average(previous)
    : 0;

  return {
    values,
    recent,
    mean100,
    median100,
    volatility,
    recentMean,
    recentMedian,
    q25,
    q75,
    under2,
    over5,
    recentUnder2,
    recentOver5,
    difference
  };
}

/* =========================================
   ANALYSE TEMPORELLE
   Étude des intervalles entre les manches
========================================= */

function analyseTiming(rounds) {
  if (rounds.length < 3) {
    throw new Error(
      "Pas assez de données temporelles."
    );
  }

  const intervals = [];

  for (let i = 1; i < rounds.length; i++) {
    const difference =
      (rounds[i].timestamp - rounds[i - 1].timestamp) / 1000;

    // Écarter les intervalles aberrants
    if (difference >= 1 && difference <= 600) {
      intervals.push(difference);
    }
  }

  if (intervals.length < 3) {
    throw new Error(
      "Intervalles entre manches insuffisants."
    );
  }

  const recentIntervals = intervals.slice(-20);

  const typicalInterval = median(recentIntervals);

  const latestRound = rounds[rounds.length - 1];

  const estimatedTime =
    latestRound.timestamp + typicalInterval * 1000;

  return {
    intervals,
    recentIntervals,
    typicalInterval,
    estimatedTime,
    latestTimestamp: latestRound.timestamp
  };
}

/* =========================================
   AFFICHAGE DES STATISTIQUES
========================================= */

function displayStatistics(stats, rounds) {
  const set = (id, value) => {
    const element = $(id);
    if (element) element.textContent = value;
  };

  set("count", stats.values.length);
  set("mean", formatMultiplier(stats.mean100));
  set("median", formatMultiplier(stats.median100));
  set("volatility", formatNumber(stats.volatility, 2));

  set("under2", formatNumber(stats.under2, 1) + "%");
  set("over5", formatNumber(stats.over5, 1) + "%");

  set("recentMean", formatMultiplier(stats.recentMean));
  set("recentLow", formatNumber(stats.recentUnder2, 1) + "%");
  set("recentHigh", formatNumber(stats.recentOver5, 1) + "%");

  set(
    "difference",
    (stats.difference >= 0 ? "+" : "") +
    formatNumber(stats.difference, 2) + "x"
  );

  const interpretation = $("interpretation");

  if (interpretation) {
    interpretation.textContent =
      stats.difference > 0
        ? "La moyenne récente est supérieure à celle des 20 manches précédentes. Cela ne prouve pas un changement de probabilité."
        : stats.difference < 0
          ? "La moyenne récente est inférieure à celle des 20 manches précédentes. Cela ne prouve pas un changement de probabilité."
          : "Les moyennes récentes sont similaires.";
  }

  const feed = $("feed");

  if (feed) {
    feed.textContent = rounds
      .slice(-20)
      .reverse()
      .map(round => formatMultiplier(round.multiplier))
      .join(", ");
  }

  const results = $("results");

  if (results) {
    results.textContent =
      "Analyse terminée : " +
      rounds.length +
      " manches analysées.";
  }
}

/* =========================================
   AFFICHAGE DU SIGNAL COMBINÉ
========================================= */

function renderPrediction(stats, timing) {
  let panel = $("predictionPanel");

  if (!panel) {
    panel = document.createElement("section");
    panel.id = "predictionPanel";

    panel.style.cssText = `
      margin-top: 20px;
      padding: 20px;
      border: 1px solid rgba(100,150,255,.35);
      border-radius: 14px;
      background: rgba(20,35,65,.35);
      color: inherit;
      width: 100%;
      box-sizing: border-box;
    `;

    const anchor = $("diagnostic");

    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(panel, anchor);
    } else {
      document.body.appendChild(panel);
    }
  }

  panel.innerHTML = `
    <h2 style="margin-top:0">
      SIGNAL COMBINÉ — LUCKY JET
    </h2>

    <div style="
      display:grid;
      grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
      gap:14px;
    ">

      <div>
        <small>COEFFICIENT CENTRAL INDICATIF</small>
        <div style="font-size:28px;font-weight:bold">
          ${formatMultiplier(stats.recentMedian)}
        </div>
      </div>

      <div>
        <small>FOURCHETTE STATISTIQUE</small>
        <div style="font-size:22px;font-weight:bold">
          ${formatMultiplier(stats.q25)}
          –
          ${formatMultiplier(stats.q75)}
        </div>
      </div>

      <div>
        <small>HEURE ESTIMÉE</small>
        <div id="estimatedTime"
          style="font-size:28px;font-weight:bold">
          --:--:--
        </div>
      </div>

      <div>
        <small>TEMPS RESTANT ESTIMÉ</small>
        <div id="countdown"
          style="font-size:24px;font-weight:bold">
          Calcul...
        </div>
      </div>
    </div>

    <hr style="opacity:.2;margin:18px 0">

    <h3>INDICATEURS HISTORIQUES</h3>

    <p>
      Fréquence sous 2x :
      <strong>${formatNumber(stats.recentUnder2, 1)}%</strong>
    </p>

    <p>
      Fréquence à partir de 5x :
      <strong>${formatNumber(stats.recentOver5, 1)}%</strong>
    </p>

    <p>
      Intervalle médian entre les manches :
      <strong>${formatNumber(timing.typicalInterval, 1)} secondes</strong>
    </p>

    <p id="combinedStatus" style="font-weight:bold">
      Analyse temporelle et statistique effectuée.
    </p>

    <p style="font-size:12px;opacity:.7">
      Estimation descriptive basée sur l'historique.
      Elle ne prédit pas de manière fiable le prochain
      coefficient ni un moment favorable pour miser.
      Les manches d'un jeu aléatoire restent imprévisibles.
    </p>
  `;

  nextEstimatedTime = timing.estimatedTime;

  updateCountdown();
}

/* =========================================
   COMPTE À REBOURS
========================================= */

function updateCountdown() {
  if (!nextEstimatedTime) return;

  const timeElement = $("estimatedTime");
  const countdownElement = $("countdown");
  const statusElement = $("combinedStatus");

  const estimatedDate = new Date(nextEstimatedTime);

  if (timeElement) {
    timeElement.textContent =
      estimatedDate.toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      });
  }

  const remaining =
    Math.floor((nextEstimatedTime - Date.now()) / 1000);

  if (remaining <= 0) {
    if (countdownElement) {
      countdownElement.textContent = "Estimation dépassée";
    }

    if (statusElement) {
      statusElement.textContent =
        "Actualise les données pour recalculer l'estimation temporelle.";
    }

    return;
  }

  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;

  const formatted = [
    hours,
    minutes,
    seconds
  ].map(value => String(value).padStart(2, "0")).join(":");

  if (countdownElement) {
    countdownElement.textContent = formatted;
  }

  if (statusElement) {
    statusElement.textContent =
      "Heure théorique calculée à partir des intervalles historiques.";
  }
}

/* =========================================
   AFFICHAGE DU DIRECT
========================================= */

function displayLive(data) {
  const game = getLiveGame(data);

  if (!game || !game.latest) {
    throw new Error("Données du direct indisponibles.");
  }

  const liveElement = $("live");

  if (liveElement) {
    liveElement.textContent =
      formatMultiplier(Number(game.latest.multiplier));
  }

  const feed = $("status");

  if (feed) {
    feed.textContent = game.stale
      ? "DONNÉES POTENTIELLEMENT ANCIENNES"
      : "CONNEXION API : EN DIRECT";
  }
}

/* =========================================
   DIAGNOSTIC
========================================= */

function displayDiagnostic(stats, timing) {
  const diagnostic = $("diagnostic");

  if (!diagnostic) return;

  diagnostic.textContent =
    "Échantillon : " + stats.values.length +
    " manches. Médiane historique : " +
    formatMultiplier(stats.median100) +
    ". Fréquence sous 2x : " +
    formatNumber(stats.under2, 1) +
    "%. Intervalle médian : " +
    formatNumber(timing.typicalInterval, 1) +
    " secondes. Ces données décrivent l'historique et ne démontrent pas un pouvoir prédictif.";
}

/* =========================================
   ANALYSE PRINCIPALE
========================================= */

async function runAnalysis() {
  const button = $("analyze");

  if (button) {
    button.disabled = true;
    button.textContent = "ANALYSE EN COURS...";
  }

  const status = $("status");

  if (status) {
    status.textContent = "Récupération des données...";
  }

  try {
    const [liveData, historyData] = await Promise.all([
      request("/api/live"),
      request("/api/history")
    ]);

    const rounds = normalizeHistory(historyData);

    if (rounds.length < CONFIG.RECENT_WINDOW) {
      throw new Error(
        "Historique insuffisant : 20 manches minimum nécessaires."
      );
    }

    const stats = analyseStatistics(rounds);
    const timing = analyseTiming(rounds);

    displayLive(liveData);
    displayStatistics(stats, rounds);
    renderPrediction(stats, timing);
    displayDiagnostic(stats, timing);

    if (status) {
      status.textContent = "ANALYSE TERMINÉE";
    }

  } catch (error) {
    console.error("Erreur AI CRASH BOT :", error);

    if (status) {
      status.textContent = "ERREUR : " + error.message;
    }

    const results = $("results");

    if (results) {
      results.textContent = error.message;
    }

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "LANCER L'ANALYSE";
    }
  }
}

/* =========================================
   INITIALISATION
========================================= */

function initializeBot() {
  const button = $("analyze");

  if (button) {
    button.addEventListener("click", runAnalysis);
  }

  if (countdownTimer) {
    clearInterval(countdownTimer);
  }

  countdownTimer = setInterval(
    updateCountdown,
    CONFIG.COUNTDOWN_INTERVAL
  );

  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(
    runAnalysis,
    CONFIG.REFRESH_INTERVAL
  );

  runAnalysis();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeBot
  );
} else {
  initializeBot();
}
