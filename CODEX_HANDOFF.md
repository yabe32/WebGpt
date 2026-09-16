# Übergabe für den nächsten Codex-Chat

## Git und Freigaben

- Repository: `https://github.com/yabe32/WebGpt.git`, Branch `main`.
- Letzter gepushter Release: `v0.2.2` (`d738c56`).
- Lokale Commits danach sind noch nicht gepusht; vor einem Release immer `git status --short`, `git log --oneline origin/main..HEAD`, `npm run typecheck`, `npm test` und `npm run build` ausführen.
- Der Nutzer möchte fortlaufende Umsetzung ohne Zwischenfreigaben. Eine ausdrückliche Bestätigung ist nur vor `git push` nach GitHub nötig. Erst Commit und Tag vorbereiten, dann die genaue Bestätigung einholen und erst danach `git push origin main` und `git push origin vX.Y.Z` ausführen.
- Niemals `.env`, `.data`, `/data`, Setup-Schlüssel, SQLite-Daten, Codex-Tokens oder private Chatinhalte committen/ausgeben.

## Ubuntu-Update

Der Server nutzt hostweiten Caddy. Daher immer:

```bash
cd ~/privatraum
git fetch --tags origin
git checkout vX.Y.Z
docker compose -f docker-compose.yml -f compose.external-caddy.yml up -d --build
docker compose -f docker-compose.yml -f compose.external-caddy.yml ps
docker compose -f docker-compose.yml -f compose.external-caddy.yml logs --tail=100 app
```

Die App ist nur auf `127.0.0.1:${APP_HOST_PORT:-3101}` veröffentlicht; `3001` ist ausschließlich ihr Containerport. Produktion braucht `DOMAIN`, `ACME_EMAIL`, `APP_HOST_PORT=3101`, `WEB_SEARCH=live`, `MAX_UPLOAD_MB`, `TURN_IDLE_TIMEOUT_SECONDS` in der privaten `.env`.

## Docker und Sicherheit

Der 4-GB-Server ist beim alten Vite-Build abgestürzt. `v0.2.2` begrenzt den Build-Heap auf 1 GiB und trennt Client-/Server-Build-Layer. Bei einem stillstehenden Build in einer zweiten SSH-Sitzung `free -h`, `uptime`, `docker stats --no-stream` und `sudo dmesg -T | grep -Ei 'out of memory|killed process|oom' | tail -20` prüfen. `Ctrl+C` bricht nur den neuen Build ab; die alte App läuft weiter.

Docker läuft non-root, mit read-only rootfs, `cap_drop: ALL`, `no-new-privileges`, ohne Docker-Socket. bwrap funktioniert auf diesem Host nicht; `CODEX_SANDBOX_MODE=danger-full-access` ist nur im bereits isolierten Container gesetzt und vom Nutzer bestätigt. Codex ist nie öffentlich erreichbar.

## Architektur und aktueller Funktionsstand

- React/TypeScript-Frontend, Node/Express/SQLite, Codex App Server über stdio.
- Offizieller ChatGPT-Gerätecode-Login; keine API-Schlüssel oder API-Fallbacks.
- Rollen `member`, `admin`, `superuser`; Superuser kann kontoübergreifend Chats, Bilder, Tokenereignisse, Audit und Zusammenfassungen einsehen.
- Streaming, Branches, Abbruch/Reconnect, Bildupload/HEIC, Bildgenerierung/-bearbeitung, Websuche, individuelle Kontolimits.
- Projekte, Projektanweisungen für Codex-Turns, Tags, manuelle Themen, Archiv, Bildgalerie.
- Audit, Warnungen, Markdown-/PDF-/ZIP-Chat-Export.

## Noch fertigstellen

- Projektaufgaben und Projektdateien sichtbar machen.
- Allgemeine Dokumentanhänge (PDF, DOCX, XLSX, CSV, TXT) mit echter serverseitiger Prüfung und Codex-Analyse; nur Bilder als `localImage` senden.
- Bildversionen über `parent_artifact_id`, erweiterte Suchfilter, Favoriten/Papierkorb, Aufbewahrung, Backups und Zeitdiagramme fertigstellen.
- Neue Endpunkte mit Tests absichern.

## Wichtige Dateien

- `server/db.ts`: nur neue Migrationen anhängen.
- `server/app.ts`: Endpunkte, Auth/Exports.
- `server/chat.ts`: Codex-Turns, Limits, Token-Logging, Projektanweisungen.
- `server/artifacts.ts`: Bildvalidierung.
- `src/main.tsx`, `src/style.css`: UI.
- `tests/server.test.ts`, `tests/fixture.ts`: Fixtures, keine echte Integration.
