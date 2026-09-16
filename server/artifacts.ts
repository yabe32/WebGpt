import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Store } from './db.js';
import type { Config } from './config.js';
const isAppleHeic = (buffer: Buffer) =>
  buffer.length >= 12 &&
  buffer.subarray(4, 8).toString('ascii') === 'ftyp' &&
  /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(buffer.subarray(8, 12).toString('ascii'));
export class Artifacts {
  constructor(
    private cfg: Config,
    private store: Store,
  ) {}
  async save(buffer: Buffer, userId?: string) {
    if (!buffer.length || buffer.length > this.cfg.maxUpload)
      throw Object.assign(Error('Bild ist zu groß oder leer.'), { status: 413 });
    const image = sharp(buffer, {
      limitInputPixels: 40_000_000,
      animated: false,
      failOn: 'warning',
    });
    let meta;
    try {
      meta = await image.metadata();
    } catch {
      if (isAppleHeic(buffer))
        throw Object.assign(
          Error('HEIC/HEIF konnte hier nicht gelesen werden. Bitte das Foto erneut über die Dateiauswahl hochladen, damit es lokal in JPEG konvertiert wird.'),
          { status: 415 },
        );
      throw Object.assign(Error('Ungültige Bilddatei.'), { status: 415 });
    }
    if (!['png', 'jpeg', 'webp', 'heif'].includes(meta.format || ''))
      throw Object.assign(Error('Nur echte PNG-, JPEG- und WebP-Bilder sind erlaubt.'), {
        status: 415,
      });
    const clean = await image.rotate().png().toBuffer();
    if (clean.length > this.cfg.maxUpload * 4)
      throw Object.assign(Error('Dekodiertes Bild ist zu groß.'), { status: 413 });
    const id = randomUUID();
    await fs.writeFile(this.file(id), clean, { mode: 0o600, flag: 'wx' });
    this.store.run(
      'INSERT INTO artifacts(id,mime,bytes,created_at,user_id) VALUES (?,?,?,?,?)',
      id,
      'image/png',
      clean.length,
      Date.now(),
      userId || null,
    );
    return id;
  }
  async saveDocument(buffer: Buffer, originalName: string, mime: string, userId?: string) {
    if (!buffer.length || buffer.length > this.cfg.maxUpload) throw Object.assign(Error('Datei ist zu groß oder leer.'), { status: 413 });
    const safeName = path.basename(originalName).replace(/[^\w. -]/g, '_').slice(0, 140) || 'dokument';
    const id = randomUUID();
    await fs.writeFile(this.file(id, false), buffer, { mode: 0o600, flag: 'wx' });
    this.store.run('INSERT INTO artifacts(id,mime,bytes,created_at,user_id,original_name) VALUES (?,?,?,?,?,?)', id, mime, buffer.length, Date.now(), userId || null, safeName);
    return id;
  }
  file(id: string, image = true) {
    if (!/^[0-9a-f-]{36}$/.test(id))
      throw Object.assign(Error('Bild nicht gefunden.'), { status: 404 });
    return path.join(this.cfg.files, id + (image ? '.png' : '.bin'));
  }
  record(id: string, userId?: string) {
    return this.store.get<any>(userId ? 'SELECT * FROM artifacts WHERE id=? AND user_id=?' : 'SELECT * FROM artifacts WHERE id=?', id, ...(userId ? [userId] : []));
  }
  async input(id: string, work: string, userId?: string) {
    const record = this.record(id, userId);
    if (!record) throw Object.assign(Error('Datei nicht gefunden.'), { status: 404 });
    if (record.mime !== 'image/png') throw Object.assign(Error('Dieses Dokument wird als Text an Codex übergeben.'), { status: 415 });
    const dest = path.join(work, id + '.png');
    await fs.copyFile(this.file(id), dest);
    return dest;
  }
  async generated(item: any, work: string, threadId?: string, userId?: string) {
    if (item.failure?.type === 'usageLimitExceeded')
      throw Error('Das Kontingent für Bilder ist ausgeschöpft.');
    if (item.status === 'failed')
      throw Error(
        'Codex-Bilderstellung fehlgeschlagen. Es wurde kein Bild geliefert. Bitte die Antwort und die Nutzungslimits prüfen.',
      );
    // The pinned Codex version emits inline base64 AND a path in CODEX_HOME/generated_images.
    // Prefer the bytes delivered by the protocol; this requires no filesystem privilege expansion.
    if (
      typeof item.result === 'string' &&
      item.result.length &&
      item.result.length < this.cfg.maxUpload * 1.5
    ) {
      const value = item.result.replace(/^data:image\/(?:png|jpeg|webp);base64,/, '');
      if (/^[A-Za-z0-9+/=\r\n]+$/.test(value)) return this.save(Buffer.from(value, 'base64'), userId);
    }
    if (item.savedPath) {
      const actual = await fs.realpath(item.savedPath);
      const roots = [await fs.realpath(work)];
      if (threadId && /^[a-zA-Z0-9_-]{1,100}$/.test(threadId)) {
        const nativeRoot = path.join(this.cfg.codexHome, 'generated_images', threadId);
        try {
          const real = await fs.realpath(nativeRoot);
          if (real === nativeRoot) roots.push(real);
        } catch {}
      }
      if (
        !roots.some((root) => {
          const rel = path.relative(root, actual);
          return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
        })
      )
        throw Error('Codex-Bildpfad liegt außerhalb der freigegebenen Bildverzeichnisse.');
      const stat = await fs.stat(actual);
      if (stat.size > this.cfg.maxUpload) throw Error('Erzeugtes Bild ist zu groß.');
      return this.save(await fs.readFile(actual), userId);
    }
    throw Error(
      'Codex hat kein unterstütztes Bildartefakt geliefert. Bildausgabe für diese Konfiguration nicht bestätigt.',
    );
  }
}
