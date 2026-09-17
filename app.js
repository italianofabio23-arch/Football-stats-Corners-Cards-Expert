"use strict";

// ==========================================
// FOOTBALL STATS V5 EXPERT
// BLOCCO 1 - Configurazione e controlli pagina
// ==========================================

const searchBtn = document.getElementById("searchBtn");
const resultsContainer = document.getElementById("resultsContainer");
const resultsInfo = document.getElementById("resultsInfo");
const matchesCount = document.getElementById("matchesCount");

const presetButtons = document.querySelectorAll(".preset");
const windowButtons = document.querySelectorAll(".window-btn");
const leagueCheckboxes = document.querySelectorAll(
  '.league-grid input[type="checkbox"]'
);

let selectedStrategy = "Corner";
let selectedDays = 1;
// ======================================================
// STORICO AUTOMATICO CORNER & CARDS
// ======================================================

const HISTORY_STORAGE_KEY = "corner_cards_prediction_history_v1";

function loadPredictionHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed
      : [];
  } catch (error) {
    console.warn(
      "Errore lettura storico:",
      error
    );

    return [];
  }
}

function savePredictionHistory(history) {
  try {
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify(history)
    );
  } catch (error) {
    console.warn(
      "Errore salvataggio storico:",
      error
    );
  }
}

function getBestHistoryMarket(markets) {
  if (!Array.isArray(markets) || !markets.length) {
    return null;
  }

  return markets
    .filter(
      (market) =>
        Number.isFinite(Number(market?.percent)) &&
        Number.isFinite(Number(market?.line))
    )
    .sort(
      (a, b) =>
        Number(b.percent) -
        Number(a.percent)
    )[0] || null;
}
function recordPredictionHistory(match) {
  const prediction = match?.cornerCardPrediction;

  if (!prediction) {
    return;
  }

  const history = loadPredictionHistory();

  const fixtureId =
    match?.raw?.fixture?.id ??
    match?.fixture?.id ??
    match?.id ??
    null;

  const baseData = {
    fixtureId,
    home: match?.home || "",
    away: match?.away || "",
    league: match?.league || "",
    date: match?.date || "",
    sampleSize: Number(prediction?.sampleSize) || 0,
    status: "pending"
  };

  const selections = [
    {
      type: "corner",
      market: getBestHistoryMarket(
        prediction?.corners?.markets?.markets
      ),
      confidence: Number(
        match?.cornerCardConfidence?.corner
      ) || 0
    },
    {
      type: "cards",
      market: getBestHistoryMarket(
        prediction?.yellowCards?.markets?.markets
      ),
      confidence: Number(
        match?.cornerCardConfidence?.cards
      ) || 0
    }
  ];

  for (const selection of selections) {
    if (!selection.market) {
      continue;
    }

    const line = Number(selection.market.line);
const probability = Number(selection.market.percent);

const uniqueId =
  `${fixtureId || `${baseData.date}-${baseData.home}-${baseData.away}`}` +
  `-${selection.type}-${line}`;

const existingIndex = history.findIndex(
  (item) => item.id === uniqueId
);

const item = {
  ...baseData,
  id: uniqueId,
  type: selection.type,
  line,
  probability,
  confidence: selection.confidence,
  updatedAt: new Date().toISOString()
};

if (existingIndex >= 0) {
  history[existingIndex] = {
    ...history[existingIndex],
    ...item
  };
} else {
  history.push({
    ...item,
    createdAt: new Date().toISOString(),
    result: null,
    won: null
  });
}
}

savePredictionHistory(history);
}
async function updatePredictionHistoryResults() {
  const history = loadPredictionHistory();

  if (!history.length) {
    return;
  }

  let changed = false;

  for (const item of history) {
    if (
      item.status === "settled" ||
      !item.fixtureId
    ) {
      continue;
    }

    try {
      const fixtureResponse = await fetch(
        `${BACKEND}/api/football?path=/fixtures&fixture=${item.fixtureId}`,
        { cache: "no-store" }
      );

      if (!fixtureResponse.ok) {
        continue;
      }

      const fixtureData = await fixtureResponse.json();
      const fixture = fixtureData?.response?.[0];

      const status =
        fixture?.fixture?.status?.short || "";

      // Valutiamo solamente partite terminate
if (!["FT", "AET", "PEN"].includes(status)) {
  continue;
}

const statisticsResponse = await fetch(
  `${BACKEND}/api/football?path=/fixtures/statistics&fixture=${item.fixtureId}`,
  { cache: "no-store" }
);

if (!statisticsResponse.ok) {
  continue;
}

const statisticsData = await statisticsResponse.json();

const rows = Array.isArray(statisticsData?.response)
  ? statisticsData.response
  : [];

if (!rows.length) {
  continue;
}

const statName =
  item.type === "corner"
    ? "Corner Kicks"
    : "Yellow Cards";

const finalValue = rows.reduce(
  (total, row) =>
    total + Number(getFixtureStat(row, statName) || 0),
  0
);

item.result = finalValue;
item.won = finalValue > Number(item.line);
item.status = "settled";
item.settledAt = new Date().toISOString();

changed = true;

} catch (error) {
  console.warn(
    "Errore aggiornamento storico:",
    item.fixtureId,
    error
  );
}
}

if (changed) {
  savePredictionHistory(history);
}
}
// Selezione strategia
presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    presetButtons.forEach((btn) => {
      btn.classList.remove("active");
    });

    button.classList.add("active");
    selectedStrategy = button.textContent.trim();
  });
});

// Selezione finestra temporale
windowButtons.forEach((button) => {
  button.addEventListener("click", () => {
    windowButtons.forEach((btn) => {
      btn.classList.remove("active");
    });

    button.classList.add("active");
    selectedDays = Number(button.dataset.days) || 1;
  });
});
// Avvia la ricerca quando premi "Cerca partite"
searchBtn.addEventListener("click", async () => {
  showLoading();

  try {
    const selectedLeagues = getSelectedLeagues();

    if (!selectedLeagues.length) {
      showEmpty("Seleziona almeno un campionato.");
      return;
    }

    const games = await fetchAllFixtures();
    const filteredGames = filterSelectedLeagues(games);
    const normalizedMatches = normalizeFixtures(filteredGames);

    await renderMatches(normalizedMatches);

  } catch (error) {
    console.error("Errore ricerca partite:", error);

    showError(
      error?.message || "Errore durante il caricamento delle partite."
    );

  } finally {
    stopLoading();
  }
});
// Restituisce i campionati selezionati
function getSelectedLeagues() {
  return [...leagueCheckboxes]
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.value);
}

// Conversione sicura in numero
function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
                          }
// ======================================
// ANTI FALSE TOP - CONTROLLO STORICO
// ======================================

