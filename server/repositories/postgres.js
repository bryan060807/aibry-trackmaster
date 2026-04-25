import { spawnSync } from 'node:child_process';

const sqliteTimestampSql = "to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')";

function parsePostgresUrl(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch (_err) {
    throw new Error('TRACKMASTER_POSTGRES_URL must be a valid PostgreSQL URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('TRACKMASTER_POSTGRES_URL must use postgres:// or postgresql://.');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('TRACKMASTER_POSTGRES_URL must include a database name.');
  }

  return {
    PGHOST: parsed.hostname || 'localhost',
    PGPORT: parsed.port || '5432',
    PGDATABASE: database,
    PGUSER: decodeURIComponent(parsed.username || ''),
    PGPASSWORD: decodeURIComponent(parsed.password || ''),
  };
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(pgEnv, input, extraArgs = []) {
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', ...extraArgs], {
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      PGHOST: pgEnv.PGHOST,
      PGPORT: pgEnv.PGPORT,
      PGDATABASE: pgEnv.PGDATABASE,
      PGUSER: pgEnv.PGUSER,
      PGPASSWORD: pgEnv.PGPASSWORD,
    },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const error = new Error(result.stderr || result.stdout || `psql exited with status ${result.status}`);
    if (/duplicate key value violates unique constraint/i.test(error.message)) {
      error.code = 'TRACKMASTER_CONSTRAINT_UNIQUE';
    }
    throw error;
  }
  return result.stdout;
}

function jsonQuery(pgEnv, sql) {
  const output = psql(pgEnv, `COPY (${sql}) TO STDOUT;\n`, ['-q', '-t', '-A']).trim();
  return output ? output.split('\n').map((line) => JSON.parse(line)) : [];
}

function one(pgEnv, sql) {
  return jsonQuery(pgEnv, sql)[0] || null;
}

export class PostgresTrackMasterRepository {
  constructor({ databaseUrl }) {
    this.pgEnv = parsePostgresUrl(databaseUrl);
  }

  async init() {
    psql(this.pgEnv, `
      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        created_at text NOT NULL DEFAULT (${sqliteTimestampSql})
      );

      CREATE TABLE IF NOT EXISTS tracks (
        id text PRIMARY KEY,
        user_id text REFERENCES users(id) ON DELETE SET NULL,
        file_name text NOT NULL,
        storage_path text NOT NULL UNIQUE,
        status text NOT NULL DEFAULT 'mastered',
        duration_seconds double precision,
        size_bytes bigint,
        format text,
        created_at text NOT NULL DEFAULT (${sqliteTimestampSql})
      );

      CREATE TABLE IF NOT EXISTS presets (
        id text PRIMARY KEY,
        user_id text REFERENCES users(id) ON DELETE SET NULL,
        name text NOT NULL,
        eq_low double precision NOT NULL,
        eq_mid double precision NOT NULL,
        eq_high double precision NOT NULL,
        comp_threshold double precision NOT NULL,
        comp_ratio double precision NOT NULL,
        makeup_gain double precision NOT NULL,
        delay_time double precision NOT NULL,
        delay_feedback double precision NOT NULL,
        delay_mix double precision NOT NULL,
        reverb_decay double precision NOT NULL,
        reverb_mix double precision NOT NULL,
        saturation_drive double precision NOT NULL,
        saturation_mix double precision NOT NULL,
        created_at text NOT NULL DEFAULT (${sqliteTimestampSql}),
        updated_at text NOT NULL DEFAULT (${sqliteTimestampSql})
      );
    `);
  }

  async close() {}

  async healthCheck() {
    psql(this.pgEnv, 'SELECT 1;');
  }

  async findUserById(id) {
    return one(this.pgEnv, `
      SELECT row_to_json(t)::text
      FROM (SELECT id, email, created_at FROM users WHERE id = ${sqlLiteral(id)}) t
    `);
  }

  async findUserByEmail(email) {
    return one(this.pgEnv, `
      SELECT row_to_json(t)::text
      FROM (SELECT id, email, password_hash, created_at FROM users WHERE lower(email) = lower(${sqlLiteral(email)}) LIMIT 1) t
    `);
  }

  async createUser({ id, email, passwordHash }) {
    return one(this.pgEnv, `
      WITH inserted AS (
        INSERT INTO users (id, email, password_hash)
        VALUES (${sqlLiteral(id)}, ${sqlLiteral(email)}, ${sqlLiteral(passwordHash)})
        RETURNING id, email, created_at
      )
      SELECT row_to_json(t)::text FROM inserted t
    `);
  }

  async listTracks(userId) {
    return jsonQuery(this.pgEnv, `
      SELECT row_to_json(t)::text
      FROM (SELECT * FROM tracks WHERE user_id = ${sqlLiteral(userId)} ORDER BY created_at DESC) t
    `);
  }

