// ============================================================
//  Révise tes Capitales — Application principale
// ============================================================

(function () {
  "use strict";

  // ---------- State ----------
  let currentMode = "locate";
  let filteredData = [...CAPITALS_DB];
  let currentQuestion = null;
  let score = { correct: 0, total: 0 };
  let answeredSet = new Set(); // tracks answered country names
  let mapInstance = null;
  let learnMapInstance = null;
  let locateMapInstance = null;
  let locateGeoLayer = null;
  let clickMarker = null;
  let targetMarker = null;
  let sortColumn = "country";
  let sortAsc = true;
  let bordersGeoJSON = null; // cached GeoJSON data

  // ---------- Country borders ----------
  const BORDERS_URL = "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson";
  const BORDER_STYLE = { color: "#334155", weight: 2, fillOpacity: 0, interactive: false };

  function addBorders(map) {
    if (bordersGeoJSON) {
      L.geoJSON(bordersGeoJSON, { style: BORDER_STYLE }).addTo(map);
      return;
    }
    fetch(BORDERS_URL)
      .then(r => r.json())
      .then(data => {
        bordersGeoJSON = data;
        L.geoJSON(data, { style: BORDER_STYLE }).addTo(map);
      })
      .catch(() => {}); // silently fail if offline
  }

  // ---------- DOM refs ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const modeSelect = $("#mode-select");
  const continentFilter = $("#continent-filter");
  const continentBtn = $("#continent-btn");
  const continentDropdown = $("#continent-dropdown");
  const levelFilter = $("#level-filter");
  const scoreCorrect = $("#score-correct");
  const scoreTotal = $("#score-total");
  const scorePercent = $("#score-percent");
  const progressBar = $("#progress-bar");
  const progressLabel = $("#progress-label");
  const countDisplay = $("#count-display");

  // ---------- Utilities ----------
  function normalize(str) {
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[-'']/g, " ")
      .trim();
  }

  function fuzzyMatch(input, target) {
    const a = normalize(input);
    const b = normalize(target);
    if (a === b) return true;
    // Allow minor typos: Levenshtein distance ≤ 2 for long words
    if (b.length > 4 && levenshtein(a, b) <= 2) return true;
    // Check if one contains the other (for compound names)
    if (b.includes(a) || a.includes(b)) return true;
    return false;
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0)
        );
    return dp[m][n];
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function getUnanswered() {
    return filteredData.filter((d) => !answeredSet.has(d.country));
  }

  // ---------- Score & Progress ----------
  function updateScore(isCorrect) {
    if (isCorrect) score.correct++;
    score.total++;
    scoreCorrect.textContent = score.correct;
    scoreTotal.textContent = score.total;
    const pct = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0;
    scorePercent.textContent = `(${pct} %)`;
    updateProgress();
  }

  function updateProgress() {
    const pct = filteredData.length > 0
      ? Math.round((answeredSet.size / filteredData.length) * 100)
      : 0;
    progressBar.style.width = pct + "%";
    progressLabel.textContent = pct + " %";
  }

  function resetScore() {
    score = { correct: 0, total: 0 };
    answeredSet.clear();
    scoreCorrect.textContent = "0";
    scoreTotal.textContent = "0";
    scorePercent.textContent = "";
    updateProgress();
  }

  // ---------- Filter ----------
  const ALL_CONTINENTS = ["Europe", "Afrique", "Asie", "Amérique", "Océanie"];

  function getSelectedContinents() {
    return [...continentDropdown.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
  }

  function updateContinentLabel() {
    const sel = getSelectedContinents();
    if (sel.length === 0 || sel.length === ALL_CONTINENTS.length) {
      continentBtn.textContent = "Tous ▾";
    } else if (sel.length <= 2) {
      continentBtn.textContent = sel.join(" + ") + " ▾";
    } else {
      continentBtn.textContent = sel.length + " continents ▾";
    }
  }

  function applyFilter() {
    const selectedContinents = getSelectedContinents();
    const level = levelFilter.value;

    // Step 1: filter by level
    let data;
    if (level === "all") {
      data = [...CAPITALS_DB];
    } else if (level === "programme") {
      data = CAPITALS_DB.filter((d) => d.level >= 1);
    } else {
      const maxLevel = parseInt(level);
      data = CAPITALS_DB.filter((d) => d.level >= 1 && d.level <= maxLevel);
    }

    // Step 2: filter by continent(s)
    if (selectedContinents.length > 0 && selectedContinents.length < ALL_CONTINENTS.length) {
      data = data.filter((d) => selectedContinents.includes(d.continent));
    }

    filteredData = data;
    countDisplay.textContent = filteredData.length + " pays";
    resetScore();
    if (sessionResults.length > 0 && !sessionSaved) saveSession();
    sessionResults = [];
    sessionSaved = false;
    renderSessionPanel();
    startCurrentMode();
  }

  // ---------- Mode switching ----------
  function switchMode(mode) {
    if (sessionResults.length > 0 && !sessionSaved) saveSession();
    sessionResults = [];
    sessionSaved = false;
    renderSessionPanel();
    currentMode = mode;
    modeSelect.value = mode;
    $$(".game-mode").forEach((sec) => sec.classList.remove("active"));
    $(`#mode-${mode}`).classList.add("active");
    startCurrentMode();
  }

  function startCurrentMode() {
    switch (currentMode) {
      case "locate": startLocate(); break;
      case "quiz": startQuiz(); break;
      case "qcm": startQCM(); break;
      case "map": startMap(); break;
      case "reverse": startReverse(); break;
      case "learn": startLearn(); break;
    }
  }

  // =====================
  //  MODE: Localiser (pays)
  // =====================
  // Map from French country names → GeoJSON ADMIN property names
  const COUNTRY_NAME_MAP = {
    "États-Unis": "United States of America", "Royaume-Uni": "United Kingdom",
    "Allemagne": "Germany", "France": "France", "Espagne": "Spain", "Italie": "Italy",
    "Belgique": "Belgium", "Pays-Bas": "Netherlands", "Suisse": "Switzerland",
    "Autriche": "Austria", "Pologne": "Poland", "République tchèque": "Czech Republic",
    "Slovaquie": "Slovakia", "Hongrie": "Hungary", "Roumanie": "Romania",
    "Bulgarie": "Bulgaria", "Grèce": "Greece", "Croatie": "Croatia",
    "Serbie": "Serbia", "Bosnie-Herzégovine": "Bosnia and Herzegovina",
    "Monténégro": "Montenegro", "Macédoine du Nord": "Macedonia",
    "Albanie": "Albania", "Kosovo": "Kosovo", "Slovénie": "Slovenia",
    "Estonie": "Estonia", "Lettonie": "Latvia", "Lituanie": "Lithuania",
    "Finlande": "Finland", "Suède": "Sweden", "Norvège": "Norway",
    "Danemark": "Denmark", "Islande": "Iceland", "Irlande": "Ireland",
    "Luxembourg": "Luxembourg", "Malte": "Malta", "Chypre": "Cyprus",
    "Moldavie": "Moldova", "Ukraine": "Ukraine", "Biélorussie": "Belarus",
    "Russie": "Russia", "Andorre": "Andorra", "Monaco": "Monaco",
    "Liechtenstein": "Liechtenstein", "Portugal": "Portugal",
    "Maroc": "Morocco", "Algérie": "Algeria", "Tunisie": "Tunisia",
    "Libye": "Libya", "Égypte": "Egypt", "Mauritanie": "Mauritania",
    "Mali": "Mali", "Niger": "Niger", "Tchad": "Chad", "Soudan": "Sudan",
    "Soudan du Sud": "South Sudan", "Éthiopie": "Ethiopia", "Érythrée": "Eritrea",
    "Djibouti": "Djibouti", "Somalie": "Somalia", "Kenya": "Kenya",
    "Ouganda": "Uganda", "Tanzanie": "United Republic of Tanzania",
    "Rwanda": "Rwanda", "Burundi": "Burundi",
    "République démocratique du Congo": "Democratic Republic of the Congo",
    "République du Congo": "Republic of Congo", "Gabon": "Gabon",
    "Guinée équatoriale": "Equatorial Guinea", "Cameroun": "Cameroon",
    "Nigeria": "Nigeria", "Bénin": "Benin", "Togo": "Togo", "Ghana": "Ghana",
    "Burkina Faso": "Burkina Faso", "Côte d'Ivoire": "Ivory Coast",
    "Liberia": "Liberia", "Sierra Leone": "Sierra Leone", "Guinée": "Guinea",
    "Guinée-Bissau": "Guinea Bissau", "Sénégal": "Senegal", "Gambie": "Gambia",
    "Centrafrique": "Central African Republic", "Angola": "Angola",
    "Zambie": "Zambia", "Zimbabwe": "Zimbabwe", "Malawi": "Malawi",
    "Mozambique": "Mozambique", "Madagascar": "Madagascar", "Namibie": "Namibia",
    "Botswana": "Botswana", "Afrique du Sud": "South Africa",
    "Eswatini": "Swaziland", "Lesotho": "Lesotho",
    "Chine": "China", "Japon": "Japan", "Corée du Sud": "South Korea",
    "Corée du Nord": "North Korea", "Mongolie": "Mongolia", "Inde": "India",
    "Pakistan": "Pakistan", "Bangladesh": "Bangladesh", "Sri Lanka": "Sri Lanka",
    "Népal": "Nepal", "Bhoutan": "Bhutan", "Birmanie": "Myanmar",
    "Thaïlande": "Thailand", "Vietnam": "Vietnam", "Laos": "Laos",
    "Cambodge": "Cambodia", "Malaisie": "Malaysia", "Singapour": "Singapore",
    "Indonésie": "Indonesia", "Philippines": "Philippines", "Brunei": "Brunei",
    "Afghanistan": "Afghanistan", "Iran": "Iran", "Irak": "Iraq",
    "Syrie": "Syria", "Liban": "Lebanon", "Jordanie": "Jordan",
    "Israël": "Israel", "Arabie saoudite": "Saudi Arabia", "Yémen": "Yemen",
    "Oman": "Oman", "Émirats arabes unis": "United Arab Emirates",
    "Qatar": "Qatar", "Bahreïn": "Bahrain", "Koweït": "Kuwait",
    "Turquie": "Turkey", "Géorgie": "Georgia", "Arménie": "Armenia",
    "Azerbaïdjan": "Azerbaijan", "Kazakhstan": "Kazakhstan",
    "Ouzbékistan": "Uzbekistan", "Turkménistan": "Turkmenistan",
    "Kirghizistan": "Kyrgyzstan", "Tadjikistan": "Tajikistan",
    "Canada": "Canada", "Mexique": "Mexico", "Guatemala": "Guatemala",
    "Belize": "Belize", "Honduras": "Honduras", "Salvador": "El Salvador",
    "Nicaragua": "Nicaragua", "Costa Rica": "Costa Rica", "Panama": "Panama",
    "Cuba": "Cuba", "Haïti": "Haiti", "République dominicaine": "Dominican Republic",
    "Jamaïque": "Jamaica", "Colombie": "Colombia", "Venezuela": "Venezuela",
    "Guyana": "Guyana", "Suriname": "Suriname", "Équateur": "Ecuador",
    "Pérou": "Peru", "Brésil": "Brazil", "Bolivie": "Bolivia",
    "Paraguay": "Paraguay", "Uruguay": "Uruguay", "Argentine": "Argentina",
    "Chili": "Chile", "Australie": "Australia", "Nouvelle-Zélande": "New Zealand",
    "Papouasie-Nouvelle-Guinée": "Papua New Guinea",
  };

  function getGeoJSONName(frenchName) {
    return COUNTRY_NAME_MAP[frenchName] || frenchName;
  }

  // ---------- Session tracking (generic, per-mode) ----------
  let sessionResults = []; // { country, capital, correct }
  let sessionTotal = 0;

  const MODE_LABELS = {
    locate: "Localiser", quiz: "Quiz", qcm: "QCM", map: "Carte", reverse: "Inversé"
  };

  function resetSession() {
    sessionResults = [];
    sessionSaved = false;
    sessionTotal = filteredData.length;
    updateSessionBar();
    renderSessionPanel();
  }

  function updateSessionBar() {
    const done = sessionResults.length;
    const correct = sessionResults.filter(r => r.correct).length;
    const text = `Question ${Math.min(done + 1, sessionTotal)} / ${sessionTotal} — ✅ ${correct}`;
    // Update all session bars
    $$(".session-progress-text").forEach(el => { el.textContent = text; });
  }

  function recordResult(country, capital, correct) {
    sessionResults.push({ country, capital, correct });
    updateSessionBar();
    renderSessionPanel();
  }

  function renderSessionPanel() {
    const list = $("#session-results-list");
    if (!list) return;
    list.innerHTML = sessionResults.map(r =>
      `<li class="${r.correct ? 'right' : 'wrong'}">${r.correct ? '✅' : '❌'} ${r.country} — ${r.capital}</li>`
    ).join("");
    // Auto-scroll to bottom
    list.scrollTop = list.scrollHeight;
  }

  function saveSession() {
    const correct = sessionResults.filter(r => r.correct).length;
    const total = sessionResults.length;
    if (total === 0) return;
    const pct = Math.round((correct / total) * 100);
    const session = {
      date: new Date().toISOString(),
      mode: MODE_LABELS[currentMode] || currentMode,
      level: levelFilter.value,
      continent: getSelectedContinents().join(", ") || "Tous",
      correct,
      total,
      pct,
      details: sessionResults.map(r => ({ c: r.country, ok: r.correct })),
    };
    const history = JSON.parse(localStorage.getItem("cap_history") || "[]");
    history.unshift(session);
    if (history.length > 50) history.length = 50;
    localStorage.setItem("cap_history", JSON.stringify(history));
  }

  let sessionSaved = false;

  function tryEndSession(feedbackId, nextBtnId) {
    if (sessionResults.length > 0 && !sessionSaved) {
      saveSession();
      sessionSaved = true;
      showCompletion(feedbackId);
      updateSessionBar();
      // Keep results visible in panel until new session
    }
    const btn = $(`#${nextBtnId}`);
    btn.textContent = "🔄 Nouvelle session";
    btn.classList.remove("hidden");
  }

  function handleNewSession(nextBtnId, defaultText, startFn) {
    if (getUnanswered().length === 0) {
      // Save session before resetting (if not already saved by tryEndSession)
      if (sessionResults.length > 0 && !sessionSaved) saveSession();
      resetScore();
      sessionResults = [];
      sessionSaved = false;
      renderSessionPanel();
      $(`#${nextBtnId}`).textContent = defaultText;
    }
    startFn();
  }

  function renderHistory() {
    const history = JSON.parse(localStorage.getItem("cap_history") || "[]");
    const container = $("#history-content");
    if (history.length === 0) {
      container.innerHTML = '<p class="history-empty">Aucune session enregistrée.</p>';
      return;
    }
    let html = '<table class="history-table"><thead><tr><th>Date</th><th>Mode</th><th>Niveau</th><th>Continent</th><th>Score</th><th>%</th><th></th></tr></thead><tbody>';
    history.forEach((s, i) => {
      const d = new Date(s.date);
      const dateStr = d.toLocaleDateString("fr-FR") + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      const pctClass = s.pct >= 60 ? "pct-good" : "pct-bad";
      const lvlLabel = s.level === "all" ? "Tous" : s.level === "programme" ? "Programme" : "Niv. " + s.level;
      html += `<tr class="session-row" data-idx="${i}">
        <td>${dateStr}</td><td>${s.mode || "—"}</td><td>${lvlLabel}</td><td>${s.continent}</td>
        <td>${s.correct}/${s.total}</td>
        <td class="${pctClass}">${s.pct} %</td>
        <td style="cursor:pointer">▼</td>
      </tr>`;
      if (s.details) {
        html += `<tr class="session-details" data-detail="${i}"><td colspan="7" class="session-detail-cell"><ul>`;
        s.details.forEach(d => {
          html += `<li class="${d.ok ? 'right' : 'wrong'}">${d.ok ? '✅' : '❌'} ${d.c}</li>`;
        });
        html += '</ul></td></tr>';
      }
    });
    html += '</tbody></table>';
    container.innerHTML = html;

    container.querySelectorAll(".session-row").forEach(row => {
      row.addEventListener("click", () => {
        const idx = row.dataset.idx;
        const detail = container.querySelector(`.session-details[data-detail="${idx}"]`);
        if (detail) detail.classList.toggle("open");
      });
    });
  }

  // History UI events — use event delegation for all history buttons
  document.addEventListener("click", (e) => {
    if (e.target.closest(".btn-history")) {
      renderHistory();
      $("#history-overlay").classList.remove("hidden");
    }
  });
  $("#history-close").addEventListener("click", () => {
    $("#history-overlay").classList.add("hidden");
  });
  $("#history-overlay").addEventListener("click", (e) => {
    if (e.target === $("#history-overlay")) $("#history-overlay").classList.add("hidden");
  });
  $("#history-clear").addEventListener("click", () => {
    localStorage.removeItem("cap_history");
    renderHistory();
  });

  let locateStarted = false;

  function startLocate() {
    if (!locateStarted) {
      // Show start screen
      $("#locate-start-screen").classList.remove("hidden");
      $("#locate-game").classList.add("hidden");
      return;
    }
    const pool = getUnanswered();
    if (pool.length === 0) {
      tryEndSession("locate-feedback", "locate-next");
      return;
    }
    if (sessionResults.length === 0) resetSession();
    currentQuestion = pickRandom(pool);
    $("#locate-country").textContent = currentQuestion.country;
    $("#locate-feedback").textContent = "";
    $("#locate-feedback").className = "feedback";
    $("#locate-next").classList.add("hidden");
    updateSessionBar();

    if (!locateMapInstance) {
      locateMapInstance = L.map("locate-map-container", { zoomControl: true }).setView([20, 0], 3);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
        attribution: '\u00a9 OpenStreetMap, \u00a9 CARTO',
        maxZoom: 18,
        subdomains: 'abcd',
      }).addTo(locateMapInstance);
      addBorders(locateMapInstance);
      setTimeout(() => locateMapInstance.invalidateSize(), 200);
    } else {
      // Remove previous highlight layer and markers
      if (locateGeoLayer) { locateMapInstance.removeLayer(locateGeoLayer); locateGeoLayer = null; }
      locateMapInstance.eachLayer((layer) => {
        if (layer instanceof L.Marker) locateMapInstance.removeLayer(layer);
      });
      locateMapInstance.setView([20, 0], 3);
      setTimeout(() => locateMapInstance.invalidateSize(), 200);
    }

    // Wait for GeoJSON then enable click detection
    ensureBordersLoaded(() => {
      // Remove old interactive layer if any
      if (locateGeoLayer) { locateMapInstance.removeLayer(locateGeoLayer); locateGeoLayer = null; }
      // Add invisible interactive layer for click detection
      locateGeoLayer = L.geoJSON(bordersGeoJSON, {
        style: { fillOpacity: 0, weight: 0, opacity: 0, interactive: true },
        onEachFeature: (feature, layer) => {
          layer.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            checkLocate(feature, layer);
          });
        }
      }).addTo(locateMapInstance);
    });
  }

  $("#locate-start-btn").addEventListener("click", () => {
    locateStarted = true;
    $("#locate-start-screen").classList.add("hidden");
    $("#locate-game").classList.remove("hidden");
    startLocate();
  });

  function ensureBordersLoaded(cb) {
    if (bordersGeoJSON) { cb(); return; }
    fetch(BORDERS_URL)
      .then(r => r.json())
      .then(data => { bordersGeoJSON = data; cb(); })
      .catch(() => {});
  }

  let locateAnswered = false;
  function checkLocate(feature, layer) {
    if (locateAnswered) return;
    locateAnswered = true;

    const clickedName = feature.properties.ADMIN || feature.properties.name || "";
    const targetName = getGeoJSONName(currentQuestion.country);
    const correct = normalize(clickedName) === normalize(targetName);

    answeredSet.add(currentQuestion.country);
    updateScore(correct);
    recordResult(currentQuestion.country, currentQuestion.capital, correct);

    const fb = $("#locate-feedback");
    const capInfo = `Capitale : ${currentQuestion.capital}`;
    if (correct) {
      layer.setStyle({ fillColor: "#16a34a", fillOpacity: 0.4, color: "#16a34a", weight: 3 });
      fb.textContent = `✅ Bravo ! C'est bien ${currentQuestion.country} ! ${capInfo}`;
      fb.className = "feedback correct";
      // Add marker on the capital
      L.marker([currentQuestion.lat, currentQuestion.lng]).addTo(locateMapInstance)
        .bindPopup(`<strong>${currentQuestion.capital}</strong><br>${currentQuestion.country}`).openPopup();
    } else {
      layer.setStyle({ fillColor: "#dc2626", fillOpacity: 0.3, color: "#dc2626", weight: 2 });
      fb.textContent = `❌ Tu as cliqué sur ${clickedName}. C'était ${currentQuestion.country}. ${capInfo}`;
      fb.className = "feedback wrong";
      // Highlight the correct country in green
      locateGeoLayer.eachLayer((l) => {
        const name = l.feature.properties.ADMIN || l.feature.properties.name || "";
        if (normalize(name) === normalize(targetName)) {
          l.setStyle({ fillColor: "#16a34a", fillOpacity: 0.4, color: "#16a34a", weight: 3 });
        }
      });
      // Add marker on the capital
      L.marker([currentQuestion.lat, currentQuestion.lng]).addTo(locateMapInstance)
        .bindPopup(`<strong>${currentQuestion.capital}</strong><br>${currentQuestion.country}`).openPopup();
    }
    $("#locate-next").classList.remove("hidden");
  }

  $("#locate-next").addEventListener("click", () => {
    locateAnswered = false;
    if (getUnanswered().length === 0) {
      locateStarted = false;
    }
    handleNewSession("locate-next", "Pays suivant →", startLocate);
  });

  // =====================
  //  MODE: Quiz (saisie)
  // =====================
  function startQuiz() {
    const pool = getUnanswered();
    if (pool.length === 0) { tryEndSession("quiz-feedback", "quiz-next"); return; }
    if (sessionResults.length === 0) resetSession();
    currentQuestion = pickRandom(pool);
    $("#quiz-country").textContent = currentQuestion.country;
    $("#quiz-input").value = "";
    $("#quiz-feedback").textContent = "";
    $("#quiz-feedback").className = "feedback";
    $("#quiz-next").classList.add("hidden");
    $("#quiz-input").focus();
  }

  function checkQuiz() {
    const input = $("#quiz-input").value.trim();
    if (!input) return;
    const correct = fuzzyMatch(input, currentQuestion.capital);
    answeredSet.add(currentQuestion.country);
    updateScore(correct);
    recordResult(currentQuestion.country, currentQuestion.capital, correct);
    const fb = $("#quiz-feedback");
    if (correct) {
      fb.textContent = `✅ Correct ! C'est bien ${currentQuestion.capital}.`;
      fb.className = "feedback correct";
    } else {
      fb.textContent = `❌ Raté ! La bonne réponse était : ${currentQuestion.capital}`;
      fb.className = "feedback wrong";
    }
    $("#quiz-next").classList.remove("hidden");
    $("#quiz-input").readOnly = true;
    $("#quiz-submit").disabled = true;
  }

  $("#quiz-submit").addEventListener("click", checkQuiz);
  $("#quiz-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if ($("#quiz-next").classList.contains("hidden")) {
        checkQuiz();
      } else {
        nextQuiz();
      }
    }
  });
  $("#quiz-next").addEventListener("click", nextQuiz);
  function nextQuiz() {
    $("#quiz-input").readOnly = false;
    $("#quiz-submit").disabled = false;
    handleNewSession("quiz-next", "Suivant →", startQuiz);
  }

  // =====================
  //  MODE: QCM
  // =====================
  function startQCM() {
    const pool = getUnanswered();
    if (pool.length === 0) { tryEndSession("qcm-feedback", "qcm-next"); return; }
    if (sessionResults.length === 0) resetSession();
    currentQuestion = pickRandom(pool);
    $("#qcm-country").textContent = currentQuestion.country;
    $("#qcm-feedback").textContent = "";
    $("#qcm-feedback").className = "feedback";
    $("#qcm-next").classList.add("hidden");

    // Build 4 options (1 correct + 3 wrong)
    const wrongPool = filteredData.filter((d) => d.country !== currentQuestion.country);
    const wrongs = shuffle(wrongPool).slice(0, 3).map((d) => d.capital);
    const options = shuffle([currentQuestion.capital, ...wrongs]);

    const grid = $("#qcm-options");
    grid.innerHTML = "";
    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "qcm-option";
      btn.textContent = opt;
      btn.addEventListener("click", () => checkQCM(btn, opt));
      grid.appendChild(btn);
    });
  }

  function checkQCM(btn, chosen) {
    const correct = chosen === currentQuestion.capital;
    answeredSet.add(currentQuestion.country);
    updateScore(correct);
    recordResult(currentQuestion.country, currentQuestion.capital, correct);

    $$(".qcm-option").forEach((b) => {
      b.classList.add("disabled");
      if (b.textContent === currentQuestion.capital) b.classList.add("highlight-correct");
    });
    btn.classList.add(correct ? "selected-correct" : "selected-wrong");

    const fb = $("#qcm-feedback");
    fb.textContent = correct
      ? `✅ Bravo ! C'est bien ${currentQuestion.capital}.`
      : `❌ Raté ! La bonne réponse était : ${currentQuestion.capital}`;
    fb.className = "feedback " + (correct ? "correct" : "wrong");
    $("#qcm-next").classList.remove("hidden");
  }

  $("#qcm-next").addEventListener("click", () => {
    handleNewSession("qcm-next", "Suivant →", startQCM);
  });

  // =====================
  //  MODE: Carte
  // =====================
  function startMap() {
    const pool = getUnanswered();
    if (pool.length === 0) { tryEndSession("map-feedback", "map-next"); return; }
    if (sessionResults.length === 0) resetSession();
    currentQuestion = pickRandom(pool);
    $("#map-country").textContent = currentQuestion.capital;
    $("#map-feedback").textContent = "";
    $("#map-feedback").className = "feedback";
    $("#map-next").classList.add("hidden");

    if (!mapInstance) {
      mapInstance = L.map("map-container", { zoomControl: true }).setView([20, 0], 3);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
        attribution: '\u00a9 OpenStreetMap, \u00a9 CARTO',
        maxZoom: 18,
        subdomains: 'abcd',
      }).addTo(mapInstance);
      addBorders(mapInstance);
      mapInstance.on("click", onMapClick);
      // Fix tile loading after display change
      setTimeout(() => mapInstance.invalidateSize(), 200);
    } else {
      if (clickMarker) { mapInstance.removeLayer(clickMarker); clickMarker = null; }
      if (targetMarker) { mapInstance.removeLayer(targetMarker); targetMarker = null; }
      mapInstance.setView([20, 0], 3);
      setTimeout(() => mapInstance.invalidateSize(), 200);
    }
  }

  function onMapClick(e) {
    if (!currentQuestion || !$("#map-next").classList.contains("hidden")) return;

    const userLat = e.latlng.lat;
    const userLng = e.latlng.lng;
    const targetLat = currentQuestion.lat;
    const targetLng = currentQuestion.lng;

    // Check if click is inside the correct country
    const targetGeoName = getGeoJSONName(currentQuestion.country);
    let clickedInCountry = false;
    if (bordersGeoJSON) {
      for (const feature of bordersGeoJSON.features) {
        const name = feature.properties.ADMIN || feature.properties.name || "";
        if (normalize(name) === normalize(targetGeoName)) {
          const layer = L.geoJSON(feature);
          const bounds = layer.getBounds();
          if (bounds.contains(e.latlng)) {
            clickedInCountry = true;
          }
          break;
        }
      }
    }

    // Place markers
    const redIcon = L.icon({
      iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      iconSize: [25, 41], iconAnchor: [12, 41],
    });
    const greenIcon = L.icon({
      iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      iconSize: [25, 41], iconAnchor: [12, 41],
    });

    clickMarker = L.marker([userLat, userLng], { icon: redIcon }).addTo(mapInstance).bindPopup("Ton clic").openPopup();
    targetMarker = L.marker([targetLat, targetLng], { icon: greenIcon }).addTo(mapInstance).bindPopup(currentQuestion.capital);

    const correct = clickedInCountry;
    answeredSet.add(currentQuestion.country);
    updateScore(correct);
    recordResult(currentQuestion.country, currentQuestion.capital, correct);

    const fb = $("#map-feedback");
    if (correct) {
      fb.textContent = `✅ Bien joué ! ${currentQuestion.capital} est bien dans ${currentQuestion.country}.`;
      fb.className = "feedback correct";
    } else {
      fb.textContent = `❌ Raté ! ${currentQuestion.capital} se trouve dans ${currentQuestion.country}.`;
      fb.className = "feedback wrong";
    }
    // Fit bounds to show both markers
    mapInstance.fitBounds([[userLat, userLng], [targetLat, targetLng]], { padding: [50, 50] });
    $("#map-next").classList.remove("hidden");
  }

  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  $("#map-next").addEventListener("click", () => {
    handleNewSession("map-next", "Suivant →", startMap);
  });

  // =====================
  //  MODE: Inversé
  // =====================
  function startReverse() {
    const pool = getUnanswered();
    if (pool.length === 0) { tryEndSession("reverse-feedback", "reverse-next"); return; }
    if (sessionResults.length === 0) resetSession();
    currentQuestion = pickRandom(pool);
    $("#reverse-capital").textContent = currentQuestion.capital;
    $("#reverse-input").value = "";
    $("#reverse-feedback").textContent = "";
    $("#reverse-feedback").className = "feedback";
    $("#reverse-next").classList.add("hidden");
    $("#reverse-input").focus();
  }

  function checkReverse() {
    const input = $("#reverse-input").value.trim();
    if (!input) return;
    const correct = fuzzyMatch(input, currentQuestion.country);
    answeredSet.add(currentQuestion.country);
    updateScore(correct);
    recordResult(currentQuestion.country, currentQuestion.capital, correct);
    const fb = $("#reverse-feedback");
    if (correct) {
      fb.textContent = `✅ Correct ! ${currentQuestion.capital} est la capitale de ${currentQuestion.country}.`;
      fb.className = "feedback correct";
    } else {
      fb.textContent = `❌ Raté ! La bonne réponse était : ${currentQuestion.country}`;
      fb.className = "feedback wrong";
    }
    $("#reverse-next").classList.remove("hidden");
    $("#reverse-input").disabled = true;
    $("#reverse-submit").disabled = true;
  }

  $("#reverse-submit").addEventListener("click", checkReverse);
  $("#reverse-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if ($("#reverse-next").classList.contains("hidden")) {
        checkReverse();
      } else {
        nextReverse();
      }
    }
  });
  $("#reverse-next").addEventListener("click", nextReverse);
  function nextReverse() {
    $("#reverse-input").disabled = false;
    $("#reverse-submit").disabled = false;
    handleNewSession("reverse-next", "Suivant →", startReverse);
  }

  // =====================
  //  MODE: Apprendre
  // =====================
  function startLearn() {
    renderLearnTable();
    initLearnMap();
  }

  function renderLearnTable(searchTerm = "") {
    const tbody = $("#learn-tbody");
    let data = [...filteredData];
    if (searchTerm) {
      const s = normalize(searchTerm);
      data = data.filter(
        (d) => normalize(d.country).includes(s) || normalize(d.capital).includes(s)
      );
    }
    data.sort((a, b) => {
      let va, vb;
      if (sortColumn === "level") {
        va = a.level; vb = b.level;
        return sortAsc ? va - vb : vb - va;
      }
      va = a[sortColumn] || "";
      vb = b[sortColumn] || "";
      return sortAsc ? va.localeCompare(vb, "fr") : vb.localeCompare(va, "fr");
    });
    tbody.innerHTML = data
      .map(
        (d) => {
          const lvl = d.level > 0 ? `<span class="level-badge level-${d.level}">Niv. ${d.level}</span>` : '<span class="level-badge level-0">—</span>';
          return `<tr data-lat="${d.lat}" data-lng="${d.lng}">
          <td><strong>${d.country}</strong></td>
          <td>${d.capital}</td>
          <td>${d.continent}</td>
          <td>${lvl}</td>
        </tr>`;
        }
      )
      .join("");

    // Row click → zoom on map
    tbody.querySelectorAll("tr").forEach((tr) => {
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => {
        const lat = parseFloat(tr.dataset.lat);
        const lng = parseFloat(tr.dataset.lng);
        if (learnMapInstance) {
          learnMapInstance.setView([lat, lng], 6, { animate: true });
        }
        tbody.querySelectorAll("tr").forEach((r) => r.classList.remove("highlight"));
        tr.classList.add("highlight");
      });
    });
  }

  function initLearnMap() {
    if (!learnMapInstance) {
      learnMapInstance = L.map("learn-map-container").setView([20, 0], 3);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
        attribution: '\u00a9 OpenStreetMap, \u00a9 CARTO',
        maxZoom: 18,
        subdomains: 'abcd',
      }).addTo(learnMapInstance);
      addBorders(learnMapInstance);
      setTimeout(() => learnMapInstance.invalidateSize(), 200);
    } else {
      learnMapInstance.eachLayer((layer) => {
        if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
          learnMapInstance.removeLayer(layer);
        }
      });
      setTimeout(() => learnMapInstance.invalidateSize(), 200);
    }

    // Add markers for all filtered capitals
    filteredData.forEach((d) => {
      L.circleMarker([d.lat, d.lng], {
        radius: 5,
        fillColor: "#2563eb",
        color: "#1e40af",
        weight: 1,
        fillOpacity: 0.8,
      })
        .addTo(learnMapInstance)
        .bindPopup(`<strong>${d.capital}</strong><br>${d.country}<br><em>${d.continent}</em>`);
    });
  }

  // Search
  $("#learn-search").addEventListener("input", (e) => {
    renderLearnTable(e.target.value);
  });

  // Sort headers
  $$("#learn-table th").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (sortColumn === col) {
        sortAsc = !sortAsc;
      } else {
        sortColumn = col;
        sortAsc = true;
      }
      // Update header arrows
      $$("#learn-table th").forEach((h) => {
        const arrow = h.dataset.sort === sortColumn ? (sortAsc ? " ▲" : " ▼") : "";
        h.textContent = h.textContent.replace(/ [▲▼]/, "") + arrow;
      });
      renderLearnTable($("#learn-search").value);
    });
  });

  // =====================
  //  Completion
  // =====================
  function showCompletion(feedbackId) {
    const fb = $(`#${feedbackId}`);
    const pct = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0;
    let msg = `🎉 Terminé ! Score final : ${score.correct}/${score.total} (${pct} %)`;
    if (pct === 100) msg += " — PARFAIT ! 🏆";
    else if (pct >= 80) msg += " — Très bien ! 💪";
    else if (pct >= 60) msg += " — Pas mal, continue ! 📚";
    else msg += " — Révise encore un peu ! 💡";
    fb.textContent = msg;
    fb.className = "feedback " + (pct >= 60 ? "correct" : "wrong");
  }

  // =====================
  //  Event listeners
  // =====================
  modeSelect.addEventListener("change", () => switchMode(modeSelect.value));

  // Continent multi-select toggle
  continentBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    continentDropdown.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!continentFilter.contains(e.target)) {
      continentDropdown.classList.add("hidden");
    }
  });
  continentDropdown.addEventListener("change", () => {
    updateContinentLabel();
    localStorage.setItem("cap_continent", JSON.stringify(getSelectedContinents()));
    applyFilter();
  });
  levelFilter.addEventListener("change", () => {
    localStorage.setItem("cap_level", levelFilter.value);
    applyFilter();
  });

  $("#reset-btn").addEventListener("click", () => {
    resetScore();
    startCurrentMode();
  });

  // ---------- Init ----------
  const savedLevel = localStorage.getItem("cap_level");
  const savedContinent = localStorage.getItem("cap_continent");
  if (savedLevel) levelFilter.value = savedLevel;
  if (savedContinent) {
    try {
      const sel = JSON.parse(savedContinent);
      if (Array.isArray(sel)) {
        continentDropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          cb.checked = sel.includes(cb.value);
        });
      }
    } catch (e) {
      // Old format (single string) — ignore, keep defaults
    }
  }
  updateContinentLabel();
  applyFilter();
})();