function getHistoricalMarketStats(type, line, league = "") {
  const history = loadPredictionHistory();

  const lineValue = Number(line);

  const normalizedLeague =
    String(league || "").trim().toLowerCase();

  const getTime = (item) => {
    const value =
      item?.settledAt ||
      item?.updatedAt ||
      item?.createdAt ||
      item?.date ||
      0;

    const time = new Date(value).getTime();

    return Number.isFinite(time) ? time : 0;
  };

  const allSettled = history
    .filter((item) => {
      return (
        item.status === "settled" &&
        item.type === type &&
        Math.abs(Number(item.line) - lineValue) < 0.001 &&
        typeof item.won === "boolean"
      );
    })
    .sort((a, b) => getTime(b) - getTime(a));

  const leagueSettled = normalizedLeague
    ? allSettled.filter(
        (item) =>
          String(item.league || "")
            .trim()
            .toLowerCase() === normalizedLeague
      )
    : [];

  // Usa lo storico del campionato quando abbiamo
  // almeno 5 esiti; altrimenti usa lo storico globale.
  const useLeagueHistory =
    leagueSettled.length >= 5;

  const settled = useLeagueHistory
    ? leagueSettled
    : allSettled;

  const total = settled.length;

  const wins = settled.filter(
    (item) => item.won === true
  ).length;

  const losses = total - wins;

  const hitRate =
    total > 0
      ? Math.round((wins / total) * 100)
      : 0;

  const recent = settled.slice(0, 10);

  const recentTotal = recent.length;

  const recentWins = recent.filter(
    (item) => item.won === true
  ).length;

  const recentHitRate =
    recentTotal > 0
      ? Math.round((recentWins / recentTotal) * 100)
      : 0;

  const smoothedHitRate =
    total > 0
      ? Math.round(
          ((wins + 2) / (total + 4)) * 100
        )
      : 0;

  const sampleReliability = Math.min(
    100,
    Math.round((total / 15) * 100)
  );

  return {
    total,
    wins,
    losses,
    hitRate,
    recentTotal,
    recentWins,
    recentHitRate,
    smoothedHitRate,
    sampleReliability,
    historyScope:
      useLeagueHistory ? "league" : "global",
    leagueTotal: leagueSettled.length
  };
}

function evaluateAntiFalseTop(
  type,
  line,
  probability,
  confidence,
  league = ""
) {
  const probabilityValue = Number(probability);
  const confidenceValue = Number(confidence);

  const historyStats =
    getHistoricalMarketStats(
      type,
      line,
      league
    );

  const probabilityLabel =
    Number.isFinite(probabilityValue)
      ? Math.round(probabilityValue)
      : 0;

  const confidenceLabel =
    Number.isFinite(confidenceValue)
      ? Math.round(confidenceValue)
      : 0;

  // ==============================
  // FILTRO 1 - MODELLO BASE
  // ==============================

  if (
  !Number.isFinite(probabilityValue) ||
  !Number.isFinite(confidenceValue)
) {
  return {
    isTop: false,
    status: "not-top",
    label: "⚪ Non TOP • Dati insufficienti",
    stats: historyStats
  };
}

if (
  (probabilityValue >= 80 && confidenceValue >= 75) ||
  (confidenceValue >= 80 && probabilityValue >= 75)
) {
  if (
    probabilityValue < 80 ||
    confidenceValue < 80
  ) {
    return {
      isTop: false,
      status: "almost-top",
  label:
  `🟠 QUASI TOP • ` +
  `P ${probabilityLabel}% • ` +
  `C ${confidenceLabel}% • ` +
  `Manca ${
    probabilityValue < 80
      ? `${Math.ceil(80 - probabilityValue)}% P`
      : `${Math.ceil(80 - confidenceValue)}% C`
  }`,
      stats: historyStats
    };
  }
}

if (
  probabilityValue < 80 ||
  confidenceValue < 80
) {
  return {
    isTop: false,
    status: "not-top",
    label:
      `⚪ Non TOP • ` +
      `P ${probabilityLabel}% • ` +
      `C ${confidenceLabel}%`,
    stats: historyStats
  };
      }

  // ==============================
  // FILTRO 2 - CAMPIONE MINIMO
  // ==============================

  if (historyStats.total < 5) {
    return {
      isTop: false,
      status: "waiting",
      label:
        `🟡 In attesa esiti ` +
        `${historyStats.total}/5`,
      stats: historyStats
    };
  }

  // ==============================
  // FILTRO 3 - HIT RATE GENERALE
  // ==============================

  if (historyStats.hitRate < 70) {
    return {
      isTop: false,
      status: "blocked",
      label:
        `🛑 Bloccato • ` +
        `${historyStats.hitRate}% ` +
        `(${historyStats.wins}/${historyStats.total})`,
      stats: historyStats
    };
  }

  // ==============================
  // FILTRO 4 - CORREZIONE CAMPIONE
  // ==============================

  if (historyStats.smoothedHitRate < 68) {
    return {
      isTop: false,
      status: "blocked",
      label:
        `🛑 Bloccato • Affidabilità ` +
        `${historyStats.smoothedHitRate}%`,
      stats: historyStats
    };
  }

  // ==============================
  // FILTRO 5 - FORMA RECENTE
  // ==============================

  if (
    historyStats.recentTotal >= 5 &&
    historyStats.recentHitRate < 60
  ) {
    return {
      isTop: false,
      status: "blocked",
      label:
        `🛑 Bloccato • Recenti ` +
        `${historyStats.recentHitRate}%`,
      stats: historyStats
    };
  }

  // ==============================
  // ANTI-FALSE SCORE
  // ==============================

  const antiFalseScore = Math.round(
    probabilityValue * 0.25 +
    confidenceValue * 0.25 +
    historyStats.smoothedHitRate * 0.30 +
    historyStats.recentHitRate * 0.20
  );

  if (antiFalseScore < 78) {
    return {
      isTop: false,
      status: "blocked",
      label:
        `🟠 Quasi TOP • Score ` +
        `${antiFalseScore}/100`,
      stats: historyStats,
      antiFalseScore
    };
  }

  // ==============================
  // TOP CONFERMATO
  // ==============================

  return {
    isTop: true,
    status: "top",
    label:
      `🔥 TOP CONFERMATO • ` +
      `${historyStats.hitRate}% ` +
      `(${historyStats.wins}/${historyStats.total}) • ` +
      `R${historyStats.recentTotal} ` +
      `${historyStats.recentHitRate}%`,
    stats: historyStats,
    antiFalseScore
  };
                 }
// ==========================================
// CORNERS & CARDS - MODELLO CONTEGGI
// ==========================================

// Probabilità che un conteggio superi una linea:
// esempio media 9.4 corner + linea 8.5 -> P(9 o più)
function poissonOverPercent(mean, line) {
  const lambda = Math.max(0.05, safeNumber(mean));
  const minimum = Math.floor(safeNumber(line)) + 1;

  let term = Math.exp(-lambda);
  let cumulative = term;

  for (let k = 1; k < minimum; k++) {
    term *= lambda / k;
    cumulative += term;
  }

  return clampPercent(
    (1 - cumulative) * 100
  );
}
// Crea automaticamente le linee Over
// partendo dal numero medio previsto
function buildOverMarkets(mean, lines) {
  const expected = Math.max(0, safeNumber(mean));

  return {
    expected: Number(expected.toFixed(1)),
    markets: lines.map((line) => ({
      line,
      percent: poissonOverPercent(expected, line)
    }))
  };
}

