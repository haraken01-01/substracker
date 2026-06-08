const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(value) {
  const match = DATE_RE.exec(value || '');
  if (!match) return null;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return formatDate(date) === value ? date : null;
}

export function formatDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function addMonthsClamped(base, months) {
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  target.setUTCDate(Math.min(base.getUTCDate(), lastDayOfMonth(target.getUTCFullYear(), target.getUTCMonth())));
  return target;
}

export function addYearsClamped(base, years) {
  const target = new Date(Date.UTC(base.getUTCFullYear() + years, base.getUTCMonth(), 1));
  target.setUTCDate(Math.min(base.getUTCDate(), lastDayOfMonth(target.getUTCFullYear(), target.getUTCMonth())));
  return target;
}

export function localParts(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

export function effectiveDueDate(rule, localDate) {
  const base = parseDate(rule.due_date);
  const today = parseDate(localDate);
  if (!base || !today) return null;
  if (!rule.auto_renew || rule.cycle === 'none' || base >= today) return base;

  const add = rule.cycle === 'yearly' ? addYearsClamped : addMonthsClamped;
  let count = 1;
  let result = add(base, count);
  while (result < today && count < 100000) {
    count += 1;
    result = add(base, count);
  }
  return result;
}

export function dueNotifications(rule, now = new Date()) {
  const local = localParts(now, rule.timezone);
  const localDate = `${local.year}-${local.month}-${local.day}`;
  const due = effectiveDueDate(rule, localDate);
  if (!due) return [];

  const [targetHour, targetMinute] = String(rule.notification_time || '09:00').split(':').map(Number);
  const currentMinutes = Number(local.hour) * 60 + Number(local.minute);
  const targetMinutes = targetHour * 60 + targetMinute;
  if (currentMinutes < targetMinutes) return [];

  let offsets;
  try {
    offsets = JSON.parse(rule.offsets_json);
  } catch {
    return [];
  }

  return offsets
    .filter(offset => Number.isInteger(offset) && offset >= 0 && offset <= 365)
    .filter(offset => formatDate(addDays(due, -offset)) === localDate)
    .map(offset => ({
      offset,
      dueDate: formatDate(due),
      key: `${rule.device_id}:${rule.source_type}:${rule.source_id}:${formatDate(due)}:${offset}`,
    }));
}
