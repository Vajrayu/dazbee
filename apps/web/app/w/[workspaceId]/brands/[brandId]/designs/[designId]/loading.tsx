// While the design page loads on the server: the flying bee, as the editor shows it over the design
// until the design is ready.
import { FlyingIn } from '@/components/editor/opening-bee.tsx'

export default function DesignLoading() {
  return <FlyingIn phase="shown" />
}
