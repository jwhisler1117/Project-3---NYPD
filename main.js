import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// ---- Config
const FADO_ORDER = ['Abuse of Authority','Force','Discourtesy','Offensive Language'];
const COLORS = d3.scaleOrdinal().domain(FADO_ORDER)
  .range(['#6c8ae4', '#e87059', '#f2b43d', '#9b7bd7']);
const fmt = d3.format(',');
const pct = d3.format('.1%');

// ---- State
let state = { years: [1985, 2020], fado: new Set(FADO_ORDER) };

// ---- Load
const data = await d3.csv('allegations.csv', d => {
  // normalize dispositions
  let dispo = d.board_disposition?.trim() || 'Unknown';
  if (dispo.startsWith('Substantiated')) dispo = 'Substantiated';

  return {
    year: +d.year_received,
    fado: d.fado_type || 'Unknown',
    dispo,
    precinct: d.precinct ? +d.precinct : null,
  };
});

const YEARS = d3.extent(data, d => d.year);

// ---- Filters UI (compact dual-thumb slider)
function renderFilters() {
  const wrap = d3.select('#filters').html('');

  // Actions row
  const actions = wrap.append('div').attr('class','actions')
    .style('display','flex').style('gap','.5rem').style('flexWrap','wrap');

  actions.append('button').attr('type','button').attr('class','btn')
    .text('Select All')
    .on('click', () => { state.fado = new Set(FADO_ORDER); updateAll(true); });

  actions.append('button').attr('type','button').attr('class','btn')
    .text('Select None')
    .on('click', () => { state.fado = new Set(); updateAll(true); });

  // ▶️ Reset button: resets years + rechecks FADO
  actions.append('button').attr('type','button').attr('class','btn btn-reset')
    .text('Reset')
    .on('click', () => resetAll());

  // Dual-thumb slider (one control)
  const [minY, maxY] = YEARS;
  const sliderRow = wrap.append('div').attr('class','date-slider')
    .style('margin','.5rem 0 0')
    .style('display','flex').style('alignItems','center').style('gap','.5rem').style('flexWrap','wrap');

  sliderRow.append('strong').text('Date:');

  const dual = sliderRow.append('div').attr('class','dual-range').node();

  const inMin = d3.select(dual).append('input')
    .attr('id','slider-start').attr('type','range')
    .attr('min', minY).attr('max', maxY).attr('step', 1).attr('value', state.years[0])
    .attr('aria-label','Start year');

  const inMax = d3.select(dual).append('input')
    .attr('id','slider-end').attr('type','range')
    .attr('min', minY).attr('max', maxY).attr('step', 1).attr('value', state.years[1])
    .attr('aria-label','End year');

  const readout = sliderRow.append('span').attr('class','range-readout').style('opacity','.8')
    .text(`${state.years[0]}–${state.years[1]}`);

  // helper to paint the selected segment on the track
  function paintDualRange() {
    const y0 = +inMin.node().value, y1 = +inMax.node().value;
    const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
    const pctStart = ((lo - minY) / (maxY - minY)) * 100;
    const pctEnd   = ((hi - minY) / (maxY - minY)) * 100;
    dual.style.setProperty('--start', pctStart + '%');
    dual.style.setProperty('--end', pctEnd + '%');

    // z-index swap so the active thumb stays on top when crossing
    if (y0 > y1) {
      inMin.style('z-index','3'); inMax.style('z-index','2');
    } else {
      inMin.style('z-index','2'); inMax.style('z-index','3');
    }
  }
  paintDualRange();

  function commitSlider() {
    let y0 = +inMin.node().value;
    let y1 = +inMax.node().value;
    if (y0 > y1) [y0, y1] = [y1, y0];
    state.years = [y0, y1];
    readout.text(`${y0}–${y1}`);
    paintDualRange();
    syncBrushToState();
    updateAll(); // refresh views
  }

  function onInput() {
    let y0 = +inMin.node().value, y1 = +inMax.node().value;
    if (y0 > y1) [y0, y1] = [y1, y0];
    readout.text(`${y0}–${y1}`);
    paintDualRange();
  }

  inMin.on('input', onInput).on('change', commitSlider);
  inMax.on('input', onInput).on('change', commitSlider);

  // FADO checkboxes
  wrap.append('div').style('marginTop','.5rem').text('Filter Allegation Types:');

  const items = wrap.append('div')
    .style('display','flex').style('gap','.75rem').style('flexWrap','wrap')
    .selectAll('label').data(FADO_ORDER).join('label')
    .html(d => `<input type="checkbox" value="${d}"> ${d}`);

  // Force UI to reflect current state (important after Reset)
  items.select('input')
    .property('checked', d => state.fado.has(d))
    .on('change', (e) => {
      const v = e.currentTarget.value;
      if (e.currentTarget.checked) state.fado.add(v); else state.fado.delete(v);
      updateAll(true);
    });
}

