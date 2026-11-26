
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
  MIN_PREPARATION_SECONDS: 60,
  REQUEST_TIMEOUT: 15000
};

const $ = id => document.getElementById(id);

let analysing = false;
let nextEstimatedTime = null;
let lastRoundTimestamp = null;

/* =========================================
   OUTILS MATHÉMATIQUES
========================================= */

function median(values) {
  const s = [...values].sort((a,b) => a-b);
  const n = s.length;

  return n % 2
    ? s[Math.floor(n/2)]
    : (s[n/2-1]+s[n/2])/2;
}

function quantile(values,q) {
  const s = [...values].sort((a,b) => a-b);
  const p = (s.length-1)*q;
  const low = Math.floor(p);
  const high = Math.ceil(p);

  return s[low]+(s[high]-s[low])*(p-low);
}

function average(values) {
  return values.reduce((a,b)=>a+b,0)/values.length;
}

function standardDeviation(values) {
  const mean = average(values);
  return Math.sqrt(
    average(values.map(v=>(v-mean)**2))
  );
}

function formatMultiplier(value) {
  return Number(value).toFixed(2)+"x";
}

function setText(id,value) {
  const el = $(id);
  if(el) el.textContent = value;
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
      CONFIG.API+"/api/history",
      {
        method:"GET",
        headers:{"Accept":"application/json"},
        cache:"no-store",
        signal:controller.signal
      }
    );

    if(!response.ok) {
      throw new Error("Erreur HTTP "+response.status);
    }

    const data = await response.json();

    if(!Array.isArray(data.rounds)) {
      throw new Error("Historique API invalide.");
    }

    return data;

  } catch(error) {
    if(error.name==="AbortError") {
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
      let timestamp;

      if(typeof round.timestamp==="number") {
        timestamp=round.timestamp;

        if(timestamp<100000000000) {
          timestamp*=1000;
        }
      } else {
        timestamp=new Date(round.timestamp).getTime();
      }

      return {
        multiplier:Number(round.multiplier),
        timestamp
      };
    })
    .filter(r =>
      Number.isFinite(r.multiplier) &&
      r.multiplier>0 &&
      Number.isFinite(r.timestamp)
    )
    .sort((a,b)=>a.timestamp-b.timestamp)
    .slice(-CONFIG.HISTORY_LIMIT);
}

/* =========================================
   DÉTECTION DES CHANGEMENTS STATISTIQUES
========================================= */

function analyseRegime(rounds) {
  const values=rounds.map(r=>r.multiplier);

  const recent=values.slice(-20);
  const previous=values.slice(-40,-20);

  if(recent.length<20 || previous.length<20) {
    throw new Error("40 manches nécessaires pour comparer les périodes.");
  }

  const recentMedian=median(recent);
  const previousMedian=median(previous);

  const recentRate=recent.filter(
    v=>v>=CONFIG.MIN_COEFFICIENT
  ).length/20;

  const previousRate=previous.filter(
    v=>v>=CONFIG.MIN_COEFFICIENT
  ).length/20;

  const recentVolatility=standardDeviation(recent);
  const previousVolatility=standardDeviation(previous);

  const medianChange=Math.abs(
    recentMedian-previousMedian
  );

  const frequencyChange=Math.abs(
    recentRate-previousRate
  );

  const volatilityRatio =
    previousVolatility>0
      ? recentVolatility/previousVolatility
      : 1;

  const strongChange =
    medianChange>=0.75 ||
    frequencyChange>=0.30 ||
    volatilityRatio>=2.20 ||
    volatilityRatio<=0.45;

  const moderateChange =
    medianChange>=0.35 ||
    frequencyChange>=0.20 ||
    volatilityRatio>=1.60 ||
    volatilityRatio<=0.65;

  let state="STABLE";
  let details="Comportement statistique relativement stable.";

  if(strongChange) {
    state="CHANGEMENT IMPORTANT";
    details="Variation importante détectée. Analyse récente prioritaire.";
  } else if(moderateChange) {
    state="CHANGEMENT DÉTECTÉ";
    details="Variation statistique détectée. Paramètres réévalués.";
  }

  return {
    state,
    details,
    recentMedian,
    previousMedian,
    recentRate,
    previousRate,
    recentVolatility,
    previousVolatility,
    medianChange,
    frequencyChange,
    volatilityRatio,
    strongChange,
    moderateChange
  };
}

