import webpush from 'web-push';
import { dueNotifications } from './schedule.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = new Set(String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
  return allowed.has(origin)
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type,x-device-token',
        'access-control-max-age': '86400',
        vary: 'Origin',
      }
    : {};
}

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(request, env) },
  });
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return request.method === 'GET';
  return String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).includes(origin);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{12,100}$/.test(value);
}

function validTimezone(value) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function normalizeRule(rule) {
  if (!rule || typeof rule !== 'object') return null;
  const sourceType = ['subscription', 'license'].includes(rule.sourceType) ? rule.sourceType : null;
  const sourceId = String(rule.sourceId || '');
  const dueDate = String(rule.dueDate || '');
  const cycle = ['monthly', 'yearly', 'none'].includes(rule.cycle) ? rule.cycle : 'none';
  const offsets = [...new Set((Array.isArray(rule.offsets) ? rule.offsets : [])
    .map(Number)
    .filter(value => Number.isInteger(value) && value >= 0 && value <= 365))]
    .sort((a, b) => b - a)
    .slice(0, 10);
  if (!sourceType || !/^[A-Za-z0-9_-]{1,100}$/.test(sourceId) || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !offsets.length) {
    return null;
  }
  return {
    sourceType,
    sourceId,
    name: String(rule.name || '更新項目').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 120),
    amountText: String(rule.amountText || '').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 80),
    dueDate,
    cycle,
    autoRenew: rule.autoRenew === true ? 1 : 0,
    offsets,
    targetUrl: String(rule.targetUrl || '/substracker/').slice(0, 300),
  };
}

async function authenticate(request, env, deviceId) {
  const token = request.headers.get('x-device-token') || '';
  if (!validId(deviceId) || token.length < 24) return null;
  const row = await env.DB.prepare('SELECT token_hash FROM devices WHERE device_id = ?').bind(deviceId).first();
  if (!row) return { exists: false, tokenHash: await sha256(token) };
  return { exists: true, valid: row.token_hash === await sha256(token), tokenHash: row.token_hash };
}

