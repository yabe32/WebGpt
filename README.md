# Chat

Private Chat-Web-App mit Admin-verwalteten Konten: React/TypeScript, Node/Express, SQLite und offizieller Codex App Server über stdio. Keine OpenAI-API-Schlüssel, keine privaten ChatGPT-Endpunkte, keine automatische Übernahme vorhandener ChatGPT-Chats oder Erinnerungen.

**Entwicklungsweg auf diesem PC: Windows PowerShell → WSL2 Ubuntu.** Die Oberfläche wurde nativ in Edge mit Protokoll-Fixtures geprüft. Ein nativer Codex-Threadstart mit eingeschränktem Dateilesen scheiterte an der vorhandenen unelevated Windows-Sandbox. Derselbe Threadstart funktioniert in WSL2 und im lokalen Linux-Container. Die Rechte wurden nicht aufgeweicht.

Die echte ChatGPT-Anmeldung, Textdeltas, Bildanalyse, Bilderstellung, Bildbearbeitung, Browser-Bildausgabe und Thread-Fortsetzung wurden mit deinem Konto unter WSL2 geprüft. Den tatsächlichen Abnahmestand enthält [docs/TESTING.md](docs/TESTING.md). Fixturetests sind davon getrennt dokumentiert.

## 1. Windows: Voraussetzungen und Installation

- Windows mit PowerShell, Node.js 22 LTS empfohlen (die Windows-Steuerung wurde auch mit 20.18.0 geprüft), Git.
- WSL2 mit Ubuntu. Falls noch nicht vorhanden: in administrativer PowerShell `wsl --install -d Ubuntu`, anschließend gegebenenfalls neu starten.
- Internetzugang für npm, die offizielle Node-Distribution und ChatGPT-Anmeldung.
- Docker Desktop ist optional für den Container-Abnahmetest.

Im Projektverzeichnis:

```powershell
npm ci
npm run setup:wsl
npm run wsl:probe
npm run dev
```

Öffne **http://localhost:5173**. Der erste Setup-Lauf benötigt etwas Zeit. `setup:wsl` erstellt in der vorhandenen Distribution einen eigenen Linux-Benutzer `privatraum` ohne administrativen Gruppenzugang, installiert eine offizielle Node-22-Distribution mit SHA-256-Prüfung unter dessen Home und installiert die Projektpakete. Er verändert den Standardbenutzer deiner Distribution nicht. Die Linux-Binärdateien werden separat installiert; Windows-`node_modules` wird nicht in Linux verwendet.

Falls `rsync`, `curl`, `tar`, `xz` oder CA-Zertifikate fehlen, installiere sie einmal in Ubuntu über dessen Paketverwaltung. Auf diesem PC waren die erforderlichen Werkzeuge vorhanden.

Andere Distribution/Benutzer beim Setup optional:

```powershell
$env:WSL_DISTRO="Ubuntu"
$env:WSL_USER="privatraum"
npm run setup:wsl
```

Die tatsächlich ermittelte Laufzeit steht in der ignorierten `.runtime/wsl.json`. Die installierte Node-Version wird mitprotokolliert. Keine Zugangsdaten werden dort gespeichert.

## 2. Website-Zugang einrichten

In einem zweiten PowerShell-Fenster:

```powershell
npm run wsl:key
```

Der Befehl zeigt ausschließlich lokal deinen zufälligen einmaligen Einrichtungsschlüssel. Trage ihn auf der Website ein und wähle Benutzername und ein eigenes Passwort mit mindestens zwölf Zeichen. Es gibt keine Registrierung und kein Standardpasswort. Nach Einrichtung wird der Schlüssel entfernt. Gib ihn ebenso wie dein Passwort nicht in Chats oder Tickets weiter.

Der Website-Login und die ChatGPT-Anmeldung sind getrennt. Sitzungen sind serverseitig gespeichert und unter **Einstellungen → Angemeldete Geräte** widerrufbar. Abmelden entfernt die aktuelle Sitzung. Sitzungen laufen nach 30 Tagen ab.

## Admin-Panel und Konten

