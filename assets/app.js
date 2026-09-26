/* SiteFootprint web app. Static front end for the /api/footprint serverless function. */
(() => {
const {esc, fmt} = Charts;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const REF = {Oslo: [59.91, 10.75, "Norway"], Paris: [48.86, 2.35, "France"], Ashburn: [39.04, -77.49, "United States"],
  Beijing: [39.90, 116.40, "China"], Marrakech: [31.63, -8.01, "Morocco"], Lagos: [6.52, 3.38, "Nigeria"]};
const ARCH = {evaporative: "Air + cooling tower", dry: "Air + dry cooler", dtc_dry: "Liquid (DTC) + dry cooler"};
const ARCH_LONG = {evaporative: "Air cooling with a hybrid cooling tower (uses water)", dry: "Air cooling with dry coolers (no water)",
  dtc_dry: "Direct-to-chip liquid cooling with dry coolers (no water)"};
const LIGHT = {bg: "#FFFFFF", s1: "#FFFFFF", s2: "#F2F2EF", s3: "#E8E8E4", line: "#E2E2DD", text: "#0F1114", muted: "#5B6169",
  faint: "#9A9FA6", accent: "#E2502A", d0: "#E4E5E7", d1: "#15181C", g1: "#15181C", g2: "#4E545C", g3: "#8A9098", g4: "#BFC3C8"};
const ARCH_PHRASE = {evaporative: "air cooling with a cooling tower", dry: "air cooling with dry coolers", dtc_dry: "direct-to-chip liquid cooling"};
const CENTRAL = {mfu: .40, overhead: 1.08, p_it: 1.05, peak: 989.4e12, pue_screen: 1.10};
const E_FU_CENTRAL = 1e25 * CENTRAL.overhead / (CENTRAL.mfu * CENTRAL.peak) / 3600 * CENTRAL.p_it; // kWh IT

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
};
const defaultCfg = () => ({mode: "flop", flop: "1e25", gpuh: "", arch: "evaporative", years: [2024], diesel: 0,
  locs: [{name: "Oslo", ref: true}, {name: "Ashburn", ref: true}, {name: "Lagos", ref: true}]});
const S = {cfg: store.get("sf_cfg") || defaultCfg(), result: store.get("sf_result"), world: null, cal: null, params: null,
  countries: null, atlasYear: 2024, atlasSel: null, playing: null, lab: {grid: 0, diesel: 0, mfu: .40, pit: 1.05, arch: null}};
const charts = {}; // id -> (C) => svg, for re-render and export

/* ---------- palette & theme ---------- */
function theme() { return document.documentElement.dataset.theme === "light" ? "light" : "dark"; }
function palette() {
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue("--" + n).trim();
  const C = {}; ["bg", "s1", "s2", "s3", "line", "text", "muted", "faint", "accent", "d0", "d1", "g1", "g2", "g3", "g4"].forEach(k => C[k] = v(k));
  return C;
}
/* reference site in the accent; others in a grey ramp, dashed beyond four */
function siteStyles(r, C) {
  const greys = [C.g1, C.g2, C.g3, C.g4]; let k = 0;
  return r.sites.map(s => s.name === r.inputs.reference ? {color: C.accent, width: 2.2}
    : (() => { const i = k++; return {color: greys[i % 4], width: 1.6, dash: i >= 4 ? "5 4" : null}; })());
}
const savedTheme = store.get("sf_theme"); if (savedTheme) document.documentElement.dataset.theme = savedTheme;

/* ---------- utilities ---------- */
const sup = n => String(n).split("").map(c => "⁰¹²³⁴⁵⁶⁷⁸⁹"[+c] ?? c).join("");
function runLabel(r) {
  if (!r) return "";
  if (r.inputs.flop) { const [m, e] = Number(r.inputs.flop).toExponential(1).split("e+"); return `${m} × 10${sup(e)} FLOP`; }
  return `${fmt(r.inputs.gpu_hours)} GPU-hours`;
}
function locSpec(l) { return l.ref ? l.name : {name: l.name, lat: l.lat, lon: l.lon, country: l.country}; }
function locCoords(l) { return l.ref ? {lat: REF[l.name][0], lon: REF[l.name][1], country: REF[l.name][2]} : l; }
function download(name, text, type) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); const o = btn.textContent; btn.textContent = "Copied"; setTimeout(() => btn.textContent = o, 1400); }
  catch { btn.textContent = "Select and copy manually"; }
}
function saveCfg() { store.set("sf_cfg", S.cfg); }
function showErr(msg, where = "#page") {
  $(".err", $(where))?.remove();
  $(where).insertAdjacentHTML("afterbegin", `<div class="err" role="alert">${esc(msg)}</div>`);
  $(where).scrollIntoView({behavior: "smooth", block: "start"});
}

/* ---------- data loading ---------- */
async function loadWorld() { if (!S.world) S.world = await (await fetch("data/world.json")).json(); return S.world; }
async function loadCal() { if (!S.cal) S.cal = await (await fetch("data/calibration.json")).json(); return S.cal; }
async function loadParams() {
  if (!S.params) { try { S.params = await (await fetch("/api/footprint?params=1")).json(); } catch { S.params = null; } }
  return S.params;
}
async function loadCountries() {
  if (!S.countries) { try { S.countries = (await (await fetch("/api/footprint?countries=1")).json()).countries; } catch { S.countries = []; } }
  return S.countries;
}

/* ---------- chart card ---------- */
function chartCard(id, title, desc, render, extra = "") {
  charts[id] = render;
  return `<section class="card chart" id="card-${id}">
    <div class="card-h"><div><h3>${esc(title)}</h3>${desc ? `<p>${desc}</p>` : ""}</div>
      <div class="chart-actions"><button class="btn2" data-svg="${id}" title="Download as SVG for papers">SVG</button><button class="btn2" data-png="${id}" title="Download as PNG">PNG</button></div></div>
    <div class="chart-body" data-chart="${id}"></div>${extra}</section>`;
}
function drawCharts() {
  const C = palette();
  $$("[data-chart]").forEach(el => {
    const f = charts[el.dataset.chart]; if (!f) return;
    el.innerHTML = f(C, Math.max(300, Math.round(el.clientWidth || 700)));
  });
}
function exportSvg(id) {
  const f = charts[id]; const el = $(`[data-chart="${id}"]`); if (!f || !el) return null;
  const W = Math.max(640, Math.round(el.clientWidth));
  let svg = f(LIGHT, W, true);
  return svg.replace(/(<svg[^>]*>)/, `$1<rect width="100%" height="100%" fill="#FFFFFF"/>`);
}
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-svg],[data-png]"); if (!b) return;
  const id = b.dataset.svg || b.dataset.png, svg = exportSvg(id); if (!svg) return;
  if (b.dataset.svg) return download(`sitefootprint_${id}.svg`, svg, "image/svg+xml");
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/), w = +vb[1], h = +vb[2], img = new Image();
  img.onload = () => { const c = document.createElement("canvas"); c.width = w * 3; c.height = h * 3;
    const x = c.getContext("2d"); x.scale(3, 3); x.drawImage(img, 0, 0, w, h);
    c.toBlob(bl => { const a = document.createElement("a"); a.href = URL.createObjectURL(bl); a.download = `sitefootprint_${id}.png`; a.click(); }); };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
});

/* ---------- analysis request ---------- */
async function runAnalysis(btn) {
  const c = S.cfg;
  if (!c.locs.length) return showErr("Add at least one location.");
  const v = parseFloat(c.mode === "gpuh" ? c.gpuh : c.flop);
  if (!(v > 0)) return showErr(c.mode === "gpuh" ? "Enter accelerator-hours greater than zero." : "Enter training compute in FLOP, for example 1e25.");
  const body = {arch: c.arch, years: c.years, diesel_share: +c.diesel, n_draws: 500, locations: c.locs.map(locSpec)};
  if (c.mode === "gpuh") body.gpu_hours = v; else body.flop = v;
  btn.disabled = true; btn.textContent = `Fetching hourly weather for ${c.locs.length} location${c.locs.length > 1 ? "s" : ""}…`;
  try {
    const r = await fetch("/api/footprint", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `The analysis failed (status ${r.status}).`);
    d._completed = new Date().toISOString();
    S.result = d; store.set("sf_result", d); S.lab.arch = null;
    render();
  } catch (e) { showErr(e.message.includes("Failed to fetch") ? "The analysis service could not be reached. Check your connection and try again." : e.message); }
  finally { btn.disabled = false; btn.textContent = "Run analysis"; }
}

