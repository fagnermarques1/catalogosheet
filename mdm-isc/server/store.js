'use strict';
/*
 * Persistência simples em arquivo JSON. Sem dependência de banco nativo —
 * suficiente para o PoC. Em produção, trocar por SQLite/Postgres (ver docs).
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'state.json');

const defaultState = () => ({
  devices: {},            // id -> { id, name, model, group, token, enrolledAt, lastSeen, online, status }
  content: {              // playlist global de signage (DMS)
    updatedAt: null,
    items: [
      { type: 'html', html: '<h1>ISC &mdash; Bem-vindo</h1><p>Signage de exemplo. Edite no dashboard.</p>', durationSec: 10 },
      { type: 'image', url: 'https://placehold.co/1920x1080/0b5/fff?text=ISC+Signage', durationSec: 8 }
    ]
  },
  commandLog: []          // histórico curto de comandos/PA (para auditoria no dashboard)
});

let state = defaultState();
let writeTimer = null;

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const raw = fs.readFileSync(FILE, 'utf8');
      const parsed = JSON.parse(raw);
      state = Object.assign(defaultState(), parsed);
    }
  } catch (err) {
    console.error('[store] falha ao carregar estado, usando padrão:', err.message);
    state = defaultState();
  }
  return state;
}

function saveSoon() {
  // write debounced para não martelar o disco a cada heartbeat
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('[store] falha ao salvar:', err.message);
    }
  }, 500);
}

function get() { return state; }

function logEvent(evt) {
  state.commandLog.unshift(Object.assign({ at: new Date().toISOString() }, evt));
  if (state.commandLog.length > 200) state.commandLog.length = 200;
  saveSoon();
}

module.exports = { load, get, saveSoon, logEvent, FILE };
