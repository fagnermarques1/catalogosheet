'use strict';
/*
 * Self-test ponta a ponta (sem navegador):
 *  1. sobe o servidor
 *  2. simula uma tela: enroll (REST) + conecta (WS) + heartbeat
 *  3. simula o dashboard: envia comando (showMessage) e um PA
 *  4. verifica que a tela recebeu playlist, comando e PA, e que deu ack
 *  5. confere /api/devices (online) e /api/health
 * Sai com código 0 se tudo passou, 1 caso contrário.
 */
const WebSocket = require('ws');
const { server } = require('./index');

const PASS = [];
const FAIL = [];
function check(name, cond) { (cond ? PASS : FAIL).push(name); console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}`); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  console.log('servidor de teste em', base);

  // --- tela: enroll ---
  const enroll = await (await fetch(base + '/api/enroll', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Tela Teste 101', model: 'WA65C', group: 'bloco-a' })
  })).json();
  check('enroll retornou deviceId e token', !!enroll.deviceId && !!enroll.token);

  // --- tela: conecta WS ---
  const got = { content: false, command: null, pa: null, welcome: false };
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/device?deviceId=${enroll.deviceId}&token=${enroll.token}`);
  const acks = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'content') got.content = true;
    if (m.type === 'welcome') got.welcome = true;
    if (m.type === 'command') { got.command = m; ws.send(JSON.stringify({ type: 'ack', commandId: m.id, result: 'ok-teste' })); }
    if (m.type === 'pa') { got.pa = m; ws.send(JSON.stringify({ type: 'ack', commandId: m.id, result: 'tocado-teste' })); }
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(JSON.stringify({ type: 'heartbeat', status: { volume: 42, uptimeSec: 5 } }));
  await wait(200);

  check('tela recebeu welcome', got.welcome);
  check('tela recebeu playlist (content) ao conectar', got.content);

  // --- dashboard: lista devices (deve estar online) ---
  const devs = await (await fetch(base + '/api/devices')).json();
  const me = devs.find((d) => d.id === enroll.deviceId);
  check('device aparece na lista', !!me);
  check('device está online', me && me.online === true);
  check('status do heartbeat chegou (volume=42)', me && me.status && me.status.volume === 42);
  check('token NÃO é exposto no /api/devices', me && me.token === undefined);

  // --- dashboard: comando showMessage ---
  const cmd = await (await fetch(base + `/api/devices/${enroll.deviceId}/command`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'showMessage', params: { text: 'Olá ISC', durationSec: 5 } })
  })).json();
  await wait(150);
  check('comando foi entregue (delivered=true)', cmd.delivered === true);
  check('tela recebeu o comando showMessage', got.command && got.command.action === 'showMessage');
  check('tela recebeu os params do comando', got.command && got.command.params.text === 'Olá ISC');

  // --- dashboard: PA broadcast ---
  const pa = await (await fetch(base + '/api/pa', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Recreio em 5 minutos', targets: 'all', volume: 90 })
  })).json();
  await wait(150);
  check('PA entregue a 1 tela', pa.delivered === 1);
  check('tela recebeu o PA', got.pa && got.pa.text === 'Recreio em 5 minutos');
  check('PA trouxe volume', got.pa && got.pa.volume === 90);

  // --- PA por grupo deve alcançar a tela do grupo ---
  const paGroup = await (await fetch(base + '/api/pa', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Teste de grupo', targets: 'group:bloco-a' })
  })).json();
  check('PA por grupo alcançou a tela (delivered=1)', paGroup.delivered === 1);

  // --- publicar nova playlist deve empurrar p/ tela conectada ---
  got.content = false;
  const put = await (await fetch(base + '/api/content', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ type: 'html', html: '<h1>Nova</h1>', durationSec: 5 }] })
  })).json();
  await wait(150);
  check('playlist publicada e empurrada (pushed>=1)', put.pushed >= 1);
  check('tela recebeu a nova playlist', got.content === true);

  // --- comando p/ token inválido deve ser rejeitado ---
  const bad = new WebSocket(`ws://127.0.0.1:${port}/ws/device?deviceId=${enroll.deviceId}&token=ERRADO`);
  const badClosed = await new Promise((res) => { bad.on('close', () => res(true)); bad.on('error', () => res(true)); setTimeout(() => res(false), 1000); });
  check('WS com token inválido é recusado', badClosed === true);

  // --- health ---
  const health = await (await fetch(base + '/api/health')).json();
  check('health reporta >=1 online', health.online >= 1);

  // --- ack chegou ao log ---
  await wait(150);
  const log = await (await fetch(base + '/api/log')).json();
  check('ack do comando foi registrado na auditoria', log.some((e) => e.kind === 'ack'));

  ws.close();
  await wait(100);

  console.log(`\nRESULTADO: ${PASS.length} passaram, ${FAIL.length} falharam`);
  if (FAIL.length) { console.log('FALHAS:', FAIL.join(', ')); process.exit(1); }
  console.log('TODOS OS TESTES PASSARAM ✅');
  process.exit(0);
})().catch((e) => { console.error('erro no self-test:', e); process.exit(1); });
