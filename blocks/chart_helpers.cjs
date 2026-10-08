'use strict';

const DEFAULT_COLORS = ['#69b7e6', '#55c596', '#e8ad60', '#dd6b72', '#9b8ee6', '#5fc6c8', '#d889c5', '#91b36c', '#d08b5b', '#8395aa'];
const THEMES = {
  Dark: { background: '#20242b', border: '#343a44', text: '#edf0f4', muted: '#9ca5b2', grid: '#343a44' },
  Light: { background: '#ffffff', border: '#d9dee6', text: '#202630', muted: '#667180', grid: '#e7eaf0' },
  Transparent: { background: 'transparent', border: 'currentColor', text: 'currentColor', muted: 'currentColor', grid: 'currentColor' }
};

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function parseJSON(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); }
    catch { throw new Error('Chart Data must be valid JSON text, an object, or a list'); }
  }
  if (!value || typeof value !== 'object') throw new Error('Chart Data must be a JSON object or list');
  return value;
}
function list(value) { return String(value ?? '').split(',').map(item => item.trim()).filter(Boolean); }
function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function positiveInteger(value, fallback, minimum, maximum) {
  value = Number(value);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}
function palette(value) {
  const requested = list(value).filter(color => /^(?:#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([\d.,%\s]+\)|hsla?\([\d.,%\s]+\))$/i.test(color));
  return requested.length ? requested : DEFAULT_COLORS;
}
function formatNumber(value, format = 'Auto') {
  if (!Number.isFinite(value)) return '';
  if (format === 'Percent') return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`;
  if (format === 'Integer') return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
  if (format === 'Decimal') return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, notation: Math.abs(value) >= 1000000 ? 'compact' : 'standard' }).format(value);
}
function aggregate(values, mode) {
  const usable = values.filter(Number.isFinite);
  if (mode === 'Count') return usable.length;
  if (!usable.length) return null;
  if (mode === 'Average') return usable.reduce((sum, value) => sum + value, 0) / usable.length;
  if (mode === 'Minimum') return Math.min(...usable);
  if (mode === 'Maximum') return Math.max(...usable);
  return usable.reduce((sum, value) => sum + value, 0);
}
function rowData(value, options, colors) {
  const rows = Array.isArray(value) ? value : [value];
  if (!rows.length) throw new Error('Chart Data contains no rows');
  if (rows.every(item => item === null || typeof item !== 'object' || Array.isArray(item))) {
    return { labels: rows.map((_item, index) => String(index + 1)), datasets: [{ label: options.series_name || 'Value', values: rows.map(number), color: colors[0] }] };
  }
  if (!rows.every(item => item && typeof item === 'object' && !Array.isArray(item))) throw new Error('Row data must contain JSON objects');
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const requestedCategory = String(options.category_field || '').trim();
  const category = requestedCategory || keys.find(key => rows.some(row => number(row[key]) === null)) || keys[0];
  if (!keys.includes(category)) throw new Error(`Category field not found: ${category}`);
  const requestedSeries = list(options.series_fields);
  const series = requestedSeries.length ? requestedSeries : keys.filter(key => key !== category && rows.some(row => number(row[key]) !== null));
  if (!series.length) throw new Error('No numeric series fields were found');
  const missing = series.filter(key => !keys.includes(key));
  if (missing.length) throw new Error(`Series field${missing.length === 1 ? '' : 's'} not found: ${missing.join(', ')}`);
  const mode = options.aggregate || 'None';
  if (mode === 'None') return {
    labels: rows.map((row, index) => String(row[category] ?? index + 1)),
    datasets: series.map((key, index) => ({
      label: key,
      values: rows.map(row => number(row[key])),
      points: options.chart_type === 'Scatter' ? rows.map((row, rowIndex) => ({ x: number(row[category]) ?? rowIndex, y: number(row[key]) })) : undefined,
      color: colors[index % colors.length]
    }))
  };
  const groups = new Map();
  for (const row of rows) {
    const label = String(row[category] ?? '');
    if (!groups.has(label)) groups.set(label, Object.fromEntries(series.map(key => [key, []])));
    for (const key of series) groups.get(label)[key].push(number(row[key]));
  }
  return {
    labels: [...groups.keys()],
    datasets: series.map((key, index) => ({ label: key, values: [...groups.values()].map(group => aggregate(group[key], mode)), color: colors[index % colors.length] }))
  };
}
function datasetData(value, colors) {
  if (!Array.isArray(value.labels) || !Array.isArray(value.datasets)) throw new Error('Labels and Datasets format requires labels and datasets lists');
  const labels = value.labels.map(String);
  const datasets = value.datasets.map((dataset, index) => {
    if (!dataset || typeof dataset !== 'object' || !Array.isArray(dataset.data)) throw new Error('Every dataset needs a data list');
    return { label: String(dataset.label ?? `Series ${index + 1}`), values: dataset.data.map(item => number(item && typeof item === 'object' ? item.y : item)), points: dataset.data, color: dataset.color ? palette(dataset.color)[0] : colors[index % colors.length] };
  });
  return { labels, datasets };
}
function keyValueData(value, options, colors) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Key-value format requires a JSON object');
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([_key, item]) => number(item) === null)) throw new Error('Key-value data must map labels to numbers');
  return { labels: entries.map(([key]) => key), datasets: [{ label: options.series_name || 'Value', values: entries.map(([_key, item]) => number(item)), color: colors[0] }] };
}
function normalize(value, options = {}) {
  value = parseJSON(value);
  const colors = palette(options.palette), format = options.data_format || 'Auto';
  let result;
  if (format === 'Labels and Datasets' || (format === 'Auto' && !Array.isArray(value) && Array.isArray(value.labels) && Array.isArray(value.datasets))) result = datasetData(value, colors);
  else if (format === 'Key-value Object' || (format === 'Auto' && !Array.isArray(value) && Object.values(value).length && Object.values(value).every(item => number(item) !== null))) result = keyValueData(value, options, colors);
  else result = rowData(value, options, colors);
  const length = result.labels.length;
  if (!length) throw new Error('Chart Data contains no points');
  for (const dataset of result.datasets) {
    if (dataset.values.length < length) dataset.values.push(...Array(length - dataset.values.length).fill(null));
    dataset.values.length = length;
  }
  return sortAndLimit(result, options);
}
function sortAndLimit(data, options) {
  const indexes = data.labels.map((_label, index) => index), sort = options.sort || 'None';
  if (sort !== 'None') indexes.sort((left, right) => {
    if (sort.startsWith('Label')) return String(data.labels[left]).localeCompare(String(data.labels[right]), undefined, { numeric: true }) * (sort.endsWith('Descending') ? -1 : 1);
    const a = data.datasets[0]?.values[left] ?? -Infinity, b = data.datasets[0]?.values[right] ?? -Infinity;
    return (a - b) * (sort.endsWith('Descending') ? -1 : 1);
  });
  const maximum = positiveInteger(options.max_points, 100, 1, 1000), selected = indexes.slice(0, maximum);
  return {
    labels: selected.map(index => data.labels[index]),
    datasets: data.datasets.map(dataset => ({ ...dataset, values: selected.map(index => dataset.values[index]), points: dataset.points ? selected.map(index => dataset.points[index]) : undefined }))
  };
}
function missingValue(value, mode) { return value === null && mode === 'Zero' ? 0 : value; }
function theme(name) { return THEMES[name] || THEMES.Dark; }
function chartStyle(colors, width) {
  return `<style>.phidias-chart{box-sizing:border-box;width:min(100%,${width}px);margin:0;border:1px solid ${colors.border};border-radius:5px;padding:16px;background:${colors.background};color:${colors.text};font:400 12px/1.4 Inter,ui-sans-serif,system-ui,sans-serif}.phidias-chart *{box-sizing:border-box}.phidias-chart figcaption{margin:0 0 12px;font-size:14px;font-weight:650}.phidias-chart svg{display:block;width:100%;height:auto;overflow:visible}.phidias-chart__legend{display:flex;flex-wrap:wrap;gap:7px 14px;margin-top:12px;color:${colors.muted};font-size:10px}.phidias-chart__legend span{display:inline-flex;align-items:center;gap:5px}.phidias-chart__legend i{width:8px;height:8px;border-radius:2px}.phidias-chart__empty{padding:30px;color:${colors.muted};text-align:center}</style>`;
}
function legend(data, show) {
  if (show === 'No') return '';
  return `<div class="phidias-chart__legend" aria-label="Chart legend">${data.datasets.map(dataset => `<span><i style="background:${escapeHTML(dataset.color)}"></i>${escapeHTML(dataset.label)}</span>`).join('')}</div>`;
}
function shell(inner, data, options, width, height, description) {
  const colors = theme(options.theme), title = String(options.title || '').trim();
  return `${chartStyle(colors, width)}<figure class="phidias-chart" role="group" aria-label="${escapeHTML(title || description)}">${title ? `<figcaption>${escapeHTML(title)}</figcaption>` : ''}${inner}${legend(data, options.show_legend)}</figure>`;
}
function niceStep(range, target = 5) {
  const rough = Math.abs(range) / target || 1, power = 10 ** Math.floor(Math.log10(rough)), fraction = rough / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}
function rangeFor(data, options, stacked = false) {
  const values = [];
  if (stacked) for (let index = 0; index < data.labels.length; index++) {
    let positive = 0, negative = 0;
    for (const dataset of data.datasets) { const value = missingValue(dataset.values[index], options.missing_values); if (value > 0) positive += value; else if (value < 0) negative += value; }
    values.push(positive, negative);
  } else for (const dataset of data.datasets) for (const raw of dataset.values) { const value = missingValue(raw, options.missing_values); if (Number.isFinite(value)) values.push(value); }
  if (!values.length) throw new Error('Chart Data contains no numeric values');
  const requestedMin = number(options.minimum), requestedMax = number(options.maximum);
  let minimum = requestedMin ?? Math.min(0, ...values), maximum = requestedMax ?? Math.max(0, ...values);
  if (minimum === maximum) { minimum -= 1; maximum += 1; }
  const step = niceStep(maximum - minimum);
  if (requestedMin === null) minimum = Math.floor(minimum / step) * step;
  if (requestedMax === null) maximum = Math.ceil(maximum / step) * step;
  if (minimum >= maximum) throw new Error('Chart minimum must be lower than maximum');
  return { minimum, maximum, step };
}
function linePath(points, smooth) {
  if (!points.length) return '';
  if (!smooth || points.length < 3) return `M ${points.map(point => `${point.x} ${point.y}`).join(' L ')}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index++) {
    const before = points[index - 1] || points[index], current = points[index], next = points[index + 1], after = points[index + 2] || next;
    const control1 = { x: current.x + (next.x - before.x) / 6, y: current.y + (next.y - before.y) / 6 };
    const control2 = { x: next.x - (after.x - current.x) / 6, y: next.y - (after.y - current.y) / 6 };
    path += ` C ${control1.x} ${control1.y},${control2.x} ${control2.y},${next.x} ${next.y}`;
  }
  return path;
}
function tickValues(range) {
  const values = [];
  for (let value = Math.ceil(range.minimum / range.step) * range.step, count = 0; value <= range.maximum + range.step / 100 && count < 20; value += range.step, count++) values.push(Number(value.toPrecision(12)));
  return values;
}
function cartesianChart(input, options = {}) {
  const data = normalize(input, options), kind = options.chart_type || 'Line', horizontal = kind === 'Horizontal Bar', stacked = kind === 'Stacked Bar';
  const width = positiveInteger(options.width, 760, 320, 2000), height = positiveInteger(options.height, 360, 220, 1200), colors = theme(options.theme);
  const margin = horizontal ? { top: 18, right: 26, bottom: 48, left: 116 } : { top: 18, right: 22, bottom: 66, left: 62 };
  const plot = { x: margin.left, y: margin.top, width: width - margin.left - margin.right, height: height - margin.top - margin.bottom };
  const valueOptions = {
    ...options,
    minimum: horizontal ? (options.x_min ?? options.minimum) : (options.y_min ?? options.minimum),
    maximum: horizontal ? (options.x_max ?? options.maximum) : (options.y_max ?? options.maximum)
  };
  const range = rangeFor(data, valueOptions, stacked), ticks = tickValues(range), x = index => plot.x + (data.labels.length === 1 ? plot.width / 2 : index * plot.width / (data.labels.length - 1));
  const y = value => plot.y + (range.maximum - value) / (range.maximum - range.minimum) * plot.height;
  const baseY = y(Math.max(range.minimum, Math.min(range.maximum, 0))), grid = [], marks = [], labels = [], values = [];
  if (horizontal) {
    const row = plot.height / data.labels.length, group = row * .72, bar = group / data.datasets.length;
    for (const tick of ticks) { const px = plot.x + (tick - range.minimum) / (range.maximum - range.minimum) * plot.width; grid.push(`<line x1="${px}" y1="${plot.y}" x2="${px}" y2="${plot.y + plot.height}"/>`); labels.push(`<text x="${px}" y="${height - 24}" text-anchor="middle">${escapeHTML(formatNumber(tick, options.number_format))}</text>`); }
    data.labels.forEach((label, index) => {
      const cy = plot.y + row * index + row / 2; labels.push(`<text x="${plot.x - 10}" y="${cy + 3}" text-anchor="end">${escapeHTML(String(label).slice(0, 18))}</text>`);
      data.datasets.forEach((dataset, series) => {
        const value = missingValue(dataset.values[index], options.missing_values); if (!Number.isFinite(value)) return;
        const zero = plot.x + (0 - range.minimum) / (range.maximum - range.minimum) * plot.width, end = plot.x + (value - range.minimum) / (range.maximum - range.minimum) * plot.width;
        const py = cy - group / 2 + series * bar, start = Math.min(zero, end), size = Math.abs(end - zero);
        marks.push(`<rect x="${start}" y="${py}" width="${size}" height="${Math.max(1, bar - 2)}" rx="2" fill="${escapeHTML(dataset.color)}"><title>${escapeHTML(label)} — ${escapeHTML(dataset.label)}: ${escapeHTML(formatNumber(value, options.number_format))}</title></rect>`);
        if (options.show_values === 'Yes') values.push(`<text x="${end + (value >= 0 ? 5 : -5)}" y="${py + bar / 2 + 3}" text-anchor="${value >= 0 ? 'start' : 'end'}">${escapeHTML(formatNumber(value, options.number_format))}</text>`);
      });
    });
  } else {
    for (const tick of ticks) { const py = y(tick); grid.push(`<line x1="${plot.x}" y1="${py}" x2="${plot.x + plot.width}" y2="${py}"/>`); labels.push(`<text x="${plot.x - 9}" y="${py + 3}" text-anchor="end">${escapeHTML(formatNumber(tick, options.number_format))}</text>`); }
    const labelEvery = Math.max(1, Math.ceil(data.labels.length / 12));
    data.labels.forEach((label, index) => {
      if (kind === 'Scatter' || (index % labelEvery !== 0 && index !== data.labels.length - 1)) return;
      const labelX = kind.includes('Bar') ? plot.x + plot.width / data.labels.length * (index + .5) : x(index);
      labels.push(`<text x="${labelX}" y="${height - 36}" text-anchor="end" transform="rotate(-35 ${labelX} ${height - 36})">${escapeHTML(String(label).slice(0, 18))}</text>`);
    });
    if (kind.includes('Bar')) {
      const slot = plot.width / data.labels.length, group = slot * .72, bar = stacked ? group : group / data.datasets.length;
      data.labels.forEach((label, index) => {
        let positive = 0, negative = 0;
        data.datasets.forEach((dataset, series) => {
          const value = missingValue(dataset.values[index], options.missing_values); if (!Number.isFinite(value)) return;
          const startValue = stacked ? (value >= 0 ? positive : negative) : 0, endValue = startValue + value;
          if (stacked) { if (value >= 0) positive = endValue; else negative = endValue; }
          const xPos = plot.x + slot * index + (slot - group) / 2 + (stacked ? 0 : series * bar), top = Math.min(y(startValue), y(endValue)), barHeight = Math.abs(y(endValue) - y(startValue));
          marks.push(`<rect x="${xPos}" y="${top}" width="${Math.max(1, bar - 2)}" height="${Math.max(1, barHeight)}" rx="2" fill="${escapeHTML(dataset.color)}"><title>${escapeHTML(label)} — ${escapeHTML(dataset.label)}: ${escapeHTML(formatNumber(value, options.number_format))}</title></rect>`);
          if (options.show_values === 'Yes' && (!stacked || series === data.datasets.length - 1)) values.push(`<text x="${xPos + bar / 2}" y="${top - 5}" text-anchor="middle">${escapeHTML(formatNumber(stacked ? endValue : value, options.number_format))}</text>`);
        });
      });
    } else if (kind === 'Scatter') {
      const points = [];
      for (const dataset of data.datasets) dataset.values.forEach((value, index) => { if (Number.isFinite(value)) points.push({ dataset, value, index, xValue: number(dataset.points?.[index]?.x) ?? index }); });
      const xValues = points.map(point => point.xValue), requestedXMin = number(options.x_min), requestedXMax = number(options.x_max);
      const xMin = requestedXMin ?? Math.min(...xValues), xMax = requestedXMax ?? Math.max(...xValues);
      if (xMin >= xMax) throw new Error('Chart X minimum must be lower than X maximum');
      const scatterX = value => plot.x + (value - xMin) / (xMax - xMin) * plot.width;
      for (let index = 0; index <= 5; index++) {
        const value = xMin + (xMax - xMin) * index / 5, px = scatterX(value);
        grid.push(`<line x1="${px}" y1="${plot.y}" x2="${px}" y2="${plot.y + plot.height}"/>`);
        labels.push(`<text x="${px}" y="${height - 36}" text-anchor="middle">${escapeHTML(formatNumber(value, options.number_format))}</text>`);
      }
      for (const point of points) marks.push(`<circle cx="${scatterX(point.xValue)}" cy="${y(point.value)}" r="4" fill="${escapeHTML(point.dataset.color)}"><title>${escapeHTML(point.dataset.label)}: (${escapeHTML(formatNumber(point.xValue, options.number_format))}, ${escapeHTML(formatNumber(point.value, options.number_format))})</title></circle>`);
    } else {
      for (const dataset of data.datasets) {
        const segments = []; let segment = [];
        dataset.values.forEach((raw, index) => {
          const value = missingValue(raw, options.missing_values);
          if (!Number.isFinite(value)) {
            if (options.missing_values !== 'Skip') { if (segment.length) segments.push(segment); segment = []; }
            return;
          }
          segment.push({ x: x(index), y: y(value), value, index });
        });
        if (segment.length) segments.push(segment);
        for (const points of segments) {
          const path = linePath(points, options.line_style === 'Smooth');
          if (kind === 'Area') marks.push(`<path d="${path} L ${points.at(-1).x} ${baseY} L ${points[0].x} ${baseY} Z" fill="${escapeHTML(dataset.color)}" opacity=".18"/>`);
          marks.push(`<path d="${path}" fill="none" stroke="${escapeHTML(dataset.color)}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>`);
          for (const point of points) {
            marks.push(`<circle cx="${point.x}" cy="${point.y}" r="3.2" fill="${escapeHTML(dataset.color)}" stroke="${escapeHTML(colors.background)}" stroke-width="1.5"><title>${escapeHTML(data.labels[point.index])} — ${escapeHTML(dataset.label)}: ${escapeHTML(formatNumber(point.value, options.number_format))}</title></circle>`);
            if (options.show_values === 'Yes') values.push(`<text x="${point.x}" y="${point.y - 8}" text-anchor="middle">${escapeHTML(formatNumber(point.value, options.number_format))}</text>`);
          }
        }
      }
    }
  }
  const axisTitles = `${options.x_axis_title ? `<text x="${plot.x + plot.width / 2}" y="${height - 4}" text-anchor="middle">${escapeHTML(options.x_axis_title)}</text>` : ''}${options.y_axis_title ? `<text x="13" y="${plot.y + plot.height / 2}" text-anchor="middle" transform="rotate(-90 13 ${plot.y + plot.height / 2})">${escapeHTML(options.y_axis_title)}</text>` : ''}`;
  const svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(options.title || `${kind} chart`)}"><g stroke="${escapeHTML(colors.grid)}" stroke-width="1" opacity="${options.show_grid === 'No' ? '0' : '.8'}">${grid.join('')}</g><g fill="${escapeHTML(colors.muted)}" font-size="10" font-family="inherit">${labels.join('')}${axisTitles}</g><svg x="${plot.x}" y="${plot.y}" width="${plot.width}" height="${plot.height}" viewBox="${plot.x} ${plot.y} ${plot.width} ${plot.height}" overflow="hidden">${marks.join('')}<g fill="${escapeHTML(colors.text)}" font-size="9" font-family="inherit">${values.join('')}</g></svg></svg>`;
  return shell(svg, data, options, width, height, `${kind} chart`);
}

