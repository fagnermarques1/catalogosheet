'use strict';
/*
 * Servidor central MDM + DMS + PA para a ISC.
 *
 * Modelo de comunicação: AGENT-PULL.
 *   - As telas (agentes) ABREM conexão de saída (HTTPS/WSS) com este servidor.
 *   - O servidor NUNCA inicia conexão nem escaneia a rede das telas.
 *   => não dispara IDS, atravessa NAT, sobrevive a troca de IP/DHCP e a reboot.
 *
 * Canais:
 *   - REST  (/api/*)     : operações do dashboard e enrollment.
 *   - WS    (/ws/device) : canal tempo-real servidor<->tela (comandos, PA, signage).
 *   - WS    (/ws/dashboard): push de estado da frota para o painel.
 *
 * O formato das mensagens é "MQTT-like" (campo type + payload) de propósito:
 * em produção troca-se o WS por um broker MQTT sem mudar a lógica. Ver docs/.
 */
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const store = require('./store');

const PORT = process.env.PORT || 8080;
const HEARTBEAT_TIMEOUT_MS = 35000; // sem heartbeat nesse tempo => offline

store.load();
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/', express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);

// conexões vivas
const deviceSockets = new Map(); // deviceId -> ws
const dashboardSockets = new Set();

// ---------- helpers ----------
function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(5).toString('hex');
}

function publicDevice(d) {
  const { token, ...rest } = d; // nunca expõe o token no dashboard
  const online = deviceSockets.has(d.id) &&
    d.lastSeen && (Date.now() - new Date(d.lastSeen).getTime() < HEARTBEAT_TIMEOUT_MS);
  return Object.assign({}, rest, { online });
}

function broadcastDashboards(msg) {
  const data = JSON.stringify(msg);
  for (const ws of dashboardSockets) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function pushDeviceState(id) {
  const d = store.get().devices[id];
  if (d) broadcastDashboards({ type: 'device', device: publicDevice(d) });
}

function sendToDevice(id, msg) {
  const ws = deviceSockets.get(id);
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

function resolveTargets(targets) {
  const devices = store.get().devices;
  if (!targets || targets === 'all') return Object.keys(devices);
  if (Array.isArray(targets)) return targets.filter((id) => devices[id]);
  if (typeof targets === 'string' && targets.startsWith('group:')) {
    const g = targets.slice(6);
    return Object.values(devices).filter((d) => d.group === g).map((d) => d.id);
  }
  return [];
}

// ---------- REST ----------

// Enrollment: a tela se registra e recebe um token para o canal WS.
// (No PoC o enrollment é aberto; em produção exigir chave de pré-provisionamento. Ver docs.)
app.post('/api/enroll', (req, res) => {
  const { deviceId, name, model, group } = req.body || {};
  const devices = store.get().devices;
  const id = deviceId && devices[deviceId] ? deviceId : (deviceId || newId('dev'));
  const existing = devices[id];
  const token = existing ? existing.token : crypto.randomBytes(16).toString('hex');
  devices[id] = Object.assign(existing || {}, {
    id,
    name: name || existing?.name || id,
    model: model || existing?.model || 'desconhecido',
    group: group || existing?.group || 'default',
    token,
    enrolledAt: existing?.enrolledAt || new Date().toISOString(),
    lastSeen: existing?.lastSeen || null,
    status: existing?.status || {}
  });
  store.saveSoon();
  store.logEvent({ kind: 'enroll', deviceId: id, name: devices[id].name });
  pushDeviceState(id);
  res.json({ deviceId: id, token, wsPath: '/ws/device' });
});

app.get('/api/devices', (req, res) => {
  res.json(Object.values(store.get().devices).map(publicDevice));
});

// Comando para UMA tela (MDM): reboot, setVolume, launchApp, showMessage, reload, screenOff...
app.post('/api/devices/:id/command', (req, res) => {
  const { id } = req.params;
  const { action, params } = req.body || {};
  if (!store.get().devices[id]) return res.status(404).json({ error: 'device desconhecido' });
  if (!action) return res.status(400).json({ error: 'action obrigatório' });
  const commandId = newId('cmd');
  const delivered = sendToDevice(id, { type: 'command', id: commandId, action, params: params || {} });
  store.logEvent({ kind: 'command', deviceId: id, action, params, delivered });
  res.json({ commandId, delivered });
});

// Comando em massa / por grupo (MDM em escala)
app.post('/api/command', (req, res) => {
  const { action, params, targets } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action obrigatório' });
  const ids = resolveTargets(targets);
  const commandId = newId('cmd');
  let delivered = 0;
  for (const id of ids) {
    if (sendToDevice(id, { type: 'command', id: commandId, action, params: params || {} })) delivered++;
  }
  store.logEvent({ kind: 'command-bulk', action, params, targetCount: ids.length, delivered });
  res.json({ commandId, targetCount: ids.length, delivered });
});

// PA System: dispara aviso sonoro (TTS ou áudio) para telas selecionadas.
app.post('/api/pa', (req, res) => {
  const { text, audioUrl, targets, volume, priority } = req.body || {};
  if (!text && !audioUrl) return res.status(400).json({ error: 'informe text ou audioUrl' });
  const ids = resolveTargets(targets);
  const paId = newId('pa');
  const msg = { type: 'pa', id: paId, text: text || null, audioUrl: audioUrl || null,
    volume: typeof volume === 'number' ? volume : 100, priority: priority || 'normal' };
  let delivered = 0;
  for (const id of ids) if (sendToDevice(id, msg)) delivered++;
  store.logEvent({ kind: 'pa', text, audioUrl, targetCount: ids.length, delivered, priority: msg.priority });
  res.json({ paId, targetCount: ids.length, delivered });
});

// DMS: conteúdo de signage (playlist global no PoC; por-grupo em produção).
app.get('/api/content', (req, res) => res.json(store.get().content));

app.put('/api/content', (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items deve ser array' });
  store.get().content = { updatedAt: new Date().toISOString(), items };
  store.saveSoon();
  store.logEvent({ kind: 'content-update', count: items.length });
  // empurra a nova playlist para todas as telas conectadas
  let pushed = 0;
  for (const id of deviceSockets.keys()) {
    if (sendToDevice(id, { type: 'content', content: store.get().content })) pushed++;
  }
  broadcastDashboards({ type: 'content', content: store.get().content });
  res.json({ ok: true, pushed });
});

app.get('/api/log', (req, res) => res.json(store.get().commandLog.slice(0, 50)));

app.get('/api/health', (req, res) => res.json({
  ok: true,
  devices: Object.keys(store.get().devices).length,
  online: [...deviceSockets.keys()].length,
  uptimeSec: Math.round(process.uptime())
}));

// ---------- WebSocket ----------
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/ws/device') {
    wss.handleUpgrade(req, socket, head, (ws) => handleDeviceWs(ws, url));
  } else if (url.pathname === '/ws/dashboard') {
    wss.handleUpgrade(req, socket, head, (ws) => handleDashboardWs(ws));
  } else {
    socket.destroy();
  }
});