// ---- Legend (standalone)
function renderLegend() {
  const root = d3.select('#legend').html('');
  FADO_ORDER.forEach(d => {
    root.append('span').html(`<span class="swatch" style="background:${COLORS(d)}"></span>${d}`);
  });
}

// ---- Helpers
function fullYearRange([y0, y1]) {
  return Array.from({length: y1 - y0 + 1}, (_,i) => y0 + i);
}
function filteredData() {
  const [y0, y1] = state.years;
  return data.filter(d => d.year >= y0 && d.year <= y1 && state.fado.has(d.fado));
}
function byYearFado(rows) {
  const grouped = d3.rollup(rows, v => d3.rollup(v, vv => vv.length, d => d.fado), d => d.year);
  const [y0, y1] = YEARS;
  return fullYearRange([y0, y1]).map(year => {
    const fadoMap = grouped.get(year) || new Map();
    const o = { year };
    for (const f of FADO_ORDER) o[f] = fadoMap.get(f) ?? 0;
    return o;
  });
}
function byDisposition(rows) {
  return d3.rollups(rows, v => v.length, d => d.dispo)
           .sort((a,b) => d3.descending(a[1], b[1])).slice(0, 12);
}

// ---- Timeline (stacked area + brush + hover tooltip)
let svgTimeline, gLayers, gAxes, gBrush, gGridX, xScale, yScale, brush;
let programmaticBrush = false, brushRaf = null;

function renderTimeline() {
  const rows = filteredData();
  const seriesData = byYearFado(rows);

  const yearMap = new Map(seriesData.map(d => {
    const total = FADO_ORDER.reduce((s,f)=>s + d[f], 0);
    return [d.year, {...d, total}];
  }));

  const W = 1000, H = 360, M = {t:10, r:20, b:40, l:48};
  if (!svgTimeline) {
    svgTimeline = d3.select('#timeline').append('svg').attr('viewBox', `0 0 ${W} ${H}`);
    gLayers = svgTimeline.append('g').attr('class', 'g-layers');
    gAxes   = svgTimeline.append('g').attr('class', 'g-axes');
    gGridX  = svgTimeline.append('g').attr('class', 'gridlines');
    gBrush  = svgTimeline.append('g').attr('class', 'g-brush');
  }

  xScale = d3.scaleLinear().domain(YEARS).nice().range([M.l, W - M.r]);
  yScale = d3.scaleLinear()
    .domain([0, d3.max(seriesData, d => FADO_ORDER.reduce((s,f)=>s+d[f],0)) || 1])
    .nice().range([H - M.b, M.t]);

  const stack = d3.stack().keys(FADO_ORDER);
  const stacked = stack(seriesData);
  const area = d3.area()
    .x(d => xScale(d.data.year)).y0(d => yScale(d[0])).y1(d => yScale(d[1]))
    .curve(d3.curveMonotoneX);

  gLayers.selectAll('path.layer')
    .data(stacked, d => d.key).join('path')
      .attr('class','layer').attr('fill', d => COLORS(d.key))
      .attr('opacity', 0.95).attr('d', area)
      .on('mousemove', (event, series) => {
        const [px] = d3.pointer(event);
        const year = Math.max(YEARS[0], Math.min(YEARS[1], Math.round(xScale.invert(px))));
        const row = yearMap.get(year); if (!row) { hideTooltip(); return; }
        gLayers.selectAll('.layer').attr('opacity', d => d.key === series.key ? 1 : 0.5);
        const html =
          `<div style="font-weight:700;margin-bottom:.25rem;">${year}</div>` +
          FADO_ORDER.map(f => `
            <div style="display:flex;align-items:center;gap:.4rem;">
              <span style="width:10px;height:10px;border-radius:2px;background:${COLORS(f)};display:inline-block"></span>
              <span style="min-width:150px">${f}</span>
              <span style="font-variant-numeric: tabular-nums">${fmt(row[f] || 0)}</span>
            </div>`).join('') +
          `<div style="margin-top:.35rem;border-top:1px solid #ccc;padding-top:.25rem">
             <span style="min-width:150px;display:inline-block;"><strong>Total</strong></span>
             <span style="font-variant-numeric: tabular-nums"><strong>${fmt(row.total)}</strong></span>
           </div>`;
        showTooltip(html, event);
      })
      .on('mouseleave', () => { gLayers.selectAll('.layer').attr('opacity', 0.95); hideTooltip(); });

  gAxes.selectAll('.x-axis').data([0]).join('g')
    .attr('class','x-axis').attr('transform', `translate(0,${H - M.b})`)
    .call(d3.axisBottom(xScale).ticks(10).tickFormat(d3.format('d')));

  gAxes.selectAll('.y-axis').data([0]).join('g')
    .attr('class','y-axis').attr('transform', `translate(${M.l},0)`)
    .call(d3.axisLeft(yScale).ticks(5));

  gGridX.attr('transform', `translate(0,${H - M.b})`)
    .call(d3.axisBottom(xScale).ticks(10).tickSize(-(H - M.b - M.t)).tickFormat(''))
    .selectAll('.tick line').attr('stroke-opacity', 0.55); // softer gridlines

  if (!brush) {
    brush = d3.brushX().extent([[M.l, M.t],[W - M.r, H - M.b]]).on('brush end', brushed);
  }
  gBrush.call(brush);

  syncBrushToState(); // keep rectangle aligned
}

