import { describe, expect, it } from 'vitest'

import { brandPath, readJson, RouteError, workspacePath } from './brand-routes.ts'

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status })

describe('RouteError', () => {
  it('holds the status and the message', () => {
    const error = new RouteError(404, 'No such asset')
    expect(error).toBeInstanceOf(Error)
    expect(error.status).toBe(404)
    expect(error.message).toBe('No such asset')
  })

  describe('fromBody', () => {
    it("takes the message from the body's error", () => {
      expect(RouteError.fromBody(400, { error: 'The image is larger than 30 MB' }).message).toBe(
        'The image is larger than 30 MB',
      )
      expect(RouteError.fromBody(400, { error: '' }).message).toBe('')
    })

    it('is the status when the body has no error text', () => {
      expect(RouteError.fromBody(502, null).message).toBe('502')
      expect(RouteError.fromBody(500, { error: 5 }).message).toBe('500')
      expect(RouteError.fromBody(500, 'oops').message).toBe('500')
      expect(RouteError.fromBody(500, [{ error: 'x' }]).message).toBe('500')
    })
  })
})

describe('workspacePath', () => {
  it("is the workspace's root without segments", () => {
    expect(workspacePath('w1')).toBe('/w/w1')
  })

  it('joins the segments with slashes', () => {
    expect(workspacePath('w1', 'settings')).toBe('/w/w1/settings')
    expect(workspacePath('w1', 'welcome')).toBe('/w/w1/welcome')
  })

  it('encodes the workspace and each segment, as encodeURIComponent does', () => {
    expect(workspacePath('a b/c', 'x?y#z')).toBe('/w/a%20b%2Fc/x%3Fy%23z')
  })
})

describe('brandPath', () => {
  it("is the brand's root in its workspace without segments", () => {
    expect(brandPath('w1', 'b1')).toBe('/w/w1/brands/b1')
  })

  it('joins the segments with slashes', () => {
    expect(brandPath('w1', 'b1', 'kit', 'data')).toBe('/w/w1/brands/b1/kit/data')
    expect(brandPath('w1', 'b1', 'assets', 'a1', 'thumbnail')).toBe('/w/w1/brands/b1/assets/a1/thumbnail')
  })

  it('encodes the workspace, the brand and each segment, as encodeURIComponent does', () => {
    expect(brandPath('w 1', 'a b/c', 'fonts', 'x?y#z', 'preview')).toBe(
      '/w/w%201/brands/a%20b%2Fc/fonts/x%3Fy%23z/preview',
    )
  })
})

describe('readJson', () => {
  it('is the body of an answer that is ok', async () => {
    expect(await readJson(json({ id: 'a1' }, 200))).toEqual({ id: 'a1' })
    expect(await readJson(json({ id: 'a1' }, 201))).toEqual({ id: 'a1' })
  })

  it('is null when an ok answer is not JSON', async () => {
    expect(await readJson(new Response('not json', { status: 200 }))).toBeNull()
  })

  it("throws a RouteError with the body's error and the status", async () => {
    const thrown = await readJson(json({ error: 'Send the font as the form field "file"' }, 400)).catch(
      (e: unknown) => e,
    )
    expect(thrown).toBeInstanceOf(RouteError)
    expect(thrown).toMatchObject({ status: 400, message: 'Send the font as the form field "file"' })
  })

  it('throws the status as the message when the body is not JSON', async () => {
    await expect(readJson(new Response('<html>', { status: 502 }))).rejects.toMatchObject({
      status: 502,
      message: '502',
    })
  })
})
