#!/usr/bin/env bash
#
# Provisionamento ÚNICO por tela (Device Owner via ADB).
# Isto roda UMA vez por aparelho — depois o ADB nunca mais é usado como canal de gestão.
#
# PRÉ-REQUISITOS NA TELA (Interactive Display Android):
#   1. Fazer FACTORY RESET.
#   2. Ao reiniciar, NÃO adicionar nenhuma conta Google e NÃO conectar e-mail.
#      (Se houver qualquer conta no aparelho, `set-device-owner` FALHA — é a causa nº1 de erro.)
#   3. Ativar Opções do desenvolvedor -> Depuração USB (e aceitar a chave RSA quando conectar).
#
# USO:
#   ./provision.sh caminho/para/app-release.apk [adb_target]
#     adb_target opcional: "usb" (padrão) ou "IP:PORTA" para provisionar via Wi-Fi uma única vez.
#
set -euo pipefail

APK="${1:-}"
TARGET="${2:-usb}"
PKG="org.iscbrazil.mdmagent"
ADMIN="${PKG}/.AgentDeviceAdminReceiver"

if [[ -z "$APK" || ! -f "$APK" ]]; then
  echo "ERRO: informe o caminho do APK. Ex.: ./provision.sh app/build/outputs/apk/release/app-release.apk"
  exit 1
fi
command -v adb >/dev/null || { echo "ERRO: adb não encontrado no PATH."; exit 1; }

echo "==> Alvo ADB: $TARGET"
if [[ "$TARGET" != "usb" ]]; then
  adb connect "$TARGET"
fi

echo "==> Aguardando dispositivo..."
adb wait-for-device

echo "==> Verificando que NÃO há contas no aparelho (pré-requisito do Device Owner)..."
ACCOUNTS=$(adb shell dumpsys account 2>/dev/null | grep -c "Account {" || true)
if [[ "${ACCOUNTS:-0}" -gt 0 ]]; then
  echo "    ATENÇÃO: há $ACCOUNTS conta(s) no aparelho. set-device-owner provavelmente vai falhar."
  echo "    Faça factory reset e NÃO adicione contas antes de provisionar."
  read -r -p "    Continuar mesmo assim? [s/N] " go
  [[ "${go:-N}" =~ ^[sS]$ ]] || exit 1
fi

echo "==> Instalando APK..."
adb install -r "$APK"

echo "==> Definindo como Device Owner..."
if adb shell dpm set-device-owner "$ADMIN"; then
  echo "    OK: $PKG agora é Device Owner."
else
  echo "    FALHA ao definir Device Owner. Causas comuns:"
  echo "      - existe conta no aparelho (faça factory reset);"
  echo "      - o aparelho já tem um Device Owner;"
  echo "      - já passou do setup inicial em algumas versões."
  exit 1
fi

echo "==> Concedendo início pós-boot e abrindo o app..."
adb shell am start -n "${PKG}/.MainActivity" || true

cat <<EOF

==================================================================
 Provisionamento concluído.
 A tela agora:
   - sobe o signage sozinha (inclusive após reboot),
   - fica em modo kiosk (lock task),
   - conecta de SAÍDA ao servidor central (nada de scan/porta aberta).

 RECOMENDADO: depois de provisionar, DESLIGUE o ADB sobre TCP para
 não deixar a 5555 exposta:
   adb shell setprop persist.adb.tcp.port -1   # (pode exigir Device Owner/Knox)
   # e desative "Depuração USB/Wi-Fi" nas Opções do desenvolvedor.
==================================================================
EOF