// sync brush (and slider readout) with state.years
function syncBrushToState() {
  if (!gBrush || !brush || !xScale) return;
  programmaticBrush = true;
  const [y0, y1] = state.years;
  if (y0 === YEARS[0] && y1 === YEARS[1]) gBrush.call(brush.move, null);
  else gBrush.call(brush.move, [xScale(y0), xScale(y1)]);
  programmaticBrush = false;

  // also sync slider DOM + paint fill
  d3.select('#slider-start').attr('value', y0);
  d3.select('#slider-end').attr('value', y1);
  const dual = document.querySelector('.dual-range');
  if (dual) {
    const minY = YEARS[0], maxY = YEARS[1];
    const pctStart = ((y0 - minY) / (maxY - minY)) * 100;
    const pctEnd   = ((y1 - minY) / (maxY - minY)) * 100;
    dual.style.setProperty('--start', pctStart + '%');
    dual.style.setProperty('--end', pctEnd + '%');
  }
  d3.select('.range-readout').text(`${y0}–${y1}`);
}

// brush handler
function brushed(event) {
  if (programmaticBrush) return;

  const selection = event.selection;
  if (!selection) {
    if (state.years[0] !== YEARS[0] || state.years[1] !== YEARS[1]) {
      state.years = YEARS;
      syncBrushToState();
      updateAll();
    }
    return;
  }

  const [px0, px1] = selection;
  const y0 = Math.round(xScale.invert(px0));
  const y1 = Math.round(xScale.invert(px1));
  const newYears = [Math.max(YEARS[0], y0), Math.min(YEARS[1], y1)];
  const changed = newYears[0] !== state.years[0] || newYears[1] !== state.years[1];
  state.years = newYears;

  syncBrushToState();

  if (event.type === 'brush') {
    if (!changed) return;
    if (brushRaf) return;
    brushRaf = requestAnimationFrame(() => { brushRaf = null; renderDispositions(); renderDetails(); });
  } else {
    updateAll();
  }
}

function resetTimeline() {
  programmaticBrush = true;
  gBrush.call(brush.move, null);
  programmaticBrush = false;
  state.years = YEARS;
  syncBrushToState();
  updateAll();
}

// ▶️ Reset both years and FADO selections
function resetAll() {
  // 1) reset year window (clear brush)
  programmaticBrush = true;
  if (gBrush && brush) gBrush.call(brush.move, null);
  programmaticBrush = false;
  state.years = YEARS;
  syncBrushToState();

  // 2) re-check all FADO types
  state.fado = new Set(FADO_ORDER);

  // 3) full refresh and re-render filters so checkboxes reflect state
  updateAll(true); // true => re-render Filters UI
}

// global reset only if clicking outside app; Esc resets timeline (not FADO)
// change to resetAll() if you want those to also re-check FADO
let globalResetBound = false;
function bindGlobalResetOnce() {
  if (globalResetBound) return; globalResetBound = true;
  document.addEventListener('click', (e) => {
    const app = document.querySelector('.chart-wrap'); if (!app) return;
    if (!app.contains(e.target)) resetTimeline(); // or resetAll();
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') resetTimeline(); // or resetAll();
  });
}

// ---- Tooltip
const tt = d3.select('#tooltip');
function showTooltip(html, evt) {
  tt.html(html).attr('hidden', null);
  const pad = 12;
  let x = evt?.clientX != null ? evt.clientX + pad : 20;
  let y = evt?.clientY != null ? evt.clientY + pad : 20;
  const rect = tt.node().getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  if (x + rect.width > vw - 8) x = vw - rect.width - 8;
  if (y + rect.height > vh - 8) y = vh - rect.height - 8;
  tt.style('left', `${x}px`).style('top', `${y}px`);
}
function hideTooltip() { tt.attr('hidden', true); }

