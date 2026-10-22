// The recorded run's one upload (page 74), through the outbox: the recorder's
// runId is the Idempotency-Key, so a retry, a relaunch or a double tap is the
// same write. The journal stays on the phone until the server has it (then
// ackUploaded deletes it). At launch, a finished recording with no outbox entry
// (localStorage lost, the app killed between stop and queue) is queued again.

import { loadOutbox } from './outbox'
import { flushOutbox, queueWrite, type QueueResult } from './outboxSync'
import { logger } from './logger'
import { runRecorder } from './runRecorder'
import type { RunRecording } from './runRecording'

export const RECORDING_KIND = 'run_recording'

export function recordingPath(runSessionId: string): string {
  return `/api/run-sessions/${runSessionId}/recording`
}

/** Queue the recording and try to send it now; acks the recorder once the server has it. */
export async function uploadRecording(rec: RunRecording): Promise<QueueResult> {
  const result = await queueWrite({
    method: 'POST',
    path: recordingPath(rec.runSessionId),
    body: rec,
    sessionId: rec.sessionId || null,
    kind: RECORDING_KIND,
    key: rec.runId,
  })
  if (result === 'sent') await runRecorder().ackUploaded(rec.runId).catch(() => {})
  if (result === 'rejected') logger.warn('session', 'run recording refused', { runId: rec.runId }, 'The server refused the recorded run. The journal stays on the phone.')
  return result
}

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}

/**
 * At launch: a finished recording the outbox doesn't hold is queued again; one
 * the outbox already sent is acked. A run still recording is left to the run screen.
 */
export async function resumeRecordingUploads(): Promise<void> {
  try {
    const { recording, active } = await runRecorder().unfinished()
    if (!recording || active || !recording.runSessionId) return
    const queued = loadOutbox(storage()).some(e => e.id === recording.runId)
    if (queued) { await flushOutbox({ force: true }); if (!loadOutbox(storage()).some(e => e.id === recording.runId)) await runRecorder().ackUploaded(recording.runId) }
    else await uploadRecording(recording)
  } catch (e) {
    logger.warn('session', 'run recording resume failed', { message: e instanceof Error ? e.message : String(e) }, 'Could not re-queue a recorded run at launch.')
  }
}
