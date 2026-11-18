// Downloads one file of a CanvasKit release. GitHub's release downloads fail now and then with a
// server error, a dropped stream or no answer, so a failed attempt is tried again after a wait that
// triples each time. A 4xx answer fails at once: the file isn't there.

/**
 * The file at `url`, sent with `headers`, after up to `attempts` tries, each given up after
 * `timeout` milliseconds.
 */
export async function download(url, { headers = {}, attempts = 4, wait = 5000, timeout = 60_000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    let failure
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) })
      if (response.ok) return new Uint8Array(await response.arrayBuffer())
      failure = new Error(`@dazbee/canvaskit: ${url} answered ${response.status}`)
      if (response.status < 500) throw failure
    } catch (error) {
      if (error === failure) throw error
      failure = new Error(`@dazbee/canvaskit: ${url} failed: ${error.message}`, { cause: error })
    }
    if (attempt === attempts) throw failure
    console.log(`${failure.message}; trying again (${attempt + 1} of ${attempts})`)
    await new Promise((resolve) => setTimeout(resolve, wait * 3 ** (attempt - 1)))
  }
}
