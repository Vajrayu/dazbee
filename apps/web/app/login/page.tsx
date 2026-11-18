// Sign in (#58): one button to WorkOS AuthKit, which signs in or signs up. The API makes the link;
// the state cookie ties WorkOS's answer to this browser. An invite email's link that starts here
// brings its `invitation_token`, which the sign-in link carries on, so WorkOS accepts the invite.
import { buttonStyles } from '@/components/ui/button.tsx'
import { DazbeeMark } from '@/components/ui/dazbee-mark.tsx'
import { WarningCircleIcon } from '@/components/ui/icons.tsx'
import { cn } from '@/lib/cn.ts'
import { getMessages } from '@/lib/i18n/server.ts'

import { start } from './actions.ts'
import { AdFan } from './ad-fan.tsx'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return { title: (await getMessages()).signIn.title }
}

// The mock's sign-in (screen 34) on one dark page: the form on the start half, and fanned-out ads
// over an aurora toward the end, the glow fading into the form's side. Phones get the form over a
// faint glow.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; unavailable?: string; invite?: string; invitation_token?: string }>
}) {
  const [t, query] = await Promise.all([getMessages(), searchParams])
  const notice = query.unavailable
    ? t.signIn.unavailable
    : query.error
      ? t.signIn.failed
      : query.invite === 'unusable'
        ? t.signIn.inviteUnusable
        : null
  return (
    <main data-theme="dark" className="relative isolate grid min-h-dvh overflow-hidden bg-bg text-text md:grid-cols-2">
      <aside aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <AdFan sample={t.signIn.sample} />
      </aside>
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-[7vw]">
        <form action={start} className="flex w-full max-w-[37rem] flex-col gap-[clamp(1rem,1.2vw,1.375rem)]">
          <DazbeeMark size={46} />
          <h1 className="font-display text-[clamp(2.5rem,3vw,3.5rem)] leading-[1.05] font-extrabold tracking-[-0.02em] text-balance">
            {t.signIn.headline} <br />
            {t.signIn.headlineEnd}
          </h1>
          {notice && (
            <p
              role="alert"
              data-testid="sign-in-notice"
              className="flex items-center gap-2 rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2.5 text-label text-danger"
            >
              <WarningCircleIcon aria-hidden size={18} weight="bold" className="shrink-0" />
              {notice}
            </p>
          )}
          {typeof query.invitation_token === 'string' && (
            <input type="hidden" name="invitation_token" value={query.invitation_token} />
          )}
          <button
            type="submit"
            data-testid="sign-in"
            className={cn(
              buttonStyles({ variant: 'primary', size: 'lg' }),
              'mt-1 h-11 w-full max-w-[22rem] rounded-[10px] text-card font-bold',
            )}
          >
            {t.signIn.signIn}
          </button>
        </form>
      </section>
    </main>
  )
}