/* ---------- findings ---------- */
function findings(r) {
  const s = [...r.sites].sort((a, b) => a.co2_t.median - b.co2_t.median), ref = r.inputs.reference, out = [];
  const best = s[0], worst = s[s.length - 1];
  if (s.length > 1) {
    const ratio = worst.co2_t.median / best.co2_t.median;
    out.push(`<b>${esc(best.name)}</b> has the lowest emissions (${fmt(best.co2_t.median)} t CO₂e). <b>${esc(worst.name)}</b> is highest at ${fmt(worst.co2_t.median)} t, ${ratio >= 1.95 ? fmt(ratio, 0) + " times as much" : fmt((ratio - 1) * 100, 0) + "% more"}.`);
    const gs = r.sites.filter(x => x.name !== ref && x.vs_reference.grid_share != null).map(x => x.vs_reference.grid_share * 100);
    if (gs.length) out.push(`The power grid explains ${gs.length > 1 ? fmt(Math.min(...gs)) + "–" + fmt(Math.max(...gs)) : fmt(gs[0])}% of each location's difference from ${esc(ref)}; the rest comes from climate and cooling.`);
    const list = a => a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : a[0];
    const always = r.sites.filter(x => x.prob_lower_than_reference === 1).map(x => esc(x.name));
    const never = r.sites.filter(x => x.prob_lower_than_reference === 0).map(x => esc(x.name));
    const parts = [];
    if (always.length) parts.push(`${list(always)} ${always.length > 1 ? "emit" : "emits"} less than ${esc(ref)} in all ${r.inputs.n_draws} paired draws`);
    if (never.length) parts.push(`${list(never)} ${never.length > 1 ? "emit" : "emits"} more than ${esc(ref)} in all ${r.inputs.n_draws} paired draws`);
    r.sites.filter(x => x.prob_lower_than_reference != null && x.prob_lower_than_reference > 0 && x.prob_lower_than_reference < 1)
      .forEach(x => parts.push(`${esc(x.name)} emits less than ${esc(ref)} in ${fmt(x.prob_lower_than_reference * 100)}% of draws`));
    if (parts.length) { const t = parts.join("; ") + "."; out.push(t.charAt(0).toUpperCase() + t.slice(1)); }
  }
  if (r.inputs.arch === "evaporative") {
    const w = [...r.sites].sort((a, b) => a.water_m3.median - b.water_m3.median);
    out.push(`On-site water use ranges from ${fmt(w[0].water_m3.median)} m³ in ${esc(w[0].name)} to ${fmt(w[w.length - 1].water_m3.median)} m³ in ${esc(w[w.length - 1].name)}. A dry cooling design would remove it; see Climate & cooling for the energy cost.`);
  } else out.push(`${esc(ARCH_LONG[r.inputs.arch])} uses no on-site water.`);
  const gains = r.sites.map(x => { const cur = x.architectures[r.inputs.arch].co2_t;
    const bestA = Object.entries(x.architectures).sort((a, b) => a[1].co2_t - b[1].co2_t)[0];
    return {name: x.name, arch: bestA[0], pct: (1 - bestA[1].co2_t / cur) * 100}; }).filter(g => g.pct > .5).sort((a, b) => b.pct - a.pct);
  if (gains.length) out.push(`Switching to ${ARCH_PHRASE[gains[0].arch]} would cut emissions most in ${esc(gains[0].name)}, by ${fmt(gains[0].pct, 1)}%. Cooling changes are small next to grid differences.`);
  return out;
}

