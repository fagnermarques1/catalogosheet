# Agente Android — ISC (Device Owner)

App de kiosk para as **Samsung Interactive Display (Android, série WAC)** e outros painéis Android.
Hospeda o agente web num WebView em tela cheia (signage + PA + heartbeat) e acrescenta, via ponte
`AndroidNative`, os poderes que exigem **Device Owner**: reboot, volume de sistema, kiosk (lock task)
e abrir app.

## Compilar o APK

> Este repositório traz o **código-fonte**. Gerar o `.apk` exige **Android Studio** ou o
> **Android SDK + Gradle** instalados (não dá para compilar dentro do ambiente do PoC).

1. Abra a pasta `android-agent/` no Android Studio (ou use o SDK via linha de comando).
2. Ajuste o endereço do servidor em `app/build.gradle`:
   ```gradle
   buildConfigField 'String', 'SERVER_URL', '"https://mdm.iscbrazil.local"'
   ```
   (No emulador, `http://10.0.2.2:8080` aponta para o `localhost` da máquina host.)
3. Gere o APK:
   ```bash
   ./gradlew assembleRelease
   # saída: app/build/outputs/apk/release/app-release.apk
   ```

## Provisionar numa tela (uma vez por aparelho)

Pré-requisitos **na tela**: factory reset, **sem nenhuma conta Google**, Depuração USB ligada.
Depois, da sua máquina:

```bash
cd ..            # raiz do mdm-isc
./provisioning/provision.sh android-agent/app/build/outputs/apk/release/app-release.apk usb
```

O script instala o APK e roda `adb shell dpm set-device-owner org.iscbrazil.mdmagent/.AgentDeviceAdminReceiver`.
A partir daí a tela sobe o signage sozinha, entra em kiosk e conecta de saída ao servidor.
**Desligue o ADB/TCP depois** (ver `docs/SECURITY-NETWORK.md`).

## Como os poderes nativos são acionados

O agente web (`public/agent/agent.js`) detecta `window.AndroidNative` e, quando presente, usa a ponte:

| Comando do servidor | No navegador/Flip | No Android Device Owner |
|---|---|---|
| `reboot` | recarrega (simulado) | `DevicePolicyManager.reboot()` real |
| `setVolume` | só visual | `AudioManager` real |
| `screenOff/On` | opacidade | `lockNow()` / wake |
| `launchApp` | indisponível | abre o pacote |
| kiosk | — | `startLockTask()` |

## Arquivos

```
android-agent/
├─ settings.gradle, build.gradle, gradle.properties
└─ app/
   ├─ build.gradle          (SERVER_URL aqui)
   ├─ proguard-rules.pro    (mantém a ponte JavascriptInterface)
   └─ src/main/
      ├─ AndroidManifest.xml
      ├─ java/org/iscbrazil/mdmagent/
      │  ├─ MainActivity.kt              WebView kiosk + ponte AndroidNative
      │  ├─ AgentDeviceAdminReceiver.kt  Device Admin/Owner
      │  └─ BootReceiver.kt              reabre o signage após reboot
      └─ res/xml/device_admin.xml, res/values/strings.xml
```

## Limitação de fabricante

Controle real de **backlight/energia do painel** nas Samsung costuma exigir o **Knox SDK**
(standard/premium). A API Android padrão chega até `lockNow()`. Se precisar desligar/ligar a
luz do painel por agenda, o próximo passo é integrar o Knox SDK aqui — a ponte `AndroidNative`
já é o ponto de extensão natural.
