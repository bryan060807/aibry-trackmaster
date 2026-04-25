import { assertRepositoryContract } from './contracts.js';
import { PostgresTrackMasterRepository } from './postgres.js';
import { SqliteTrackMasterRepository } from './sqlite.js';

const postgresRuntimeOptIn = 'I_UNDERSTAND_THIS_IS_VALIDATION_ONLY';
const unsafeRuntimeOptIn = 'I_UNDERSTAND_THIS_COULD_TARGET_A_NON_REHEARSAL_DATABASE';

function postgresDatabaseName(databaseUrl) {
  const parsed = new URL(databaseUrl);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
}

function isSafeRehearsalDatabase(databaseName) {
  return /(^|[_-])(rehearsal|dryrun|scratch|test|tmp|temporary)([_-]|$)/i.test(databaseName);
}

export function createRepository({ dbPath, production = false, env = process.env } = {}) {
  const backend = String(env.TRACKMASTER_REPOSITORY_BACKEND || 'sqlite').trim().toLowerCase();
  let repository;

  if (backend === 'sqlite') {
    repository = new SqliteTrackMasterRepository({ dbPath });
  } else if (backend === 'postgres') {
    if (production) {
      throw new Error('TRACKMASTER_REPOSITORY_BACKEND=postgres is disabled when NODE_ENV=production.');
    }
    if (env.TRACKMASTER_ENABLE_POSTGRES_RUNTIME !== postgresRuntimeOptIn) {
      throw new Error(`Set TRACKMASTER_ENABLE_POSTGRES_RUNTIME=${postgresRuntimeOptIn} to boot the Postgres validation backend.`);
    }
    const databaseUrl = env.TRACKMASTER_POSTGRES_URL || env.TRACKMASTER_MIGRATION_DATABASE_URL || '';
    const databaseName = postgresDatabaseName(databaseUrl);
    if (!isSafeRehearsalDatabase(databaseName) && env.TRACKMASTER_ALLOW_UNSAFE_POSTGRES_RUNTIME !== unsafeRuntimeOptIn) {
      throw new Error(
        `Refusing to boot Postgres runtime against database "${databaseName}". ` +
        `Use an isolated rehearsal database name or set TRACKMASTER_ALLOW_UNSAFE_POSTGRES_RUNTIME=${unsafeRuntimeOptIn}.`
      );
    }
    repository = new PostgresTrackMasterRepository({
      databaseUrl,
    });
  } else {
    throw new Error(`Unsupported TRACKMASTER_REPOSITORY_BACKEND: ${backend}`);
  }

  assertRepositoryContract(repository);
  repository.backend = backend;
  return repository;
}