Der bei der Ersteinrichtung angelegte Benutzer ist ein Admin. Bestehende Installationen migrieren das bisherige Eigentümerkonto beim ersten Start automatisch zu diesem Admin; vorhandene Chats und Dateien bleiben diesem Konto zugeordnet. Öffentliche Registrierung gibt es nicht.

Admins öffnen **Einstellungen → Admin-Panel**. Dort können sie Mitglieder oder weitere Admins anlegen, Konten aktivieren/deaktivieren, Rollen ändern und ein Stundenlimit für Modellanfragen pro Konto setzen. Das Panel zeigt nur Metadaten und App-Zähler: Zahl der Unterhaltungen, Modellanfragen, Bilder, Websuchen, aktive Sitzungen und Anfragen der letzten Stunde. Private Nachrichtentexte anderer Konten werden dort nicht angezeigt.

Besucher einer eingerichteten Website können auf der Anmeldeseite **Neuen Zugang beantragen** wählen. Ihr Konto wird als deaktiviertes Mitglied angelegt und hat bis zur Freischaltung keinen Zugang. Im Admin-Panel erscheint es als `deaktiviert`; **Freischalten** aktiviert es. Eine öffentliche Registrierung kann nie Adminrechte erzeugen.

Das Stundenlimit wird vor dem nächsten Codex-Turn erzwungen. Die von Codex gelieferten ChatGPT-Nutzungslimits gelten dagegen für das verbundene ChatGPT-Konto insgesamt und können technisch nicht einzelnen Website-Konten zugeteilt werden. Deaktivieren widerruft alle Sitzungen dieses Kontos. Mindestens ein aktiver Admin bleibt geschützt.

Nur Admins sehen diese globalen Codex-Nutzungslimits. Im selben Panel lässt sich unter **Globales Modell** ein Modell aus dem aktuellen Codex-Katalog auswählen. Die Auswahl wird in der App-Datenbank gespeichert und gilt für alle folgenden beziehungsweise wieder aufgenommenen Gespräche. Laufende Antworten müssen vorher beendet werden. Angezeigt werden nur im Katalog sichtbare Modelle mit Bildeingabe, damit Uploads weiterhin funktionieren; die verfügbare Liste und Kontolimits kommen vom angemeldeten ChatGPT-Codex-Konto.

Das Admin-Panel zeigt außerdem die von Codex gemeldeten Tokenwerte je Website-Konto: Gesamt, laufende fünf Stunden, laufende Woche sowie Eingabe- und Ausgabeanteile einschließlich Reasoning. Die Werte werden pro Turn überschrieben, falls Codex einen präziseren Zwischenstand liefert. Mitglieder erhalten weder diesen Endpunkt noch eine Tokenanzeige.

Tokenlimits gelten pro Website-Konto: ein rollierendes Fenster von fuenf Stunden und ein rollierendes Wochenfenster. Im Admin-Panel ist `0` unbegrenzt. Vor einem neuen Turn wird die Summe der von Codex gemeldeten Tokens im jeweiligen Fenster geprueft. Da Codex diese Werte waehrend oder nach einem Turn liefert, kann ein bereits laufender Turn ein Limit noch ueberschreiten; der folgende Turn wird dann blockiert. Diese App-Grenzen teilen das globale ChatGPT-Plus-Limit nicht prozentual auf.

## 3. ChatGPT anmelden

Bevorzugt auf der laufenden Website: **Einstellungen → Mit ChatGPT anmelden**. Die App zeigt die vom offiziellen App Server gelieferte URL und einen Gerätecode. Öffne die URL, melde dich mit deinem Plus-Konto an und bestätige den Code. Bei gesperrter Gerätecode-Anmeldung prüfe die entsprechenden Sicherheitseinstellungen in ChatGPT. Das Backend übernimmt keine Passwörter; Codex speichert und erneuert die Tokens.

Alternativ bei gestopptem Entwicklungsserver:

```powershell
npm run wsl:login
npm run dev
```

