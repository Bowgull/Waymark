import { useState } from 'react'

import { CentredCard, FlapButton, TileChoice, showPop } from '@/design'

import { CLASS_TYPE_TILES, type ClassTypeValue } from './classType'

/**
 * "What kind of class?" asked when the class is logged (quick add leaves the
 * type open). The pick is saved at once so a Block Zero refusal (sparring,
 * clinch too early, the weekly cap) shows on the tile with its one-line reason.
 */
export function ClassTypeCard({
  blockZero,
  onSave,
  onDone,
  onClose,
  initialRefused,
}: {
  /** Design gallery only: open on a refused pick. */
  initialRefused?: { type: ClassTypeValue; reason: string }
  blockZero: boolean
  /** PATCH the class type. Resolves null when saved, or the refusal line. */
  onSave: (type: ClassTypeValue) => Promise<string | null>
  onDone: (type: ClassTypeValue) => void
  onClose: () => void
}) {
  const [picked, setPicked] = useState<ClassTypeValue | null>(null)
  const [refused, setRefused] = useState<{ type: ClassTypeValue; reason: string } | null>(initialRefused ?? null)
  const [saving, setSaving] = useState(false)
  const tiles = blockZero ? CLASS_TYPE_TILES : [...CLASS_TYPE_TILES, { value: 'general' as const, label: 'GENERAL', sub: 'regular class' }]

  async function pick(type: ClassTypeValue) {
    if (saving) return
    setPicked(type)
    setRefused(null)
    setSaving(true)
    const reason = await onSave(type)
    setSaving(false)
    if (reason) {
      setRefused({ type, reason })
      setPicked(null)
      showPop(reason, 'bad', { title: 'NOT TODAY', durationMs: 4000 })
      return
    }
    onDone(type)
  }

  return (
    <CentredCard label="What kind of class?" head="Log class" sub="What kind of class was it?" onDismiss={saving ? undefined : onClose}>
      <TileChoice
        label="Class type"
        columns={2}
        options={tiles.map(t => ({ value: t.value, label: t.label, sub: t.sub }))}
        selected={picked}
        refused={refused?.type ?? null}
        onPick={v => void pick(v)}
      />
      {refused && <p className="wm-row-note" role="alert">{refused.reason}</p>}
      <FlapButton label="LATER" quiet onClick={onClose} disabled={saving} />
    </CentredCard>
  )
}
