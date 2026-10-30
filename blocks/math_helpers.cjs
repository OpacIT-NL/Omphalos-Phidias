'use strict';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function finiteNumber(value, name = 'Value') {
  if (value === null || value === undefined || value === '' || (typeof value === 'string' && !value.trim())) throw new Error(`${name} must be a number`);
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${name} must be a finite number`);
  return result;
}
function calculate(a, b, operation) {
  a = finiteNumber(a, 'Number A'); b = finiteNumber(b, 'Number B');
  switch (operation) {
    case 'Add': return a + b;
    case 'Subtract': return a - b;
    case 'Multiply': return a * b;
    case 'Divide': if (b === 0) throw new Error('Cannot divide by zero'); return a / b;
    case 'Modulo': if (b === 0) throw new Error('Cannot calculate modulo zero'); return a % b;
    case 'Power': return a ** b;
    case 'Minimum': return Math.min(a, b);
    case 'Maximum': return Math.max(a, b);
    default: throw new Error(`Unknown math operation: ${operation}`);
  }
}
function percentage(value, reference, operation) {
  value = finiteNumber(value, 'Value'); reference = finiteNumber(reference, 'Reference');
  switch (operation) {
    case 'Value as Percentage of Reference': if (reference === 0) throw new Error('Reference cannot be zero'); return value / reference * 100;
    case 'Percentage of Reference': return reference * value / 100;
    case 'Increase Reference by Percentage': return reference * (1 + value / 100);
    case 'Decrease Reference by Percentage': return reference * (1 - value / 100);
    case 'Percentage Change': if (reference === 0) throw new Error('Reference cannot be zero'); return (value - reference) / Math.abs(reference) * 100;
    case 'Percentage Point Difference': return value - reference;
    default: throw new Error(`Unknown percentage calculation: ${operation}`);
  }
}
function round(value, mode = 'None', places = 2) {
  if (!Number.isFinite(value)) throw new Error('Calculation did not produce a finite number');
  places = Math.max(0, Math.min(12, Number.isInteger(Number(places)) ? Number(places) : 2));
  if (mode === 'None') return value;
  if (mode === 'Floor') return Math.floor(value);
  if (mode === 'Ceiling') return Math.ceil(value);
  if (mode === 'Truncate') return Math.trunc(value);
  if (mode === 'Significant Digits') return Number(value.toPrecision(Math.max(1, places)));
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
function parseJSON(value, name = 'JSON Data') {
  if (typeof value === 'string') {
    try { return JSON.parse(value); }
    catch { throw new Error(`${name} must be valid JSON text, an object, or a list`); }
  }
  if (value === null || typeof value !== 'object') throw new Error(`${name} must be a JSON object or list`);
  return structuredClone(value);
}
function pathParts(path) {
  const parts = String(path ?? '').trim().split('.').filter(Boolean);
  if (parts.some(part => FORBIDDEN_KEYS.has(part))) throw new Error('Field paths cannot access prototype properties');
  return parts;
}
function readPath(object, path, name = 'Field') {
  const parts = pathParts(path); let value = object;
  for (const part of parts) {
    if (value === null || value === undefined || !Object.hasOwn(Object(value), part)) throw new Error(`${name} not found: ${path}`);
    value = value[part];
  }
  return value;
}
function writePath(object, path, value) {
  const parts = pathParts(path);
  if (!parts.length) throw new Error('Result Field is required');
  let current = object;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) current[part] = {};
    current = current[part];
  }
  current[parts.at(-1)] = value;
}
function operationValue(source, operand, operation) {
  if (operation === 'Value as Percentage of Operand') return percentage(source, operand, 'Value as Percentage of Reference');
  if (operation === 'Percentage of Value') return percentage(operand, source, 'Percentage of Reference');
  if (operation === 'Percentage Change from Operand') return percentage(source, operand, 'Percentage Change');
  return calculate(source, operand, operation);
}
function operandFor(row, options, connectedOperand) {
  if (options.operand_source === 'Field') return readPath(row, options.operand_field, 'Operand Field');
  if (options.operand_source === 'Constant') return options.constant;
  return connectedOperand;
}
function transformJSON(input, connectedOperand, options = {}) {
  const data = parseJSON(input), sourcePath = String(options.source_field || '').trim(), outputMode = options.output_mode || 'Add Result Field';
  const calculateItem = (item, index) => {
    try {
      const rowObject = item && typeof item === 'object' && !Array.isArray(item);
      const source = sourcePath ? readPath(item, sourcePath, 'Source Field') : item;
      const operand = operandFor(rowObject ? item : {}, options, connectedOperand);
      const result = round(operationValue(source, operand, options.operation || 'Multiply'), options.rounding, options.decimal_places);
      if (outputMode === 'Values Only' || !rowObject) return result;
      if (outputMode === 'Replace Source Field') { writePath(item, sourcePath, result); return item; }
      writePath(item, options.result_field, result); return item;
    } catch (error) {
      if (options.invalid_values === 'Skip Row') return Symbol.for('skip');
      if (options.invalid_values === 'Null') {
        if (item && typeof item === 'object' && !Array.isArray(item) && outputMode !== 'Values Only') {
          const target = outputMode === 'Replace Source Field' ? sourcePath : options.result_field; writePath(item, target, null); return item;
        }
        return null;
      }
      if (options.invalid_values === 'Keep Original') return item;
      throw Object.assign(new Error(`Item ${index + 1}: ${error.message}`), { cause: error });
    }
  };
  if (Array.isArray(data)) return data.map(calculateItem).filter(item => item !== Symbol.for('skip'));
  if (sourcePath) return calculateItem(data, 0);
  const entries = Object.entries(data), result = {};
  for (let index = 0; index < entries.length; index++) {
    const [key, value] = entries[index], changed = calculateItem(value, index);
    if (changed !== Symbol.for('skip')) result[key] = changed;
  }
  return result;
}
function numericCandidates(value, fieldPath, invalid, output = [], location = 'value') {
  if (fieldPath) {
    const rows = Array.isArray(value) ? value : [value];
    for (let index = 0; index < rows.length; index++) {
      try { output.push(finiteNumber(readPath(rows[index], fieldPath, 'Value Field'), `Item ${index + 1}`)); }
      catch (error) { if (invalid === 'Error') throw error; if (invalid === 'Zero') output.push(0); }
    }
    return output;
  }
  if (Array.isArray(value)) { value.forEach((item, index) => numericCandidates(item, '', invalid, output, `${location}[${index}]`)); return output; }
  if (value && typeof value === 'object') { Object.entries(value).forEach(([key, item]) => numericCandidates(item, '', invalid, output, `${location}.${key}`)); return output; }
  try { output.push(finiteNumber(value, location)); }
  catch (error) { if (invalid === 'Error') throw error; if (invalid === 'Zero') output.push(0); }
  return output;
}
function aggregateNumbers(input, options = {}) {
  const data = typeof input === 'string' ? parseJSON(input, 'Values') : structuredClone(input);
  const values = numericCandidates(data, String(options.field_path || '').trim(), options.invalid_values || 'Ignore');
  if (!values.length) throw new Error('No numeric values were found');
  const count = values.length, sum = values.reduce((total, value) => total + value, 0), average = sum / count;
  const sorted = values.toSorted((a, b) => a - b), middle = Math.floor(count / 2), median = count % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const divisor = options.variance_type === 'Sample' ? count - 1 : count;
  const variance = divisor > 0 ? values.reduce((total, value) => total + (value - average) ** 2, 0) / divisor : 0;
  const apply = value => round(value, options.rounding, options.decimal_places);
  return { count, sum: apply(sum), average: apply(average), minimum: Math.min(...values), maximum: Math.max(...values), median: apply(median), range: apply(Math.max(...values) - Math.min(...values)), variance: apply(variance), standard_deviation: apply(Math.sqrt(variance)) };
}

module.exports = { finiteNumber, calculate, percentage, round, parseJSON, readPath, writePath, transformJSON, aggregateNumbers };
