// A version's picture of its first frame, for the Versions card's rows. The API checks workspace and
// brand, draws the picture the first time it is asked for and keeps it in the version's row; the
// bytes pass through here. A version never changes, so its picture is kept privately for a day.
import { versionThumbnail } from '@/lib/server/api.ts'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; brandId: string; designId: string; versionId: string }> },
) {
  const { workspaceId, brandId, designId, versionId } = await params
  const png = await versionThumbnail(workspaceId, brandId, designId, versionId)
  if (!png) return new Response('No picture for this version', { status: 404 })
  return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=86400' } })
}