Die Anmelde-URL wird nicht fest eingebaut. Codes können ablaufen; dann eine neue Anmeldung starten. Kein Wechsel auf API-Key-Abrechnung. Das Plus-Abo ist kein allgemeines API-Guthaben. Bilderstellung beansprucht das Codex-Kontingent und kann unabhängig von Textanfragen begrenzt sein.

## Antwort-Timeout und Apple-Fotos

Jeder laufende Turn wird nach **180 Sekunden ohne neues Textdelta oder erzeugtes Bild** als unterbrochen gespeichert. Eine vorhandene Teilantwort bleibt sichtbar; die App wartet nicht auf eine spätere Codex-Rückmeldung. `TURN_IDLE_TIMEOUT_SECONDS` kann in `.env` oder Docker Compose zwischen 30 und 1800 Sekunden gesetzt werden.

Die Dateiauswahl akzeptiert PNG, JPEG, WebP sowie HEIC/HEIF. HEIC/HEIF-Fotos von iPhone und iPad werden vor dem Upload direkt im Browser nach JPEG konvertiert; kein Foto wird an einen Konvertierungsdienst übertragen. Falls ein Browser die lokale Konvertierung nicht unterstützt, zeigt die App eine konkrete Fehlermeldung; das Foto kann dann über Teilen als JPEG gesendet werden. iOS Safari wurde noch nicht auf echter Hardware geprüft.

Dateien erstellt Codex nur, wenn sie ausdrücklich verlangt werden. Solche Dateien bleiben im privaten Arbeitsverzeichnis des jeweiligen Gesprächs. Ein in einer Antwort enthaltener `/data/work/...`-Link wird im Browser zu einem authentifizierten Download übersetzt; weder andere Konten noch beliebige Serverpfade können darüber gelesen werden.

## Internetrecherche

Die integrierte Codex-Websuche ist standardmäßig mit `WEB_SEARCH=live` aktiviert. Formuliere aktuelle Fragen normal im gemeinsamen Chatfeld, zum Beispiel „Suche bitte aktuelle Informationen zu …“. Während der Recherche zeigt die Unterhaltung einen Status an; Antworten mit Recherche enthalten eine knappe Quellenliste als Links. Die Suche ist ein von Codex bereitgestelltes Werkzeug, kein Browser-Scraping und kein zusätzlicher API-Schlüssel. Verfügbarkeit und Limits hängen vom angemeldeten ChatGPT-Konto ab. Die Ausführung anderer Netzwerkwerkzeuge bleibt gesperrt.

Zum Abschalten setzt du in der Linux-`.env` oder Docker-Umgebung `WEB_SEARCH=disabled` und startest die App neu. Zulässige Werte sind `disabled`, `cached`, `indexed` und `live`.

**Nicht gleichzeitig mehrere Entwicklungsserver/CLI-Anmeldungen auf demselben Codex-Profil betreiben.** Windows-Nativdiagnosen (`codex:probe`, `codex:login`) verwenden ein anderes Profil unter Windows-`.data` und melden die WSL-App nicht an.

## 4. Lokal entwickeln und sofort testen

`npm run dev` in Windows startet eine lokale WSL2-Laufzeit. Frontend, Backend, Codex, SQLite und Dateipfade befinden sich vollständig in Linux. Du bearbeitest weiterhin die Quelldateien in diesem Windows-Projekt. Der Startbefehl synchronisiert nur freigegebene Quelldateien in `/home/privatraum/privatraum` und überwacht Änderungen an `src`, `server` und `scripts`. Vite aktualisiert die Oberfläche sofort; `tsx watch` startet das Backend nach Änderungen neu. Bereits laufende Antworten werden bei einem Backend-Neustart als unterbrochen markiert.

Der WSL-Quellspiegel ist generiert: **Produktcode im Windows-Projekt bearbeiten**, sonst überschreibt der nächste Abgleich deine Linux-Änderungen. Gelöschte Dateien werden innerhalb der vier freigegebenen Quellverzeichnisse im Spiegel entfernt. `.env`, Daten, Tokens und Linux-Pakete werden nicht synchronisiert. Nach Änderung der Paketabhängigkeiten `npm run setup:wsl` erneut ausführen. Quellpfade sind nicht im Backend fest verdrahtet.