/* =========================================
   MOTEUR ADAPTATIF
========================================= */

function adaptiveAnalysis(rounds) {
  const regime=analyseRegime(rounds);
  const values=rounds.map(r=>r.multiplier);

  /*
    En période stable : fenêtre de 30 manches.
    En cas de changement : fenêtre récente de 20 manches.
  */

  const windowSize=regime.state==="STABLE"?30:20;
  const sample=values.slice(-windowSize);

  const central=median(sample);
  const low=quantile(sample,0.25);
  const high=quantile(sample,0.75);

  const countAbove2=sample.filter(
    v=>v>=CONFIG.MIN_COEFFICIENT
  ).length;

  const hitRate=countAbove2/sample.length;

  /*
    Score descriptif de stabilité.
    Ce score n'est pas une probabilité de gain.
  */

  const stabilityScore=Math.max(
    0,
    25-Math.min(25,regime.medianChange*15)
      -Math.min(10,regime.frequencyChange*30)
      -Math.min(10,Math.abs(Math.log(
        Math.max(regime.volatilityRatio,0.01)
      ))*8)
  );

  const frequencyScore=hitRate*60;

  const levelScore=Math.min(
    15,
    Math.max(0,(central-2)*10+5)
  );

  const score=Math.round(
    frequencyScore+stabilityScore+levelScore
  );

  const valid=
    central>=CONFIG.MIN_COEFFICIENT;

  let light="NONE";
  let lightLabel="AUCUN CANDIDAT";

  if(valid) {
    if(score>=80 && !regime.strongChange) {
      light="GREEN";
      lightLabel="VERT — STABILITÉ ÉLEVÉE";
    } else if(score>=60 && !regime.strongChange) {
      light="ORANGE";
      lightLabel="ORANGE — STABILITÉ MODÉRÉE";
    } else {
      light="RED";
      lightLabel="ROUGE — RISQUE STATISTIQUE ÉLEVÉ";
    }
  }

  return {
    valid,
    central,
    low,
    high,
    score,
    hitRate,
    windowSize,
    light,
    lightLabel,
    regime
  };
}

/* =========================================
   FEU LUMINEUX
========================================= */

function updateTrafficLight(light,label) {
  ["lightGreen","lightOrange","lightRed"].forEach(id=>{
    const el=$(id);
    if(el) el.classList.remove("active");
  });

  const mapping={
    GREEN:"lightGreen",
    ORANGE:"lightOrange",
    RED:"lightRed"
  };

  if(mapping[light]) {
    $(mapping[light]).classList.add("active");
  }

  setText("lightLabel",label);
}

/* =========================================
   ESTIMATION HORAIRE INDICATIVE
========================================= */

function analyseTime(rounds) {
  const intervals=[];

  for(let i=1;i<rounds.length;i++) {
    const seconds=(
      rounds[i].timestamp-rounds[i-1].timestamp
    )/1000;

    if(seconds>=1 && seconds<=600) {
      intervals.push(seconds);
    }
  }

  if(intervals.length<5) {
    throw new Error("Données temporelles insuffisantes.");
  }

  const typicalInterval=median(intervals.slice(-20));
  const latest=rounds[rounds.length-1].timestamp;

  return {
    latestTimestamp:latest,
    time:Date.now()+
      Math.max(
        CONFIG.MIN_PREPARATION_SECONDS,
        typicalInterval
      )*1000
  };
}

/* =========================================
   AFFICHAGE SANS CANDIDAT
========================================= */

function displayNoSignal(reason) {
  nextEstimatedTime=null;
  lastRoundTimestamp=null;

  setText("coefficient","AUCUN SIGNAL");
  setText("range","--");
  setText("estimatedTime","--:--:--");
  setText("countdown","--:--:--");

  setText("signalStatus",reason);

  updateTrafficLight("NONE","AUCUN CANDIDAT");
}