// ---- Disposition bars
function renderDispositions() {
  const rows = filteredData();
  const dataBars = byDisposition(rows);

  const wrap = d3.select('#dispo-bars').html('');
  if (!rows.length) { wrap.append('p').attr('class','empty').text('No allegations in this selection.'); return; }

  const W = 1000, H = 420, M = {t:10, r:80, b:30, l:200};
  const svg = wrap.selectAll('svg').data([0]).join('svg').attr('viewBox', `0 0 ${W} ${H}`);
  // color by board disposition
const DISPO_COLORS = d3.scaleOrdinal()
  .domain(['Substantiated','Exonerated','Unsubstantiated'])
  .range(['#2E8B57', '#8A2BE2', '#FF8C00']);


  const x = d3.scaleLinear().domain([0, d3.max(dataBars, d => d[1]) || 1]).nice().range([M.l, W - M.r]);
  const y = d3.scaleBand().domain(dataBars.map(d => d[0])).range([M.t, H - M.b]).padding(0.15);

  // Optional anti-flash: set duration(0) instead of 200 if you prefer no animation
svg.selectAll('.bar').data(dataBars, d => d[0]).join(
  enter => enter.append('rect').attr('class','bar')
    .attr('x', x(0)).attr('y', d => y(d[0]))
    .attr('width', 0).attr('height', y.bandwidth())
    .attr('fill', d => DISPO_COLORS(d[0]))
    .call(sel => sel.transition().duration(0).attr('width', d => x(d[1]) - x(0)))
)
.transition().duration(200)
  .attr('width', d => x(d[1]) - x(0))
  .attr('y', d => y(d[0]))
  .attr('fill', d => DISPO_COLORS(d[0]));


  svg.selectAll('.bar-label').data(dataBars, d => d[0]).join(
    enter => enter.append('text').attr('class', 'bar-label')
      .attr('x', d => x(d[1]) + 6).attr('y', d => y(d[0]) + y.bandwidth()/2 + 4)
      .text(d => fmt(d[1]))
  ).transition().duration(200)
   .attr('x', d => x(d[1]) + 6).attr('y', d => y(d[0]) + y.bandwidth()/2 + 4)
   .text(d => fmt(d[1]));

svg.selectAll('.x-axis').data([0]).join('g')
  .attr('class','x-axis')
  .attr('transform', `translate(0,${H - M.b})`)
  .call(d3.axisBottom(x).ticks(6))
  .selectAll('text')
    .style('font-size', '14px')
    .style('font-family', 'sans-serif');

// Y axis
svg.selectAll('.y-axis').data([0]).join('g')
  .attr('class','y-axis')
  .attr('transform', `translate(${M.l},0)`)
  .call(d3.axisLeft(y))
  .selectAll('text')
    .style('font-size', '14px')
    .style('font-family', 'sans-serif');
}

// ---- Details
function renderDetails() {
  const rows = filteredData();
  const el = d3.select('#details').html('');
  if (!rows.length) { el.append('p').text('No allegations in this selection.'); return; }

  const total = rows.length;
  const byFado = d3.rollups(rows, v => v.length, d => d.fado).sort((a,b)=>d3.descending(a[1],b[1]));
  const byYear = d3.rollups(rows, v => v.length, d => d.year).sort((a,b)=>d3.ascending(a[0],b[0]));
  const topYear = byYear.length ? byYear[d3.greatestIndex(byYear, d => d[1])] : null;

  el.append('p').html(`<strong>${fmt(total)}</strong> allegations in <strong>${state.years[0]}–${state.years[1]}</strong>.`);

  const stats = el.append('dl').attr('class','stats');
  stats.html(byFado.slice(0,4).map(([k,v]) =>
    `<dt>${k}</dt><dd>${fmt(v)} <span style="opacity:.7">(${pct(v/total)})</span></dd>`
  ).join(''));

  if (topYear) el.append('p').text(`Peak year in range: ${topYear[0]} (${fmt(topYear[1])}; ${pct(topYear[1]/total)} of selection)`);
}

// ---- Legend + boot
function updateAll(rerenderFilters = false) {
  renderTimeline();
  renderDispositions();
  renderDetails();
  renderLegend();
  if (rerenderFilters) renderFilters();  // <- ensures checkboxes match state
  bindGlobalResetOnce();
}

renderFilters();
state.years = YEARS;
updateAll();
