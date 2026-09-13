# Abnahme – 12. September 2026

## Tatsächlich geprüfte Laufzeiten

- **Windows nativ:** Node 20.18.0, npm 10.8.2, Codex 0.153.4. stdio-Initialisierung, Modellkatalog und Gerätecode-Start funktionieren. Vollständiger Codex-Threadstart mit eingeschränkten Leserechten scheiterte an der vorhandenen unelevated Sandbox: `cannot enforce split filesystem read restrictions directly; refusing to run unsandboxed`. Deshalb kein nativer Full-Access-Fallback, sondern WSL2.
- **WSL2 Ubuntu:** Linux-Kernel 6.18.33.2-microsoft-standard-WSL2, eigener Benutzer `privatraum`, Node 22.23.2, Codex 0.153.4. Sicherer Threadstart, tatsächliche ChatGPT-Anmeldung und sämtliche unten aufgeführten Live-Funktionen getestet. Frontend, Backend, Codex und Dateien in derselben Linux-Laufzeit.
- **Docker Desktop:** 4.34.3, Engine 27.2.0, Linux/amd64, Node 22.23.2. Image gebaut, Non-Root-Container auf localhost:8080 gestartet, Healthcheck erfolgreich, SQLite-Datensatz über Containerneustart erhalten, Codex-Threadstart mit restriktivem Profil bestätigt. Container hat absichtlich eine eigene noch nicht angemeldete ChatGPT-Datenablage; keine Live-Modellanfragen im Container behauptet.
- **Ubuntu-Server/Domain/öffentliches HTTPS:** nicht ausgerollt. Compose/Caddy vorbereitet; DNS, Zertifikatsausstellung und produktive Backups müssen bei der späteren Installation abgenommen werden.

## Echter Machbarkeitsnachweis mit deinem Konto

1. Gerätecode-Anmeldung unter WSL2 abgeschlossen; Codex verwaltet die Tokens.
2. Textantwort und echte `item/agentMessage/delta`-Ereignisse empfangen. Zusätzlich echtes Browser-SSE mit zwei getrennten Website-Sitzungen erfolgreich geprüft.
3. Rotes PNG hochgeladen und durch das Modell korrekt als rot erkannt. Private Bildausgabe im Browser sichtbar, vergrößerbar und herunterladbar.
4. Natives Bildwerkzeug erzeugte einen blauen Kreis auf weißem Hintergrund. Codex lieferte `imageGeneration`, `status: completed`, Base64-PNG sowie einen Pfad unter `CODEX_HOME/generated_images/<threadId>`. Import, PNG-Dekodierung, Speicherung, Browseranzeige und Download bestätigt.
5. Derselbe Thread bearbeitete das erzeugte Bild zu einem grünen Kreis auf weißem Hintergrund. Das neue Bild wurde gespeichert, im Browser angezeigt und visuell geprüft. Kein manueller Modellwechsel, keine zusätzliche API.
6. Codex-Prozess und App-Datenbank geschlossen und neu geöffnet; `thread/resume` setzte das Gespräch fort. Das zu Beginn vereinbarte Wort „Sonnenbogen“ wurde korrekt erinnert. Beide echten Bilder blieben auch nach einem weiteren Backend-Neustart im Browser verfügbar.

### Beobachtete Probleme und Korrekturen

Der erste Bildaufruf scheiterte am gemeldeten Bild-Nutzungslimit. Das Image-Item enthielt `status: failed`, einen leeren `result` und keinen detaillierten `failure`-Code; die Modellantwort nannte das Limit. Nach Ablauf des beobachteten Limitfensters erfolgte ein einzelner erneuter Versuch erfolgreich.

Der erste erfolgreiche Bildimport wurde zu Recht durch eine zu enge Pfad-Allowlist zurückgewiesen: Codex speichert Bilder nicht notwendigerweise im Chat-CWD. Der Importer bevorzugt jetzt die tatsächlich gelieferten Base64-Daten und akzeptiert als Dateifallback ausschließlich das zugeordnete Gesprächsverzeichnis oder Codex' threadbezogenen Bildordner nach Realpath-Prüfung. Das bereits erzeugte Bild wurde ohne weitere Generierung importiert. Danach wurde die Bearbeitung echt geprüft.

Die erste echte Browser-Testassertion erwartete eine starre Formulierung; das Modell antwortete korrekt mit „Die Browserprüfung ist erfolgreich.“. Die Assertion wurde auf die angeforderten Wörter angepasst; anschließende Browser-Abnahmen bestanden.

Private Diagnoseberichte liegen in der WSL-Datenablage (`live-report.json`, `image-live-report.json`, `image-final-report.json`), nicht im Repository. Frühere Berichte bleiben als historische Fehlversuche erhalten und dürfen nicht mit dem finalen erfolgreichen Nachtest verwechselt werden. Testbild-Screenshots liegen im ignorierten `test-results`-Verzeichnis.

## Automatisierte Tests mit Protokoll-Fixtures

`npm test`: **13 Tests bestanden**, sowohl nativ unter Windows als auch unter WSL2. Die Fixtures unter `tests/fixture.ts` sind ausschließlich Testabhängigkeiten; sie gelangen nicht in `npm run dev`/`npm start`.

