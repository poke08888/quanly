// Reusable client-side table sorting. Tables pass a `getVal(row, key)` accessor
// returning a number or string for the active column. Click cycles:
//   unsorted -> desc -> asc -> unsorted (original order restored).
import { useMemo, useState } from 'react'

export type SortDir = 'asc' | 'desc'
export interface SortState<K extends string> {
  key: K | null
  dir: SortDir
}

export function useSort<T, K extends string>(
  rows: T[],
  getVal: (row: T, key: K) => number | string,
  initial?: { key: K; dir: SortDir },
) {
  const [sort, setSort] = useState<SortState<K>>(initial ?? { key: null, dir: 'desc' })

  const sorted = useMemo(() => {
    if (!sort.key) return rows
    const key = sort.key
    const arr = [...rows].sort((a, b) => {
      const va = getVal(a, key)
      const vb = getVal(b, key)
      if (typeof va === 'number' && typeof vb === 'number') return va - vb
      return String(va).localeCompare(String(vb), 'vi')
    })
    if (sort.dir === 'desc') arr.reverse()
    return arr
  }, [rows, sort, getVal])

  // desc first (most tables want "highest first"), then asc, then clear.
  const toggle = (key: K) =>
    setSort((s) =>
      s.key !== key
        ? { key, dir: 'desc' }
        : s.dir === 'desc'
          ? { key, dir: 'asc' }
          : { key: null, dir: 'desc' },
    )

  return { sorted, sort, toggle }
}
