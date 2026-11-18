// The editor's worker module: each worker the editor starts, the export worker and the image
// worker, runs this one file, and each job says which it is (an export, a sample or a copy). One module, because Chromium starts a
// dedicated worker whose script URL differs from an earlier one only in its fragment, where the
// bundler puts which code it runs, with the earlier one's: an image worker started after an export
// ran the export's code.
import type { ExportJob, ExportReply, SampleJob } from './export/export-client.ts'
import { exportJob, sampleJob } from './export/export-worker.ts'
import type { CopyJob, CopyReply } from './image-client.ts'
import { copyJob } from './image-worker.ts'

/** What this file uses of a dedicated worker's global scope, which the DOM types don't describe. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ExportJob | SampleJob | CopyJob>) => void) | null
  postMessage(message: ExportReply | CopyReply, transfer?: Transferable[]): void
}

scope.onmessage = ({ data: job }) => {
  const answer = (reply: ExportReply | CopyReply, transfer: Transferable[] = []) => scope.postMessage(reply, transfer)
  if (job.kind === 'copy') void copyJob(job, answer)
  else if (job.kind === 'sample') void sampleJob(job, answer)
  else void exportJob(job, answer)
}