  async createTrack(track) {
    psql(this.pgEnv, `
      INSERT INTO tracks (id, user_id, file_name, storage_path, status, duration_seconds, size_bytes, format)
      VALUES (
        ${sqlLiteral(track.id)},
        ${sqlLiteral(track.userId)},
        ${sqlLiteral(track.fileName)},
        ${sqlLiteral(track.storagePath)},
        ${sqlLiteral(track.status)},
        ${sqlLiteral(track.durationSeconds)},
        ${sqlLiteral(track.sizeBytes)},
        ${sqlLiteral(track.format)}
      );
    `);
    return this.getTrack(track.id, track.userId);
  }

  async getTrack(id, userId) {
    return one(this.pgEnv, `
      SELECT row_to_json(t)::text
      FROM (SELECT * FROM tracks WHERE id = ${sqlLiteral(id)} AND user_id = ${sqlLiteral(userId)}) t
    `);
  }

  async deleteTrack(id, userId) {
    const output = psql(this.pgEnv, `
      WITH deleted AS (
        DELETE FROM tracks WHERE id = ${sqlLiteral(id)} AND user_id = ${sqlLiteral(userId)}
        RETURNING 1
      )
      SELECT count(*) FROM deleted;
    `, ['-q', '-t', '-A']).trim();
    return Number.parseInt(output || '0', 10);
  }

  async listPresets(userId) {
    return jsonQuery(this.pgEnv, `
      SELECT row_to_json(t)::text
      FROM (SELECT * FROM presets WHERE user_id = ${sqlLiteral(userId)} ORDER BY created_at DESC) t
    `);
  }

  async createPreset(preset) {
    psql(this.pgEnv, `
      INSERT INTO presets (
        id, user_id, name, eq_low, eq_mid, eq_high, comp_threshold, comp_ratio, makeup_gain,
        delay_time, delay_feedback, delay_mix, reverb_decay, reverb_mix, saturation_drive, saturation_mix
      )
      VALUES (
        ${sqlLiteral(preset.id)},
        ${sqlLiteral(preset.userId)},
        ${sqlLiteral(preset.name)},
        ${sqlLiteral(preset.eqLow)},
        ${sqlLiteral(preset.eqMid)},
        ${sqlLiteral(preset.eqHigh)},
        ${sqlLiteral(preset.compThreshold)},
        ${sqlLiteral(preset.compRatio)},
        ${sqlLiteral(preset.makeupGain)},
        ${sqlLiteral(preset.delayTime)},
        ${sqlLiteral(preset.delayFeedback)},
        ${sqlLiteral(preset.delayMix)},
        ${sqlLiteral(preset.reverbDecay)},
        ${sqlLiteral(preset.reverbMix)},
        ${sqlLiteral(preset.saturationDrive)},
        ${sqlLiteral(preset.saturationMix)}
      );
    `);
    return this.getPreset(preset.id, preset.userId);
  }

  async getPreset(id, userId) {
    return one(this.pgEnv, `
      SELECT row_to_json(t)::text
      FROM (SELECT * FROM presets WHERE id = ${sqlLiteral(id)} AND user_id = ${sqlLiteral(userId)}) t
    `);
  }

  async updatePreset(preset) {
    psql(this.pgEnv, `
      UPDATE presets
      SET name = ${sqlLiteral(preset.name)},
          eq_low = ${sqlLiteral(preset.eqLow)},
          eq_mid = ${sqlLiteral(preset.eqMid)},
          eq_high = ${sqlLiteral(preset.eqHigh)},
          comp_threshold = ${sqlLiteral(preset.compThreshold)},
          comp_ratio = ${sqlLiteral(preset.compRatio)},
          makeup_gain = ${sqlLiteral(preset.makeupGain)},
          delay_time = ${sqlLiteral(preset.delayTime)},
          delay_feedback = ${sqlLiteral(preset.delayFeedback)},
          delay_mix = ${sqlLiteral(preset.delayMix)},
          reverb_decay = ${sqlLiteral(preset.reverbDecay)},
          reverb_mix = ${sqlLiteral(preset.reverbMix)},
          saturation_drive = ${sqlLiteral(preset.saturationDrive)},
          saturation_mix = ${sqlLiteral(preset.saturationMix)},
          updated_at = ${sqliteTimestampSql}
      WHERE id = ${sqlLiteral(preset.id)}
        AND user_id = ${sqlLiteral(preset.userId)};
    `);
    return this.getPreset(preset.id, preset.userId);
  }

  async deletePreset(id, userId) {
    const output = psql(this.pgEnv, `
      WITH deleted AS (
        DELETE FROM presets WHERE id = ${sqlLiteral(id)} AND user_id = ${sqlLiteral(userId)}
        RETURNING 1
      )
      SELECT count(*) FROM deleted;
    `, ['-q', '-t', '-A']).trim();
    return Number.parseInt(output || '0', 10);
  }
}
