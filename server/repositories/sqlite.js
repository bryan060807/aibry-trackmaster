import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const legacyUserId = 'legacy-local-user';

export class SqliteTrackMasterRepository {
  constructor({ dbPath }) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        file_name TEXT NOT NULL,
        storage_path TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'mastered',
        duration_seconds REAL,
        size_bytes INTEGER,
        format TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS presets (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        name TEXT NOT NULL,
        eq_low REAL NOT NULL,
        eq_mid REAL NOT NULL,
        eq_high REAL NOT NULL,
        comp_threshold REAL NOT NULL,
        comp_ratio REAL NOT NULL,
        makeup_gain REAL NOT NULL,
        delay_time REAL NOT NULL,
        delay_feedback REAL NOT NULL,
        delay_mix REAL NOT NULL,
        reverb_decay REAL NOT NULL,
        reverb_mix REAL NOT NULL,
        saturation_drive REAL NOT NULL,
        saturation_mix REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    this.ensureColumn('tracks', 'user_id', 'TEXT');
    this.ensureColumn('presets', 'user_id', 'TEXT');
    this.db.prepare('UPDATE tracks SET user_id = ? WHERE user_id IS NULL').run(legacyUserId);
    this.db.prepare('UPDATE presets SET user_id = ? WHERE user_id IS NULL').run(legacyUserId);
    this.db.prepare('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(
      legacyUserId,
      'legacy@trackmaster.local',
      bcrypt.hashSync(randomUUID(), 12)
    );
  }

  ensureColumn(table, column, definition) {
    const existing = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (!existing.some((row) => row.name === column)) {
      this.db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    }
  }

  async close() {
    this.db?.close();
  }

  async healthCheck() {
    this.db.prepare('SELECT 1').get();
  }

  async findUserById(id) {
    return this.db.prepare('SELECT id, email, created_at FROM users WHERE id = ?').get(id) || null;
  }

  async findUserByEmail(email) {
    return this.db.prepare('SELECT id, email, password_hash, created_at FROM users WHERE email = ?').get(email) || null;
  }

  async createUser({ id, email, passwordHash }) {
    return this.db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?) RETURNING id, email, created_at')
      .get(id, email, passwordHash);
  }

  async listTracks(userId) {
    return this.db.prepare('SELECT * FROM tracks WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  }

  async createTrack(track) {
    this.db.prepare(`
      INSERT INTO tracks (id, user_id, file_name, storage_path, status, duration_seconds, size_bytes, format)
      VALUES (@id, @userId, @fileName, @storagePath, @status, @durationSeconds, @sizeBytes, @format)
    `).run(track);
    return this.getTrack(track.id, track.userId);
  }

  async getTrack(id, userId) {
    return this.db.prepare('SELECT * FROM tracks WHERE id = ? AND user_id = ?').get(id, userId) || null;
  }

  async deleteTrack(id, userId) {
    return this.db.prepare('DELETE FROM tracks WHERE id = ? AND user_id = ?').run(id, userId).changes;
  }

  async listPresets(userId) {
    return this.db.prepare('SELECT * FROM presets WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  }

  async createPreset(preset) {
    this.db.prepare(`
      INSERT INTO presets (
        id, user_id, name, eq_low, eq_mid, eq_high, comp_threshold, comp_ratio, makeup_gain,
        delay_time, delay_feedback, delay_mix, reverb_decay, reverb_mix, saturation_drive, saturation_mix
      )
      VALUES (
        @id, @userId, @name, @eqLow, @eqMid, @eqHigh, @compThreshold, @compRatio, @makeupGain,
        @delayTime, @delayFeedback, @delayMix, @reverbDecay, @reverbMix, @saturationDrive, @saturationMix
      )
    `).run(preset);
    return this.getPreset(preset.id, preset.userId);
  }

  async getPreset(id, userId) {
    return this.db.prepare('SELECT * FROM presets WHERE id = ? AND user_id = ?').get(id, userId) || null;
  }

  async updatePreset(preset) {
    this.db.prepare(`
      UPDATE presets
      SET name = @name,
          eq_low = @eqLow,
          eq_mid = @eqMid,
          eq_high = @eqHigh,
          comp_threshold = @compThreshold,
          comp_ratio = @compRatio,
          makeup_gain = @makeupGain,
          delay_time = @delayTime,
          delay_feedback = @delayFeedback,
          delay_mix = @delayMix,
          reverb_decay = @reverbDecay,
          reverb_mix = @reverbMix,
          saturation_drive = @saturationDrive,
          saturation_mix = @saturationMix,
          updated_at = datetime('now')
      WHERE id = @id
        AND user_id = @userId
    `).run(preset);
    return this.getPreset(preset.id, preset.userId);
  }

  async deletePreset(id, userId) {
    return this.db.prepare('DELETE FROM presets WHERE id = ? AND user_id = ?').run(id, userId).changes;
  }
}