Die lokale Konfiguration liegt in `\\wsl.localhost\Ubuntu\home\privatraum\privatraum\.env`. Nach Änderung der Ports/Basis-URL beide Server neu starten. Beenden mit Strg+C oder `npm run dev:stop` aus einem zweiten Fenster. Der Stopbefehl prüft PID, Arbeitsverzeichnis und Prozesskommando der eigenen Instanz. Wichtig: `BASE_URL` muss genau der im Browser verwendeten Origin entsprechen (standardmäßig `http://localhost:5173`, nicht `http://127.0.0.1:5173`). Backend-Port ist 3001. Keine öffentlichen Bindings in der Entwicklungsumgebung.

Linux/Ubuntu ohne Windows-Steuerung, im eigenen Checkout mit Node 22:

```bash
npm ci
cp .env.example .env
npm run dev
```

Build/Start ohne Vite unter Windows/WSL2: `npm run wsl:build`, dann in der Linux-`.env` `BASE_URL=http://localhost:3001` setzen und `npm start`. Auf Linux direkt `npm run build`, dann `npm start`. Docker bekommt seine Umgebungsvariablen direkt und startet `node dist/server/index.js`. Vor der Rückkehr zu `npm run dev` die Basis-URL wieder auf `http://localhost:5173` setzen.

## 5. Linux-Container mit Docker Desktop testen

```powershell
docker compose -f compose.local.yml up -d --build
docker compose -f compose.local.yml exec app cat /data/setup-key
```

Öffne **http://localhost:8080**, richte den Website-Zugang ein und melde ChatGPT separat über Einstellungen an. Diese Installation hat ein eigenes Volume `privatraum-local_local_data`; sie erhält keine Windows-/WSL-Anmeldung und keine lokalen Gespräche. Der Container läuft als Benutzer `node`, ohne Docker-Socket, ohne Host-Dateifreigaben, mit schreibgeschütztem Root-Dateisystem und ohne Linux-Capabilities. Nur das Datenvolume und begrenztes temporäres Verzeichnis sind beschreibbar.

```powershell
docker compose -f compose.local.yml ps
docker compose -f compose.local.yml restart app
docker compose -f compose.local.yml down
```

`down` erhält das Datenvolume. **`down -v` würde sämtliche Containerdaten inklusive Anmeldung löschen.** Ein Docker-Test veröffentlicht keine Website: Der Port ist ausschließlich an `127.0.0.1` gebunden.

## 6. Später auf Ubuntu, Domain und HTTPS

Erst eine akzeptierte Version übertragen. Diese Umsetzung wurde nicht auf deinen Server ausgerollt.

1. Auf Ubuntu Git, Docker Engine und das Compose-Plugin nach deren offizieller Installationsanleitung installieren. Git-Zugriff auf ein privates Repository einrichten.
2. Nur Quellcode und Lockfile committen. `.gitignore` und `.dockerignore` schließen lokale Daten, Tokens, Setup-Schlüssel, Testberichte und `.env` aus. Vor dem Push `git status` und die vorgemerkten Dateien prüfen.
3. Auf Ubuntu `git clone <DEIN-PRIVATES-REPOSITORY> privatraum` und `cd privatraum`. Einen konkret getesteten Commit oder Release-Tag auschecken.
4. `.env.example` nach `.env` kopieren. `DOMAIN=chat.deine-domain.de` und `ACME_EMAIL=deine-adresse@example.org` setzen. Optional `MODEL` und `MAX_UPLOAD_MB` anpassen. `docker-compose.yml` setzt HTTPS-Basis-URL und Proxykonfiguration selbst.
5. DNS A/AAAA auf den Server setzen. Nur SSH und HTTP/HTTPS freigeben; Port 3001 bleibt intern. Fehlerhafte AAAA-Einträge entfernen, falls kein IPv6 erreichbar ist.

```bash
docker compose up -d --build
docker compose ps
docker compose exec app cat /data/setup-key
```

