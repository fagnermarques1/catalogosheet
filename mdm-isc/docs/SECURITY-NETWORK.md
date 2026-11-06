# Rede e segurança — por que o scan virou "ataque" e como não repetir

> Esta é a parte que travou o projeto antes. Leia antes de ligar qualquer coisa na rede da escola.

## O que aconteceu

A tentativa anterior **varreu a sub-rede procurando a porta 5555 (ADB) aberta** nas telas.
Do ponto de vista de qualquer firewall/IDS/EDR, isso é **indistinguível de um reconhecimento
de invasor**: um host sondando muitos IPs em uma porta de serviço. Não importa que as telas
sejam da ISC — o *padrão de tráfego* é hostil. Por isso foi marcado como ataque.

Além disso, **ADB sobre TCP é um transporte de desenvolvimento**, não de operação:
- cai a cada reboot (`adb tcpip 5555` não persiste sem Device Owner/propriedade do sistema);
- quebra quando o IP muda (DHCP);
- só um `adb server` fala por vez;
- a 5555 aberta na rotina é uma **porta de controle sem autenticação forte** — risco real.

## A regra de ouro deste projeto

**O servidor NUNCA inicia conexão com as telas. As telas é que ligam pra casa (saída).**

```
   NÃO (vira "ataque", quebra no reboot):          SIM (este projeto):
   servidor --- scan/adb ---> telas               telas --- HTTPS/WSS saída ---> servidor
   (entrada nas telas, varredura)                 (nenhuma porta de entrada nas telas)
```

Com agente-pull:
- nenhuma porta de escuta exposta nas telas;
- nenhum scan de rede (o inventário vem do enrollment, não de varredura);
- atravessa NAT e troca de IP sem reconfigurar nada;
- sobrevive a reboot (o agente reconecta sozinho).

## ADB: só no provisionamento, e combinado

- O ADB entra **uma vez por tela**, de preferência **via USB** (cabo), para instalar o APK e
  rodar `dpm set-device-owner`. Veja `provisioning/provision.sh`.
- Se precisar provisionar por Wi-Fi, faça **1 tela por vez, por IP conhecido** (`adb connect IP:5555`)
  — nunca um laço varrendo a faixa.
- **Depois de provisionar, desligue o ADB/TCP** e a depuração. A 5555 não deve ficar aberta na rotina.

## Antes de mexer na rede: avise quem opera a segurança

O motivo de ter sido "marcado como ataque" é que **havia monitoramento funcionando** (bom sinal).
Para não repetir:

1. **Combine uma janela e um host de origem** com o time de rede/segurança. Diga exatamente
   qual máquina vai falar com as telas e em quais portas.
2. **Documente o servidor central** (IP fixo) como origem legítima e **crie exceção no IDS**
   apenas para o tráfego esperado (telas → servidor, saída).
3. **Nada de varredura.** Se precisar descobrir telas, use a lista de enrollment do servidor,
   não `nmap`/scan.

## Segmentação recomendada (VLAN de telas)

- Coloque as telas numa **VLAN dedicada** (ex.: `VLAN-SINALIZACAO`).
- Regras de firewall mínimas nessa VLAN:
  - **permitir saída** das telas para o **servidor central** (443/TCP HTTPS+WSS; 8080 só em teste);
  - **permitir saída** para NTP e, se usar, DNS interno;
  - **bloquear** tela↔tela (não precisam se falar);
  - **bloquear** qualquer **entrada** vinda de fora para as telas;
  - sem rota para a rede administrativa/alunos.
- IPs por **reserva DHCP** (por MAC) para inventário estável — mas o sistema **não depende** disso,
  porque a identidade da tela é o `deviceId` do enrollment, não o IP.

## Produção: feche o enrollment

No PoC o `/api/enroll` é aberto (qualquer um que acesse o servidor registra uma tela).
Antes de produção:
- exigir uma **chave de pré-provisionamento** (gravada no APK no provisionamento) no `/api/enroll`;
- **HTTPS obrigatório** (certificado interno próprio já resolve) — nunca WSS sem TLS;
- o `token` do enrollment vira credencial da tela; trate como segredo (já não é exposto no dashboard);
- rotacionar token por tela se um aparelho for desativado/roubado (comando de `wipe` via Device Owner).

## Checklist antes de ir pra rede da escola

- [ ] Servidor central com IP fixo e HTTPS.
- [ ] VLAN de telas criada, com as regras de firewall acima.
- [ ] Exceção de IDS combinada e registrada com o time de segurança.
- [ ] Enrollment fechado por chave de pré-provisionamento.
- [ ] Provisionamento por USB; ADB/TCP desligado após cada tela.
- [ ] Teste com 1–2 telas piloto antes do rollout em massa.