// Linee dedicate ai corner
function buildCornerMarkets(mean) {
  return buildOverMarkets(
    mean,
    [7.5, 8.5, 9.5, 10.5]
  );
}

// Linee dedicate ai cartellini gialli
function buildCardMarkets(mean) {
  return buildOverMarkets(
    mean,
    [2.5, 3.5, 4.5, 5.5]
  );
}
// ==========================================
// BLOCCO 2 - Utility e gestione interfaccia
// ==========================================

// Protezione del testo inserito nell'HTML
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return entities[char];
  });
}

// Limita una percentuale tra 0 e 100
function clampPercent(value) {
  return Math.max(
    0,
    Math.min(100, Math.round(safeNumber(value)))
  );
}

// Colore della percentuale
function percentClass(value) {
  const percent = clampPercent(value);

  if (percent >= 80) return "high";
  if (percent >= 65) return "medium";
  return "low";
}

// Formatta una data per la visualizzazione
function formatMatchDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// Stato caricamento
function showLoading() {
  searchBtn.disabled = true;
  searchBtn.textContent = "⏳ Analisi in corso...";

  resultsInfo.textContent =
    `Analisi ${selectedStrategy} su ${selectedDays} ` +
    `${selectedDays === 1 ? "giorno" : "giorni"}...`;

  matchesCount.textContent = "0 partite";

  resultsContainer.innerHTML = `
    <div class="empty-state">
      ⏳ Analisi delle partite in corso...
    </div>
  `;
}

// Ripristina il pulsante
function stopLoading() {
  searchBtn.disabled = false;
  searchBtn.textContent = "🔎 Cerca partite";
}

// Nessun risultato
function showEmpty(message) {
  matchesCount.textContent = "0 partite";
  resultsInfo.textContent = message;

  resultsContainer.innerHTML = `
    <div class="empty-state">
      ${escapeHtml(message)}
    </div>
  `;
}

// Gestione errori
function showError(message) {
  matchesCount.textContent = "0 partite";
  resultsInfo.textContent = "Errore durante l'analisi.";

  resultsContainer.innerHTML = `
    <div class="empty-state">
      ❌ ${escapeHtml(message)}
    </div>
  `;
                             }
// ==========================================
// BLOCCO 3 - Schede risultati e percentuali
// ==========================================

function getStrategyKey() {
  const strategy = selectedStrategy.toLowerCase();

  if (strategy.includes("over")) return "over25";
  if (strategy.includes("under")) return "under25";
  if (strategy.includes("corner")) return "corners";
  if (strategy.includes("cartell")) return "cards";

  return "btts";
}

function getStrategyLabel() {
  const key = getStrategyKey();

  const labels = {
    btts: "GG / BTTS",
    over25: "Over 2.5",
    under25: "Under 2.5",
    corners: "Corner",
    cards: "Cartellini"
  };

  return labels[key] || "Pronostico";
}

function getMainProbability(match) {
  const key = getStrategyKey();

  if (!match.probabilities) return 0;

  return clampPercent(
    match.probabilities[key]
  );
}

function renderMarketBox(label, value) {
  const percent = clampPercent(value);

  return `
    <div class="market-box">
      <span>${escapeHtml(label)}</span>

      <div class="market-value ${percentClass(percent)}">
        ${percent}%
      </div>
    </div>
  `;
}
function renderXgBox(label, value) {
  const number = Number(value);

  const xg =
    Number.isFinite(number)
      ? number.toFixed(2)
      : "—";

  return `
    <div class="market-box">
      <span>${escapeHtml(label)}</span>

      <div class="market-value">
        ${xg}
      </div>
    </div>
  `;
}
function getExpertPrediction(probabilities, match = null) {
  if (!probabilities) {
    return {
      label: "Nessun pronostico",
      value: 0
    };
  }

  const options = [
    { label: "🏠 1 Casa", value: probabilities.homeWin },
    { label: "🤝 X Pareggio", value: probabilities.draw },
    { label: "✈️ 2 Ospite", value: probabilities.awayWin },
    { label: "⚽ GG / BTTS", value: probabilities.btts },
    { label: "🔥 Over 2.5", value: probabilities.over25 },
    { label: "🛡️ Under 2.5", value: probabilities.under25 }
  ];

  const best = options.reduce((best, current) => {
  return Number(current.value) > Number(best.value)
    ? current
    : best;
});

if (Number(best.value) < 65) {
  return {
    label: "⚠️ Nessun pronostico forte",
    value: best.value
  };
}

if (Number(best.value) >= 80) {
  const topConfidence = match
    ? calculateConfidenceScore(match, { value: best.value })
    : 0;

  if (topConfidence >= 80) {
    return {
      label: `🔥 TOP • ${best.label}`,
      value: best.value
    };
  }
}

if (Number(best.value) >= 70) {
  return {
    label: `🟠 Forte • ${best.label}`,
    value: best.value
  };
}

return {
  label: `🟡 Discreto • ${best.label}`,
  value: best.value
};
}
// ========================================
// V6 - CONFIDENCE SCORE 0-100
// ========================================
function calculateConfidenceScore(match, expertPrediction) {
  const probability = Number(expertPrediction?.value);

  if (!Number.isFinite(probability)) {
    return 0;
  }

  const data = match?.expertData || {};

  const homePlayed = Number(data.homePlayed) || 0;
  const awayPlayed = Number(data.awayPlayed) || 0;

  // Usa il campione più debole tra casa e trasferta
  const minPlayed = Math.min(homePlayed, awayPlayed);

  // Qualità campione:
  // poche partite = fiducia ridotta
  // da circa 8 partite in poi = campione forte
  const sampleScore = Math.min(
    100,
    40 + minPlayed * 7.5
  );

  const homeXg = Number(match?.xg?.home);
  const awayXg = Number(match?.xg?.away);

  let xgReliability = 100;

  if (
    !Number.isFinite(homeXg) ||
    !Number.isFinite(awayXg)
  ) {
    xgReliability = 40;
  } else {
    // Penalizza valori arrivati quasi ai limiti
    // di sicurezza del modello
    if (
      homeXg <= 0.16 ||
      awayXg <= 0.16 ||
      homeXg >= 4.49 ||
      awayXg >= 4.49
    ) {
      xgReliability -= 25;
    }
  }

  const leagueAverage = Number(data.leagueAverage);

  const leagueScore =
    Number.isFinite(leagueAverage) &&
    leagueAverage > 0
      ? 100
      : 50;

  // Probabilità pronostico = 55%
  // Quantità dati = 30%
  // Affidabilità xG = 10%
  // Dati campionato = 5%
  const confidence =
    probability * 0.55 +
    sampleScore * 0.30 +
    xgReliability * 0.10 +
    leagueScore * 0.05;

  return Math.max(
    0,
    Math.min(100, Math.round(confidence))
  );
}
function renderMatchCard(match) {
  const home = escapeHtml(match.home || "Casa");
  const away = escapeHtml(match.away || "Ospite");
  const league = escapeHtml(match.league || "Campionato");
  const date = formatMatchDate(match.date);

  const prediction = match.cornerCardPrediction;

  if (!prediction) {
    return `
      <article class="match-card">
        <div class="match-top">
          <div class="match-league">${league}</div>
          <div class="match-date">${escapeHtml(date)}</div>
        </div>

        <div class="teams">
          ⚽ ${home} - ${away}
        </div>

        <div class="market-box">
          <span>⚠️ Dati Corner/Card insufficienti</span>
        </div>
      </article>
    `;
  }

  const cornerMarkets =
    prediction.corners?.markets?.markets || [];

  const cardMarkets =
    prediction.yellowCards?.markets?.markets || [];
const bestCornerMarket =
  getBestHistoryMarket(cornerMarkets);

const bestCardMarket =
  getBestHistoryMarket(cardMarkets);

const cornerAntiFalse = bestCornerMarket
  ? evaluateAntiFalseTop(
      "corner",
      bestCornerMarket.line,
      bestCornerMarket.percent,
      match.cornerCardConfidence?.corner,
match.league || ""
)
  : null;

const cardsAntiFalse = bestCardMarket
  ? evaluateAntiFalseTop(
      "cards",
      bestCardMarket.line,
      bestCardMarket.percent,
      match.cornerCardConfidence?.cards,
      match.league || ""
    )
  : null;
  return `
    <article class="match-card">

      <div class="match-top">
        <div class="match-league">
          ${league}
        </div>

        <div class="match-date">
          ${escapeHtml(date)}
        </div>
      </div>

      <div class="teams">
        ⚽ ${home} - ${away}
      </div>

      <div class="market-grid">

        <div class="market-box">
          <span>🚩 Corner previsti</span>
          <div class="market-value">
            ${prediction.corners.total}
          </div>
        </div>

        <div class="market-box">
          <span>🏠 Corner ${home}</span>
          <div class="market-value">
            ${prediction.corners.home}
          </div>
        </div>

        <div class="market-box">
          <span>✈️ Corner ${away}</span>
          <div class="market-value">
            ${prediction.corners.away}
          </div>
        </div>

        ${cornerMarkets.map((market) =>
          renderMarketBox(
            `🚩 Over ${market.line} Corner`,
            market.percent
          )
        ).join("")}

        <div class="market-box">
          <span>🟨 Gialli previsti</span>
          <div class="market-value">
            ${prediction.yellowCards.total}
          </div>
        </div>

        <div class="market-box">
          <span>🏠 Gialli ${home}</span>
          <div class="market-value">
            ${prediction.yellowCards.home}
          </div>
        </div>

        <div class="market-box">
          <span>✈️ Gialli ${away}</span>
          <div class="market-value">
            ${prediction.yellowCards.away}
          </div>
        </div>

        ${cardMarkets.map((market) =>
          renderMarketBox(
            `🟨 Over ${market.line} Cartellini`,
            market.percent
          )
        ).join("")}

        ${renderMarketBox(
          "🟥 Probabilità almeno un rosso",
          prediction.redCard?.probability
        )}
${renderMarketBox(
  "🎯 Confidence Corner",
  match.cornerCardConfidence?.corner
)}

${renderMarketBox(
  "🎯 Confidence Cartellini",
  match.cornerCardConfidence?.cards
  )}
${cornerAntiFalse ? `
  <div class="market-box">
    <span>🛡️ Anti-False Corner</span>
    <div class="market-value">
      ${escapeHtml(cornerAntiFalse.label)}
    </div>
  </div>
` : ""}

${cardsAntiFalse ? `
  <div class="market-box">
    <span>🛡️ Anti-False Cartellini</span>
    <div class="market-value">
      ${escapeHtml(cardsAntiFalse.label)}
    </div>
  </div>
` : ""}
        <div class="market-box">
          <span>📊 Campione analizzato</span>
          <div class="market-value">
            ${prediction.sampleSize} partite
          </div>
        </div>

      </div>
    </article>
  `;
}
// ==========================================
// BLOCCO 4F - Collegamento xG -> Poisson
// ==========================================

