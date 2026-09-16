# Architektur und Integrationsvertrag

## Module

- `src`: deutsche React-Oberfläche. Sitzungs-/CSRF-Status nur im Arbeitsspeicher, Theme-Präferenz im LocalStorage. Kein Offline-Cache privater Inhalte. React Markdown ohne Raw-HTML, externe Markdown-Bilder werden nicht geladen; KaTeX `trust:false`.
- `server/auth.ts`: einmalige Einrichtung, Argon2id, serverseitige Gerätesitzungen und CSRF. 256-Bit-Sitzungstoken, nur deren SHA-256-Digest in SQLite. 30 Tage feste Laufzeit; Widerruf wird für jeden SSE-Datensatz und beim Heartbeat geprüft.
- `server/db.ts`: versionierte, transaktionale SQLite-Migrationen, WAL und Foreign Keys. Chats, Turns, Nachrichten, Artefakte, Events und Idempotenzoperationen.
- `server/chat.ts`: serverseitige Turn-Zustände, dedupliziertes Senden, Kontextzweige, dauerhafte Teilantworten, Bildereignisse, pro Turn gemeldete Tokenwerte und ein Inaktivitätsabbruch nach konfigurierbaren 180 Sekunden ohne Text- oder Bildausgabe.
- `server/codex.ts`: gepinnter offizieller nativer Codex-Prozess, JSON-RPC über zeilengetrenntes stdio, Initialisierung, Antwortkorrelation und Notifications. Keine Terminalausgabe wird geparst.
- `server/artifacts.ts`: Größen-/Pixelgrenzen, Dekodierung echter PNG/JPEG/WebP/HEIF-Dateien, normalisierte PNGs ohne EXIF, zufällige IDs und private Dateiausgabe. Kein vom Browser gelieferter Dateipfad wird verwendet.
- `server/app.ts`: HTTP-Routen und authentifiziertes SSE. Caddy ist der einzige spätere öffentliche Einstiegspunkt.

## Zustand und Wiederverbindung

App-Chat-ID ↔ Codex-Thread-ID; App-Turn-ID ↔ Codex-Turn-ID; Nachrichten gehören jeweils genau einem App-Turn. Bilddateien haben eigene zufällige IDs. Bevorzugt wird die validierte Base64-Bildausgabe übernommen. Dateibasierter Fallback erlaubt ausschließlich das Gesprächsverzeichnis und Codex' `generated_images/<threadId>` nach Realpath-Prüfung; niemals beliebige URLs oder fremde Dateipfade.

Vor dem ersten Modellaufruf werden Sende-ID, Hash der Nutzlast und Nutzernachricht atomar gespeichert. Dieselbe Sende-ID liefert denselben Turn, eine andere Nutzlast mit derselben ID wird abgelehnt. Ein partieller eindeutiger Index verhindert parallele aktive Turns pro Chat. Verbindungsfehler lösen keine automatische zweite Modellanfrage aus. Das Protokoll verspricht keine transaktionale Genau-einmal-Ausführung über einen Prozessabsturz: Bei unbekanntem Ausgang wird der Turn unterbrochen und nicht wiederholt.

SSE enthält dauerhafte monotone Ereignis-IDs. Der Browser lädt zuerst einen vollständigen Snapshot mit Wasserstand und verbindet dann den Ereigniskanal. Replay und Live-Abonnement werden ohne asynchronen Zwischenraum installiert. Bei großem Rückstand wird ein Snapshot-Reset gesendet. Der Client ersetzt seinen Zustand aus der Datenbank, statt Textdeltas bei jedem Reconnect erneut anzuhängen. Live-Modellanfragen laufen im Backend weiter, auch wenn Tabs geschlossen werden. Ein langsamer Browser wird getrennt und kann den gespeicherten Zustand erneut laden.

Prozessabbruch markiert `starting`/`running` als `interrupted` und erhält Teilantworten. `turn/interrupt` stoppt laufende Turns. Keine automatische Wiederaufnahme des abgebrochenen Turns. Die nächste neue Nachricht lädt den gespeicherten Thread über `thread/resume`. Codex übernimmt seine dokumentierte Kontextkompaktierung; der App-Verlauf bleibt separat.