async function syncDevice(request, env) {
  const body = await request.json();
  const deviceId = String(body.deviceId || '');
  const auth = await authenticate(request, env, deviceId);
  if (!auth || (auth.exists && !auth.valid)) return json(request, env, { error: 'unauthorized' }, 401);

  const subscription = body.subscription;
  const timezone = validTimezone(body.timezone) ? body.timezone : 'Asia/Tokyo';
  const notificationTime = /^\d{2}:\d{2}$/.test(body.notificationTime || '') ? body.notificationTime : '09:00';
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return json(request, env, { error: 'invalid_subscription' }, 400);
  }
  const rules = (Array.isArray(body.rules) ? body.rules : []).map(normalizeRule).filter(Boolean).slice(0, 500);
  const now = Date.now();

  const statements = [
    env.DB.prepare(`
      INSERT INTO devices (
        device_id, token_hash, endpoint, p256dh, auth, timezone,
        notification_time, generic_body, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        endpoint = excluded.endpoint,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        timezone = excluded.timezone,
        notification_time = excluded.notification_time,
        generic_body = excluded.generic_body,
        updated_at = excluded.updated_at
    `).bind(
      deviceId,
      auth.tokenHash,
      String(subscription.endpoint).slice(0, 2000),
      String(subscription.keys.p256dh).slice(0, 500),
      String(subscription.keys.auth).slice(0, 500),
      timezone,
      notificationTime,
      body.genericBody === true ? 1 : 0,
      now,
      now,
    ),
    env.DB.prepare('DELETE FROM reminder_rules WHERE device_id = ?').bind(deviceId),
    ...rules.map(rule => env.DB.prepare(`
      INSERT INTO reminder_rules (
        device_id, source_type, source_id, name, amount_text, due_date,
        cycle, auto_renew, offsets_json, target_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      deviceId,
      rule.sourceType,
      rule.sourceId,
      rule.name,
      rule.amountText,
      rule.dueDate,
      rule.cycle,
      rule.autoRenew,
      JSON.stringify(rule.offsets),
      rule.targetUrl,
    )),
  ];
  await env.DB.batch(statements);
  return json(request, env, { ok: true, ruleCount: rules.length });
}

async function deleteDevice(request, env, deviceId) {
  const auth = await authenticate(request, env, deviceId);
  if (!auth?.exists || !auth.valid) return json(request, env, { error: 'unauthorized' }, 401);
  await env.DB.prepare('DELETE FROM devices WHERE device_id = ?').bind(deviceId).run();
  return json(request, env, { ok: true });
}

function notificationPayload(rule, notification, genericBody = false) {
  const typeLabel = rule.source_type === 'license' ? 'ライセンス期限' : '更新';
  const when = notification.offset === 0 ? '今日' : `${notification.offset}日後`;
  const title = genericBody ? 'SubsTrackの期限通知' : `${rule.name}の${typeLabel}`;
  const detail = rule.amount_text ? `${notification.dueDate}・${rule.amount_text}` : notification.dueDate;
  const body = genericBody ? `${when}に期限を迎える項目があります。` : `${when}です（${detail}）`;
  return JSON.stringify({
    title,
    body,
    icon: '/substracker/icon-192.png',
    badge: '/substracker/icon-192.png',
    tag: notification.key,
    data: { url: rule.target_url || '/substracker/' },
  });
}

async function sendPush(env, device, rule, notification) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const subscription = {
    endpoint: device.endpoint,
    keys: { p256dh: device.p256dh, auth: device.auth },
  };
  return webpush.sendNotification(subscription, notificationPayload(rule, notification, device.generic_body === 1), {
    TTL: 86400,
    urgency: 'normal',
  });
}

async function processDueNotifications(env) {
  const { results = [] } = await env.DB.prepare(`
    SELECT r.*, d.endpoint, d.p256dh, d.auth, d.timezone, d.notification_time, d.generic_body
    FROM reminder_rules r
    JOIN devices d ON d.device_id = r.device_id
  `).all();
  let sent = 0;
  let removed = 0;

  for (const rule of results) {
    for (const notification of dueNotifications(rule)) {
      const logged = await env.DB.prepare('SELECT 1 FROM notification_log WHERE notification_key = ?')
        .bind(notification.key).first();
      if (logged) continue;
      try {
        await sendPush(env, rule, rule, notification);
        await env.DB.prepare('INSERT INTO notification_log (notification_key, device_id, sent_at) VALUES (?, ?, ?)')
          .bind(notification.key, rule.device_id, Date.now()).run();
        sent += 1;
      } catch (error) {
        const status = Number(error?.statusCode || error?.status || 0);
        if (status === 404 || status === 410) {
          await env.DB.prepare('DELETE FROM devices WHERE device_id = ?').bind(rule.device_id).run();
          removed += 1;
          break;
        }
        console.error('Push delivery failed', rule.device_id, notification.key, status, error?.message);
      }
    }
  }

  await env.DB.prepare('DELETE FROM notification_log WHERE sent_at < ?')
    .bind(Date.now() - 400 * 86400000).run();
  return { sent, removed };
}

async function sendTest(request, env, deviceId) {
  const auth = await authenticate(request, env, deviceId);
  if (!auth?.exists || !auth.valid) return json(request, env, { error: 'unauthorized' }, 401);
  const device = await env.DB.prepare('SELECT * FROM devices WHERE device_id = ?').bind(deviceId).first();
  if (!device) return json(request, env, { error: 'not_found' }, 404);
  const notification = {
    key: `test:${deviceId}:${Date.now()}`,
    offset: 0,
    dueDate: new Date().toISOString().slice(0, 10),
  };
  const rule = {
    source_type: 'subscription',
    name: 'テスト通知',
    amount_text: '',
    target_url: '/substracker/',
  };
  try {
    await sendPush(env, device, rule, notification);
    return json(request, env, { ok: true });
  } catch (error) {
    console.error('Test push failed', error);
    return json(request, env, { error: 'push_failed' }, 502);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      if (!isAllowedOrigin(request, env)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (!isAllowedOrigin(request, env)) return json(request, env, { error: 'origin_not_allowed' }, 403);

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/vapid-public-key') {
      return json(request, env, { publicKey: env.VAPID_PUBLIC_KEY });
    }
    if (request.method === 'POST' && url.pathname === '/sync') {
      return syncDevice(request, env);
    }
    const deviceMatch = /^\/devices\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (request.method === 'DELETE' && deviceMatch) {
      return deleteDevice(request, env, deviceMatch[1]);
    }
    const testMatch = /^\/devices\/([A-Za-z0-9_-]+)\/test$/.exec(url.pathname);
    if (request.method === 'POST' && testMatch) {
      return sendTest(request, env, testMatch[1]);
    }
    return json(request, env, { error: 'not_found' }, 404);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(processDueNotifications(env));
  },
};

export { processDueNotifications };
