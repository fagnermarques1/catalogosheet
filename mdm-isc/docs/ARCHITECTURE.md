# Arquitetura — MDM + DMS + PA System (ISC)

## Visão geral

Três funções, um mesmo plano de controle:

| Função | O que faz | Onde vive |
|---|---|---|
| **MDM** | kiosk/lockdown, reboot, volume, abrir app, mensagem na tela, (wipe) | agente Android (Device Owner) + comandos do servidor |
| **DMS** | signage: playlist de conteúdo com agendamento, cache offline | servidor (biblioteca/playlist) + agente (exibição) |
| **PA System** | aviso sonoro (TTS pt-BR ou áudio) em telas/grupos, com ducking | servidor (disparo) + agente (reprodução) |

Modelo de comunicação: **agent-pull** (as telas ligam pra casa). Ver `SECURITY-NETWORK.md`
para o porquê — é o que resolve o "marcado como ataque" e o "quebra no reboot".

## Componentes

```
public/dashboard  ── painel web de controle (REST + WS de status)
        │ REST (/api/*)
        ▼
server/index.js   ── servidor central (Node): inventário, fila de comandos,
        │               biblioteca de signage, disparo de PA, auditoria
        │ WS /ws/device  (comandos, PA, signage)   ▲ WS /ws/dashboard (status ao vivo)
        ▼
AGENTES (falam o mesmo protocolo):
  • public/agent       → agente WEB: roda em QUALQUER tela (Flip/Tizen, TV box, navegador)
  • android-agent      → agente ANDROID (Kotlin, Device Owner): kiosk + poderes de MDM reais
```

O agente Android **hospeda o agente web num WebView** e expõe uma ponte `AndroidNative`
(reboot/volume/kiosk/abrir app). Resultado: signage e PA têm **uma só implementação**
(a web, já testada), e o nativo acrescenta só o que exige privilégio de sistema.

## Protocolo (mensagens)

Tudo JSON. Formato "MQTT-like" (`type` + payload) de propósito: em produção troca-se o WS
por um broker MQTT sem reescrever a lógica.

### Tela → Servidor
- `POST /api/enroll` `{deviceId?, name, model, group}` → `{deviceId, token, wsPath}`
- WS conecta em `/ws/device?deviceId=..&token=..`
- `{type:"heartbeat", status:{volume, uptimeSec, currentSlide, screen, deviceOwner, ua}}`
- `{type:"ack", commandId, result}`

### Servidor → Tela (via WS)
- `{type:"content", content:{items:[...]}}` — playlist de signage (DMS)
- `{type:"command", id, action, params}` — MDM. Ações:
  `showMessage`, `clearMessage`, `setVolume`, `reload`, `reboot`, `screenOff`, `screenOn`,
  `launchApp` (params.package), `nextSlide`
- `{type:"pa", id, text?, audioUrl?, volume, priority}` — PA System

### Dashboard → Servidor (REST)
- `GET /api/devices` · `POST /api/devices/:id/command` · `POST /api/command` (massa/grupo)
- `POST /api/pa` · `GET|PUT /api/content` · `GET /api/log` · `GET /api/health`

Itens de signage: `{type:"html", html, durationSec}` | `{type:"image|video|url", url, durationSec}`.

## Heterogeneidade da frota (muitas + modelos mistos)

- **Samsung Interactive Display (Android, série WAC)** → agente **Android nativo** (MDM completo).
- **Samsung Flip (Tizen, série WMx)** → **não roda APK**. Use o **agente web** no navegador do Flip
  (ou via conteúdo web do MagicINFO). Signage + PA + heartbeat funcionam; comandos de Device Owner
  (reboot/volume de sistema) não — ficam como "simulado/limitado", o que o dashboard mostra pelo
  campo `deviceOwner:false` no status.
- **Outras TVs/box Android** → agente nativo também, desde que seja possível `set-device-owner`.

`group` no enrollment permite tratar blocos/prédios/tipos separadamente (PA por grupo já funciona).

## O que é PoC e o que falta para produção

| Área | PoC (hoje) | Produção |
|---|---|---|
| Transporte realtime | WebSocket | Broker **MQTT** (TLS, QoS, retained, LWT para offline) |
| Persistência | arquivo JSON | **SQLite/Postgres** |
| Signage | playlist global | playlist **por grupo/tela** + **agendamento** (horários) + **cache offline** no agente |
| Enrollment | aberto | **chave de pré-provisionamento** + HTTPS obrigatório |
| PA | TTS/áudio por WS | **prioridade/fila**, pré-gravados, sino/horário automático, confirmação de reprodução |
| Alta disponibilidade | 1 processo | múltiplas instâncias atrás de LB + broker |
| Auditoria | log em memória/arquivo | trilha persistida + relatórios |
| MDM avançado | kiosk, reboot, volume | políticas de app (allowlist), brilho, Knox SDK p/ backlight/energia, wipe remoto |

## Roadmap sugerido (incremental)

1. **Piloto (1–2 telas)** com este PoC numa VLAN de teste → validar signage + PA + comandos.
2. Trocar JSON por SQLite e WS por MQTT; HTTPS + enrollment fechado.
3. Signage por grupo + agendamento + cache offline.
4. Agente Android nativo compilado e provisionado como Device Owner nas Interactive Display.
5. Rollout em fases por bloco, com exceção de IDS combinada.
6. PA avançado (sinos de horário, prioridade de emergência) e MDM avançado (políticas/Knox).
