// A design as the sync server welcomes a tab to it, and a tab opening it from that welcome: what the
// big carousel's size check (big-carousel.test.ts) and `scripts/measure-doc.ts` measure.
import { type ClientStore, clientStore, openClient, openSession, type Session } from '@dazbee/doc'
import { firstSaved, openServer, type Who } from '@dazbee/doc/sync'
import { type Design, PROTOCOL, type ServerMessage } from '@dazbee/schema'

const WHO: Who = { member: { userId: 'measured', workspaceId: 'measured' }, name: 'measured', access: 'edit' }

/** The welcome the sync server sends a tab that joins `design`, as the text it sends. */
export function welcomeText(design: Design): string {
  const server = openServer(
    { saved: firstSaved(design, 'measured'), journal: [], lastEntry: 0 },
    { hashSecret: (secret) => secret },
  )
  const joined = server.join({ type: 'hello', protocol: PROTOCOL, token: 'measured', waiting: 0 }, WHO)
  if ('close' in joined) throw new Error(`the server refused the tab: ${joined.reason}`)
  const welcome = joined.out.find(({ to }) => to === joined.tabId)
  if (!welcome) throw new Error('the server sent no welcome')
  return JSON.stringify(welcome.message)
}

/** The store a tab keeps the design `welcome` carries in: the sync client on the welcome. */
export function welcomedStore(welcome: string): ClientStore {
  return clientStore(openClient(JSON.parse(welcome) as ServerMessage), () => {})
}

/**
 * A tab opening the design `welcome` carries, as the editor opens one: the sync client on the
 * welcome, its store, and the session's whole first read.
 */
export function openWelcomed(welcome: string): Session {
  const session = openSession(welcomedStore(welcome))
  session.design()
  return session
}