async function enrichMatchWithExpertData(match) {
  try {
    // Il fixture originale API-Football è salvato in raw
    const sourceGame = match.raw || match;

    // Calcolo xG Casa / Ospite
    const xgData =
      await calculateExpectedGoals(sourceGame);

    // Se non abbiamo dati sufficienti,
    // lasciamo la partita invariata
    if (!xgData) {
      return match;
    }

    // Trasforma gli xG in probabilità Poisson
    const probabilities =
      calculatePoissonProbabilities(
        xgData.homeExpectedGoals,
        xgData.awayExpectedGoals
      );

    return {
      ...match,

      probabilities,

      xg: {
        home: xgData.homeExpectedGoals,
        away: xgData.awayExpectedGoals
      },

      expertData: xgData
    };

  } catch (error) {
    console.error(
      "Errore analisi V5:",
      error
    );

    return match;
  }
  }
async function renderMatches(matches) {
  if (!Array.isArray(matches) || !matches.length) {
    showEmpty(
      "Nessuna partita soddisfa i filtri selezionati."
    );
    return;
  }
resultsInfo.textContent =
  "🚩🟨 Analisi Corner & Cards in corso...";

const enrichedMatches = [];

for (const match of matches) {
  enrichedMatches.push(
    await enrichMatchWithCornerCardData(match)
  );
}

matches = enrichedMatches;
  // Salva automaticamente i pronostici nello storico
matches.forEach((match) => {
  recordPredictionHistory(match);
});
  // Aggiorna automaticamente gli esiti dello storico
await updatePredictionHistoryResults();
  matchesCount.textContent =
    `${matches.length} ${matches.length === 1 ? "partita" : "partite"}`;

  resultsInfo.textContent =
    `${getStrategyLabel()} • ${selectedDays} ` +
    `${selectedDays === 1 ? "giorno" : "giorni"} • ` +
    `${matches.length} risultati`;

  resultsContainer.innerHTML =
  matches.map(renderMatchCard).join("");
    }