function handleDeviceWs(ws, url) {
  const deviceId = url.searchParams.get('deviceId');
  const token = url.searchParams.get('token');
  const d = store.get().devices[deviceId];
  if (!d || d.token !== token) {
    ws.send(JSON.stringify({ type: 'error', error: 'nao autorizado (reenrole)' }));
    ws.close();
    return;
  }
  deviceSockets.set(deviceId, ws);
  d.lastSeen = new Date().toISOString();
  store.saveSoon();
  console.log(`[ws] device online: ${deviceId} (${d.name})`);

  // ao conectar, já manda a playlist atual de signage
  ws.send(JSON.stringify({ type: 'content', content: store.get().content }));
  ws.send(JSON.stringify({ type: 'welcome', deviceId, serverTime: new Date().toISOString() }));
  pushDeviceState(deviceId);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'heartbeat') {
      d.lastSeen = new Date().toISOString();
      d.status = Object.assign({}, d.status, msg.status || {});
      store.saveSoon();
      pushDeviceState(deviceId);
    } else if (msg.type === 'ack') {
      store.logEvent({ kind: 'ack', deviceId, commandId: msg.commandId, result: msg.result });
      broadcastDashboards({ type: 'ack', deviceId, commandId: msg.commandId, result: msg.result });
    }
  });

  ws.on('close', () => {
    if (deviceSockets.get(deviceId) === ws) deviceSockets.delete(deviceId);
    console.log(`[ws] device offline: ${deviceId}`);
    pushDeviceState(deviceId);
  });
  ws.on('error', () => {});
}

function handleDashboardWs(ws) {
  dashboardSockets.add(ws);
  // snapshot inicial
  ws.send(JSON.stringify({
    type: 'snapshot',
    devices: Object.values(store.get().devices).map(publicDevice),
    content: store.get().content,
    log: store.get().commandLog.slice(0, 50)
  }));
  ws.on('close', () => dashboardSockets.delete(ws));
  ws.on('error', () => dashboardSockets.delete(ws));
}

// marca telas como offline quando o heartbeat expira
setInterval(() => {
  const now = Date.now();
  for (const d of Object.values(store.get().devices)) {
    const stale = !d.lastSeen || (now - new Date(d.lastSeen).getTime() > HEARTBEAT_TIMEOUT_MS);
    if (stale && deviceSockets.has(d.id)) {
      // conexão presa: derruba
      try { deviceSockets.get(d.id).terminate(); } catch {}
      deviceSockets.delete(d.id);
      pushDeviceState(d.id);
    }
  }
}, 10000);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n  MDM/DMS/PA ISC  →  http://localhost:${PORT}`);
    console.log(`  Dashboard:  http://localhost:${PORT}/dashboard/`);
    console.log(`  Agente web: http://localhost:${PORT}/agent/\n`);
  });
}

module.exports = { app, server };
