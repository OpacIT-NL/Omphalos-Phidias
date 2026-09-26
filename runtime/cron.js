'use strict';

const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

function parseField(source, minimum, maximum, field) {
  const values = new Set();
  for (const token of source.split(',')) {
    const match = token.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/);
    if (!match) throw new Error(`Invalid cron ${field} field`);
    const start = match[1] === '*' ? minimum : Number(match[1]);
    const end = match[2] === undefined ? (match[1] === '*' ? maximum : start) : Number(match[2]);
    const step = match[3] === undefined ? 1 : Number(match[3]);
    if (start < minimum || end > maximum || start > end || !Number.isInteger(step) || step < 1) throw new Error(`Invalid cron ${field} range`);
    for (let value = start; value <= end; value += step) values.add(field === 'weekday' && value === 7 ? 0 : value);
  }
  return values;
}

function parseCron(expression) {
  if (typeof expression !== 'string' || expression.trim().split(/\s+/).length !== 5) throw new Error('Cron expression must contain five fields: minute hour day month weekday');
  const parts = expression.trim().split(/\s+/);
  const fields = parts.map((part, index) => parseField(part, ...ranges[index], ['minute', 'hour', 'day', 'month', 'weekday'][index]));
  return { fields, wildcards: parts.map(part => part.includes('*')) };
}

function matchesCron(schedule, date) {
  const values = [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()];
  const [minute, hour, day, month, weekday] = schedule.fields;
  if (!minute.has(values[0]) || !hour.has(values[1]) || !month.has(values[3])) return false;
  const dayMatches = day.has(values[2]), weekdayMatches = weekday.has(values[4]);
  if (!schedule.wildcards[2] && !schedule.wildcards[4]) return dayMatches || weekdayMatches;
  return dayMatches && weekdayMatches;
}

module.exports = { parseCron, matchesCron };