function renderTop80Slip(matches) {
  const picks = matches
    .map((match) => ({
      match,
      prediction: getExpertPrediction(match.probabilities, match)
    }))
    .filter((item) => item.prediction.label.startsWith("🔥 TOP"))
    .sort(
      (a, b) =>
        Number(b.prediction.value) -
        Number(a.prediction.value)
    )
    .slice(0, 3);

  if (picks.length === 0) {
    return `
      <article class="match-card">
        <div class="teams">
          🔥 SCHEDINA TOP 80+
        </div>
        <div class="market-box">
          <span>Nessuna schedina TOP disponibile</span>
        </div>
      </article>
    `;
  }
const combinedTop80Odds = picks.reduce(
  (total, { prediction }) => {
    const probability = Number(prediction.value);

    if (!Number.isFinite(probability) || probability <= 0) {
      return total;
    }

    return total * (100 / probability);
  },
  1
);
  return `
    <article class="match-card">
      <div class="teams">
      ${picks.length === 1 ? "🔥 MIGLIORE TOP TROVATO" : "🔥 SCHEDINA TOP 80+"}
      </div>

      <div class="market-grid">
        ${picks.map(({ match, prediction }) => `
          <div class="market-box">
            <span>
              ${escapeHtml(match.home)} -
              ${escapeHtml(match.away)}
              <br>
              ${escapeHtml(prediction.label)}
            </span>

            <div class="market-value">
  ${clampPercent(prediction.value)}%
  <br>
  <span style="font-size:0.75em">
    Quota stimata ${(100 / Number(prediction.value)).toFixed(2)}
  </span>
</div>
          </div>
        `).join("")}
      </div>
      <div class="market-box" style="margin-top:16px;">
  <span>💰 Quota totale stimata</span>
  <div class="market-value">
    ${combinedTop80Odds.toFixed(2)}
  </div>
</div>
<div class="market-box" style="margin-top:12px;">
  <span>💶 Puntata</span>

  <input
    type="number"
    min="1"
    step="1"
    value="10"
    style="width:100%;margin:10px 0;padding:10px;border-radius:8px;"
    oninput="this.nextElementSibling.textContent='Vincita potenziale €' + ((Number(this.value) || 0) * ${Number(combinedTop80Odds.toFixed(2))}).toFixed(2)"
  >

  <div class="market-value">
    Vincita potenziale €${(10 * Number(combinedTop80Odds.toFixed(2))).toFixed(2)}
  </div>
</div>
    </article>
  `;
}
function renderRiskyExpertSlip(matches) {
let picks = matches
    .map((match) => {
      const p = match.probabilities || {};

      const options = [
  { label: "🏠 1 Casa", value: p.homeWin },
  { label: "✈️ 2 Ospite", value: p.awayWin },
  { label: "⚽ GG / BTTS", value: p.btts },
  { label: "🔥 Over 2.5", value: p.over25 },
  { label: "🛡️ Under 2.5", value: 100 - Number(p.over25)}
]
        .filter(
          (option) =>
            Number(option.value) >= 65 &&
            Number(option.value) < 80
        )
        .sort(
          (a, b) =>
            Number(b.value) - Number(a.value)
        );

      if (!options.length) return null;

      return {
        match,
        prediction: options[0]
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        Number(a.prediction.value) -
Number(b.prediction.value)
    )
    .slice(0, 4);
  if (picks.length < 4) {
  const missing = 4 - picks.length;

  const fallbackPicks = matches
    .filter((match) => !picks.some((pick) => pick.match === match))
    .map((match) => {
      const p = match.probabilities || {};

      const options = [
        { label: "🏠 1 Casa", value: p.homeWin },
        { label: "✈️ 2 Ospite", value: p.awayWin },
        { label: "⚽ GG / BTTS", value: p.btts },
        { label: "🔥 Over 2.5", value: p.over25 },
     { label: "🛡️ Under 2.5", value: 100 - Number(p.over25) }
      ]
        .filter(
          (option) =>
          Number(option.value) >= 55 &&
            Number(option.value) < 65
        )
        .sort(
          (a, b) =>
            Number(b.value) - Number(a.value)
        );

      if (!options.length) return null;

      return {
        match,
        prediction: options[0]
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        Number(a.prediction.value) -
        Number(b.prediction.value)
    )
    .slice(0, missing);

  picks = [...picks, ...fallbackPicks];
  }
const combinedEstimatedOdds = picks.reduce(
  (total, { prediction }) => {
    const probability = Number(prediction.value);

    if (!Number.isFinite(probability) || probability <= 0) {
      return total;
    }

    return total * (100 / probability);
  },
  1
);
  if (picks.length === 0) {
    return `
      <article class="match-card">
        <div class="teams">
          🎯 SCHEDINA EXPERT RISCHIOSA
        </div>

        <div class="market-box">
          <span>
            Nessuna schedina rischiosa disponibile
          </span>
        </div>
      </article>
    `;
  }

  return `
    <article class="match-card">
      <div class="teams">
        🎯 SCHEDINA EXPERT RISCHIOSA
      </div>

      <div class="market-grid">
        ${picks.map(({ match, prediction }) => `
          <div class="market-box">
            <span>
              ${escapeHtml(match.home)} -
              ${escapeHtml(match.away)}
              <br>
              ${Number(prediction.value) < 65 ? "⚠️ EXTRA • " : ""}${escapeHtml(prediction.label)}
            </span>

            <div class="market-value">
  ${clampPercent(prediction.value)}%
  <br>
  <span style="font-size:0.75em">
    Quota stimata ${(100 / Number(prediction.value)).toFixed(2)}
  </span>
</div>
          </div>
        `).join("")}
      </div>
      <div class="market-box" style="margin-top:16px;">
  <span>💰 Quota totale stimata</span>
  <div class="market-value">
    ${combinedEstimatedOdds.toFixed(2)}
  </div>
</div>
<div class="market-box" style="margin-top:12px;">
  <span>💶 Puntata</span>

  <input
    type="number"
    min="1"
    step="1"
    value="10"
    style="width:100%;margin:10px 0;padding:10px;border-radius:8px;"
    oninput="this.nextElementSibling.textContent='Vincita potenziale €' + ((Number(this.value) || 0) * ${Number(combinedEstimatedOdds.toFixed(2))}).toFixed(2)"
  >

  <div class="market-value">
    Vincita potenziale €${(10 * Number(combinedEstimatedOdds.toFixed(2))).toFixed(2)}
  </div>
</div>
    </article>
  `;
}
// ==========================================
// BLOCCO 4A - Backend V4 e gestione date
// ==========================================

const BACKEND =
  "https://football-stats-v3.onrender.com";

const LEAGUE_NAMES = {
  SA: "Serie A",
  PL: "Premier League",
  PD: "La Liga",
  BL1: "Bundesliga",
  FL1: "Ligue 1",
  FL2: "Ligue 2",
  NL2: "Eerste Divisie",
  PD2: "Segunda División",
  TR1: "Süper Lig",
  PT1: "Primeira Liga",
SC1: "Premiership",
SERIE_B: "Serie B",
  CL: "UEFA Champions League",
  EL: "UEFA Europa League",
  CH: "Championship"
};

// Data YYYY-MM-DD senza problemi di fuso orario
function formatApiDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// Crea le date da oggi fino al numero di giorni scelto
function getSearchDates() {
  const dates = [];
  const today = new Date();

  for (let i = 0; i < selectedDays; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    dates.push(formatApiDate(date));
  }

  return dates;
}

// Nomi dei campionati selezionato 
function getSelectedLeagueNames() {
  return getSelectedLeagues()
    .map((code) => LEAGUE_NAMES[code])
    .filter(Boolean);
}

// Scarica le partite di una singola data
async function fetchFixturesByDate(date) {
  const url =
`${BACKEND}/api/football?path=/fixtures&date=${date}`;

  const response = await fetch(url, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(
      `Errore API ${response.status} per ${date}`
    );
  }

  const data = await response.json();

  return Array.isArray(data.response)
  ? data.response
  : [];
}
// Cache statistiche partita: evita richieste duplicate
const fixtureStatsCache = new Map();

// Recupera statistiche reali di una partita:
// corner, cartellini gialli, rossi, tiri, ecc.
async function fetchFixtureStatistics(fixtureId) {
  const id = Number(fixtureId);

  if (!Number.isFinite(id) || id <= 0) {
    return [];
  }

  if (fixtureStatsCache.has(id)) {
    return fixtureStatsCache.get(id);
  }

  const url =
    `${BACKEND}/api/football?path=/fixtures/statistics&fixture=${id}`;

  const response = await fetch(url, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(
      `Errore statistiche fixture ${response.status}`
    );
  }

  const data = await response.json();

  const statistics = Array.isArray(data.response)
    ? data.response
    : [];

  fixtureStatsCache.set(id, statistics);

  return statistics;
}
// Legge un singolo valore dalle statistiche API-Football
function getFixtureStat(teamStats, type) {
  const stats = Array.isArray(teamStats?.statistics)
    ? teamStats.statistics
    : [];

  const item = stats.find(
    (stat) =>
      String(stat?.type || "").toLowerCase() ===
      String(type).toLowerCase()
  );

  return safeNumber(item?.value);
}

// Estrae corner, gialli e rossi per casa e trasferta
function parseCornerCardStatistics(
  statistics,
  homeTeamId,
  awayTeamId
) {
  const rows = Array.isArray(statistics)
    ? statistics
    : [];

  const home =
    rows.find(
      (row) =>
        Number(row?.team?.id) === Number(homeTeamId)
    ) || rows[0];

  const away =
    rows.find(
      (row) =>
        Number(row?.team?.id) === Number(awayTeamId)
    ) || rows[1];

  const homeCorners = getFixtureStat(
    home,
    "Corner Kicks"
  );

  const awayCorners = getFixtureStat(
    away,
    "Corner Kicks"
  );

  const homeYellow = getFixtureStat(
    home,
    "Yellow Cards"
  );

  const awayYellow = getFixtureStat(
    away,
    "Yellow Cards"
  );

  const homeRed = getFixtureStat(
    home,
    "Red Cards"
  );

  const awayRed = getFixtureStat(
    away,
    "Red Cards"
  );

  return {
    home: {
      corners: homeCorners,
      yellowCards: homeYellow,
      redCards: homeRed
    },

    away: {
      corners: awayCorners,
      yellowCards: awayYellow,
      redCards: awayRed
    },

    total: {
      corners: homeCorners + awayCorners,
      yellowCards: homeYellow + awayYellow,
      redCards: homeRed + awayRed
    }
  };
}
const recentFixturesCache = new Map();

async function fetchRecentTeamFixtures(teamId, last = 6) {
  const id = Number(teamId);
  const limit = Math.max(1, Math.min(10, Number(last) || 6));

  if (!Number.isFinite(id) || id <= 0) {
    return [];
  }

  const cacheKey = `${id}-${limit}`;

  if (recentFixturesCache.has(cacheKey)) {
    return recentFixturesCache.get(cacheKey);
  }

  const url =
    `${BACKEND}/api/football?path=/fixtures&team=${id}&last=${limit}&status=FT`;

  const response = await fetch(url, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(
      `Errore ultime partite squadra ${response.status}`
    );
  }

  const data = await response.json();

  const fixtures = Array.isArray(data.response)
    ? data.response
    : [];

  recentFixturesCache.set(cacheKey, fixtures);

  return fixtures;
}
function averageValues(values) {
  const valid = values.filter((value) =>
    Number.isFinite(Number(value))
  );

  if (!valid.length) {
    return 0;
  }

  return (
    valid.reduce(
      (sum, value) => sum + Number(value),
      0
    ) / valid.length
  );
}

async function buildTeamCornerCardProfile(
  teamId,
  fixtures
) {
  const id = Number(teamId);

  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  const matches = Array.isArray(fixtures)
    ? fixtures
    : [];

  const samples = [];

  for (const game of matches) {
    const fixtureId = Number(game?.fixture?.id);
    const homeId = Number(game?.teams?.home?.id);
    const awayId = Number(game?.teams?.away?.id);

    if (
      !Number.isFinite(fixtureId) ||
      (homeId !== id && awayId !== id)
    ) {
      continue;
    }

    try {
      const statistics =
        await fetchFixtureStatistics(fixtureId);

      if (
        !Array.isArray(statistics) ||
        statistics.length < 2
      ) {
        continue;
      }

      const parsed =
        parseCornerCardStatistics(
          statistics,
          homeId,
          awayId
        );

      const isHome = homeId === id;

      const own = isHome
        ? parsed.home
        : parsed.away;

      const opponent = isHome
        ? parsed.away
        : parsed.home;

      samples.push({
        cornersFor: own.corners,
        cornersAgainst: opponent.corners,

        yellowFor: own.yellowCards,
        yellowAgainst: opponent.yellowCards,

        redFor: own.redCards,
        redAgainst: opponent.redCards,

        redInMatch:
          parsed.total.redCards > 0 ? 1 : 0
      });
    } catch (error) {
      console.warn(
        "Statistiche storiche non disponibili:",
        fixtureId
      );
    }
  }

  if (!samples.length) {
    return null;
  }

  const round1 = (value) =>
    Number(value.toFixed(1));

  return {
    sampleSize: samples.length,

    cornersFor: round1(
      averageValues(
        samples.map((item) => item.cornersFor)
      )
    ),

    cornersAgainst: round1(
      averageValues(
        samples.map((item) => item.cornersAgainst)
      )
    ),

    yellowFor: round1(
      averageValues(
        samples.map((item) => item.yellowFor)
      )
    ),

    yellowAgainst: round1(
      averageValues(
        samples.map((item) => item.yellowAgainst)
      )
    ),

    redForRate: Math.round(
      averageValues(
        samples.map((item) =>
          item.redFor > 0 ? 100 : 0
        )
      )
    ),

    redMatchRate: Math.round(
      averageValues(
        samples.map((item) =>
          item.redInMatch ? 100 : 0
        )
      )
    )
  };
}
function buildMatchCornerCardPrediction(
  homeProfile,
  awayProfile
) {
  if (!homeProfile || !awayProfile) {
    return null;
  }

  const round1 = (value) =>
    Number(safeNumber(value).toFixed(1));

  // Corner previsti casa:
  // media tra corner fatti dalla casa
  // e corner concessi dall'ospite
  const homeCorners = round1(
    averageValues([
      homeProfile.cornersFor,
      awayProfile.cornersAgainst
    ])
  );

  // Corner previsti ospite
  const awayCorners = round1(
    averageValues([
      awayProfile.cornersFor,
      homeProfile.cornersAgainst
    ])
  );

  const totalCorners = round1(
    homeCorners + awayCorners
  );

  // Gialli previsti casa
  const homeYellow = round1(
    averageValues([
      homeProfile.yellowFor,
      awayProfile.yellowAgainst
    ])
  );

  // Gialli previsti ospite
  const awayYellow = round1(
    averageValues([
      awayProfile.yellowFor,
      homeProfile.yellowAgainst
    ])
  );

  const totalYellow = round1(
    homeYellow + awayYellow
  );

  // Stima prudente probabilità di almeno un rosso
  const redMatchBase = averageValues([
    homeProfile.redMatchRate,
    awayProfile.redMatchRate
  ]);

  const redTeamBase = averageValues([
    homeProfile.redForRate,
    awayProfile.redForRate
  ]);

  const redProbability = clampPercent(
    redMatchBase * 0.7 +
    redTeamBase * 0.3
  );

  return {
    sampleSize: Math.min(
      safeNumber(homeProfile.sampleSize),
      safeNumber(awayProfile.sampleSize)
    ),

    corners: {
      home: homeCorners,
      away: awayCorners,
      total: totalCorners,
      markets: buildCornerMarkets(totalCorners)
    },

    yellowCards: {
      home: homeYellow,
      away: awayYellow,
      total: totalYellow,
      markets: buildCardMarkets(totalYellow)
    },

    redCard: {
      probability: redProbability
    }
  };
}

function calculateCornerCardConfidence(prediction, type = "corner") {
  if (!prediction) {
    return 0;
  }

  const sampleSize = Number(prediction.sampleSize) || 0;

  const markets =
    type === "cards"
      ? prediction.yellowCards?.markets?.markets || []
      : prediction.corners?.markets?.markets || [];

  const probabilities = markets
    .map((market) => Number(market?.percent))
    .filter((value) => Number.isFinite(value));

  if (!probabilities.length || sampleSize <= 0) {
    return 0;
  }

  const bestProbability = Math.max(...probabilities);

  const sampleScore = Math.min(
    100,
    (sampleSize / 8) * 100
  );

  let confidence =
    bestProbability * 0.70 +
    sampleScore * 0.30;

  if (sampleSize < 5) {
    confidence -= 10;
  }

  return Math.max(
    0,
    Math.min(100, Math.round(confidence))
  );
}
async function enrichMatchWithCornerCardData(match) {
  try {
    const sourceGame = match.raw || match;

    const homeTeamId = Number(
      sourceGame?.teams?.home?.id
    );

    const awayTeamId = Number(
      sourceGame?.teams?.away?.id
    );

    if (
      !Number.isFinite(homeTeamId) ||
      !Number.isFinite(awayTeamId)
    ) {
      return match;
    }

    const [homeFixtures, awayFixtures] =
      await Promise.all([
        fetchRecentTeamFixtures(homeTeamId, 10),
        fetchRecentTeamFixtures(awayTeamId, 10)
      ]);

    const [homeProfile, awayProfile] =
      await Promise.all([
        buildTeamCornerCardProfile(
          homeTeamId,
          homeFixtures
        ),

        buildTeamCornerCardProfile(
          awayTeamId,
          awayFixtures
        )
      ]);

    const cornerCardPrediction =
      buildMatchCornerCardPrediction(
        homeProfile,
        awayProfile
      );
const cornerConfidence =
  calculateCornerCardConfidence(
    cornerCardPrediction,
    "corner"
  );

const cardConfidence =
  calculateCornerCardConfidence(
    cornerCardPrediction,
    "cards"
  );
    return {
      ...match,
cornerCardPrediction,
     cornerCardConfidence: {
  corner: cornerConfidence,
  cards: cardConfidence
}, 

      cornerCardProfiles: {
        home: homeProfile,
        away: awayProfile
      }
    };
  } catch (error) {
    console.warn(
      "Errore analisi Corner/Card:",
      match?.home,
      match?.away,
      error
    );

    return {
      ...match,
      cornerCardPrediction: null
    };
  }
}
// Scarica tutte le partite della finestra selezionata
async function fetchAllFixtures() {
  const dates = getSearchDates();

  const responses = await Promise.all(
    dates.map((date) => fetchFixturesByDate(date))
  );

  return responses.flat();
}

// Filtra solo i campionati scelti
function filterSelectedLeagues(games) {
  const selected = getSelectedLeagueNames();

  if (!selected.length) {
    return [];
  }

  return games.filter((game) => {
    const leagueName = String(
  game.competition?.name ||
  game.league?.name ||
  game.league ||
  ""
).trim();

    return selected.includes(leagueName);
  });
    }
// ==========================================
// BLOCCO 4B - Normalizzazione dati partite
// ==========================================

function normalizeFixture(game) {
  return {
    raw: game,

    home:
      game.homeTeam?.name ||
      game.teams?.home?.name ||
      game.home ||
      "Casa",

    away:
      game.awayTeam?.name ||
      game.teams?.away?.name ||
      game.away ||
      "Ospite",

    league:
      game.competition?.name ||
      game.league?.name ||
      game.league ||
      "Campionato",

    date:
      game.utcDate ||
      game.fixture?.date ||
      game.date ||
      "",

    status:
      game.status ||
      game.fixture?.status?.short ||
      ""
  };
}

function normalizeFixtures(games) {
  if (!Array.isArray(games)) {
    return [];
  }

  return games.map(normalizeFixture);
}
// ==========================================
// BLOCCO 4C - Motore matematico Poisson
// ==========================================

// Fattoriale
function factorial(n) {
  if (n <= 1) return 1;

  let result = 1;

  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
}

// Probabilità di segnare esattamente N gol
function poissonProbability(goals, lambda) {
  return (
    Math.exp(-lambda) *
    Math.pow(lambda, goals) /
    factorial(goals)
  );
}

// Calcolo completo delle probabilità
function calculatePoissonProbabilities(
  homeExpectedGoals,
  awayExpectedGoals
) {
  const homeLambda = Math.max(
    0.05,
    Math.min(6, safeNumber(homeExpectedGoals))
  );

  const awayLambda = Math.max(
    0.05,
    Math.min(6, safeNumber(awayExpectedGoals))
  );

  const totalLambda = homeLambda + awayLambda;

  // GG / BTTS
  const bttsProbability =
    1 -
    Math.exp(-homeLambda) -
    Math.exp(-awayLambda) +
    Math.exp(-totalLambda);

  // Under 1.5
  const under15Probability =
    Math.exp(-totalLambda) *
    (1 + totalLambda);

  // Under 2.5
  const under25Probability =
    Math.exp(-totalLambda) *
    (
      1 +
      totalLambda +
      Math.pow(totalLambda, 2) / 2
    );

  const over15Probability =
    1 - under15Probability;

  const over25Probability =
    1 - under25Probability;

  // 1X2
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  const MAX_GOALS = 10;

  for (let homeGoals = 0; homeGoals <= MAX_GOALS; homeGoals++) {
    const homeProbability =
      poissonProbability(homeGoals, homeLambda);

    for (let awayGoals = 0; awayGoals <= MAX_GOALS; awayGoals++) {
      const awayProbability =
        poissonProbability(awayGoals, awayLambda);

      const probability =
        homeProbability * awayProbability;

      if (homeGoals > awayGoals) {
        homeWin += probability;
      } else if (homeGoals === awayGoals) {
        draw += probability;
      } else {
        awayWin += probability;
      }
    }
  }

  const resultTotal =
    homeWin + draw + awayWin;

  if (resultTotal > 0) {
    homeWin /= resultTotal;
    draw /= resultTotal;
    awayWin /= resultTotal;
  }

  return {
    homeExpectedGoals: homeLambda,
    awayExpectedGoals: awayLambda,

    btts: clampPercent(
      bttsProbability * 100
    ),

    over15: clampPercent(
      over15Probability * 100
    ),

    over25: clampPercent(
      over25Probability * 100
    ),

    under25: clampPercent(
      under25Probability * 100
    ),

    homeWin: clampPercent(
      homeWin * 100
    ),

    draw: clampPercent(
      draw * 100
    ),

    awayWin: clampPercent(
      awayWin * 100
    )
  };
}
// ==========================================
// BLOCCO 4D - Classifica e forma squadre
// ==========================================

const standingsCache = {};
const standingsPending = {};
// Scarica la classifica del campionato
async function fetchStandings(leagueId, season) {
  const emptyStandings = {
    total: [],
    home: [],
    away: []
  };

  if (!leagueId || !season) {
    return emptyStandings;
  }

  const key = `${leagueId}-${season}`;

  if (standingsCache[key]) {
    return standingsCache[key];
  }

  if (standingsPending[key]) {
    return standingsPending[key];
  }

  standingsPending[key] = (async () => {
    try {
      const url =
        `${BACKEND}/api/football?path=/standings` +
        `&league=${leagueId}&season=${season}`;

      const response = await fetch(url, {
        cache: "no-store"
      });

      if (!response.ok) {
        console.warn(
          "Standings API errore:",
          leagueId,
          season,
          response.status
        );
        return emptyStandings;
      }

      const data = await response.json();

      const allStandings =
        Array.isArray(data.standings)
          ? data.standings
          : [];

      const total =
        allStandings.find((s) => s.type === "TOTAL")?.table ||
        allStandings[0]?.table ||
        [];

      const home =
        allStandings.find((s) => s.type === "HOME")?.table ||
        total;

      const away =
        allStandings.find((s) => s.type === "AWAY")?.table ||
        total;

      const standings = {
        total,
        home,
        away
      };

      if (total.length) {
        standingsCache[key] = standings;
      }

      return standings;

    } catch (error) {
      console.error("Errore fetchStandings:", error);
      return emptyStandings;

    } finally {
      delete standingsPending[key];
    }
  })();

  return standingsPending[key];
  }


// Converte la forma recente in valore 0-1
function calculateFormScore(form) {
  const results = String(form || "")
    .replace(/,/g, "")
    .slice(-5);

  if (!results) {
    return 0.5;
  }

  let points = 0;

  for (const result of results) {
    if (result === "W") {
      points += 3;
    } else if (result === "D") {
      points += 1;
    }
  }

  return points / (results.length * 3);
}


// Media corretta con smoothing
function smoothGoalRate(
  value,
  played,
  leagueAverage,
  priorGames = 5
) {
  return (
    safeNumber(value) +
    leagueAverage * priorGames
  ) / (
    safeNumber(played) + priorGames
  );
                           }
// ==========================================
// BLOCCO 4E - Calcolo xG Casa / Ospite
// ==========================================

// Normalizza il nome di una squadra
function normalizeTeamName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}


// Trova una squadra nella classifica
function findStandingTeam(standings, team) {
  if (!Array.isArray(standings) || !team) {
    return null;
  }

  const teamId = safeNumber(team.id);
  const teamName = normalizeTeamName(team.name);

  return standings.find((row) => {
    const rowId = safeNumber(row.team?.id);
    const rowName = normalizeTeamName(row.team?.name);

    if (teamId && rowId === teamId) {
      return true;
    }

    return teamName && rowName === teamName;
  }) || null;
}


// Media gol del campionato
function calculateLeagueGoalAverage(standings) {
  let totalGoals = 0;
  let totalPlayed = 0;

  for (const row of standings) {
    totalGoals += safeNumber(
      row.goalsFor
    );

    totalPlayed += safeNumber(
      row.playedGames
    );
  }

  if (!totalPlayed) {
    return 1.35;
  }

  const average =
    totalGoals / totalPlayed;

  return Math.max(
    0.8,
    Math.min(2.2, average)
  );
}


// Calcola gli Expected Goals
async function calculateExpectedGoals(game) {

  const leagueId =
    game.league?.id;

  const season =
    game.league?.season;

  const homeTeam =
    game.teams?.home;

  const awayTeam =
    game.teams?.away;

  if (
    !leagueId ||
    !season ||
    !homeTeam ||
    !awayTeam
  ) {
    return null;
  }

  const standingsData =
  await fetchStandings(
    leagueId,
    season
  );

const totalStandings =
  standingsData?.total || [];

const homeStandings =
  standingsData?.home || totalStandings;

const awayStandings =
  standingsData?.away || totalStandings;

if (!totalStandings.length) {
  return null;
}

const homeRow =
  findStandingTeam(
    homeStandings,
    homeTeam
  ) ||
  findStandingTeam(
    totalStandings,
    homeTeam
  );

const awayRow =
  findStandingTeam(
    awayStandings,
    awayTeam
  ) ||
  findStandingTeam(
    totalStandings,
    awayTeam
  );

if (!homeRow || !awayRow) {
  return null;
}

const homeTotalRow =
  findStandingTeam(
    totalStandings,
    homeTeam
  ) || homeRow;

const awayTotalRow =
  findStandingTeam(
    totalStandings,
    awayTeam
  ) || awayRow;

const leagueAverage =
  calculateLeagueGoalAverage(
    totalStandings
  );


  // CASA
  const homePlayed =
    safeNumber(
      homeRow.playedGames
    );

  const homeGF =
    safeNumber(
      homeRow.goalsFor
    );

  const homeGA =
    safeNumber(
      homeRow.goalsAgainst
    );


  // OSPITE
  const awayPlayed =
    safeNumber(
      awayRow.playedGames
    );

  const awayGF =
    safeNumber(
      awayRow.goalsFor
    );

  const awayGA =
    safeNumber(
      awayRow.goalsAgainst
    );


  // Medie con smoothing
  const homeAttack =
    smoothGoalRate(
      homeGF,
      homePlayed,
      leagueAverage
    );

  const homeDefense =
    smoothGoalRate(
      homeGA,
      homePlayed,
      leagueAverage
    );

  const awayAttack =
    smoothGoalRate(
      awayGF,
      awayPlayed,
      leagueAverage
    );

  const awayDefense =
    smoothGoalRate(
      awayGA,
      awayPlayed,
      leagueAverage
    );


  // Forma ultime 5
  const homeForm =
    calculateFormScore(
      homeTotalRow.form
    );

  const awayForm =
    calculateFormScore(
      awayTotalRow.form
    );


  const homeFormFactor =
    0.90 + homeForm * 0.20;

  const awayFormFactor =
    0.90 + awayForm * 0.20;


  // xG stimati
  let homeExpectedGoals =
    leagueAverage *
    (homeAttack / leagueAverage) *
    (awayDefense / leagueAverage) *
    1.00 *
    homeFormFactor;

  let awayExpectedGoals =
    leagueAverage *
    (awayAttack / leagueAverage) *
    (homeDefense / leagueAverage) *
    1.00 *
    awayFormFactor;


  // Limiti di sicurezza
  homeExpectedGoals =
    Math.max(
      0.15,
      Math.min(4.5, homeExpectedGoals)
    );

  awayExpectedGoals =
    Math.max(
      0.15,
      Math.min(4.5, awayExpectedGoals)
    );


  return {
  homeExpectedGoals,
  awayExpectedGoals,
  homeForm,
  awayForm,
  leagueAverage,
  homePlayed,
  awayPlayed
};
}