function polarPoint(cx, cy, radius, angle) { const radians = (angle - 90) * Math.PI / 180; return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) }; }
function arcPath(cx, cy, radius, start, end, inner) {
  const outerStart = polarPoint(cx, cy, radius, end), outerEnd = polarPoint(cx, cy, radius, start), large = end - start > 180 ? 1 : 0;
  if (!inner) return `M ${cx} ${cy} L ${outerStart.x} ${outerStart.y} A ${radius} ${radius} 0 ${large} 0 ${outerEnd.x} ${outerEnd.y} Z`;
  const innerStart = polarPoint(cx, cy, inner, start), innerEnd = polarPoint(cx, cy, inner, end);
  return `M ${outerStart.x} ${outerStart.y} A ${radius} ${radius} 0 ${large} 0 ${outerEnd.x} ${outerEnd.y} L ${innerStart.x} ${innerStart.y} A ${inner} ${inner} 0 ${large} 1 ${innerEnd.x} ${innerEnd.y} Z`;
}
function circularChart(input, options = {}) {
  const normalized = normalize(input, { ...options, max_points: options.max_slices || options.max_points }), source = normalized.datasets[0];
  let items = normalized.labels.map((label, index) => ({ label, value: source.values[index], color: palette(options.palette)[index % palette(options.palette).length] })).filter(item => Number.isFinite(item.value) && item.value >= 0);
  if (!items.length) throw new Error('Circular chart data needs at least one non-negative number');
  const threshold = Math.max(0, Math.min(50, number(options.group_below_percent) ?? 0)), originalTotal = items.reduce((sum, item) => sum + item.value, 0);
  if (threshold > 0 && originalTotal > 0) {
    const small = items.filter(item => item.value / originalTotal * 100 < threshold), kept = items.filter(item => item.value / originalTotal * 100 >= threshold);
    if (small.length > 1) kept.push({ label: options.other_label || 'Other', value: small.reduce((sum, item) => sum + item.value, 0), color: palette(options.palette)[kept.length % palette(options.palette).length] });
    else kept.push(...small); items = kept;
  }
  if ((options.sort || 'None').startsWith('Value')) items.sort((a, b) => (a.value - b.value) * ((options.sort || '').endsWith('Descending') ? -1 : 1));
  const width = positiveInteger(options.width, 520, 280, 1600), height = positiveInteger(options.height, 380, 240, 1200), colors = theme(options.theme), total = items.reduce((sum, item) => sum + item.value, 0);
  const cx = width / 2, cy = height / 2, radius = Math.max(40, Math.min(width, height) / 2 - 34), innerPercent = options.chart_type === 'Pie' ? 0 : Math.max(10, Math.min(85, number(options.inner_radius) ?? 58)), inner = radius * innerPercent / 100;
  let angle = 0; const paths = [], labels = [];
  items.forEach(item => {
    const sweep = total ? item.value / total * 360 : 360 / items.length, drawableSweep = Math.min(sweep, 359.9999), end = angle + drawableSweep, path = arcPath(cx, cy, radius, angle, end, inner);
    paths.push(`<path d="${path}" fill="${escapeHTML(item.color)}" stroke="${escapeHTML(colors.background)}" stroke-width="2"><title>${escapeHTML(item.label)}: ${escapeHTML(formatNumber(item.value, options.number_format))} (${escapeHTML(formatNumber(total ? item.value / total * 100 : 0, 'Percent'))})</title></path>`);
    if (options.show_labels === 'Yes' && sweep >= 12) { const point = polarPoint(cx, cy, inner + (radius - inner) * .55, angle + sweep / 2); labels.push(`<text x="${point.x}" y="${point.y + 3}" text-anchor="middle">${escapeHTML(item.label)}${options.show_values === 'Yes' ? ` ${escapeHTML(formatNumber(item.value, options.number_format))}` : ''}</text>`); }
    angle += sweep;
  });
  const center = inner ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="23" font-weight="650">${escapeHTML(formatNumber(total, options.number_format))}</text><text x="${cx}" y="${cy + 17}" text-anchor="middle" fill="${escapeHTML(colors.muted)}" font-size="10">${escapeHTML(options.center_label || 'Total')}</text>` : '';
  const data = { datasets: items.map(item => ({ label: item.label, color: item.color })) };
  const svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(options.title || `${options.chart_type || 'Donut'} chart`)}">${paths.join('')}<g fill="${escapeHTML(colors.text)}" font-size="9" font-weight="650" font-family="inherit">${labels.join('')}${center}</g></svg>`;
  return shell(svg, data, options, width, height, `${options.chart_type || 'Donut'} chart`);
}

module.exports = { cartesianChart, circularChart, normalize, formatNumber, escapeHTML };