/* =========================================
   AFFICHAGE DU CANDIDAT
========================================= */

function displaySignal(stats,timing) {
  setText("coefficient",formatMultiplier(stats.central));

  setText(
    "range",
    formatMultiplier(stats.low)+" – "+
    formatMultiplier(stats.high)
  );

  setText(
    "signalStatus",
    "Candidat statistique détecté · Fenêtre "+
    stats.windowSize+" manches"
  );

  updateTrafficLight(
    stats.light,
    stats.lightLabel
  );

  nextEstimatedTime=timing.time;
  lastRoundTimestamp=timing.latestTimestamp;

  updateCountdown();
}

/* =========================================
   AFFICHAGE DE L'ADAPTATION
========================================= */

function displayAdaptation(regime) {
  setText("adaptationStatus",regime.state);
  setText("adaptationDetails",regime.details);
}

/* =========================================
   COMPTE À REBOURS
========================================= */

function updateCountdown() {
  if(!nextEstimatedTime) return;

  const remaining=Math.max(
    0,
    Math.floor((nextEstimatedTime-Date.now())/1000)
  );

  const time=new Date(nextEstimatedTime)
    .toLocaleTimeString("fr-FR",{
      hour:"2-digit",
      minute:"2-digit",
      second:"2-digit",
      hour12:false
    });

  const h=Math.floor(remaining/3600);
  const m=Math.floor((remaining%3600)/60);
  const s=remaining%60;

  const countdown=[h,m,s]
    .map(v=>String(v).padStart(2,"0"))
    .join(":");

  setText("estimatedTime",time);
  setText("countdown",remaining===0?"ÉCHÉANCE":countdown);
}

/* =========================================
   ANALYSE PRINCIPALE
========================================= */

async function runAnalysis() {
  if(analysing) return;

  analysing=true;

  try {
    setText("signalStatus","Récupération des données...");
    setText("adaptationStatus","ANALYSE EN COURS");

    const data=await getHistory();
    const rounds=normalizeRounds(data);

    if(rounds.length<40) {
      displayNoSignal(
        "Historique insuffisant : "+
        rounds.length+"/40 manches."
      );

      setText(
        "adaptationStatus",
        "DONNÉES INSUFFISANTES"
      );

      return;
    }

    const stats=adaptiveAnalysis(rounds);

    displayAdaptation(stats.regime);

    if(!stats.valid) {
      displayNoSignal(
        "Aucun candidat : coefficient central inférieur à 2.00x."
      );

      console.log("Analyse adaptative :",stats);
      return;
    }

    const timing=analyseTime(rounds);

    /*
      Garder le même horaire tant qu'aucune
      nouvelle manche n'est arrivée.
    */

    if(
      lastRoundTimestamp===timing.latestTimestamp &&
      nextEstimatedTime &&
      nextEstimatedTime>Date.now()
    ) {
      timing.time=nextEstimatedTime;
    }

    displaySignal(stats,timing);

    console.log("AI CRASH ADAPTIVE ANALYSIS",{
      manches:rounds.length,
      coefficientCentral:stats.central,
      fourchetteBasse:stats.low,
      fourchetteHaute:stats.high,
      scoreDescriptif:stats.score,
      feu:stats.light,
      adaptation:stats.regime.state,
      fenetreUtilisee:stats.windowSize
    });

  } catch(error) {
    console.error("AI CRASH BOT :",error);

    displayNoSignal("ERREUR : "+error.message);

    setText("adaptationStatus","CONNEXION / ANALYSE");
    setText("adaptationDetails",error.message);

  } finally {
    analysing=false;
  }
}

/* =========================================
   INITIALISATION
========================================= */

function initialize() {
  console.log("AI CRASH ADAPTIVE INTELLIGENCE démarré.");

  runAnalysis();

  setInterval(updateCountdown,1000);
  setInterval(runAnalysis,CONFIG.REFRESH_MS);
}

if(document.readyState==="loading") {
  document.addEventListener("DOMContentLoaded",initialize);
} else {
  initialize();
     }
     
