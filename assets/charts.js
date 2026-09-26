/* SiteFootprint charts: dependency-free SVG. Colours are passed in resolved form so exported SVGs are self-contained. */
const Charts = (() => {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const fmt = (v, d = 0) => v == null || isNaN(v) ? "–" : Number(v).toLocaleString("en-US", {maximumFractionDigits: d, minimumFractionDigits: d});
  const hex = h => { h = h.trim(); if (h.length === 4) h = "#" + [...h.slice(1)].map(c => c + c).join(""); return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const mix = (a, b, t) => { const x = hex(a), y = hex(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * Math.min(1, Math.max(0, t)))).join(",")})`; };
  const FONT = "Geist, Inter, Segoe UI, Arial, sans-serif";

  /* carbon intensity -> brightness ramp (d0 = low, d1 = high), log scale 15-850 g/kWh */
  function carbonT(g) { return Math.min(1, Math.max(0, Math.log(Math.max(g, 8) / 15) / Math.log(850 / 15))); }
  function carbonColour(g, C) { return g == null ? C.s2 : mix(C.d0, C.d1, .08 + .92 * carbonT(g)); }

  /* ticks that always cover [lo, hi] */
  function niceStep(span, n) { const s0 = span / n, p = 10 ** Math.floor(Math.log10(s0)); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => span / s <= n) || p * 10; }
  function cover(lo, hi, n = 5) {
    const step = niceStep((hi - lo) || Math.abs(hi) || 1, n), a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, t = [];
    for (let v = a; v <= b + step / 1e6; v += step) t.push(+v.toFixed(10));
    return t;
  }
  const open = (W, H, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" font-family="${FONT}">`;
  const txt = (x, y, s, C, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 11.5}" fill="${o.fill || C.muted}" text-anchor="${o.anchor || "start"}"${o.weight ? ` font-weight="${o.weight}"` : ""}${o.rot ? ` transform="rotate(${o.rot} ${x} ${y})"` : ""}${o.halo ? ` stroke="${C.s1}" stroke-width="3" paint-order="stroke"` : ""}>${esc(s)}</text>`;
  const grid = (x1, x2, y, C) => `<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="${C.line}" stroke-width="1"/>`;
  function spread(items, minGap, lo, hi) { // push labels apart vertically
    items.sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < minGap) items[i].y = items[i - 1].y + minGap;
    const over = items.length ? items[items.length - 1].y - hi : 0;
    if (over > 0) items.forEach(it => it.y -= over);
    items.forEach(it => it.y = Math.max(lo, it.y));
    return items;
  }

  /* ---- log ruler ---- */
  function ruler(sites, W, C, ref) {
    const s = [...sites].sort((a, b) => a.co2_t.median - b.co2_t.median);
    const lo = Math.min(...s.map(x => x.co2_t.lo)), hi = Math.max(...s.map(x => x.co2_t.hi));
    const a = Math.floor(Math.log10(lo)), b = Math.ceil(Math.log10(hi));
    const narrow = W < 520, L = narrow ? 90 : 128, R = narrow ? 66 : 90, rowH = 38, H = s.length * rowH + 44;
    const x = v => L + (Math.log10(v) - a) / (b - a) * (W - L - R);
    let g = open(W, H, "Emissions per location on a logarithmic scale");
    for (let e = a; e <= b; e++) for (const m of [1, 2, 5]) {
      const v = m * 10 ** e; if (v < 10 ** a || v > 10 ** b) continue;
      g += `<line x1="${x(v)}" x2="${x(v)}" y1="6" y2="${H - 28}" stroke="${C.line}" stroke-width="${m === 1 ? 1 : .5}"${m === 1 ? "" : ' stroke-dasharray="2 3"'}/>`;
      if (m === 1 || (!narrow && b - a <= 2)) g += txt(x(v), H - 10, fmt(v), C, {anchor: "middle", size: 11});
    }
    s.forEach((t, i) => {
      const y = 22 + i * rowH, col = carbonColour(t.grid_g_per_kwh, C), isRef = t.name === ref;
      g += txt(L - 14, y + 4, t.name, C, {anchor: "end", size: 13, fill: isRef ? C.accent : C.text, weight: isRef ? 600 : 400});
      g += `<line x1="${x(t.co2_t.lo)}" x2="${x(t.co2_t.hi)}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="2" stroke-linecap="round" opacity=".55"/>`;
      g += `<line x1="${x(t.co2_t.lo)}" x2="${x(t.co2_t.lo)}" y1="${y - 5}" y2="${y + 5}" stroke="${col}" opacity=".55"/><line x1="${x(t.co2_t.hi)}" x2="${x(t.co2_t.hi)}" y1="${y - 5}" y2="${y + 5}" stroke="${col}" opacity=".55"/>`;
      if (isRef) g += `<circle cx="${x(t.co2_t.median)}" cy="${y}" r="10" fill="none" stroke="${C.accent}" stroke-width="1.5"/>`;
      g += `<circle cx="${x(t.co2_t.median)}" cy="${y}" r="6" fill="${col}" stroke="${C.s1}" stroke-width="1.5"/>`;
      g += txt(x(t.co2_t.hi) + 10, y + 4, `${fmt(t.co2_t.median)} t`, C, {size: 12.5, fill: C.text});
    });
    return g + txt(W - 4, H - 10, "tCO₂e", C, {anchor: "end", size: 10.5, fill: C.faint}) + "</svg>";
  }

  /* ---- grouped vertical bars ---- */
  function bars({cats, series, W, H = 280, yLabel = "", C, d = 0}) {
    const L = 58, R = 12, T = 14, B = 44, iw = W - L - R, ih = H - T - B;
    const top = Math.max(...series.flatMap(s => s.values).filter(v => v != null), 0), ticks = cover(0, top * 1.04 || 1, 5), ymax = ticks[ticks.length - 1];
    const y = v => T + ih - v / ymax * ih, gw = iw / cats.length, bw = Math.min(30, gw * .74 / series.length);
    let g = open(W, H, yLabel);
    ticks.forEach(t => { g += grid(L, W - R, y(t), C) + txt(L - 8, y(t) + 4, fmt(t, ymax < 10 ? 2 : 0), C, {anchor: "end", size: 11}); });
    cats.forEach((c, i) => {
      const x0 = L + i * gw + (gw - bw * series.length) / 2;
      series.forEach((s, j) => {
        const v = s.values[i]; if (v == null) return;
        const col = typeof s.color === "function" ? s.color(i) : s.color;
        g += `<rect x="${x0 + j * bw + 1.5}" y="${y(v)}" width="${bw - 3}" height="${Math.max(0, y(0) - y(v))}" rx="1.5" fill="${col}"><title>${esc(s.name)} · ${esc(c)}: ${fmt(v, d)}</title></rect>`;
      });
      g += txt(L + i * gw + gw / 2, H - B + 20, c, C, {anchor: "middle", size: 12, fill: C.text});
    });
    if (yLabel) g += txt(13, T + ih / 2, yLabel, C, {anchor: "middle", size: 11, rot: -90});
    return g + "</svg>";
  }

  /* ---- multi-line chart with direct end labels ---- */
  function lines({xs, series, W, H = 260, yLabel = "", C, d = 2, labels = true}) {
    const L = 54, R = labels ? 96 : 14, T = 14, B = 32, iw = W - L - R, ih = H - T - B;
    const vals = series.flatMap(s => s.values).filter(v => v != null);
    const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * .06 || Math.abs(hi) * .02 || 1;
    const ticks = cover(lo - pad, hi + pad, 5), y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const x = i => L + i / (xs.length - 1) * iw, y = v => T + ih - (v - y0) / (y1 - y0) * ih;
    let g = open(W, H, yLabel);
    ticks.forEach(t => { g += grid(L, W - R, y(t), C) + txt(L - 8, y(t) + 4, fmt(t, d), C, {anchor: "end", size: 11}); });
    xs.forEach((l, i) => { if (l) g += txt(x(i), H - 10, l, C, {anchor: "middle", size: 11}); });
    const ends = [];
    [...series].reverse().forEach(s => {
      const pts = s.values.map((v, i) => v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean).join(" ");
      g += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="${s.width || 1.6}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}><title>${esc(s.name)}</title></polyline>`;
      const li = s.values.map((v, i) => v == null ? -1 : i).filter(i => i >= 0).pop();
      if (li != null && li >= 0) { g += `<circle cx="${x(li)}" cy="${y(s.values[li])}" r="2.8" fill="${s.color}"/>`; ends.push({y: y(s.values[li]), s}); }
    });
    if (labels) spread(ends, 14, T + 4, T + ih).forEach(e => { g += txt(x(xs.length - 1) + 9, e.y + 4, e.s.name, C, {size: 11.5, fill: e.s.color === C.accent ? C.accent : C.text}); });
    if (yLabel) g += txt(12, T + ih / 2, yLabel, C, {anchor: "middle", size: 11, rot: -90});
    return g + "</svg>";
  }

  /* ---- overlaid histograms on a log x axis, labelled at peaks ---- */
  function hist({edges, series, W, H = 260, C}) {
    const L = 16, R = 16, T = 26, B = 40, iw = W - L - R, ih = H - T - B;
    const la = Math.log10(edges[0]), lb = Math.log10(edges[edges.length - 1]);
    const x = v => L + (Math.log10(v) - la) / (lb - la) * iw;
    const ymax = Math.max(...series.flatMap(s => s.counts)) || 1, y = v => T + ih - v / ymax * ih;
    let g = open(W, H, "Distribution of emissions per location");
    g += grid(L, W - R, T + ih, C);
    for (let e = Math.ceil(la); e <= Math.floor(lb); e++) for (const m of [1, 2, 5]) {
      const v = m * 10 ** e; if (Math.log10(v) < la || Math.log10(v) > lb) continue;
      g += `<line x1="${x(v)}" x2="${x(v)}" y1="${T + ih}" y2="${T + ih + 4}" stroke="${C.faint}"/>` + txt(x(v), T + ih + 17, fmt(v), C, {anchor: "middle", size: 11});
    }
    series.forEach(s => {
      let p = `M${x(edges[0])},${y(0)}`;
      s.counts.forEach((c, i) => { p += ` L${x(edges[i]).toFixed(1)},${y(c).toFixed(1)} L${x(edges[i + 1]).toFixed(1)},${y(c).toFixed(1)}`; });
      p += ` L${x(edges[edges.length - 1])},${y(0)} Z`;
      g += `<path d="${p}" fill="${s.color}" fill-opacity=".12" stroke="${s.color}" stroke-width="1.3"><title>${esc(s.name)}</title></path>`;
      const k = s.counts.indexOf(Math.max(...s.counts));
      g += txt(x(Math.sqrt(edges[k] * edges[k + 1])), y(s.counts[k]) - 7, s.name, C, {anchor: "middle", size: 11.5, fill: s.color === C.accent ? C.accent : C.text, halo: true});
    });
    g += txt(L + iw / 2, H - 4, "tCO₂e per run (log scale)", C, {anchor: "middle", size: 11, fill: C.faint});
    return g + "</svg>";
  }

  /* ---- probability heatmap (monochrome intensity) ---- */
  function heat({names, matrix, W, C}) {
    const n = names.length, L = 100, T = 70, RP = 64, cell = Math.max(34, Math.min(58, (W - L - RP) / n)), H = T + n * cell + 8, Wt = L + n * cell + RP;
    let g = open(Wt, H, "Probability that the row location emits less than the column location");
    names.forEach((nm, j) => { g += txt(L + j * cell + cell / 2, T - 10, nm, C, {size: 11.5, rot: -35, fill: C.text}); });
    matrix.forEach((row, i) => {
      g += txt(L - 12, T + i * cell + cell / 2 + 4, names[i], C, {anchor: "end", size: 12, fill: C.text});
      row.forEach((v, j) => {
        const fill = v == null ? C.s2 : mix(C.s3, C.text, .06 + .94 * v);
        g += `<rect x="${L + j * cell + 1}" y="${T + i * cell + 1}" width="${cell - 2}" height="${cell - 2}" rx="2" fill="${fill}"/>`;
        g += txt(L + j * cell + cell / 2, T + i * cell + cell / 2 + 4, v == null ? "·" : `${Math.round(v * 100)}%`, C, {anchor: "middle", size: 11.5, weight: 500, fill: v == null ? C.faint : (v > .55 ? C.bg : C.text)});
      });
    });
    return g + "</svg>";
  }

  /* ---- decomposition: grid (grey) vs climate & cooling (accent) ---- */
  function decomp({rows, W, C}) {
    const L = 104, R = 64, T = 30, rowH = 36, H = T + rows.length * rowH + 14;
    const m = Math.max(...rows.map(r => Math.abs(r.g) + Math.abs(r.f)), .05) * 1.05;
    const neg = rows.some(r => r.g + r.f < 0), pos = rows.some(r => r.g + r.f > 0);
    const x0 = neg && pos ? L + (W - L - R) / 2 : neg ? W - R : L, sc = (neg && pos ? (W - L - R) / 2 : W - L - R) / m;
    let g = open(W, H, "Log-ratio decomposition into grid and facility terms");
    g += `<line x1="${x0}" x2="${x0}" y1="${T - 12}" y2="${H - 8}" stroke="${C.faint}" stroke-width="1"/>`;
    if (neg) g += txt(x0 - 8, T - 16, "lower than reference", C, {anchor: "end", size: 11, fill: C.faint});
    if (pos) g += txt(x0 + 8, T - 16, "higher than reference", C, {size: 11, fill: C.faint});
    rows.forEach((r, i) => {
      const y = T + i * rowH;
      g += txt(L - 12, y + 16, r.name, C, {anchor: "end", size: 12, fill: C.text});
      let p = x0, q = x0;
      [["g", C.g2, "Grid"], ["f", C.accent, "Climate & cooling"]].forEach(([k, col, nm]) => {
        const v = r[k], w = Math.abs(v) * sc; if (w < .01) return;
        const xs = v >= 0 ? p : q - w; if (v >= 0) p += w; else q -= w;
        g += `<rect x="${xs}" y="${y + 5}" width="${Math.max(w, 1)}" height="16" fill="${col}"><title>${esc(r.name)} · ${nm}: ${v.toFixed(3)}</title></rect>`;
      });
      const endX = r.g + r.f >= 0 ? Math.max(p, x0) + 8 : Math.min(q, x0) - 8;
      g += txt(endX, y + 17, `×${fmt(Math.exp(r.g + r.f), 2)}`, C, {size: 12, fill: C.text, anchor: r.g + r.f >= 0 ? "start" : "end"});
    });
    return g + "</svg>";
  }

  /* ---- Equal Earth projection ---- */
  const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
  function eqEarth(lon, lat) {
    const l = lon * Math.PI / 180, p = lat * Math.PI / 180, t = Math.asin(M * Math.sin(p)), t2 = t * t, t6 = t2 * t2 * t2;
    return [2 * Math.sqrt(3) * l * Math.cos(t) / (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1)),
            A4 * t6 * t2 * t + A3 * t6 * t + A2 * t2 * t + A1 * t];
  }
  function mapGeometry(features, W) {
    const XM = 2.7064, YT = 1.3173, YB = -0.93, sc = W / (2 * XM), H = Math.round((YT - YB) * sc);
    const P = (lon, lat) => { const [x, y] = eqEarth(lon, lat); return [(x + XM) * sc, (YT - y) * sc]; };
    const paths = features.filter(f => f.iso3 !== "ATA").map(f => ({
      f, d: f.p.map(poly => poly.map(ring => "M" + ring.map(([lo, la]) => P(lo, la).map(v => v.toFixed(1)).join(",")).join("L") + "Z").join("")).join("")
    }));
    return {W, H, P, paths};
  }
  return {esc, fmt, mix, carbonColour, ruler, bars, lines, hist, heat, decomp, mapGeometry};
})();