/* ---------- pages ---------- */
const PAGES = {
  overview: {title: "Overview", icon: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>'},
  atlas: {title: "Atlas", icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'},
  compare: {title: "Compare", icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'},
  climate: {title: "Climate & cooling", icon: '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z"/>'},
  uncertainty: {title: "Uncertainty", icon: '<path d="M3 20c3-1 4-14 9-14s6 13 9 14"/>'},
  scenarios: {title: "Scenario lab", icon: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'},
  methods: {title: "Methods & validation", icon: '<path d="M9 3h6M10 3v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-10V3"/>'},
  cite: {title: "Cite & export", icon: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>'},
};
const NEEDS_RESULT = new Set(["compare", "climate", "uncertainty", "scenarios"]);

function needRun(title) {
  return `<div class="empty"><h2>${esc(title)} needs an analysis</h2><p class="muted">Run an analysis on the Overview page first. The results then appear on every page.</p>
    <a class="btn2" href="#/overview">Go to Overview</a></div>`;
}

/* ---- Overview ---- */
function pageOverview() {
  const r = S.result, c = S.cfg;
  const yearsChips = Array.from({length: 10}, (_, i) => 2025 - i).map(y => `<button type="button" class="chip" data-year="${y}" aria-pressed="${c.years.includes(y)}">${y}</button>`).join("");
  const form = `<form class="card" id="cfg" novalidate>
    <fieldset><legend>Training run</legend>
      <div class="seg" role="radiogroup" aria-label="How to describe the run">
        <label><input type="radio" name="mode" value="flop" ${c.mode === "flop" ? "checked" : ""}>Compute (FLOP)</label>
        <label><input type="radio" name="mode" value="gpuh" ${c.mode === "gpuh" ? "checked" : ""}>GPU-hours</label></div>
      <div ${c.mode === "gpuh" ? "hidden" : ""} id="flopBox"><label class="lb" for="flop">Training compute</label>
        <input id="flop" inputmode="decimal" value="${esc(c.flop)}">
        <div class="chips" style="margin-top:6px">${[["1e24", "10²⁴"], ["1e25", "10²⁵ · EU AI Act"], ["3.8e25", "Llama 3.1 405B"], ["1e26", "10²⁶"]].map(([v, l]) => `<button type="button" class="chip" data-flop="${v}">${l}</button>`).join("")}</div>
        <p class="hint">Converted to H100-hours with model FLOP utilisation 30–50%.</p></div>
      <div ${c.mode === "gpuh" ? "" : "hidden"} id="gpuBox"><label class="lb" for="gpuh">Measured accelerator-hours</label>
        <input id="gpuh" inputmode="decimal" placeholder="e.g. 2000000" value="${esc(c.gpuh)}"><p class="hint">Uses your hours directly.</p></div>
    </fieldset>
    <fieldset><legend>Facility</legend>
      <label class="lb" for="arch">Cooling design</label>
      <select id="arch">${Object.entries(ARCH_LONG).map(([k, v]) => `<option value="${k}" ${c.arch === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <label class="lb" for="diesel">On-site diesel share</label>
      <select id="diesel">${[0, .1, .25, .5].map(v => `<option value="${v}" ${+c.diesel === v ? "selected" : ""}>${v ? v * 100 + "% of facility energy" : "None"}</option>`).join("")}</select>
      <label class="lb">Weather and grid years <span class="faint">(up to 3, averaged)</span></label>
      <div class="chips">${yearsChips}</div>
    </fieldset>
    <fieldset><legend>Locations</legend>
      <div class="chips" id="refchips">${Object.keys(REF).map(n => `<button type="button" class="chip" data-ref="${n}" aria-pressed="${c.locs.some(l => l.name === n)}">${n}</button>`).join("")}</div>
      <details id="adder"><summary>Add any location</summary>
        <div class="addgrid"><div class="full"><label class="lb" for="nName">Name</label><input id="nName" placeholder="Nairobi"></div>
          <div><label class="lb" for="nLat">Latitude</label><input id="nLat" inputmode="decimal" placeholder="-1.29"></div>
          <div><label class="lb" for="nLon">Longitude</label><input id="nLon" inputmode="decimal" placeholder="36.82"></div>
          <div class="full"><label class="lb" for="nCountry">Country (sets grid intensity)</label><select id="nCountry"><option value="">Loading countries…</option></select></div>
          <div class="full"><button type="button" class="btn2" id="addLoc">Add location</button></div></div></details>
      <ul class="loclist">${c.locs.map((l, i) => `<li><span class="who">${esc(l.name)}<small>${i === 0 ? '<span class="ref">Reference</span> · ' : ""}${esc(locCoords(l).country)}</small></span>
        <span class="acts">${i ? `<button type="button" class="ghost" data-mkref="${i}">Set as reference</button>` : ""}<button type="button" class="rm" data-rm="${i}" aria-label="Remove ${esc(l.name)}">Remove</button></span></li>`).join("")}</ul>
      <p class="hint">Up to 6 locations. Tip: click any country on the Atlas to add it.</p>
    </fieldset>
    <button class="btn full" id="go" type="submit">Run analysis</button></form>`;

  const head = `<div class="page-head"><h1>Where should this model be trained?</h1>
    <p>Estimate the carbon and water footprint of an AI training run at any location, using hourly weather, calibrated cooling physics and the local power grid. Results come with 95% ranges and paired comparisons.</p></div>`;

  if (!r) return head + `<div class="cfg-layout">${form}<div class="stack">
    <div class="empty"><h2>Configure a run and press Run analysis</h2>
      <p class="muted">The defaults compare a 10²⁵-FLOP run, the EU AI Act systemic-risk threshold, in Oslo, Ashburn and Lagos.</p>
      <ul class="findings small" style="margin-top:12px">${["Emissions and water per location, with 95% ranges", "How much of each difference is grid versus climate",
        "Probability that each place beats your reference", "Monthly cooling profiles and design trade-offs", "A methods paragraph and figures ready for your paper"].map((t, i) => `<li><span class="n">0${i + 1}</span><span>${t}</span></li>`).join("")}</ul></div>
    ${chartCard("mini-atlas", "Grid carbon intensity, 2024", "Your locations are marked. Open the Atlas to explore every country and year.", (C, W) => atlasSvg(C, W, 2024, true))}</div></div>`;

  const s = [...r.sites].sort((a, b) => a.co2_t.median - b.co2_t.median), e = r.it_energy_kwh;
  const best = s[0], worst = s[s.length - 1];
  const gs = r.sites.filter(x => x.vs_reference.grid_share != null).map(x => x.vs_reference.grid_share);
  const kpis = `<div class="kpis">
    <div class="kpi"><div class="v">${fmt(e.median / 1e6, 2)}<small>GWh</small></div><div class="l">IT energy (95%: ${fmt(e.lo / 1e6, 1)}–${fmt(e.hi / 1e6, 1)})</div></div>
    <div class="kpi hl"><div class="v">${fmt(best.co2_t.median)}<small>t CO₂e</small></div><div class="l">Lowest emissions · ${esc(best.name)}</div></div>
    <div class="kpi"><div class="v">${fmt(worst.co2_t.median / best.co2_t.median, 1)}<small>×</small></div><div class="l">${esc(worst.name)} vs ${esc(best.name)}</div></div>
    <div class="kpi"><div class="v">${gs.length ? fmt(Math.min(...gs) * 100) : "–"}<small>%</small></div><div class="l">At least this much of each gap to ${esc(r.inputs.reference)} is the grid</div></div></div>`;
  const Cp = palette();
  const rows = s.map(t => `<tr><td><span class="dot" style="background:${t.name === r.inputs.reference ? Cp.accent : Charts.carbonColour(t.grid_g_per_kwh, Cp)}"></span> ${esc(t.name)}</td>
    <td>${fmt(t.grid_g_per_kwh)}</td><td>${fmt(t.pue.median, 3)}</td><td>${fmt(t.co2_t.median)}</td><td>${fmt(t.co2_t.lo)}–${fmt(t.co2_t.hi)}</td>
    <td>${fmt(t.water_m3.median)}</td><td>${t.prob_lower_than_reference == null ? "reference" : fmt(t.prob_lower_than_reference * 100) + "%"}</td></tr>`).join("");
  return head + `<div class="cfg-layout">${form}<div class="stack">${kpis}
    ${chartCard("ruler", "Emissions on one scale", "Dots are medians, whiskers 95% ranges. Brighter means a more carbon-intensive grid; the ringed site is your reference.", (C, W) => Charts.ruler(r.sites, W, C, r.inputs.reference))}
    <section class="card"><div class="card-h"><div><h3>What the results say</h3><p>Generated from this analysis; safe to paraphrase in a paper.</p></div></div>
      <ul class="findings">${findings(r).map((f, i) => `<li><span class="n">0${i + 1}</span><span>${f}</span></li>`).join("")}</ul></section>
    <section class="card"><div class="card-h"><div><h3>Results by location</h3><p>${esc(r.inputs.arch_label)} · years ${r.inputs.years.join(", ")} · ${r.inputs.n_draws} paired draws</p></div>
      <button class="btn2" id="csvBtn">CSV</button></div>
      <div class="tbl"><table><thead><tr><th>Location</th><th>Grid gCO₂e/kWh</th><th>PUE</th><th>tCO₂e</th><th>95% range</th><th>Water m³</th><th>Lower than ${esc(r.inputs.reference)}</th></tr></thead><tbody>${rows}</tbody></table></div></section>
  </div></div>`;
}
const check = () => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

function bindOverview() {
  const c = S.cfg, f = $("#cfg"); if (!f) return;
  $$('input[name=mode]').forEach(x => x.addEventListener("change", () => { c.mode = x.value; saveCfg(); render(); }));
  $("#flop").addEventListener("input", e => { c.flop = e.target.value; saveCfg(); });
  $("#gpuh").addEventListener("input", e => { c.gpuh = e.target.value; saveCfg(); });
  $$("[data-flop]").forEach(b => b.addEventListener("click", () => { c.flop = b.dataset.flop; $("#flop").value = c.flop; saveCfg(); }));
  $("#arch").addEventListener("change", e => { c.arch = e.target.value; saveCfg(); });
  $("#diesel").addEventListener("change", e => { c.diesel = +e.target.value; saveCfg(); });
  $$("[data-year]").forEach(b => b.addEventListener("click", () => {
    const y = +b.dataset.year, i = c.years.indexOf(y);
    if (i >= 0) { if (c.years.length > 1) c.years.splice(i, 1); } else if (c.years.length < 3) c.years.push(y); else return showErr("Choose at most 3 years.");
    c.years.sort(); saveCfg(); $$("[data-year]").forEach(x => x.setAttribute("aria-pressed", c.years.includes(+x.dataset.year)));
  }));
  $$("[data-ref]").forEach(b => b.addEventListener("click", () => {
    const n = b.dataset.ref, i = c.locs.findIndex(l => l.name === n);
    if (i >= 0) c.locs.splice(i, 1); else if (c.locs.length < 6) c.locs.push({name: n, ref: true}); else return showErr("Remove a location first: the limit is 6.");
    saveCfg(); render();
  }));
  $$("[data-rm]").forEach(b => b.addEventListener("click", () => { c.locs.splice(+b.dataset.rm, 1); saveCfg(); render(); }));
  $$("[data-mkref]").forEach(b => b.addEventListener("click", () => { const [l] = c.locs.splice(+b.dataset.mkref, 1); c.locs.unshift(l); saveCfg(); render(); }));
  loadCountries().then(list => { const sel = $("#nCountry"); if (sel) sel.innerHTML = `<option value="">Choose a country</option>` + list.map(x => `<option>${esc(x)}</option>`).join(""); });
  $("#addLoc").addEventListener("click", () => {
    const name = $("#nName").value.trim(), lat = parseFloat($("#nLat").value), lon = parseFloat($("#nLon").value), country = $("#nCountry").value;
    if (!name || isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !country)
      return showErr("To add a location, give a name, a latitude between −90 and 90, a longitude between −180 and 180, and a country.");
    if (c.locs.length >= 6) return showErr("Remove a location first: the limit is 6.");
    c.locs.push({name, lat, lon, country}); saveCfg(); render();
  });
  f.addEventListener("submit", e => { e.preventDefault(); runAnalysis($("#go")); });
  $("#csvBtn")?.addEventListener("click", () => download("sitefootprint_sites.csv", sitesCsv(S.result), "text/csv"));
}

/* ---- Atlas ---- */
function atlasSvg(C, W, year, mini = false) {
  if (!S.world) return `<p class="muted small">Loading map…</p>`;
  const G = Charts.mapGeometry(S.world.features, W);
  let g = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G.W} ${G.H}" role="img" aria-label="World map of grid carbon intensity in ${year}">`;
  G.paths.forEach(({f, d}) => {
    const v = f.g ? (f.g[year] ?? null) : null;
    g += `<path d="${d}" fill="${Charts.carbonColour(v, C)}" data-iso="${f.iso3}"${mini ? "" : ' tabindex="0"'}><title>${esc(f.name)}: ${v == null ? "no data" : fmt(v) + " gCO₂e/kWh"}</title></path>`;
  });
  S.cfg.locs.forEach(l => { const q = locCoords(l); if (q.lat == null) return; const [x, y] = G.P(q.lon, q.lat);
    g += `<g pointer-events="none"><circle cx="${x}" cy="${y}" r="${mini ? 4 : 5}" fill="none" stroke="${C.accent}" stroke-width="1.5" class="pulse"/><circle cx="${x}" cy="${y}" r="${mini ? 3 : 3.8}" fill="${C.accent}" stroke="${C.bg}" stroke-width="1.2"/>`;
    g += (mini ? "" : `<text x="${x + 7}" y="${y - 6}" font-size="12" font-weight="600" fill="${C.text}" stroke="${C.bg}" stroke-width="3" paint-order="stroke">${esc(l.name)}</text>`) + "</g>"; });
  return g + "</svg>";
}
function pageAtlas() {
  const y = S.atlasYear;
  return `<div class="page-head"><h1>Atlas of grid carbon intensity</h1>
    <p>Annual life-cycle carbon intensity of electricity for ${S.world ? S.world.features.filter(f => f.g).length : 170} countries, 2010–2025 (Ember via Our World in Data). Hover for a screening estimate; click a country to add it to your analysis.</p></div>
    <div class="stack">
    <section class="card chart" id="card-atlas"><div class="card-h"><div><h3 id="atlasTitle">${y}</h3><p>Screening estimate assumes PUE ${CENTRAL.pue_screen} and central IT energy; run an analysis for the full hourly model.</p></div>
      <div class="chart-actions"><button class="btn2" data-svg="atlas">SVG</button><button class="btn2" data-png="atlas">PNG</button></div></div>
      <div class="row" style="align-items:center;gap:12px;margin-bottom:10px"><button class="btn2" id="play" style="flex:none">Play 2010–2025</button>
        <input type="range" id="yr" min="2010" max="2025" step="1" value="${y}" aria-label="Year"><b id="yrLab" style="flex:none;min-width:42px">${y}</b></div>
      <div class="atlas-wrap"><div class="atlas" data-chart="atlas"></div><div class="tip" id="tip"></div></div>
      <div style="max-width:420px;margin-top:14px"><div class="scale"></div><div class="scale-l"><span>15</span><span>100</span><span>300</span><span>850 gCO₂e/kWh</span></div></div></section>
    <div class="grid3"><section class="card" id="selCard">${selPanel()}</section>
      <section class="card"><h3>Cleanest grids, ${y}</h3><div class="tbl" id="cleanList"></div></section>
      <section class="card"><h3>Most carbon-intensive, ${y}</h3><div class="tbl" id="dirtyList"></div></section></div></div>`;
}
function selPanel() {
  const f = S.atlasSel;
  if (!f) return `<h3>Selected country</h3><p class="muted small">Click a country on the map to see its grid history and add it to your analysis.</p>`;
  const v = f.g?.[S.atlasYear], yrs = f.g ? Object.keys(f.g).map(Number).sort() : [];
  const series = yrs.map(yy => f.g[yy]);
  return `<h3>${esc(f.name)}</h3><p class="muted small">${v == null ? "No grid data for this year." : `${fmt(v)} gCO₂e/kWh in ${S.atlasYear} · screening estimate ${fmt(v * E_FU_CENTRAL * CENTRAL.pue_screen / 1e6)} t CO₂e per 10²⁵ FLOP`}</p>
    ${yrs.length > 1 ? `<div class="chart">${Charts.lines({xs: yrs.map(String).map((s, i) => i % 3 ? "" : s), series: [{name: f.name, values: series, color: palette().accent, width: 1.8}], W: 360, H: 170, C: palette(), d: 0, yLabel: "g/kWh", labels: false})}</div>` : ""}
    ${f.owid ? `<button class="btn2" id="addCountry" style="margin-top:8px">Add ${esc(f.name)} to analysis</button>` : ""}`;
}
function atlasLists() {
  const y = S.atlasYear, have = S.world.features.filter(f => f.g && f.g[y] != null).sort((a, b) => a.g[y] - b.g[y]);
  const row = f => `<tr><td>${esc(f.name)}</td><td>${fmt(f.g[y])}</td></tr>`;
  const head = `<table><thead><tr><th>Country</th><th>gCO₂e/kWh</th></tr></thead><tbody>`;
  $("#cleanList").innerHTML = head + have.slice(0, 8).map(row).join("") + "</tbody></table>";
  $("#dirtyList").innerHTML = head + have.slice(-8).reverse().map(row).join("") + "</tbody></table>";
}
function bindAtlas() {
  charts.atlas = (C, W) => atlasSvg(C, W, S.atlasYear);
  const setYear = y => { S.atlasYear = y; $("#yr").value = y; $("#yrLab").textContent = y; $("#atlasTitle").textContent = y;
    const C = palette(); $$("[data-chart=atlas] path").forEach(p => { const f = S.world.features.find(x => x.iso3 === p.dataset.iso);
      const v = f?.g?.[y] ?? null; p.setAttribute("fill", Charts.carbonColour(v, C)); p.querySelector("title").textContent = `${f.name}: ${v == null ? "no data" : fmt(v) + " gCO₂e/kWh"}`; });
    atlasLists(); $$("#card-atlas ~ .grid3 h3").forEach((h, i) => { if (i) h.textContent = (i === 1 ? "Cleanest grids, " : "Most carbon-intensive, ") + y; });
    if (S.atlasSel) { $("#selCard").innerHTML = selPanel(); bindSel(); } };
  $("#yr").addEventListener("input", e => setYear(+e.target.value));
  $("#play").addEventListener("click", e => {
    if (S.playing) { clearInterval(S.playing); S.playing = null; e.target.textContent = "Play 2010–2025"; return; }
    let y = 2010; e.target.textContent = "Stop"; setYear(y);
    S.playing = setInterval(() => { y++; if (y > 2025) { clearInterval(S.playing); S.playing = null; e.target.textContent = "Play 2010–2025"; return; } setYear(y); }, 650);
  });
  const wrap = $(".atlas-wrap"), tip = $("#tip");
  wrap.addEventListener("mousemove", e => {
    const p = e.target.closest("path[data-iso]"); if (!p) { tip.style.display = "none"; return; }
    const f = S.world.features.find(x => x.iso3 === p.dataset.iso), v = f?.g?.[S.atlasYear];
    const rb = wrap.getBoundingClientRect();
    tip.innerHTML = `<b>${esc(f.name)}</b>${v == null ? "No grid data" : `<span class="big">${fmt(v)}</span> gCO₂e/kWh<br>≈ ${fmt(v * E_FU_CENTRAL * CENTRAL.pue_screen / 1e6)} t CO₂e per 10²⁵ FLOP`}`;
    tip.style.display = "block"; tip.style.left = Math.min(e.clientX - rb.left + 14, rb.width - 200) + "px"; tip.style.top = (e.clientY - rb.top + 14) + "px";
  });
  wrap.addEventListener("mouseleave", () => tip.style.display = "none");
  const pick = e => { const p = e.target.closest("path[data-iso]"); if (!p) return;
    S.atlasSel = S.world.features.find(x => x.iso3 === p.dataset.iso); $("#selCard").innerHTML = selPanel(); bindSel();
    if (window.innerWidth < 1020) $("#selCard").scrollIntoView({behavior: "smooth", block: "nearest"}); };
  wrap.addEventListener("click", pick);
  wrap.addEventListener("keydown", e => { if (e.key === "Enter") pick(e); });
  atlasLists();
}
function bindSel() {
  $("#addCountry")?.addEventListener("click", () => {
    const f = S.atlasSel, c = S.cfg;
    if (c.locs.length >= 6) return showErr("Your analysis already has 6 locations. Remove one on the Overview page first.");
    if (c.locs.some(l => l.name === f.name)) return showErr(`${f.name} is already in your analysis.`);
    c.locs.push({name: f.name, lat: f.ly, lon: f.lx, country: f.owid}); saveCfg();
    $("#addCountry").textContent = `Added. ${c.locs.length} locations in analysis`; drawCharts();
  });
}

/* ---- Compare ---- */
function pageCompare() {
  const r = S.result; if (!r) return needRun("Compare");
  const s = [...r.sites].sort((a, b) => a.co2_t.median - b.co2_t.median), ref = r.inputs.reference;
  const rows = s.map(t => `<tr><td>${esc(t.name)}</td><td>${fmt(t.vs_reference.carbon_ratio, 2)}×</td><td>${t.vs_reference.ln_grid.toFixed(3)}</td><td>${t.vs_reference.ln_facility.toFixed(3)}</td>
    <td>${t.vs_reference.grid_share == null ? "–" : fmt(t.vs_reference.grid_share * 100) + "%"}</td><td>${t.prob_lower_than_reference == null ? "reference" : fmt(t.prob_lower_than_reference * 100) + "%"}</td></tr>`).join("");
  return `<div class="page-head"><h1>Compare locations</h1><p>Every location against ${esc(ref)}, split into what the power grid contributes and what climate and cooling contribute. Because IT energy is identical everywhere, the two terms add up exactly.</p></div>
  <div class="stack">
    ${chartCard("decomp", `What drives the difference from ${ref}`, "Natural-log contributions; bar length is the size of each effect, the label the total emission ratio.",
      (C, W) => Charts.decomp({rows: s.filter(t => t.name !== ref).map(t => ({name: t.name, g: t.vs_reference.ln_grid, f: t.vs_reference.ln_facility})), W, C}),
      `<div class="legend"><span><i class="sw" style="background:var(--g2)"></i>Grid</span><span><i class="sw" style="background:var(--accent)"></i>Climate and cooling</span></div>`)}
    <div class="grid2">
      ${chartCard("pairwise", "Which location beats which", "Share of paired draws in which the row location emits less than the column location.",
        (C, W) => Charts.heat({names: r.pairwise_prob_lower.names, matrix: r.pairwise_prob_lower.matrix, W, C}))}
      <section class="card"><div class="card-h"><div><h3>Decomposition table</h3><p>ln(site/ref) = ln(grid ratio) + ln(PUE ratio)</p></div></div>
        <div class="tbl"><table><thead><tr><th>Location</th><th>× ${esc(ref)}</th><th>Grid</th><th>Cooling</th><th>Grid share</th><th>Lower than ref</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    </div></div>`;
}

/* ---- Climate & cooling ---- */
function pageClimate() {
  const r = S.result; if (!r) return needRun("Climate & cooling");
  const months = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const ser = (key, C) => { const st = siteStyles(r, C); return r.sites.map((s, i) => ({name: s.name, values: s.monthly[key], ...st[i]})); };
  const legend = `<p class="hint">Your reference, ${esc(r.inputs.reference)}, is shown in the accent colour.</p>`;
  const archKeys = Object.keys(ARCH), ac = ["var(--g1)", "var(--g2)", "var(--g4)"];
  const archLegend = `<div class="legend">${archKeys.map((a, i) => `<span><i class="sw" style="background:${ac[i]}"></i>${ARCH[a]}</span>`).join("")}</div>`;
  const clim = r.sites.map(s => `<tr><td>${esc(s.name)}</td><td>${fmt(s.climate.mean_t_db, 1)}</td><td>${fmt(s.climate.p99_t_db, 1)}</td><td>${fmt(s.climate.mean_rh)}</td><td>${fmt(s.climate.mean_t_wb, 1)}</td><td>${fmt(s.climate.p99_t_wb, 1)}</td><td>${fmt(s.climate.dry_free_cooling_h_per_yr)}</td></tr>`).join("");
  const archRows = r.sites.map(s => `<tr><td>${esc(s.name)}</td>${archKeys.map(a => `<td>${fmt(s.architectures[a].pue, 3)}</td>`).join("")}${archKeys.map(a => `<td>${fmt(s.architectures[a].water_m3)}</td>`).join("")}<td>${ARCH[Object.entries(s.architectures).sort((x, y) => x[1].co2_t - y[1].co2_t)[0][0]]}</td></tr>`).join("");
  return `<div class="page-head"><h1>Climate & cooling</h1><p>How local weather shapes cooling energy and water, month by month, and what each cooling design would change. Monthly profiles use central parameter values for ${esc(ARCH_LONG[r.inputs.arch].toLowerCase())}.</p></div>
  <div class="stack"><div class="grid2">
    ${chartCard("mpue", "Monthly PUE", "Facility energy per unit of IT energy.", (C, W) => Charts.lines({xs: months, series: ser("pue", C), W, C, d: 3, yLabel: "PUE"}), legend)}
    ${chartCard("mtwb", "Monthly wet-bulb temperature", "Sets how well evaporative cooling works.", (C, W) => Charts.lines({xs: months, series: ser("t_wb", C), W, C, d: 0, yLabel: "°C"}), legend)}
    ${r.inputs.arch === "evaporative" ? chartCard("mwue", "Monthly water use", "Litres evaporated per kWh of IT energy.", (C, W) => Charts.lines({xs: months, series: ser("wue", C), W, C, d: 2, yLabel: "L/kWh"}), legend) : ""}
    ${chartCard("archco2", "Emissions by cooling design", "Central estimate per location; the grid, not the design, sets the level.",
      (C, W) => Charts.bars({cats: r.sites.map(s => s.name), series: archKeys.map((a, i) => ({name: ARCH[a], values: r.sites.map(s => s.architectures[a].co2_t), color: [C.g1, C.g2, C.g4][i]})), W, C, yLabel: "tCO₂e"}), archLegend)}
    ${chartCard("archwater", "On-site water by cooling design", "Only the cooling-tower design evaporates water.",
      (C, W) => Charts.bars({cats: r.sites.map(s => s.name), series: archKeys.map((a, i) => ({name: ARCH[a], values: r.sites.map(s => s.architectures[a].water_m3), color: [C.g1, C.g2, C.g4][i]})), W, C, yLabel: "m³"}), archLegend)}
  </div>
  <section class="card"><h3>Cooling design comparison</h3><div class="tbl"><table><thead><tr><th>Location</th>${archKeys.map(a => `<th>PUE · ${ARCH[a]}</th>`).join("")}${archKeys.map(a => `<th>Water m³ · ${ARCH[a]}</th>`).join("")}<th>Lowest carbon</th></tr></thead><tbody>${archRows}</tbody></table></div></section>
  <section class="card"><h3>Climate summary</h3><div class="tbl"><table><thead><tr><th>Location</th><th>Mean °C</th><th>99th pct °C</th><th>Mean RH %</th><th>Mean wet-bulb °C</th><th>99th pct wet-bulb °C</th><th>Dry free-cooling h/yr</th></tr></thead><tbody>${clim}</tbody></table></div></section></div>`;
}

/* ---- Uncertainty ---- */
function pageUncertainty() {
  const r = S.result; if (!r) return needRun("Uncertainty");
  const rows = [...r.sites].sort((a, b) => a.co2_t.median - b.co2_t.median).map(s => `<tr><td>${esc(s.name)}</td><td>${fmt(s.co2_t.median)}</td><td>${fmt(s.co2_t.lo)}</td><td>${fmt(s.co2_t.hi)}</td><td>${fmt((s.co2_t.hi - s.co2_t.lo) / s.co2_t.median * 100)}%</td><td>${fmt(s.pue.lo, 3)}–${fmt(s.pue.hi, 3)}</td></tr>`).join("");
  return `<div class="page-head"><h1>Uncertainty</h1><p>${r.inputs.n_draws} parameter draws, shared by every location. Ranges look wide because chip efficiency and power are uncertain, but those move all locations together, so rankings are far more certain than the ranges suggest.</p></div>
  <div class="stack">
    ${chartCard("hist", "Distribution of emissions per location", "Each curve is one location across all draws.", (C, W) => { const st = siteStyles(r, C); return Charts.hist({edges: r.co2_hist_edges, series: r.sites.map((s, i) => ({name: s.name, counts: s.co2_hist, color: st[i].color})), W, C}); })}
    <section class="card"><h3>Intervals</h3><div class="tbl"><table><thead><tr><th>Location</th><th>Median tCO₂e</th><th>2.5th pct</th><th>97.5th pct</th><th>Relative width</th><th>PUE 95% range</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <section class="card"><div class="card-h"><div><h3>Every assumption, with its source</h3><p>Triangular distributions (minimum, mode, maximum). These are the defaults of SiteFootprint ${esc(r.version)}.</p></div></div><div class="tbl" id="paramTbl"><p class="muted small">Loading…</p></div></section></div>`;
}
async function bindUncertainty() {
  const p = await loadParams(), el = $("#paramTbl"); if (!el) return;
  if (!p) { el.innerHTML = `<p class="muted small">The parameter list could not be loaded.</p>`; return; }
  el.innerHTML = `<table><thead><tr><th>Parameter</th><th>Min</th><th>Mode</th><th>Max</th><th>Unit</th><th style="text-align:left">Basis</th></tr></thead><tbody>${p.params.map(x => `<tr><td>${esc(x.key)}</td><td>${x.min}</td><td>${x.mode}</td><td>${x.max}</td><td>${esc(x.unit)}</td><td style="text-align:left;white-space:normal;min-width:260px">${esc(x.source)}</td></tr>`).join("")}</tbody></table>`;
}

/* ---- Scenario lab ---- */
function labCompute(r) {
  const L = S.lab, arch = L.arch || r.inputs.arch, ef = r.central.diesel_ef_kg_per_kwh;
  const eScale = (r.inputs.flop ? r.central.mfu / L.mfu : 1) * (L.pit / r.central.p_it_per_gpu_kw);
  const E = r.central.it_energy_kwh * eScale;
  return r.sites.map(s => {
    const pue = s.architectures[arch].pue, ci = s.central.ci_kg_per_kwh * (1 + L.grid / 100), eff = (1 - L.diesel / 100) * ci + L.diesel / 100 * ef;
    return {name: s.name, base: s.central.co2_t, now: E * pue * eff / 1000, water: E * s.architectures[arch].wue_l_per_kwh_it / 1000, eff};
  });
}
function pageScenarios() {
  const r = S.result; if (!r) return needRun("Scenario lab");
  const L = S.lab; if (!L.arch) { L.arch = r.inputs.arch; L.mfu = r.central.mfu; L.pit = r.central.p_it_per_gpu_kw; }
  const slider = (id, label, min, max, step, val, unit, hint) => `<label class="lb" for="${id}">${label}: <b id="${id}V">${val}${unit}</b></label>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}">${hint ? `<p class="hint">${hint}</p>` : ""}`;
  return `<div class="page-head"><h1>Scenario lab</h1><p>Instant what-ifs on top of your analysis, using central parameter values. Use it to explore; report the full analysis for numbers with ranges.</p></div>
  <div class="cfg-layout"><section class="card">
    ${slider("sGrid", "Grid carbon intensity change", -90, 30, 5, L.grid, "%", "Negative values mean a cleaner grid, applied to every location.")}
    ${slider("sDiesel", "On-site diesel share", 0, 60, 5, L.diesel, "%", "Replaces the diesel setting of the analysis.")}
    ${r.inputs.flop ? slider("sMfu", "Model FLOP utilisation", .25, .60, .01, L.mfu, "", "Higher utilisation means fewer GPU-hours for the same FLOP.") : ""}
    ${slider("sPit", "IT power per GPU (kW)", .70, 1.40, .01, L.pit, "", "Includes host, network and storage share.")}
    <label class="lb" for="sArch">Cooling design</label><select id="sArch">${Object.entries(ARCH_LONG).map(([k, v]) => `<option value="${k}" ${L.arch === k ? "selected" : ""}>${v}</option>`).join("")}</select>
    <button class="btn2" id="sReset" style="margin-top:14px">Reset to analysis</button></section>
  <div class="stack">${chartCard("lab", "Emissions: analysis vs scenario", "Central estimates per location.", (C, W) => {
      const d = labCompute(r); return Charts.bars({cats: d.map(x => x.name), series: [{name: "Analysis", values: d.map(x => x.base), color: C.g4}, {name: "Scenario", values: d.map(x => x.now), color: C.accent}], W, C, yLabel: "tCO₂e"});
    }, `<div class="legend"><span><i class="sw" style="background:var(--g4)"></i>Analysis</span><span><i class="sw" style="background:var(--accent)"></i>Scenario</span></div>`)}
    <section class="card"><h3>Scenario table</h3><div class="tbl" id="labTbl"></div><p class="hint" id="labNote"></p></section></div></div>`;
}
function bindScenarios() {
  const r = S.result; if (!r) return;
  const upd = () => {
    const d = labCompute(r), best = Math.min(...d.map(x => x.now));
    $("#labTbl").innerHTML = `<table><thead><tr><th>Location</th><th>Analysis tCO₂e</th><th>Scenario tCO₂e</th><th>Change</th><th>Water m³</th><th>Grid cut to match best</th></tr></thead><tbody>${d.map(x => {
      const need = x.now > best ? (1 - best / x.now) * 100 : 0;
      return `<tr><td>${esc(x.name)}</td><td>${fmt(x.base)}</td><td>${fmt(x.now)}</td><td>${x.now >= x.base ? "+" : ""}${fmt((x.now / x.base - 1) * 100, 1)}%</td><td>${fmt(x.water)}</td><td>${need ? "−" + fmt(need) + "%" : "best"}</td></tr>`; }).join("")}</tbody></table>`;
    $("#labNote").textContent = "“Grid cut to match best” is the further reduction in effective grid intensity a location would need to equal the lowest-emission location in this scenario.";
    const el = $("[data-chart=lab]"); if (el) el.innerHTML = charts.lab(palette(), Math.round(el.clientWidth));
  };
  const bind = (id, key, unit, dec = 0) => { const el = $("#" + id); if (!el) return;
    el.addEventListener("input", () => { S.lab[key] = +el.value; $("#" + id + "V").textContent = (+el.value).toFixed(dec) + unit; upd(); }); };
  bind("sGrid", "grid", "%"); bind("sDiesel", "diesel", "%"); bind("sMfu", "mfu", "", 2); bind("sPit", "pit", "", 2);
  $("#sArch").addEventListener("change", e => { S.lab.arch = e.target.value; upd(); });
  $("#sReset").addEventListener("click", () => { S.lab = {grid: 0, diesel: 0, mfu: r.central.mfu, pit: r.central.p_it_per_gpu_kw, arch: r.inputs.arch}; render(); });
  upd();
}

/* ---- Methods & validation ---- */
function calScatter(C, W) {
  const cal = S.cal; if (!cal) return "";
  const H = Math.min(W, 380), L = 56, R = 16, T = 12, B = 44, xs = cal.campuses.flatMap(c => [c.reported, c.modelled]);
  const lo = Math.floor(Math.min(...xs) * 100) / 100 - .005, hi = Math.ceil(Math.max(...xs) * 100) / 100 + .005;
  const x = v => L + (v - lo) / (hi - lo) * (W - L - R), y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  let g = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Modelled versus reported PUE" font-family="Source Sans 3, Arial, sans-serif">`;
  for (let v = Math.ceil(lo * 100) / 100; v <= hi; v += .02) {
    g += `<line x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${H - B}" stroke="${C.line}" stroke-width=".6"/><line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${C.line}" stroke-width=".6"/>`;
    g += `<text x="${x(v)}" y="${H - B + 16}" font-size="11" fill="${C.muted}" text-anchor="middle">${v.toFixed(2)}</text><text x="${L - 6}" y="${y(v) + 4}" font-size="11" fill="${C.muted}" text-anchor="end">${v.toFixed(2)}</text>`;
  }
  g += `<polygon points="${x(lo)},${y(lo + .01)} ${x(hi - .01)},${y(hi)} ${x(hi)},${y(hi)} ${x(hi)},${y(hi - .01)} ${x(lo + .01)},${y(lo)} ${x(lo)},${y(lo)}" fill="${C.text}" opacity=".05"/>`;
  g += `<line x1="${x(lo)}" y1="${y(lo)}" x2="${x(hi)}" y2="${y(hi)}" stroke="${C.muted}" stroke-dasharray="4 4"/>`;
  cal.campuses.forEach(c => {
    const hold = c.split === "holdout";
    g += hold ? `<rect x="${x(c.reported) - 5}" y="${y(c.modelled) - 5}" width="10" height="10" transform="rotate(45 ${x(c.reported)} ${y(c.modelled)})" fill="${C.s1}" stroke="${C.g1}" stroke-width="1.5"><title>${esc(c.campus)} (hold-out)</title></rect>`
      : `<circle cx="${x(c.reported)}" cy="${y(c.modelled)}" r="4.5" fill="${C.g1}"><title>${esc(c.campus)} (fit)</title></circle>`;
    if (Math.abs(c.modelled - c.reported) >= .02) g += `<text x="${x(c.reported) + 8}" y="${y(c.modelled) + 4}" font-size="11.5" fill="${C.text}">${esc(c.campus.split(",")[0])}</text>`;
  });
  g += `<text x="${L + (W - L - R) / 2}" y="${H - 6}" font-size="12" fill="${C.muted}" text-anchor="middle">Reported PUE (Google, 2021–2025 mean)</text>`;
  g += `<text x="14" y="${T + (H - T - B) / 2}" font-size="12" fill="${C.muted}" text-anchor="middle" transform="rotate(-90 14 ${T + (H - T - B) / 2})">Modelled PUE</text>`;
  return g + "</svg>";
}
function pageMethods() {
  const cal = S.cal;
  return `<div class="page-head"><h1>Methods & validation</h1><p>What the model does, how it was tested, and where its limits are. Everything here can be cited through the software record and the accompanying study.</p></div>
  <div class="grid2">
    <section class="card prose"><h3 style="margin-top:0">1. Training energy</h3>
      <p>Accelerator-hours follow from the training compute, the chip's dense BF16 peak (H100: 989.4 TFLOP/s), model FLOP utilisation <i>u</i> and a wall-clock overhead <i>o</i>. IT energy adds the average power per accelerator, including host, network and storage.</p>
      <div class="eq">H = C · o / (u · F<sub>peak</sub> · 3600) &nbsp;&nbsp; E<sub>IT</sub> = H · P<sub>IT</sub></div>
      <h3>2. Hour-by-hour cooling</h3>
      <p>For each hour of ERA5-based weather (Open-Meteo), the model checks whether outside air can cool the plant for free (dry coolers), whether a cooling tower can (wet-bulb, Stull 2011), and otherwise runs a chiller at a fixed fraction of Carnot efficiency. Water is the heat rejected by the tower divided by the latent heat of vaporisation, plus blow-down.</p>
      <div class="eq">PUE<sub>h</sub> = 1 + f<sub>el</sub> + f<sub>air</sub> + P<sub>cool,h</sub> &nbsp;&nbsp; COP = η · T<sub>ev</sub> / (T<sub>cd</sub> − T<sub>ev</sub>)</div>
      <h3>3. Carbon</h3>
      <p>Facility energy times Ember's annual life-cycle grid intensity for the country and year, optionally blended with on-site diesel (IPCC default 74.1 tCO₂/TJ, generator efficiency 30–40%).</p>
      <div class="eq">G = E<sub>IT</sub> · PUE · [(1 − s<sub>d</sub>) · I<sub>grid</sub> + s<sub>d</sub> · EF<sub>d</sub>]</div>
      <h3>4. Uncertainty</h3>
      <p>Sixteen parameters are drawn from triangular distributions. All locations share the same draws, so comparisons are paired, and the grid-versus-cooling split is exact: ln(G<sub>s</sub>/G<sub>ref</sub>) = ln(PUE ratio) + ln(grid ratio).</p></section>
    <div class="stack">
      ${chartCard("cal", "Facility model against real campuses", cal ? `Fitted on 7 Google campuses (${cal.fit_n} campus-years), tested on 7 others (${cal.holdout_n}). Hold-out mean absolute error ${cal.holdout_mae} PUE (uncalibrated: ${cal.prior_holdout_mae}); rank correlation ${cal.spearman}.` : "", calScatter,
        `<div class="legend"><span><i class="sw" style="background:var(--g1);border-radius:50%"></i>Fit</span><span><i class="sw" style="border:1.5px solid var(--g1);transform:rotate(45deg);width:9px;height:9px"></i>Hold-out</span><span>Shaded band: ±0.01</span></div>`)}
      <section class="card"><h3>Training-energy check: Llama 3.1 405B</h3>
        <div class="tbl"><table><thead><tr><th>Quantity</th><th>Model (95%)</th><th>Disclosed</th></tr></thead><tbody>
          <tr><td>H100-hours</td><td>29.4 M (23.9–36.3)</td><td>30.84 M</td></tr>
          <tr><td>tCO₂e, Meta's boundary (GPU TDP)</td><td>9,172</td><td>8,930</td></tr>
          <tr><td>tCO₂e, full IT boundary</td><td>13,112 (10,087–17,725)</td><td>–</td></tr></tbody></table></div>
        <p class="hint">Meta counts only the GPU's 700 W rating; SiteFootprint counts the whole server and network share. The difference is a boundary choice, not an error.</p></section>
    </div>
    <section class="card prose"><h3 style="margin-top:0">Limits you should state</h3><ul>
      <li>Defaults describe efficient hyperscale facilities (calibration campuses: PUE 1.07–1.15). Enterprise facilities usually have higher overhead.</li>
      <li>The model overpredicts the one tropical calibration campus (Singapore, +0.038), so tropical PUE is likely slightly high.</li>
      <li>Grid intensity is national, annual and life-cycle, not hourly, marginal or market-based.</li>
      <li>Operational emissions only: embodied hardware emissions and water used in power generation are excluded.</li>
      <li>Weather is reanalysis at about 0.25°, not site microclimate.</li></ul></section>
    <section class="card"><h3>Data sources</h3><div class="tbl"><table><thead><tr><th>Data</th><th>Source</th><th>Licence</th></tr></thead><tbody>
      <tr><td>Hourly weather</td><td>Open-Meteo historical archive (ERA5)</td><td>CC BY 4.0</td></tr>
      <tr><td>Grid intensity</td><td>Ember via Our World in Data</td><td>CC BY 4.0</td></tr>
      <tr><td>Campus PUE</td><td>Google data-centre efficiency disclosures</td><td>Public</td></tr>
      <tr><td>Map geometry</td><td>Natural Earth 1:110m</td><td>Public domain</td></tr></tbody></table></div></section>
  </div>`;
}

/* ---- Cite & export ---- */
function methodsParagraph(r) {
  const s = [...r.sites].sort((a, b) => a.co2_t.median - b.co2_t.median);
  const run = r.inputs.flop ? `a training run of ${Number(r.inputs.flop).toExponential(2)} FLOP on H100-class accelerators` : `a training run of ${fmt(r.inputs.gpu_hours)} accelerator-hours`;
  const locs = s.map(x => `${x.name} (${x.country})`).join(", ");
  const res = s.map(x => `${x.name} ${fmt(x.co2_t.median)} tCO₂e (95% interval ${fmt(x.co2_t.lo)}–${fmt(x.co2_t.hi)})`).join("; ");
  return `We estimated the operational carbon and on-site water footprint of ${run} at ${s.length} location${s.length > 1 ? "s" : ""} (${locs}) using SiteFootprint version ${r.version} (Oladeji, 2026). ` +
    `SiteFootprint converts training compute to IT energy and computes facility overhead hour by hour from ERA5-based weather for ${r.inputs.years.join(", ")} (Open-Meteo), using a thermodynamic model of ${ARCH_LONG[r.inputs.arch].toLowerCase().replace(/ \(.*\)/, "")} calibrated against published campus PUE (hold-out mean absolute error 0.010). ` +
    `Emissions use Ember annual life-cycle grid intensities${+r.inputs.years.length ? "" : ""}${r.sites.some(x => x.diesel_share > 0) ? " blended with on-site diesel generation" : ""}. Uncertainty was propagated with ${r.inputs.n_draws} paired Monte Carlo draws (seed ${r.inputs.seed}), and differences between locations were decomposed into grid and facility terms. ` +
    `Median emissions were ${res}. Estimates represent efficient hyperscale facilities and exclude embodied emissions.`;
}
function sitesCsv(r) {
  const h = ["location", "country", "lat", "lon", "grid_g_per_kwh", "pue_median", "pue_lo", "pue_hi", "wue_l_per_kwh", "co2_t_median", "co2_t_lo", "co2_t_hi", "water_m3_median", "water_m3_lo", "water_m3_hi", "prob_lower_than_reference", "ln_grid", "ln_facility"];
  const rows = r.sites.map(s => [s.name, s.country, s.lat, s.lon, s.grid_g_per_kwh, s.pue.median, s.pue.lo, s.pue.hi, s.wue_l_per_kwh_it.median, s.co2_t.median, s.co2_t.lo, s.co2_t.hi, s.water_m3.median, s.water_m3.lo, s.water_m3.hi, s.prob_lower_than_reference ?? "", s.vs_reference.ln_grid, s.vs_reference.ln_facility]);
  const q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
  return `# SiteFootprint ${r.version}; ${runLabel(r)}; ${r.inputs.arch}; years ${r.inputs.years.join(" ")}; ${r.inputs.n_draws} draws; seed ${r.inputs.seed}\n` + [h, ...rows].map(x => x.map(q).join(",")).join("\n");
}
function bib(v) {
  return `@software{oladeji_sitefootprint,
  author  = {Oladeji, Lawrence},
  title   = {SiteFootprint: location-resolved carbon and water footprints of AI training},
  version = {${v}},
  year    = {2026},
  url     = {https://github.com/Lawrencium-103/sitefootprint},
  doi     = {[Zenodo DOI]}
}`;
}
function pageCite() {
  const r = S.result, v = r?.version || "0.1.0";
  const apa = `Oladeji, L. (2026). SiteFootprint: Location-resolved carbon and water footprints of AI training (Version ${v}) [Computer software]. https://github.com/Lawrencium-103/sitefootprint`;
  return `<div class="page-head"><h1>Cite & export</h1><p>If SiteFootprint informs your work, please cite it. Everything you need for a paper is here: the citation, a methods paragraph describing your exact run, the numbers and the figures.</p></div>
  <div class="grid2">
    <section class="card"><div class="card-h"><div><h3>Citation</h3><p>BibTeX</p></div><button class="btn2" data-copy="bib">Copy</button></div><pre class="code" id="bib">${esc(bib(v))}</pre>
      <div class="card-h" style="margin-top:14px"><div><p>APA</p></div><button class="btn2" data-copy="apa">Copy</button></div><pre class="code" id="apa">${esc(apa)}</pre></section>
    <section class="card"><div class="card-h"><div><h3>Methods paragraph for your paper</h3><p>Written from your current analysis. Edit freely.</p></div>${r ? '<button class="btn2" data-copy="meth">Copy</button>' : ""}</div>
      ${r ? `<pre class="code" id="meth">${esc(methodsParagraph(r))}</pre>` : `<p class="muted">Run an analysis on the Overview page and the paragraph will appear here.</p>`}</section>
    <section class="card"><h3>Export</h3><p class="muted small">Numbers and a reproducible record of this analysis.</p>
      <div class="chips" style="gap:8px">${r ? `<button class="btn2" id="xCsv">Results table (CSV)</button><button class="btn2" id="xJson">Full results (JSON)</button><button class="btn2" id="xPrint">Printable report (PDF)</button><button class="btn2" id="xShare">Copy share link</button>` : `<span class="muted small">Available after an analysis.</span>`}</div>
      <p class="hint">Every chart also has SVG and PNG buttons; exports use a white, print-ready style.</p></section>
    <section class="card"><h3>Why cite the software</h3><p class="muted small">Citing the exact version lets reviewers reproduce your numbers: the version, seed, years and draws in the methods paragraph regenerate the same results. SiteFootprint is open source (MIT) and archived with a DOI.</p></section>
  </div>`;
}
function bindCite() {
  $$("[data-copy]").forEach(b => b.addEventListener("click", () => copy($("#" + b.dataset.copy).textContent, b)));
  const r = S.result; if (!r) return;
  $("#xCsv").addEventListener("click", () => download("sitefootprint_sites.csv", sitesCsv(r), "text/csv"));
  $("#xJson").addEventListener("click", () => download("sitefootprint_results.json", JSON.stringify(r, null, 2), "application/json"));
  $("#xPrint").addEventListener("click", () => { location.hash = "#/overview"; setTimeout(() => window.print(), 400); });
  $("#xShare").addEventListener("click", e => copy(shareLink(), e.target));
}
function shareLink() {
  const c = S.cfg, packed = btoa(unescape(encodeURIComponent(JSON.stringify(c))));
  return `${location.origin}${location.pathname}#/overview?cfg=${encodeURIComponent(packed)}`;
}

/* ---------- shell & router ---------- */
function route() { const h = location.hash.replace(/^#\/?/, ""), [p, q] = h.split("?"); return {page: PAGES[p] ? p : "overview", query: new URLSearchParams(q || "")}; }
function shell() {
  const {page} = route();
  const nav = Object.entries(PAGES).map(([k, v], i) => `${i === 6 ? '<div class="sep"></div>' : ""}<a href="#/${k}" ${k === page ? 'aria-current="page"' : ""}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${v.icon}</svg>${v.title}</a>`).join("");
  document.body.innerHTML = `<div class="shell"><aside class="rail">
    <div class="brand"><svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13.5" fill="none" stroke="var(--text)" stroke-width="1.6"/><path d="M2.5 16h27M16 2.5c-5 5-5 22 0 27M16 2.5c5 5 5 22 0 27" fill="none" stroke="var(--text)" stroke-width="1" opacity=".45"/><circle cx="21" cy="12" r="3" fill="var(--accent)"/></svg>
      <div><b>SiteFootprint</b><span>Carbon and water of AI training, by location</span></div></div>
    <nav class="nav" aria-label="Pages">${nav}</nav>
    <button class="theme-btn" id="themeBtn">${theme() === "dark" ? "Light theme" : "Dark theme"}</button>
    <div class="rail-foot">Open-source research software (MIT). Weather: Open-Meteo/ERA5. Grid: Ember via OWID.</div></aside>
    <main class="main" id="main"><div class="topbar"><div class="runchip">${S.result ? `<span class="pill"><span class="dot" style="background:var(--accent)"></span><b>${esc(runLabel(S.result))}</b></span>
      <span class="pill">${esc(ARCH[S.result.inputs.arch])}</span><span class="pill">${S.result.inputs.years.join(", ")}</span><span class="pill">${S.result.sites.length} locations</span>` : `<span class="pill">No analysis yet</span>`}</div>
      <div class="actions chips"><button class="btn2" id="shareTop">Share link</button><button class="btn2" id="printTop">Print report</button></div></div>
    <div id="page"></div></main></div>`;
  $("#themeBtn").addEventListener("click", () => { const t = theme() === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = t; store.set("sf_theme", t); render(); });
  $("#shareTop").addEventListener("click", e => copy(shareLink(), e.target));
  $("#printTop").addEventListener("click", () => window.print());
}
async function render() {
  const {page, query} = route();
  if (query.get("cfg")) { try { S.cfg = JSON.parse(decodeURIComponent(escape(atob(query.get("cfg"))))); saveCfg(); } catch { /* ignore malformed link */ }
    history.replaceState(null, "", "#/overview"); }
  if (S.playing) { clearInterval(S.playing); S.playing = null; }
  Object.keys(charts).forEach(k => delete charts[k]);
  shell();
  if (page === "atlas" || page === "overview") await loadWorld();
  if (page === "methods") await loadCal();
  const html = {overview: pageOverview, atlas: pageAtlas, compare: pageCompare, climate: pageClimate, uncertainty: pageUncertainty,
    scenarios: pageScenarios, methods: pageMethods, cite: pageCite}[page]();
  $("#page").innerHTML = html;
  document.title = `${PAGES[page].title} · SiteFootprint`;
  drawCharts();
  ({overview: bindOverview, atlas: bindAtlas, uncertainty: bindUncertainty, scenarios: bindScenarios, cite: bindCite}[page] || (() => {}))();
  if (page === "atlas") drawCharts();
  if (!NEEDS_RESULT.has(page) || S.result) $("#main").focus?.();
}
let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(drawCharts, 180); });
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
window.addEventListener("beforeprint", () => { document.documentElement.dataset.printPrev = theme(); document.documentElement.dataset.theme = "light"; drawCharts(); });
window.addEventListener("afterprint", () => { document.documentElement.dataset.theme = document.documentElement.dataset.printPrev || "dark"; drawCharts(); });
render();
})();
