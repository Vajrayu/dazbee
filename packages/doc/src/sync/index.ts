// The sync server's core, for `apps/sync` (`@dazbee/doc/sync`): the design's state and checks, the
// server that takes in a tab's messages, its journal and the host that runs one design between its
// connections and its journal. Not exported from the package index: the editor never runs it.
export { type DesignHost, type Connection, type HostOptions, openHost, UNSAVED, type VersionAnswer } from './host.ts'
export { storedDesign, type StoredDesign } from '../stored-design.ts'
export { DesignGone, Fenced, firstSaved, type Journal, type Loaded, type StoredVersion } from './journal.ts'
export { type MemoryJournal, memoryJournal, type MemoryRows, memoryRows } from './memory-journal.ts'
export {
  type Closing,
  openServer,
  type Outgoing,
  type Server,
  type ServerLimits,
  type ServerOptions,
  type Who,
} from './server.ts'
export { DesignState } from './state.ts'
export { versionText } from './version-text.ts'