Caddy beantragt HTTPS-Zertifikate. Website-Zugang auf deiner Domain einrichten, anschließend ChatGPT mit einem neuen Gerätecode anmelden. App Server ist ausschließlich ein stdio-Unterprozess und hat keinen öffentlichen Netzwerkport. Browser-Sitzungen erhalten unter HTTPS Secure-/HttpOnly-/SameSite-Strict-Cookies. `TRUST_PROXY=true` gilt nur hinter dem einen Caddy-Proxy.

## 7. Updates

Zuerst Backup anlegen. Änderungen lokal testen und committen/taggen; danach auf Ubuntu:

```bash
git fetch --tags
git checkout <GETESTETER-COMMIT-ODER-TAG>
docker compose build
docker compose up -d
docker compose ps
```

Migrationen laufen beim Start transaktional. App und Codex verwenden dieselbe festgelegte Version auf beiden Plattformen. Codex-Upgrades sind bewusste Änderungen am Lockfile und erfordern Protokoll- und Live-Abnahme. Ein Rollback nach einer zukünftigen inkompatiblen Datenbankmigration benötigt das passende Backup, nicht nur ein altes Image.

## 8. Backup und Wiederherstellung

Sichere **das gesamte Datenverzeichnis bei gestoppter App**, damit SQLite, WAL, Codex-Threads, Eingaben und Bilddateien zusammenpassen. Tokens sind im Backup enthalten; daher verschlüsselt und zugriffsbeschränkt aufbewahren. Caddys Volumes enthalten Zertifikatsdaten. Ein Backup ist keine automatische Synchronisierung lokaler Daten nach Ubuntu.

Ubuntu-Beispiel (Backup-Verzeichnis mit Zugriffsrechten 700):

```bash
mkdir -p backups
chmod 700 backups
docker compose stop app
docker compose cp app:/data ./backups/data
docker compose start app
```

Für jede Sicherung ein neues Zielverzeichnis verwenden. Lokales WSL-Backup: `npm run dev` beenden und das komplette Linux-`.data` über den WSL-Dateipfad sichern. Keine einzelne laufende SQLite-Datei kopieren.

Wiederherstellung am besten zuerst in einer separaten Testinstallation: App stoppen; das passende vollständige Datenbackup in deren Datenvolume kopieren; Eigentümer auf UID/GID 1000 setzen; denselben Quellcode-/Image-Stand starten. Beispiel für eine frisch angelegte, noch nicht eingerichtete Compose-Installation:

```bash
docker compose create app
docker compose cp ./backups/data/. app:/data
docker compose run --rm --no-deps --user root app chown -R 1000:1000 /data
docker compose up -d
```

Der einmalige `chown` dient nur der Wiederherstellung. Der reguläre App-/Codex-Prozess bleibt unprivilegiert. Bestehende produktive Daten nicht ungeprüft überschreiben. Nach Wiederherstellung Gerätesitzungen prüfen/widerrufen und gegebenenfalls ChatGPT erneut anmelden. Absolute Codex-Dateireferenzen verlangen dasselbe Linux-Datenverzeichnis (`/data` im Container); ein Windows-Datenbestand wird nicht automatisch konvertiert.

### Ubuntu-Portcheck

Die Produktion verwendet nur Caddy als oeffentlichen Dienst: TCP **80**, TCP **443** und UDP **443** muessen frei sein und durch die Provider-Firewall gehen. Port 3001 bleibt im Docker-Netz und braucht keinen freien Host-Port. Wenn dort schon ein Webserver oder Caddy laeuft, darf keine zweite Caddy-Instanz gestartet werden; die Domain muss dann in dessen vorhandene Konfiguration integriert werden.

Vor dem Start im geklonten Repository:

```bash
bash scripts/ubuntu-preflight.sh chat.deine-domain.de
```

Das Skript aendert nichts. Es zeigt Ports, Docker/Git, UFW und DNS.

Wenn bereits ein zentraler Caddy auf dem Host laeuft, verwende die Overlay-Datei statt einer zweiten Caddy-Instanz:

```bash
docker compose -f docker-compose.yml -f compose.external-caddy.yml up -d --build
```

