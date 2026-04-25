/**
 * @typedef {object} TrackMasterRepository
 * @property {() => Promise<void>} init
 * @property {() => Promise<void>} close
 * @property {() => Promise<void>} healthCheck
 * @property {(id: string) => Promise<object | null>} findUserById
 * @property {(email: string) => Promise<object | null>} findUserByEmail
 * @property {(user: { id: string, email: string, passwordHash: string }) => Promise<object>} createUser
 * @property {(userId: string) => Promise<object[]>} listTracks
 * @property {(track: object) => Promise<object>} createTrack
 * @property {(id: string, userId: string) => Promise<object | null>} getTrack
 * @property {(id: string, userId: string) => Promise<number>} deleteTrack
 * @property {(userId: string) => Promise<object[]>} listPresets
 * @property {(preset: object) => Promise<object>} createPreset
 * @property {(id: string, userId: string) => Promise<object | null>} getPreset
 * @property {(preset: object) => Promise<object>} updatePreset
 * @property {(id: string, userId: string) => Promise<number>} deletePreset
 */

export const repositoryContract = Object.freeze([
  'init',
  'close',
  'healthCheck',
  'findUserById',
  'findUserByEmail',
  'createUser',
  'listTracks',
  'createTrack',
  'getTrack',
  'deleteTrack',
  'listPresets',
  'createPreset',
  'getPreset',
  'updatePreset',
  'deletePreset',
]);

export function assertRepositoryContract(repository) {
  for (const method of repositoryContract) {
    if (typeof repository?.[method] !== 'function') {
      throw new Error(`Repository is missing method: ${method}`);
    }
  }
}
