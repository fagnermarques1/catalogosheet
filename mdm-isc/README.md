# MDM + DMS + PA System — ISC

PoC de um sistema próprio para gerenciar as telas Android/Tizen da escola:

- **MDM** — kiosk, reboot, volume, mensagem na tela, abrir app (Device Owner).
- **DMS** — digital signage: playlist de conteúdo empurrada para as telas.
- **PA System** — avisos sonoros (voz TTS pt-BR ou áudio) por tela ou por grupo.

> **Princípio central:** as telas **ligam pra casa** (conexão de saída). O servidor **nunca
> escaneia a rede** nem abre porta nas telas. É isso que resolve o problema anterior de a
> varredura ter sido **marcada como ataque** e de o ADB **cair a cada reboot**.
> Leia **[`docs/SECURITY-NETWORK.md`](docs/SECURITY-NETWORK.md)** antes de pôr na rede da escola.

## Rodar o PoC (sem nenhuma tela física)

```bash
cd mdm-isc
npm install
npm start
```

Depois abra no navegador:

- **Dashboard:** http://localhost:8080/dashboard/
- **Agente (simula uma tela):** http://localhost:8080/agent/ — clique em “Iniciar tela”.
  Abra em **várias abas** para simular várias telas.

No dashboard você verá as telas ficarem **online**; então pode:
- disparar um **aviso de PA** (a aba do agente fala em voz alta e escurece o signage);
- editar a **playlist de signage** e publicar (muda em todas as telas na hora);
- mandar **mensagem**, **volume**, **recarregar**, **reiniciar** por tela.

## Testar sem navegador

```bash
npm run selftest
```

Sobe o servidor, simula uma tela via WebSocket e valida enrollment, heartbeat, comando, PA,
PA por grupo, push de playlist, rejeição de token inválido e auditoria (19 verificações).

## Estrutura

```
mdm-isc/
├─ server/            servidor central (Node): REST + WS + inventário + PA + signage
│  ├─ index.js
│  ├─ store.js        persistência (JSON no PoC → SQLite/Postgres em produção)
│  └─ selftest.js     teste ponta a ponta
├─ public/
│  ├─ dashboard/      painel de controle (web)
│  └─ agent/          AGENTE WEB — roda em qualquer tela (Flip/Tizen, box, navegador)
├─ android-agent/     AGENTE ANDROID (Kotlin, Device Owner) — projeto Android Studio
├─ provisioning/      provision.sh — provisionamento ÚNICO por tela via ADB
└─ docs/
   ├─ ARCHITECTURE.md       componentes, protocolo, escala, heterogeneidade, roadmap
   └─ SECURITY-NETWORK.md   rede/VLAN/IDS — leia primeiro
```

## Frota mista (muitas telas, modelos diferentes)

- **Interactive Display (Android)** → agente **Android nativo** (MDM completo: kiosk, reboot, volume).
- **Samsung Flip (Tizen)** → **não roda APK**; use o **agente web** no navegador do Flip. Signage e PA
  funcionam; comandos de Device Owner ficam limitados (o dashboard mostra `deviceOwner:false`).

## Status

- [x] Servidor: enrollment, inventário, heartbeat/online, comandos (unit/massa/grupo), PA, signage, auditoria
- [x] Agente web: signage, PA (TTS/áudio) com ducking, comandos, reconexão, ponte nativa
- [x] Dashboard ao vivo
- [x] Self-test ponta a ponta (19/19)
- [x] Agente Android (código + provisionamento) — **requer Android Studio para gerar o APK**
- [ ] Produção: MQTT, SQLite/Postgres, HTTPS, enrollment fechado, agendamento de signage, cache offline

Próximos passos e o que falta: **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.
