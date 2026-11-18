// A brand's templates (#54), as the earlier mock's Templates page: chips for this brand's or every
// brand's, then a card per template with its picture and name. Picking one starts a design from it;
// each card's menu renames or deletes it (#159). A Reviewer sees the cards only: picking one starts
// nothing, and there is no menu. A member limited to some brands starts from a template for every brand,
// but its card has no menu.
import { notFound } from 'next/navigation'

import type { TemplateSummary } from '@dazbee/schema'

import {
  deleteTemplateAction,
  renameTemplateAction,
  startTemplate,
} from '@/app/w/[workspaceId]/brands/[brandId]/actions.ts'
import { FilterChips } from '@/components/library/filter-chips.tsx'
import { LibraryShell } from '@/components/library/library-shell.tsx'
import { TileMenu } from '@/components/library/tile-menu.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { brandPath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { showsBrandList } from '@/lib/home.ts'
import { brandWords, format } from '@/lib/i18n/index.ts'
import { getMessages } from '@/lib/i18n/server.ts'
import { getAccess, getWorkspace, listBrands, listTemplates } from '@/lib/server/api.ts'
import { canChange, canChangeTemplate } from '@/lib/settings-rights.ts'

export const dynamic = 'force-dynamic'

const SCOPES = ['brand', 'workspace'] as const

export default async function TemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; brandId: string }>
  searchParams: Promise<{ scope?: string }>
}) {
  const [{ workspaceId, brandId }, { scope }] = await Promise.all([params, searchParams])
  const [t, workspace, brands, { role, limited }] = await Promise.all([
    getMessages(),
    getWorkspace(workspaceId),
    listBrands(workspaceId),
    getAccess(workspaceId),
  ])
  const brand = brands.find((b) => b.id === brandId)
  if (!brand) notFound()
  const templates = await listTemplates(workspaceId, brand.id)
  const picked = SCOPES.find((s) => s === scope) ?? null
  const shown = picked ? templates.filter((tpl) => tpl.scope === picked) : templates
  const here = brandPath(workspaceId, brand.id, 'templates')
  const l = t.library
  const words = brandWords(t)
  const changes = canChange(role)

  return (
    <LibraryShell
      t={t}
      words={words}
      workspace={workspace}
      brands={brands}
      activeBrandId={brand.id}
      showBrands={showsBrandList(brands)}
      place="templates"
    >
      <div className="flex flex-col gap-6 pt-2 md:pt-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-display text-title font-bold tracking-tight md:leading-tight">{l.templates}</h1>
          <span className="text-label font-medium text-muted">{format(l.templatesFor, { brand: brand.name })}</span>
        </div>
        {templates.length > 0 && (
          <FilterChips
            label={l.filters}
            chips={[
              { label: l.scopes.all, href: here, on: picked === null },
              ...SCOPES.map((s) => ({ label: l.scopes[s], href: `${here}?scope=${s}`, on: picked === s })),
            ]}
          />
        )}
        {shown.length === 0 ? (
          <EmptyState
            pose="box"
            title={l.noTemplates.title}
            line={changes ? l.noTemplates.line : l.review.noTemplates}
          />
        ) : (
          <ul aria-label={l.templates} className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {shown.map((template, i) => {
              const card = (
                <TemplateCard
                  src={brandPath(workspaceId, brand.id, 'templates', template.id, 'thumbnail')}
                  template={template}
                  madeFor={template.scope === 'workspace' ? words.all : brand.name}
                  eager={i < 8}
                  lifts={changes}
                />
              )
              return (
                <li
                  key={template.id}
                  data-template={template.id}
                  className="rise group/tile relative min-w-0"
                  style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                >
                  {changes ? (
                    <>
                      <form action={startTemplate.bind(null, workspaceId, brand.id, template.id)}>
                        <button
                          type="submit"
                          aria-label={format(l.useTemplate, { name: template.name })}
                          className="group flex w-full cursor-pointer flex-col gap-2 text-start"
                        >
                          {card}
                        </button>
                      </form>
                      {canChangeTemplate(role, limited, template.scope) && (
                        <TileMenu
                          name={template.name}
                          rename={renameTemplateAction.bind(null, workspaceId, brand.id, template.id)}
                          remove={deleteTemplateAction.bind(null, workspaceId, brand.id, template.id)}
                        />
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col gap-2">{card}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </LibraryShell>
  )
}

/** A template's picture and name, with whom it is made for under it. */
function TemplateCard({
  src,
  template,
  madeFor,
  eager,
  lifts,
}: {
  src: string
  template: TemplateSummary
  madeFor: string
  /** Whether the picture loads at once, for the first rows. */
  eager: boolean
  /** Whether the picture lifts under the pointer, as a card that starts a design does. */
  lifts: boolean
}) {
  return (
    <>
      <span
        className={cn(
          'grid aspect-[5/4] w-full place-items-center overflow-hidden rounded-[18px] border border-line bg-raised p-4 shadow-panel',
          lifts && 'lift',
        )}
      >
        <img
          src={src}
          alt=""
          width={template.width}
          height={template.height}
          loading={eager ? 'eager' : 'lazy'}
          className="max-h-full max-w-full rounded-[6px] object-contain shadow-panel transition-transform duration-[var(--chrome)] ease-[var(--ease-out)] group-hover:scale-[1.03]"
        />
      </span>
      <span className="flex min-w-0 flex-col px-1">
        <span className="truncate font-display text-card font-bold">{template.name}</span>
        <span className="truncate text-label text-muted">{madeFor}</span>
      </span>
    </>
  )
}