Bearbeiten/Neu generieren erstellt mit `thread/fork` und `lastTurnId` einen neuen Kontext bis zum vorherigen Turn. Bei Änderung der allerersten Nachricht wird ein leerer Thread gestartet. Die App kopiert ausschließlich den sichtbaren Präfix. Ursprünglicher Verlauf bleibt erhalten. Branch-Sendeoperationen haben ebenfalls persistente Idempotenzschlüssel. Kein deprecated `thread/rollback`.

## Sicherheitsgrenzen

Die erste Einrichtung erzeugt ein Superuserkonto. Besucher können einen deaktivierten Mitgliedsantrag anlegen, den ein Admin freischaltet. Chats, Sessions und Artefakte tragen eine Konto-ID und werden bei jedem Endpunkt geprüft. Admins sehen nur Nutzungsmetadaten. Ausschließlich Superuser dürfen die schreibgeschützten Endpunkte für fremde Chats, zugehörige Dateien, Token-Ereignisse und kontoübergreifende Auswertungen aufrufen. Token-Ereignisse sind append-only und speichern den vom App Server empfangenen Zeitpunkt, den aktuellen Turn-Stand sowie das Delta zum vorherigen Stand. Zusammenfassungen werden als separate Chats des Superusers gestartet; sie verwenden nur Text und begrenzen das Quellmaterial auf 120.000 Zeichen. App-Stundenlimits sowie optionale Tokenlimits für fünf Stunden und eine Woche werden vor jedem Modellturn gezählt und durchgesetzt; `0` bedeutet unbegrenzt. Die Rate-Limits des einen verbundenen ChatGPT-Kontos bleiben global. Weil Codex Tokenwerte asynchron meldet, kann der aktuell laufende Turn sein Tokenlimit noch überschreiten; der nächste Turn wird zuverlässig blockiert.

Ein eigener `CODEX_HOME` wird bewusst von Codex verwaltet. Persönliche globale MCP-/Plugin-Konfigurationen und API-Key-Umgebungsvariablen werden nicht übernommen. Login-Endpunkte bieten ausschließlich den offiziellen `chatgptDeviceCode`-Flow. `account/read` muss vor einem Turn eine ChatGPT-Anmeldung bestätigen; ein API-Key-Konto ist unzulässig. Die pro Turn vom App Server gemeldeten Tokenwerte werden nur in der App-Datenbank und im Admin-Panel gespeichert; Mitglieder erhalten sie nicht. Kein API-Abrechnungs-Fallback und keine Kontingentkäufe.

Codex erhält ein benanntes Dateiprofil: minimale Systemleserechte, Schreiben nur in den effektiven Gesprächs-Arbeitswurzeln, kein Werkzeug-Netzwerkzugriff. Shell/Unified Exec, Browser, Computer Use, Apps, Plugins, Multi-Agent, Hooks und Erinnerungen sind abgeschaltet. Aktionsfreigaben werden abgelehnt; unbekannte Serveranfragen scheitern geschlossen. Das native Bildwerkzeug wurde für Erstellung und Bearbeitung mit dem angemeldeten Konto erfolgreich getestet. Codex selbst verwaltet seinen threadbezogenen Bildspeicher. Der Codex-Dienstzugriff zur Modellgenerierung ist von Werkzeugnetzwerkrechten getrennt.

Windows verweigerte den eingeschränkten Lesezugriff in der verfügbaren unelevated Sandbox. Deshalb erfolgt die vollständige Integration unter einem eigenen WSL2-Benutzer. Ein späterer Dockerbetrieb verwendet zusätzlich einen Non-Root-Container, read-only Root-FS, keine Capabilities, keine privilegierten Host-Mounts und keinen Docker-Socket. Native Codex-Prozesse werden direkt gestartet, damit es keinen verwaisten npm-/Terminal-Wrapper braucht.

Uploads: höchstens sechs pro Nachricht, standardmäßig 15 MiB pro Originaldatei, 40 Megapixel bei Dekodierung. PNG-Neukodierung kann größer sein und ist zusätzlich begrenzt. HEIC/HEIF von Apple-Geräten wird vor dem Upload in einem Browser-Worker lokal als JPEG konvertiert; der Server akzeptiert außerdem HEIF, falls die lokale Bildbibliothek es dekodieren kann. Lokale Bilddownloads und SSE erfordern denselben Website-Login. Auth- und Upload-Endpunkte prüfen Origin und eigenen Header; angemeldete Mutationen zusätzlich CSRF. HTTP nur auf localhost, HTTPS-Produktionscookies sind Secure. Eine Installation und ein Backendprozess pro SQLite-Datenverzeichnis.

