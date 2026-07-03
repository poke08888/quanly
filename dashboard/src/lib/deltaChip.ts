// Delta-vs-previous chip logic — ported from the prototype's deltaChip().
export interface DeltaChip {
  delta: string
  deltaColor: string
  show: boolean
}

export function deltaChip(
  cur: number,
  prev: number,
  compare: boolean,
  lowerIsBetter = false,
): DeltaChip {
  if (!compare || !prev) return { delta: '', deltaColor: '#9aa0ac', show: false }
  const ch = (cur - prev) / Math.abs(prev || 1)
  const up = ch >= 0
  const good = lowerIsBetter ? !up : up
  return {
    delta: (up ? '▲ +' : '▼ −') + Math.abs(ch * 100).toFixed(1).replace('.', ',') + '%',
    deltaColor: good ? '#0f9d6b' : '#e5484d',
    show: true,
  }
}
