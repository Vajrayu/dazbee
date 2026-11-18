// A stand-in for the browser's Web Locks in Node, which has none: exclusive locks by name, asked
// for at once (`ifAvailable`) or waited for until a `signal` aborts, each held until its callback's
// promise settles. Two browser tabs in one test share one `TestLocks`; a closed tab lets go of its
// locks with `dropAll`.

/** What `tab-copy.ts` asks of the browser's `navigator.locks`. */
export type Locks = Pick<LockManager, 'request'>

type Callback = (lock: { name: string } | null) => unknown

export interface TestLocks extends Locks {
  /** The names held now. */
  held(): string[]
  /** Lets go of every lock asked for through `tab` (a closed browser tab), whatever its callback does. */
  dropAll(tab: Locks): void
  /** A view of these locks for one browser tab: what it asks for, `dropAll` lets go of. */
  tab(): Locks
}

export function testLocks(): TestLocks {
  /** Each lock held, with who holds it and how it is let go. */
  const holders = new Map<string, { tab: Locks | undefined; release: () => void }>()
  /** Requests waiting for a lock, in order. */
  const waiting = new Map<string, (() => void)[]>()

  function grant(name: string, tab: Locks | undefined, callback: Callback): Promise<unknown> {
    let release = () => {}
    const released = new Promise<void>((resolve) => (release = resolve))
    holders.set(name, { tab, release })
    const result = Promise.resolve().then(() => callback({ name }))
    void Promise.race([
      result.then(
        () => undefined,
        () => undefined,
      ),
      released,
    ]).then(() => {
      if (holders.get(name)?.release !== release) return
      holders.delete(name)
      waiting.get(name)?.shift()?.()
    })
    return result
  }

  function request(tab: Locks | undefined, name: string, ...rest: unknown[]): Promise<unknown> {
    const callback = rest.at(-1) as Callback
    const options = (rest.length > 1 ? rest[0] : {}) as LockOptions
    // As the browser's: a lock asked for while others wait for it goes to them first.
    const free = !holders.has(name) && !waiting.get(name)?.length
    if (free) return grant(name, tab, callback)
    if (options.ifAvailable) return Promise.resolve().then(() => callback(null))
    return new Promise((resolve, reject) => {
      const queue = waiting.get(name) ?? []
      let next = () => {}
      const abort = () => {
        queue.splice(queue.indexOf(next), 1)
        reject(options.signal?.reason ?? new DOMException('aborted', 'AbortError'))
      }
      next = () => {
        options.signal?.removeEventListener('abort', abort)
        grant(name, tab, callback).then(resolve, reject)
      }
      options.signal?.addEventListener('abort', abort)
      queue.push(next)
      waiting.set(name, queue)
    })
  }

  const locks: TestLocks = {
    request: ((name: string, ...rest: unknown[]) => request(undefined, name, ...rest)) as LockManager['request'],
    held: () => [...holders.keys()],
    dropAll(tab) {
      for (const [, holder] of [...holders].filter(([, h]) => h.tab === tab)) holder.release()
    },
    tab() {
      const view: Locks = {
        request: ((name: string, ...rest: unknown[]) => request(view, name, ...rest)) as LockManager['request'],
      }
      return view
    },
  }
  return locks
}