Arbeitsdateien werden nur nach ausdrücklicher Dateianforderung in einem Gespräch angelegt. Ein Download akzeptiert ausschließlich einen normalisierten relativen Pfad innerhalb dieses Gesprächsordners, prüft den Besitzer des Chats, begrenzt die Größe und sendet die Datei immer als Download. Die Oberfläche übersetzt ausschließlich Links des Musters `/data/work/<eigene-chat-id>/…`; ein direkter Serverpfad wird nie ausgeliefert.

## Bewusste Grenzen von v0.1

- Beim ersten Bildtest meldete Codex `status: failed`, `result: ""`, `failure: null`; der Assistent nannte das Bild-Nutzungslimit. Nach Ablauf des beobachteten Limitfensters wurden Erstellung und Bearbeitung tatsächlich erfolgreich geliefert. Fehler ohne detaillierten Protokollcode werden weiterhin ehrlich als fehlgeschlagene Bildoperation angezeigt.
- Protokoll-Fixtures prüfen Bildimport und private Anzeige unabhängig davon; sie werden niemals als Kontoverfügbarkeitsnachweis ausgegeben.
- Löschen entfernt App-Daten, erhält derzeit Codex-Rollouts/Bilddateien. `thread/delete` kann Nachfahren löschen; deshalb erfolgt keine unkontrollierte kaskadierende Codex-Löschung. UI und README erläutern die Aufbewahrung.
- Große Verläufe werden vollständig als App-Snapshot geladen. Für den Einzelbenutzer zunächst bewusst einfach; Pagination ist eine spätere Skalierungsarbeit.
- Keine PWA-/Sprach-/PDF-/Memory-Funktionen. Keine funktionslosen Schaltflächen dafür.
- Personenbezogene Daten sind serverseitig gespeichert, aber nicht anwendungsseitig verschlüsselt. Datenträger-/Backup-Verschlüsselung liegt beim Betreiber.

## Integrierte Websuche

`WEB_SEARCH=live` aktiviert ausschließlich das eingebaute Codex-Websuchwerkzeug. Es wird nicht als Shell-, Browser- oder allgemeiner Netzwerkzugriff ausgeführt; diese Werkzeuge bleiben deaktiviert. Die App zeigt bei `webSearch`-Protokollereignissen einen laufenden Status, speichert die erfolgreiche Nutzung als Installationsfähigkeit und fordert den Agenten zu einer knappen Quellenliste mit Markdown-Links auf. Die tatsächliche Verfügbarkeit bleibt kontogebunden und wird nicht durch Fixturetests behauptet.

## Version und offizielle Quellen

Codex **0.153.4**, exakt in `package.json`/Lockfile. Die Protokolltypen wurden mit `codex app-server generate-ts --out .protocol` aus dieser installierten Version erzeugt und bei der Umsetzung geprüft. `.protocol` ist eine lokale Diagnoseausgabe, kein Laufzeitdownload. `imageGeneration` und einzelne Protokollfelder können sich ändern; vor Updates neu erzeugen und die Live-Abnahme wiederholen. Es wird kein experimenteller API-Handshake aktiviert.

Am 12.09.2026 geprüft:

- [Offizielle App-Server-Referenz](https://learn.chatgpt.com/docs/app-server): stdio, Gerätecode-Anmeldung, Threads, Forks, Streaming, Limits.
- [Bilderstellung](https://learn.chatgpt.com/docs/image-generation): natives Bildwerkzeug und enthaltene Codex-Nutzung; tatsächliche Kontoverfügbarkeit gesondert testen.
- [Bildeingaben](https://learn.chatgpt.com/docs/image-inputs): visuelle Referenzen.
- [Windows-Sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox): native Modi und Einschränkungen.
- [Konfiguration](https://learn.chatgpt.com/docs/config-file/config-reference): benannte Dateiberechtigungsprofile und Werkzeugkonfiguration.

Die Online-Referenz kann neuer als das gepinnte Binary sein. Beispiel einer tatsächlich festgestellten Abweichung: Überschreiben von `model_providers.openai` wurde vom Threadstart abgelehnt; diese Konfiguration wurde entfernt. Endlose Wiederholungen sind abgeschaltet, die App selbst wiederholt Modellstarts nie automatisch.
