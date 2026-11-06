'use strict';
/*
 * Agente WEB da ISC — cliente de referência do protocolo.
 * Roda no navegador/WebView de qualquer tela (Interactive Display, Flip/Tizen, TV box…).
 * Faz: enrollment, heartbeat, signage (DMS), comandos (MDM básico) e PA System (TTS/áudio).
 * O agente Android nativo fala EXATAMENTE este mesmo protocolo.
 */
(function () {
  const LS = window.localStorage;
  const stage = document.getElementById('stage');
  const hud = document.getElementById('hud');
  const msgEl = document.getElementById('msg');
  const paEl = document.getElementById('pa');
  const paText = document.getElementById('pa-text');
  const gate = document.getElementById('gate');

  const qs = new URLSearchParams(location.search);
  const state = {
    deviceId: LS.getItem('isc.deviceId') || null,
    token: LS.getItem('isc.token') || null,
    name: qs.get('name') || LS.getItem('isc.name') || ('Tela-' + Math.floor(Math.random() * 900 + 100)),
    model: qs.get('model') || LS.getItem('isc.model') || 'WebAgent (navegador)',
    group: qs.get('group') || LS.getItem('isc.group') || 'default',
    volume: 60,
    ws: null,
    playlist: [],
    slideIdx: 0,
    slideTimer: null,
    startedAt: Date.now()
  };

  function setHud(text, off) {
    hud.textContent = text;
    hud.classList.toggle('off', !!off);
  }

  async function enroll() {
    const body = { deviceId: state.deviceId || undefined, name: state.name, model: state.model, group: state.group };
    const r = await fetch('/api/enroll', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await r.json();
    state.deviceId = j.deviceId;
    state.token = j.token;
    LS.setItem('isc.deviceId', state.deviceId);
    LS.setItem('isc.token', state.token);
    LS.setItem('isc.name', state.name);
    LS.setItem('isc.model', state.model);
    LS.setItem('isc.group', state.group);
    return j;
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws/device?deviceId=${encodeURIComponent(state.deviceId)}&token=${encodeURIComponent(state.token)}`;
    const ws = new WebSocket(url);
    state.ws = ws;

    ws.onopen = () => {
      setHud(`online · ${state.name} · ${state.deviceId}`);
      sendHeartbeat();
    };
    ws.onclose = () => {
      setHud('offline · tentando reconectar…', true);
      clearInterval(state.hbTimer);
      setTimeout(bootConnection, 3000); // reconexão resiliente (reboot/rede)
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      handle(m);
    };

    clearInterval(state.hbTimer);
    state.hbTimer = setInterval(sendHeartbeat, 10000);
  }

  function sendHeartbeat() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    state.ws.send(JSON.stringify({
      type: 'heartbeat',
      status: {
        volume: state.volume,
        uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
        currentSlide: state.slideIdx,
        screen: document.visibilityState === 'visible' ? 'on' : 'off',
        deviceOwner: !!(window.AndroidNative && window.AndroidNative.reboot),
        ua: navigator.userAgent.slice(0, 80)
      }
    }));
  }

  function ack(commandId, result) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    state.ws.send(JSON.stringify({ type: 'ack', commandId, result }));
  }

  // ---------- handlers ----------
  function handle(m) {
    switch (m.type) {
      case 'content': setPlaylist(m.content && m.content.items ? m.content.items : []); break;
      case 'command': runCommand(m); break;
      case 'pa': playPA(m); break;
      case 'welcome': setHud(`online · ${state.name} · ${state.deviceId}`); break;
      case 'error': setHud('erro: ' + m.error, true); break;
    }
  }

  // ---------- DMS (signage) ----------
  function setPlaylist(items) {
    state.playlist = Array.isArray(items) ? items : [];
    state.slideIdx = 0;
    clearTimeout(state.slideTimer);
    showSlide();
  }

  function showSlide() {
    if (!state.playlist.length) {
      stage.innerHTML = '<div class="html"><h1>Sem conteúdo</h1><p>Defina a playlist no dashboard.</p></div>';
      return;
    }
    const item = state.playlist[state.slideIdx % state.playlist.length];
    if (item.type === 'image') {
      stage.innerHTML = `<img alt="" src="${escapeAttr(item.url)}">`;
    } else if (item.type === 'video') {
      stage.innerHTML = `<video src="${escapeAttr(item.url)}" autoplay muted loop playsinline style="max-width:100%;max-height:100%"></video>`;
    } else if (item.type === 'url') {
      stage.innerHTML = `<iframe src="${escapeAttr(item.url)}" style="border:0;width:100%;height:100%"></iframe>`;
    } else { // html
      stage.innerHTML = `<div class="html">${item.html || ''}</div>`;
    }
    const dur = Math.max(2, Number(item.durationSec) || 10) * 1000;
    clearTimeout(state.slideTimer);
    state.slideTimer = setTimeout(() => { state.slideIdx++; showSlide(); }, dur);
  }

  // Ponte com o app Android nativo (injetada via JavascriptInterface quando rodando
  // dentro do agente Android como Device Owner). No navegador comum é undefined.
  const NATIVE = window.AndroidNative || null;

  // ---------- MDM (comandos) ----------
  function runCommand(m) {
    const p = m.params || {};
    let result = 'ok';
    switch (m.action) {
      case 'showMessage':
        showMessage(p.text || '', Number(p.durationSec) || 10);
        break;
      case 'clearMessage':
        msgEl.style.display = 'none';
        break;
      case 'setVolume':
        state.volume = Math.max(0, Math.min(100, Number(p.volume) || 0));
        if (NATIVE && NATIVE.setVolume) { try { NATIVE.setVolume(state.volume); result = 'volume-nativo'; } catch (e) {} }
        break;
      case 'reload':
        ack(m.id, 'reloading'); location.reload(); return;
      case 'reboot':
        if (NATIVE && NATIVE.reboot) {
          showMessage('↻ Reiniciando…', 4); ack(m.id, 'reboot-nativo');
          try { NATIVE.reboot(); } catch (e) {}
          return;
        }
        // Sem Device Owner (navegador/Flip): sem reboot real, recarrega.
        showMessage('↻ Reiniciando (simulado — sem Device Owner)…', 4);
        ack(m.id, 'reboot-simulado'); setTimeout(() => location.reload(), 1500); return;
      case 'screenOff':
        stage.style.opacity = '0';
        if (NATIVE && NATIVE.setScreen) { try { NATIVE.setScreen(false); } catch (e) {} }
        break;
      case 'screenOn':
        stage.style.opacity = '1';
        if (NATIVE && NATIVE.setScreen) { try { NATIVE.setScreen(true); } catch (e) {} }
        break;
      case 'launchApp':
        if (NATIVE && NATIVE.launchApp && p.package) { try { NATIVE.launchApp(p.package); result = 'app-aberto'; } catch (e) { result = 'launch-falhou'; } }
        else result = 'launchApp-requer-android';
        break;
      case 'nextSlide':
        state.slideIdx++; showSlide(); break;
      default:
        result = 'acao-desconhecida:' + m.action;
    }
    ack(m.id, result);
  }

  function showMessage(text, durationSec) {
    msgEl.textContent = text;
    msgEl.style.display = 'flex';
    clearTimeout(showMessage._t);
    showMessage._t = setTimeout(() => { msgEl.style.display = 'none'; }, durationSec * 1000);
  }

  // ---------- PA System ----------
  function playPA(m) {
    paText.textContent = m.text || '🔊 Aviso';
    paEl.style.display = 'flex';
    stage.classList.add('ducked'); // "ducking": escurece o signage durante o aviso

    const done = () => {
      paEl.style.display = 'none';
      stage.classList.remove('ducked');
      ack(m.id, 'tocado');
    };

    if (m.audioUrl) {
      const a = new Audio(m.audioUrl);
      a.volume = Math.max(0, Math.min(1, (m.volume ?? 100) / 100));
      a.onended = done;
      a.onerror = () => { speak(m.text || 'Aviso', m.volume, done); };
      a.play().catch(() => speak(m.text || 'Aviso', m.volume, done));
    } else {
      speak(m.text || 'Aviso', m.volume, done);
    }
  }

  function speak(text, volume, done) {
    if (!('speechSynthesis' in window)) { setTimeout(done, 2500); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      u.volume = Math.max(0, Math.min(1, (volume ?? 100) / 100));
      u.onend = done;
      u.onerror = () => setTimeout(done, 500);
      window.speechSynthesis.speak(u);
      // fallback caso onend não dispare (alguns WebViews)
      setTimeout(done, Math.max(4000, text.length * 90));
    } catch (e) { setTimeout(done, 2000); }
  }

  // ---------- utils ----------
  function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }

  async function bootConnection() {
    try {
      if (!state.deviceId || !state.token) await enroll();
      connect();
    } catch (e) {
      setHud('falha ao registrar: ' + e.message, true);
      setTimeout(bootConnection, 4000);
    }
  }

  // Gate de 1 clique (só por causa da política de autoplay de áudio do navegador)
  document.getElementById('start').addEventListener('click', () => {
    gate.style.display = 'none';
    // "aquece" o TTS com uma fala vazia para destravar o áudio
    try { window.speechSynthesis && window.speechSynthesis.speak(new SpeechSynthesisUtterance(' ')); } catch (e) {}
    bootConnection();
  });

  // permite pular o gate via ?auto=1 (p/ testes automatizados / kiosk real)
  if (qs.get('auto') === '1') { gate.style.display = 'none'; bootConnection(); }
})();