- Website-Login, Argon2id, einmaliger Setup-Schlüssel, CSRF/Origin und Login-Rate-Limit.
- Zugriffsschutz für Chats, Streams, Uploads, Bilder und Status.
- Sitzungswiderruf einschließlich laufender SSE-Verbindung.
- Echte Bilddekodierung, Ablehnung von SVG/gefälschten Bilddateien, private PNG-Ausgabe.
- Idempotentes Senden, Konflikte bei anderer Nutzlast oder parallelen Turns.
- Dauerhafte Textdeltas, finales Ersetzen statt doppeltem Anhängen, Stoppen und gespeicherter Verlauf.
- Codex-Abbruch und Backend-Neustart; unterbrochener Status mit erhaltener Teilantwort.
- `thread/resume` nach Neustart; exakter sichtbarer Präfix bei `thread/fork`.
- Abgelaufene/fehlende Anmeldung und Limitfehler ohne automatische neue Modellanfrage.
- Monotone SSE-IDs, `Last-Event-ID`-Replay, Live-Reconnect und authentifizierte Streams.
- Native Codex-Bildereignisform mit Base64 plus Speicherpfad; fehlgeschlagene und limitierte Bildoperationen.

Ein zusätzlicher Test bestätigt, dass Abbrechen während der Threadinitialisierung und sofortiges erneutes Senden weder zwei Threads noch konkurrierende Modellstarts erzeugt. Der abschließende vollständige WSL-Testlauf mit 13 Tests bestand.

## Browser- und Entwicklungsabnahme

`npm run test:e2e`: Edge/Chromium mit explizitem Fixture-Backend, zwei getrennte Sitzungen, sichtbares Streaming, erneut öffnen, Bearbeiten als Zweig, Umbenennen, Stoppen, Hell/Dunkel und Smartphone-Viewport 390 × 844. Bestanden. Reale Kamera-Hardware, iOS Safari und Android Chrome wurden nicht getestet.

`playwright.live.config.ts`: echter WSL-Codex-Backendprozess, zwei getrennte Website-Sitzungen, gespeicherte echte Text-/Bildinhalte, Live-SSE, Vergrößerung und Download der tatsächlich erzeugten Bilder. Bestanden. Screenshot-Sichtprüfung: blauer Ausgangskreis und grüner bearbeiteter Kreis.

`node scripts/dev-smoke.mjs`: Windows-Quelldatei verändert → automatischer WSL-Abgleich → Vite-Hot-Reload ohne Browserneuladen bestätigt. Backend-Quelldatei verändert → neuer Backendprozess bestätigt. Alle Teständerungen wiederhergestellt.

`npm run dev:stop` wurde erfolgreich geprüft; anschließend wurde die normale App mit `npm run dev` wieder gestartet. Der Website-Zugang war beim letzten Statuscheck noch nicht eingerichtet und muss vom Eigentümer mit eigenem Passwort angelegt werden. Die vorhandene WSL-ChatGPT-Anmeldung wird dabei weiterverwendet.

Build und TypeScript-Prüfung bestanden. `npm audit` meldete nach den Bibliotheksupdates **0 bekannte Schwachstellen**. Ein nichtfunktionaler Vite-Hinweis betrifft das größere Markdown-/KaTeX-Bundle; die App lädt es lokal und ohne CDN.

Die Caddy-Konfiguration wurde zusätzlich im offiziellen Caddy-Container mit `--network none` validiert: **Valid configuration**. Dies ist keine öffentliche TLS-/DNS-Abnahme.

## Websuche

`npm run wsl:web-search` wurde mit der bestehenden ChatGPT-Anmeldung ausgeführt. Der Test startete eine einzelne Recherche zur offiziellen Codex-App-Server-Dokumentation, empfing ein `webSearch`-Protokollereignis und endete erfolgreich. Der private, tokenfreie Statusbericht liegt unter WSL-`.data/web-search-report.json`. Die Websuche bleibt kontolimitabhängig.

## Admin und Mehrkonten

Die Datenbankmigration vom bestehenden Eigentümerkonto zum ersten Admin wurde beim lokalen Neustart ausgeführt. Die Fixture-Abnahme umfasst die Anmeldung eines vom Admin angelegten Mitglieds, die Isolation fremder Chats, den Zugriffsschutz von Bildern sowie die Durchsetzung eines individuellen Stundenlimits. 14 automatisierte Tests bestanden; der Browser-Test bestätigt zusätzlich die dunkle Standardansicht, den Wechsel zur hellen Ansicht und zurück sowie die mobile Darstellung.

## Noch nicht als getestet behauptet

- Reale Nutzungslimit-Rücksetzungszeiten für alle Kontofenster, tatsächlicher Tokenablauf nach längerer Betriebsdauer und TLS-Zertifikatsrotation.
- Vollständige Live-Bild-/Text-Abnahme im separaten Docker-Profil; die Anmeldung wird bewusst nicht übertragen.
- Physische Smartphone-Kamera, Zwischenablage auf allen Mobilbrowsern, barrierefreie Bedienung mit Screenreader.
- Server-Backup-Wiederherstellung unter realen Produktionsbedingungen und kompletter Disaster-Recovery-Lauf.
- Unbegrenzte Last-/Langzeitbelastung. Diese Version ist für genau einen Nutzer und einen Backendprozess vorgesehen.
