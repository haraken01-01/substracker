import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonthsClamped,
  dueNotifications,
  effectiveDueDate,
  formatDate,
  parseDate,
} from '../src/schedule.js';

test('monthly recurrence clamps month end', () => {
  assert.equal(formatDate(addMonthsClamped(parseDate('2026-01-31'), 1)), '2026-02-28');
});

test('effective due date advances recurring subscriptions', () => {
  assert.equal(effectiveDueDate({
    due_date: '2026-01-31',
    cycle: 'monthly',
    auto_renew: 1,
  }, '2026-03-01').toISOString().slice(0, 10), '2026-03-31');
});

test('notification is due after configured local time', () => {
  const rule = {
    device_id: 'device',
    source_type: 'subscription',
    source_id: 'sub',
    due_date: '2026-06-15',
    cycle: 'monthly',
    auto_renew: 1,
    offsets_json: '[7,1,0]',
    timezone: 'Asia/Tokyo',
    notification_time: '09:00',
  };
  assert.equal(dueNotifications(rule, new Date('2026-06-08T00:05:00Z')).length, 1);
  assert.equal(dueNotifications(rule, new Date('2026-06-07T23:55:00Z')).length, 0);
});
