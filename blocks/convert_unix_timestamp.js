'use strict';

function formatYear(value) {
  return value >= 0 ? String(value).padStart(4, '0') : `-${String(Math.abs(value)).padStart(4, '0')}`;
}

function formatUnixTimestamp(value, unit = 'Seconds', timeZone = 'UTC') {
  if (typeof value === 'string') value = value.trim();
  if (value === '') throw new Error('Unix Timestamp is required');
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) throw new Error('Unix Timestamp must be a finite number');
  if (!['Seconds', 'Milliseconds', 'Auto detect'].includes(unit)) throw new Error('Timestamp Unit must be Seconds, Milliseconds, or Auto detect');
  if (!['UTC', 'Local'].includes(timeZone)) throw new Error('Time Zone must be UTC or Local');

  const milliseconds = unit === 'Milliseconds' || (unit === 'Auto detect' && Math.abs(timestamp) >= 100_000_000_000)
    ? timestamp
    : timestamp * 1000;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) throw new Error('Unix Timestamp is outside the supported date range');

  const prefix = timeZone === 'UTC' ? 'UTC' : '';
  const part = name => date[`get${prefix}${name}`]();
  const pad = number => String(number).padStart(2, '0');
  return `${formatYear(part('FullYear'))}-${pad(part('Month') + 1)}-${pad(part('Date'))} ${pad(part('Hours'))}:${pad(part('Minutes'))}:${pad(part('Seconds'))}`;
}

module.exports = {
  type: 'convert_unix_timestamp',
  name: 'Convert Unix Timestamp',
  category: 'Date Stuff',
  description: 'Converts a Unix timestamp to readable YYYY-MM-DD HH:MM:SS text.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'timestamp', name: 'Unix Timestamp', kind: 'value', types: ['number', 'text', 'unspecified'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Action', kind: 'action', types: [] },
    { id: 'error', name: 'Action (Error)', kind: 'action', types: [] },
    { id: 'readable_time', name: 'Readable Time', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [
    { key: 'unit', label: 'Timestamp Unit', type: 'select', choices: ['Seconds', 'Milliseconds', 'Auto detect'], default: 'Seconds' },
    { key: 'time_zone', label: 'Time Zone', type: 'select', choices: ['UTC', 'Local'], default: 'UTC' }
  ],
  async execute(_ctx, options, inputs, setOutput) {
    try {
      setOutput('readable_time', formatUnixTimestamp(inputs.timestamp, options.unit, options.time_zone));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('readable_time', '');
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  formatUnixTimestamp
};
