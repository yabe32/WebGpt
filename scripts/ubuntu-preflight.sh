#!/usr/bin/env bash
# Read-only deployment preflight. Run with: bash scripts/ubuntu-preflight.sh chat.example.com
set -Eeuo pipefail

domain="${1:-${DOMAIN:-}}"

echo "== System =="
uname -a
command -v git >/dev/null && git --version || echo "FEHLT: git"
command -v docker >/dev/null && docker --version || echo "FEHLT: docker"
docker compose version 2>/dev/null || echo "FEHLT: Docker Compose Plugin"

echo
echo "== Belegte Ports =="
for port in 80 443 3001; do
  echo "Port ${port}:"
  if ss -ltn "sport = :${port}" | grep -q LISTEN; then
    ss -ltn "sport = :${port}"
  else
    echo "  TCP frei"
  fi
  if [ "$port" = 443 ]; then
    if ss -lun "sport = :${port}" | grep -q UNCONN; then
      ss -lun "sport = :${port}"
    else
      echo "  UDP frei"
    fi
  fi
done

echo
echo "== Firewall =="
if command -v ufw >/dev/null; then
  ufw status || true
else
  echo "UFW ist nicht installiert; Provider-Firewall ebenfalls pruefen."
fi

if [ -n "$domain" ]; then
  echo
  echo "== DNS fuer ${domain} =="
  getent ahostsv4 "$domain" || echo "Kein IPv4-DNS-Ergebnis gefunden."
  getent ahostsv6 "$domain" || true
fi

echo
echo "Erwartung: Caddy verwendet TCP 80, TCP 443 und UDP 443. Die App selbst bleibt nur im Docker-Netz auf Port 3001 erreichbar."
