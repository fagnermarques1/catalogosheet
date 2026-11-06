'use strict';
/* Painel de controle: estado ao vivo da frota + comandos/PA/signage. */
(function () {
  const devicesEl = document.getElementById('devices');
  const logEl = document.getElementById('log');
  const statEl = document.getElementById('stat');
  const connEl = document.getElementById('conn');
  const contentEl = document.getElementById('content');
  const paTargetEl = document.getElementById('paTarget');

  const devices = new Map();
  let log = [];

  function api(path, method, body) {
    return fetch(path, {
      method: method || 'GET',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then((r) => r.json());
  }

  function fmtAge(iso) {
    if (!iso) return 'nunca';
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return s + 's atrás';
    if (s < 3600) return Math.round(s / 60) + 'min atrás';
    return Math.round(s / 3600) + 'h atrás';
  }

  function render() {
    const list = [...devices.values()].sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
    statEl.textContent = `${list.length} telas · ${list.filter((d) => d.online).length} online`;
    if (!list.length) {
      devicesEl.innerHTML = '<div class="empty">Nenhuma tela registrada ainda. Abra o <a href="/agent/" style="color:#2ea8ff">agente</a> em outra aba.</div>';
    } else {
      devicesEl.innerHTML = '';
      for (const d of list) devicesEl.appendChild(devCard(d));
    }
    // atualiza seletor de alvos do PA
    const cur = paTargetEl.value;
    const groups = [...new Set(list.map((d) => d.group))];
    paTargetEl.innerHTML = '<option value="all">Todas as telas</option>' +
      groups.map((g) => `<option value="group:${g}">grupo: ${g}</option>`).join('') +
      list.map((d) => `<option value="id:${d.id}">${escapeHtml(d.name)}</option>`).join('');
    if ([...paTargetEl.options].some((o) => o.value === cur)) paTargetEl.value = cur;
  }

  function devCard(d) {
    const el = document.createElement('div');
    el.className = 'dev';
    const st = d.status || {};
    el.innerHTML = `
      <div class="top">
        <span class="dot ${d.online ? 'on' : ''}"></span>
        <span class="name">${escapeHtml(d.name)}</span>
        <span class="meta">${escapeHtml(d.model)}<br>${d.online ? 'online' : 'visto ' + fmtAge(d.lastSeen)} · vol ${st.volume ?? '—'} · grupo ${escapeHtml(d.group)}</span>
      </div>
      <div class="actions">
        <button data-a="msg">Mensagem</button>
        <button data-a="vol">Volume</button>
        <button data-a="reload">Recarregar</button>
        <button data-a="next">Próx. slide</button>
        <button class="danger" data-a="reboot">Reiniciar</button>
      </div>`;
    el.querySelector('[data-a=msg]').onclick = () => {
      const text = prompt('Mensagem na tela:', 'Aula cancelada hoje.');
      if (text != null) api(`/api/devices/${d.id}/command`, 'POST', { action: 'showMessage', params: { text, durationSec: 15 } });
    };
    el.querySelector('[data-a=vol]').onclick = () => {
      const v = prompt('Volume (0-100):', String(st.volume ?? 60));
      if (v != null) api(`/api/devices/${d.id}/command`, 'POST', { action: 'setVolume', params: { volume: Number(v) } });
    };
    el.querySelector('[data-a=reload]').onclick = () => api(`/api/devices/${d.id}/command`, 'POST', { action: 'reload' });
    el.querySelector('[data-a=next]').onclick = () => api(`/api/devices/${d.id}/command`, 'POST', { action: 'nextSlide' });
    el.querySelector('[data-a=reboot]').onclick = () => { if (confirm(`Reiniciar ${d.name}?`)) api(`/api/devices/${d.id}/command`, 'POST', { action: 'reboot' }); };
    return el;
  }

  function renderLog() {
    logEl.innerHTML = log.slice(0, 50).map((e) => {
      const t = new Date(e.at).toLocaleTimeString('pt-BR');
      let desc = e.kind;
      if (e.kind === 'command') desc = `cmd <b>${e.action}</b> → ${e.deviceId}${e.delivered ? '' : ' (offline)'}`;
      else if (e.kind === 'command-bulk') desc = `cmd massa <b>${e.action}</b> → ${e.delivered}/${e.targetCount}`;
      else if (e.kind === 'pa') desc = `PA <b>${e.delivered}/${e.targetCount}</b> ${e.text ? '“' + escapeHtml(e.text.slice(0, 30)) + '”' : e.audioUrl || ''}`;
      else if (e.kind === 'enroll') desc = `enroll <b>${escapeHtml(e.name || e.deviceId)}</b>`;
      else if (e.kind === 'ack') desc = `ack ${e.deviceId} · ${e.result}`;
      else if (e.kind === 'content-update') desc = `playlist atualizada (${e.count} itens)`;
      return `${t} · ${desc}`;
    }).join('<br>') || '<span style="opacity:.5">sem eventos</span>';
  }

  // ---------- WebSocket do painel ----------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/dashboard`);
    ws.onopen = () => { connEl.textContent = 'ao vivo'; connEl.style.color = '#27c093'; };
    ws.onclose = () => { connEl.textContent = 'reconectando…'; connEl.style.color = '#ff5d5d'; setTimeout(connect, 2500); };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'snapshot') {
        devices.clear();
        (m.devices || []).forEach((d) => devices.set(d.id, d));
        log = m.log || [];
        if (m.content) contentEl.value = JSON.stringify(m.content.items, null, 2);
        render(); renderLog();
      } else if (m.type === 'device') {
        devices.set(m.device.id, m.device); render();
      } else if (m.type === 'ack' || m.type === 'content') {
        refreshLog();
      }
    };
  }

  function refreshLog() { api('/api/log').then((l) => { log = l; renderLog(); }); }

  function resolveTarget() {
    const v = paTargetEl.value;
    if (v.startsWith('id:')) return [v.slice(3)];
    return v; // 'all' ou 'group:x'
  }

  // ---------- ações globais ----------
  document.getElementById('sendPa').onclick = () => {
    const text = document.getElementById('paText').value.trim();
    const audioUrl = document.getElementById('paAudio').value.trim();
    const volume = Number(document.getElementById('paVolume').value) || 100;
    api('/api/pa', 'POST', { text: text || undefined, audioUrl: audioUrl || undefined, targets: resolveTarget(), volume })
      .then((r) => { statEl.textContent = `PA enviado a ${r.delivered}/${r.targetCount}`; refreshLog(); });
  };
  document.getElementById('saveContent').onclick = () => {
    let items;
    try { items = JSON.parse(contentEl.value); } catch (e) { alert('JSON inválido: ' + e.message); return; }
    api('/api/content', 'PUT', { items }).then((r) => { statEl.textContent = `playlist publicada (${r.pushed} telas)`; refreshLog(); });
  };
  document.getElementById('bulkReload').onclick = () => api('/api/command', 'POST', { action: 'reload', targets: 'all' }).then(refreshLog);
  document.getElementById('bulkNext').onclick = () => api('/api/command', 'POST', { action: 'nextSlide', targets: 'all' }).then(refreshLog);

  function escapeHtml(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  connect();
})();
