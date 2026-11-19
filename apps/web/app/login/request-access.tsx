'use client'

// The early-access notice's Request access: a button that opens a short form for an email, a name, a company
// and what they will make (which may be left out), with Cloudflare Turnstile's check when the site has a key
// (TURNSTILE_SITE_KEY). Once it is sent, the form gives way to the thanks; why it wasn't sent shows under it.
import { startTransition, useActionState, useEffect, useRef, useState } from 'react'

import { Note } from '@/components/settings/note.tsx'
import { buttonStyles } from '@/components/ui/button.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { type RequestAnswer, requestToJoin } from './actions.ts'

/** The part of Turnstile's script the form uses. */
interface Turnstile {
  render(element: HTMLElement, options: Record<string, unknown>): string
  remove(id: string): void
}

/** Turnstile's script, which renders a check only when asked. */
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

const FIELD =
  'h-11 w-full min-w-0 rounded-row border border-line bg-bg px-3 text-card outline-none hover:border-line-strong focus:border-accent'

/** Turnstile's script, loaded once for the page. */
let turnstileLoading: Promise<Turnstile> | null = null

/** Loads Turnstile's script, once, and gives its `turnstile`. */
function loadTurnstile(): Promise<Turnstile> {
  turnstileLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT
    script.async = true
    script.onload = () => {
      const turnstile = (window as unknown as { turnstile?: Turnstile }).turnstile
      if (turnstile) resolve(turnstile)
      else reject(new Error('Turnstile did not load'))
    }
    script.onerror = () => {
      turnstileLoading = null
      reject(new Error('Turnstile did not load'))
    }
    document.head.append(script)
  })
  return turnstileLoading
}

export function RequestAccess({ turnstileSiteKey }: { turnstileSiteKey: string }) {
  const t = useMessages().signIn
  const w = t.request
  const [open, setOpen] = useState(false)
  // The token Turnstile gave the person, empty until it does or once it expires.
  const [token, setToken] = useState('')
  const [answer, send, sending] = useActionState<RequestAnswer, FormData>(requestToJoin, null)
  if (answer && 'sent' in answer)
    return (
      <div data-testid="request-access-sent" className="w-full max-w-[37rem]">
        <Note text={w.sent} />
      </div>
    )
  if (!open)
    return (
      <button
        type="button"
        data-testid="request-access"
        onClick={() => setOpen(true)}
        className={cn(
          buttonStyles({ variant: 'secondary', size: 'lg' }),
          'h-11 w-full max-w-[22rem] rounded-[10px] text-card font-semibold',
        )}
      >
        {t.requestAccess}
      </button>
    )
  return (
    <form
      method="post"
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        startTransition(() => send(form))
      }}
      aria-labelledby="request-access-title"
      data-testid="request-access-form"
      className="flex w-full max-w-[37rem] flex-col gap-3"
    >
      <h2 id="request-access-title" className="text-label font-semibold">
        {w.title}
      </h2>
      <input
        name="email"
        type="email"
        required
        maxLength={254}
        autoComplete="email"
        aria-label={w.email}
        placeholder={w.emailPlaceholder}
        className={FIELD}
      />
      <div className="flex flex-wrap gap-3">
        <input
          name="name"
          required
          maxLength={120}
          autoComplete="name"
          aria-label={w.name}
          placeholder={w.name}
          className={cn(FIELD, 'flex-1 basis-48')}
        />
        <input
          name="company"
          required
          maxLength={120}
          autoComplete="organization"
          aria-label={w.company}
          placeholder={w.company}
          className={cn(FIELD, 'flex-1 basis-48')}
        />
      </div>
      <textarea
        name="note"
        rows={3}
        maxLength={1000}
        aria-label={`${w.note} (${w.optional})`}
        placeholder={`${w.note} (${w.optional})`}
        className={cn(FIELD, 'h-auto resize-y py-2.5')}
      />
      {turnstileSiteKey && (
        <>
          <TurnstileCheck siteKey={turnstileSiteKey} onToken={setToken} />
          <input type="hidden" name="turnstile_token" value={token} />
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={sending || Boolean(turnstileSiteKey && !token)}
          className={cn(buttonStyles({ variant: 'primary', size: 'lg' }), 'h-11 px-7 font-semibold')}
        >
          {sending ? w.sending : w.send}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={cn(buttonStyles({ variant: 'ghost', size: 'lg' }), 'h-11 px-4')}
        >
          {w.close}
        </button>
      </div>
      {answer && 'error' in answer && <Note refused text={answer.error} />}
    </form>
  )
}

/** Turnstile's check, rendered in place, which hands each token it gives, and empty once one expires. */
function TurnstileCheck({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let id: string | null = null
    let gone = false
    loadTurnstile().then(
      (turnstile) => {
        if (gone || !box.current) return
        id = turnstile.render(box.current, {
          sitekey: siteKey,
          callback: onToken,
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        })
      },
      (e: unknown) => console.error(e),
    )
    return () => {
      gone = true
      if (id) void loadTurnstile().then((turnstile) => id && turnstile.remove(id))
    }
  }, [siteKey, onToken])
  return <div ref={box} className="min-h-[65px]" />
}