Dann im vorhandenen Caddyfile den Reverse Proxy eintragen und Caddy neu laden:

```caddyfile
chat.deine-domain.de {
    reverse_proxy 127.0.0.1:3101
}
```

`APP_HOST_PORT` kann gesetzt werden, falls 3101 lokal bereits belegt ist. Dieser Port bleibt an `127.0.0.1` gebunden und wird nie in der Firewall freigegeben.

## 9. Tests und Fehlerbehebung

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit
```

Browser-Abnahme verwendet lokal installiertes Edge. Unter Linux `channel` in `playwright.config.ts` weglassen und `npx playwright install --with-deps chromium` ausführen. Automatisierte Antworten kommen ausschließlich aus ausdrücklich markierten Tests unter `tests/`; `npm run dev` und `npm start` haben keinen Demo-Modus.

Nach ChatGPT-Anmeldung, bei gestopptem Entwicklungsserver:

```powershell
npm run wsl:live
```

Diese echte Abnahme verbraucht enthaltenes Codex-Kontingent. Sie prüft Textdeltas, Bildanalyse, Erstellung, Bearbeitung und Wiederaufnahme. Der private Ergebnisbericht liegt unter WSL-`.data/live-report.json`; Testgespräche unter `.data/live-suite`. Der erste Test beobachtete ein Bildlimit. Nach Ablauf des Limitfensters wurden Erstellung und Bearbeitung erfolgreich nachgeprüft (`image-final-report.json`). Die echte Browser-Bildausgabe und der Farbwechsel wurden zusätzlich geprüft. Ein neuer vollständiger Live-Test überschreibt seinen eigenen Ergebnisbericht, nicht diese historische Abnahmedokumentation.

- **Codex nicht verbunden:** Einstellungen → Codex verbinden. Kein endloser Prozessneustart. Allgemeine Serverfehler werden ohne private Protokollinhalte angezeigt.
- **Native Windows-Sandbox verweigert Threadstart:** `npm run setup:wsl`/`npm run dev` verwenden. Keine Full-Access-Freigabe setzen.
- **403 beim Senden:** Browseradresse gegen `BASE_URL` prüfen; neu laden, damit der aktuelle CSRF-Token geladen wird.
- **Gerätecode abgelaufen:** In Einstellungen eine neue Anmeldung starten. Windows-Anmeldung ist nicht WSL-Anmeldung.
- **Nutzungslimit:** Einstellungen zeigen die gelieferten Fenster und Rücksetzungszeiten. Keine API-Alternative und keine automatischen Kontingentkäufe.
- **Bild ohne Artefakt:** Das Konto/Modell/Tool hat keine unterstützte Ausgabe geliefert. Fehlermeldung und Testergebnis beachten, keine synthetischen Ersatzbilder.
- **Port belegt:** Vorherigen Entwicklungsserver beenden. Nicht zwei Instanzen auf derselben SQLite-/Codex-Datenablage starten.
- **Nach Absturz:** Teilantwort bleibt gespeichert. Eine unterbrochene Modellanfrage wird nicht automatisch wiederholt. Neu generieren erstellt einen Zweig.
- **Langes Gespräch:** Codex verwaltet und kompaktiert seinen Kontext. Die App speichert weiterhin den eigenen sichtbaren Verlauf; sie behauptet keine unbegrenzte Modell-Erinnerung.
- **Löschen:** Entfernt den App-Chat. Codex-Rollouts und Bilddateien bleiben derzeit erhalten, weil `thread/delete` auch abgeleitete Threads löschen kann. Die Löschbestätigung nennt dies ausdrücklich. Für vollständige Datenvernichtung die gestoppte, gesicherte Installation bewusst zurücksetzen; keine automatische Datenbereinigung in v0.1.
- **Kein Offline-Modus:** Nur die Darstellungspräferenz liegt in LocalStorage; keine Chatinhalte, Tokens oder Anhänge. Kein Service Worker/PWA-Cache.

Architektur und Protokollquellen: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Abnahmestand: [docs/TESTING.md](docs/TESTING.md).
