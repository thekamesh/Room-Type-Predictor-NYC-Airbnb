(() => {
  "use strict";

  /* ---------------------------------------------------------
   * NYC borough -> neighbourhood data (subset of the classic
   * NYC Airbnb open-data neighbourhood groups/neighbourhoods)
   * --------------------------------------------------------- */
  const BOROUGHS = {
    "Manhattan": [
      "Upper West Side", "Upper East Side", "Harlem", "East Village",
      "West Village", "Chelsea", "Hell's Kitchen", "Midtown",
      "Financial District", "Chinatown", "Murray Hill", "Inwood",
      "Washington Heights", "Morningside Heights", "SoHo",
      "Greenwich Village", "Kips Bay", "Gramercy Park", "Tribeca",
      "Battery Park City"
    ],
    "Brooklyn": [
      "Williamsburg", "Bedford-Stuyvesant", "Bushwick", "Crown Heights",
      "Greenpoint", "Park Slope", "Sunset Park", "Flatbush",
      "Prospect-Lefferts Gardens", "Clinton Hill", "Fort Greene",
      "Bay Ridge", "Brooklyn Heights", "East Flatbush", "Canarsie"
    ],
    "Queens": [
      "Astoria", "Long Island City", "Flushing", "Ridgewood",
      "Sunnyside", "Jackson Heights", "Elmhurst", "Woodside",
      "Forest Hills", "Rockaway Beach", "Jamaica", "Corona"
    ],
    "Bronx": [
      "Mott Haven", "Fordham", "Riverdale", "Kingsbridge",
      "Concourse", "Belmont", "Williamsbridge", "City Island"
    ],
    "Staten Island": [
      "St. George", "Tompkinsville", "Stapleton", "Great Kills", "New Dorp", "Port Richmond"
    ]
  };

  // Rough centroid coords per borough, used only to prefill lat/long on sample fill.
  const BOROUGH_COORDS = {
    "Manhattan": [40.7831, -73.9712],
    "Brooklyn": [40.6782, -73.9442],
    "Queens": [40.7282, -73.7949],
    "Bronx": [40.8448, -73.8648],
    "Staten Island": [40.5795, -74.1502]
  };

  // Colour per class label, so the skyline chart reads consistently.
  const CLASS_COLORS = {
    "Entire home/apt": "var(--amber)",
    "Private room": "var(--teal)",
    "Shared room": "var(--indigo)",
    "Hotel room": "var(--rose)"
  };
  const FALLBACK_COLORS = ["var(--amber)", "var(--teal)", "var(--indigo)", "var(--rose)", "var(--terra)"];

  // Best-guess alphabetical label order, used only if the API response
  // doesn't tell us the class names directly (see README note at bottom).
  const GUESS_LABELS = {
    3: ["Entire home/apt", "Private room", "Shared room"],
    4: ["Entire home/apt", "Hotel room", "Private room", "Shared room"]
  };

  const els = {};
  [
    "listingForm", "neighbourhood_group", "neighbourhood", "latitude", "longitude",
    "price", "minimum_nights", "availability_365", "number_of_reviews",
    "reviews_per_month", "calculated_host_listings_count", "predictBtn",
    "formError", "results", "resultsLede", "skylineChart", "resultsError",
    "resultsErrorText", "dismissError", "predictAnother", "fillSample",
    "toggleSettings", "settingsPanel", "apiBase", "statNeighbourhoods",
    "statPredictions", "rawToggle", "rawResponse"
  ].forEach(id => (els[id] = document.getElementById(id)));

  let predictionCount = 0;

  /* ---------------------------------------------------------
   * Skyline background: generate a randomized SVG skyline once,
   * with windows that flicker on and off independently via CSS.
   * --------------------------------------------------------- */
  function buildSkylineBackground() {
    const svg = document.getElementById("skylineSvg");
    const NS = "http://www.w3.org/2000/svg";
    const W = 1600, H = 400;
    let x = 0;
    let seed = 42;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    while (x < W) {
      const bw = 60 + rand() * 90;
      const bh = 80 + rand() * 260;
      const bx = x;
      const by = H - bh;

      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", bx);
      rect.setAttribute("y", by);
      rect.setAttribute("width", bw);
      rect.setAttribute("height", bh + 20);
      rect.setAttribute("class", "bldg bldg-outline");
      svg.appendChild(rect);

      const cols = Math.max(2, Math.floor(bw / 16));
      const rows = Math.max(3, Math.floor(bh / 20));
      const padX = (bw - cols * 10) / (cols + 1);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rand() < 0.28) continue; // gaps between windows
          const wx = bx + padX + c * (10 + padX);
          const wy = by + 14 + r * 18;
          const win = document.createElementNS(NS, "rect");
          win.setAttribute("x", wx);
          win.setAttribute("y", wy);
          win.setAttribute("width", 6);
          win.setAttribute("height", 9);
          const lit = rand() < 0.5;
          win.setAttribute("class", `window ${lit ? "lit" : ""} ${rand() < 0.2 ? "teal" : ""}`);
          win.style.animationDelay = `${(rand() * 8).toFixed(2)}s`;
          svg.appendChild(win);
        }
      }
      x += bw + 4;
    }
  }

  /* ---------------------------------------------------------
   * Populate borough / neighbourhood selects (cascading)
   * --------------------------------------------------------- */
  function populateBoroughs() {
    const sel = els.neighbourhood_group;
    Object.keys(BOROUGHS).forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    populateNeighbourhoods(sel.value);
  }

  function populateNeighbourhoods(borough) {
    const sel = els.neighbourhood;
    sel.innerHTML = "";
    (BOROUGHS[borough] || []).forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    const total = Object.values(BOROUGHS).reduce((sum, arr) => sum + arr.length, 0);
    els.statNeighbourhoods.textContent = total;
  }

  els.neighbourhood_group.addEventListener("change", e => populateNeighbourhoods(e.target.value));

  /* ---------------------------------------------------------
   * Settings panel (API base URL), persisted in localStorage
   * --------------------------------------------------------- */
  function initSettings() {
    const saved = localStorage.getItem("roomPredictor.apiBase");
    if (saved) els.apiBase.value = saved;
    els.apiBase.addEventListener("change", () => {
      localStorage.setItem("roomPredictor.apiBase", els.apiBase.value.trim());
    });
    els.toggleSettings.addEventListener("click", () => {
      const hidden = els.settingsPanel.hasAttribute("hidden");
      if (hidden) els.settingsPanel.removeAttribute("hidden");
      else els.settingsPanel.setAttribute("hidden", "");
      els.toggleSettings.setAttribute("aria-expanded", String(hidden));
    });
  }

  /* ---------------------------------------------------------
   * Sample listing fill, for quick testing
   * --------------------------------------------------------- */
  function fillSample() {
    const boroughs = Object.keys(BOROUGHS);
    const borough = boroughs[Math.floor(Math.random() * boroughs.length)];
    els.neighbourhood_group.value = borough;
    populateNeighbourhoods(borough);
    const list = BOROUGHS[borough];
    els.neighbourhood.value = list[Math.floor(Math.random() * list.length)];

    const [lat, lng] = BOROUGH_COORDS[borough];
    els.latitude.value = (lat + (Math.random() - 0.5) * 0.06).toFixed(6);
    els.longitude.value = (lng + (Math.random() - 0.5) * 0.06).toFixed(6);
    els.price.value = Math.round(60 + Math.random() * 260);
    els.minimum_nights.value = [1, 2, 3, 5, 7, 30][Math.floor(Math.random() * 6)];
    els.availability_365.value = Math.round(Math.random() * 365);
    els.number_of_reviews.value = Math.round(Math.random() * 120);
    els.reviews_per_month.value = (Math.random() * 4).toFixed(2);
    els.calculated_host_listings_count.value = Math.round(1 + Math.random() * 6);
  }

  /* ---------------------------------------------------------
   * Form -> payload, mirroring the Pydantic Features model
   * --------------------------------------------------------- */
  function readPayload() {
    return {
      latitude: parseFloat(els.latitude.value),
      longitude: parseFloat(els.longitude.value),
      price: parseFloat(els.price.value),
      minimum_nights: parseInt(els.minimum_nights.value, 10),
      number_of_reviews: parseInt(els.number_of_reviews.value, 10),
      reviews_per_month: parseFloat(els.reviews_per_month.value),
      calculated_host_listings_count: parseInt(els.calculated_host_listings_count.value, 10),
      availability_365: parseInt(els.availability_365.value, 10),
      neighbourhood_group: els.neighbourhood_group.value,
      neighbourhood: els.neighbourhood.value
    };
  }

  function validate(payload) {
    const errors = [];
    if (!(payload.latitude >= -90 && payload.latitude <= 90)) errors.push("Latitude must be between -90 and 90.");
    if (!(payload.longitude >= -180 && payload.longitude <= 180)) errors.push("Longitude must be between -180 and 180.");
    if (!(payload.price > 0)) errors.push("Price must be greater than 0.");
    if (!(payload.minimum_nights >= 1 && payload.minimum_nights <= 365)) errors.push("Minimum nights must be between 1 and 365.");
    if (!(payload.number_of_reviews >= 0)) errors.push("Total reviews can't be negative.");
    if (!(payload.reviews_per_month >= 0)) errors.push("Reviews per month can't be negative.");
    if (!(payload.calculated_host_listings_count >= 0)) errors.push("Host's listing count can't be negative.");
    if (!(payload.availability_365 >= 0 && payload.availability_365 <= 365)) errors.push("Available days must be between 0 and 365.");
    if (!payload.neighbourhood_group) errors.push("Choose a borough.");
    if (!payload.neighbourhood) errors.push("Choose a neighbourhood.");
    return errors;
  }

  /* ---------------------------------------------------------
   * Loading state on the submit button, cycling through
   * a few short messages so the wait feels alive.
   * --------------------------------------------------------- */
  let loadingTimer = null;
  function setLoading(isLoading) {
    const btn = els.predictBtn;
    const label = btn.querySelector(".btn-label");
    if (isLoading) {
      btn.disabled = true;
      btn.classList.add("loading");
      const phrases = ["Reading the listing…", "Checking the neighbourhood…", "Asking the model…"];
      let i = 0;
      label.setAttribute("data-loading", phrases[0]);
      loadingTimer = setInterval(() => {
        i = (i + 1) % phrases.length;
        label.setAttribute("data-loading", phrases[i]);
      }, 900);
    } else {
      clearInterval(loadingTimer);
      btn.disabled = false;
      btn.classList.remove("loading");
    }
  }

  /* ---------------------------------------------------------
   * Render the prediction as an animated "skyline" bar chart:
   * each class is a building whose height is its probability.
   * --------------------------------------------------------- */
  function renderResults(data) {
    const probs = Array.isArray(data.Probability) ? data.Probability : [];
    const predicted = data.Predicted_room_type;
    let labels = data.classes || data.Classes;
    if (!labels && GUESS_LABELS[probs.length]) labels = GUESS_LABELS[probs.length];
    if (!labels) labels = probs.map((_, i) => `Class ${i + 1}`);

    els.skylineChart.innerHTML = "";
    const maxProb = Math.max(...probs, 0.0001);

    labels.forEach((label, i) => {
      const p = probs[i] ?? 0;
      const isWinner = label === predicted || (labels.length === 1 && i === 0);
      const color = CLASS_COLORS[label] || FALLBACK_COLORS[i % FALLBACK_COLORS.length];

      const col = document.createElement("div");
      col.className = "building-col" + (isWinner ? " winner" : "");

      const track = document.createElement("div");
      track.className = "building-track";
      const bar = document.createElement("div");
      bar.className = "building";
      bar.style.setProperty("--bar-color", color);
      track.appendChild(bar);

      const pct = document.createElement("div");
      pct.className = "building-pct";
      pct.textContent = "0%";

      const lbl = document.createElement("div");
      lbl.className = "building-label";
      lbl.textContent = label;

      col.appendChild(track);
      col.appendChild(pct);
      col.appendChild(lbl);
      if (isWinner) {
        const tag = document.createElement("span");
        tag.className = "winner-tag";
        tag.textContent = "Model's pick";
        col.appendChild(tag);
      }
      els.skylineChart.appendChild(col);

      // animate height + count-up after layout settles
      requestAnimationFrame(() => {
        setTimeout(() => {
          bar.style.height = `${Math.max(4, (p / maxProb) * 100)}%`;
          animateCount(pct, p * 100);
        }, 40 + i * 90);
      });
    });

    els.resultsLede.textContent = predicted
      ? `Most likely: ${predicted}.`
      : "Here's how the model split its confidence.";

    els.rawResponse.textContent = JSON.stringify(data, null, 2);

    predictionCount += 1;
    els.statPredictions.textContent = predictionCount;
  }

  function animateCount(node, target) {
    const start = performance.now();
    const duration = 700;
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = `${(target * eased).toFixed(1)}%`;
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------------------------------------------------------
   * Submit handler
   * --------------------------------------------------------- */
  async function handleSubmit(e) {
    e.preventDefault();
    els.formError.hidden = true;
    els.resultsError.hidden = true;

    const payload = readPayload();
    const errors = validate(payload);
    if (errors.length) {
      els.formError.textContent = errors[0] + (errors.length > 1 ? ` (and ${errors.length - 1} more)` : "");
      els.formError.hidden = false;
      return;
    }

    const base = "https://room-type-predictor-nyc-airbnb-gpci.onrender.com"
    setLoading(true);

    try {
      const res = await fetch(`${base}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let detail = `Server responded with ${res.status}.`;
        try {
          const body = await res.json();
          if (body.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
        } catch (_) { /* ignore parse failure */ }
        throw new Error(detail);
      }

      const data = await res.json();
      els.results.hidden = false;
      els.results.scrollIntoView({ behavior: "smooth", block: "start" });
      renderResults(data);
    } catch (err) {
      els.resultsErrorText.textContent =
        err.message === "Failed to fetch"
          ? `Couldn't reach ${base}. Check that your FastAPI server is running (uvicorn main:app --reload) and that the URL in "Connection settings" is correct.`
          : err.message;
      els.resultsError.hidden = false;
      els.resultsError.scrollIntoView({ behavior: "smooth", block: "start" });
    } finally {
      setLoading(false);
    }
  }

  /* ---------------------------------------------------------
   * Wire up remaining UI
   * --------------------------------------------------------- */
  function init() {
    buildSkylineBackground();
    populateBoroughs();
    initSettings();

    els.listingForm.addEventListener("submit", handleSubmit);
    els.fillSample.addEventListener("click", fillSample);

    els.dismissError.addEventListener("click", () => { els.resultsError.hidden = true; });
    els.predictAnother.addEventListener("click", () => {
      els.results.hidden = true;
      els.listingForm.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    els.rawToggle.addEventListener("click", () => {
      els.rawResponse.hidden = !els.rawResponse.hidden;
      els.rawToggle.textContent = els.rawResponse.hidden ? "View raw response" : "Hide raw response";
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
