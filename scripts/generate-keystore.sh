#!/bin/bash
set -euo pipefail

KEYSTORE_FILE="monochrome-release.keystore"
OUTPUT_FILE="keystore-secrets.txt"

# Trouver keytool depuis JetBrains Toolbox ou le PATH
KEYTOOL="$(find "$HOME/.local/share/JetBrains/Toolbox/apps" -name "keytool" -type f 2>/dev/null | head -1)"
if [ -z "$KEYTOOL" ]; then
  KEYTOOL="$(command -v keytool 2>/dev/null || true)"
fi
if [ -z "$KEYTOOL" ]; then
  echo "ERREUR: keytool introuvable. Installe un JDK (sudo dnf install java-17-openjdk)" >&2
  exit 1
fi
echo "keytool trouvé: $KEYTOOL"

echo "=== Génération du keystore Android ==="
echo ""

# Demander les infos
read -sp "Mot de passe (keystore + clé): " PASSWORD
echo ""
read -p "Alias de la clé [monochrome]: " KEY_ALIAS
KEY_ALIAS="${KEY_ALIAS:-monochrome}"

# Supprimer l'ancien keystore s'il existe
rm -f "$KEYSTORE_FILE"

echo ""
echo "Génération du keystore..."

"$KEYTOOL" -genkey -v \
  -keystore "$KEYSTORE_FILE" \
  -alias "$KEY_ALIAS" \
  -keyalg RSA -keysize 2048 \
  -validity 10000 \
  -storepass "$PASSWORD" \
  -keypass "$PASSWORD" \
  -dname "CN=Monochrome, OU=Dev, O=Monochrome, L=Paris, ST=IDF, C=FR"

echo ""
echo "Encodage en base64..."

KEYSTORE_B64=$(base64 -w 0 "$KEYSTORE_FILE")

cat > "$OUTPUT_FILE" <<EOF
=== GitHub Secrets pour android-apk workflow ===

ANDROID_KEYSTORE_BASE64:
$KEYSTORE_B64

ANDROID_KEYSTORE_PASSWORD:
$PASSWORD

ANDROID_KEY_ALIAS:
$KEY_ALIAS

ANDROID_KEY_PASSWORD:
$PASSWORD
EOF

echo "Fichier keystore: $KEYSTORE_FILE"
echo "Secrets sauvegardés dans: $OUTPUT_FILE"
echo ""
echo "Ajoute ces 4 secrets dans GitHub > Settings > Secrets and variables > Actions"
echo "ATTENTION: ne commit jamais ces fichiers !"
