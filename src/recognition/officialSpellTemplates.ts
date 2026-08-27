import type { VisualFeatureObservation } from './templateMatcher'

export interface OfficialSpellObservation extends VisualFeatureObservation {
  kind: 'spell'
  id: number
}

const histogram = (entries: Record<number, number>) => Array.from({ length: 128 }, (_, index) => entries[index] ?? 0)

// Independent references generated from the bundled official game icons. They
// provide a clean fallback when a cropped blue spell card is under-represented
// in the screenshot-derived template set.
export const officialSpellObservations: OfficialSpellObservation[] = [
  {
    kind: 'spell', id: 0, dhash: 'b2aa6e6d4ded5995',
    hsvHistogram: histogram({
      0: 27, 1: 1, 3: 51, 5: 1, 6: 5, 7: 6, 9: 6, 10: 10, 13: 1, 14: 16,
      17: 2, 19: 6, 21: 7, 25: 1, 34: 1, 35: 11, 49: 2, 51: 45, 54: 4, 55: 1,
      58: 1, 59: 1, 63: 1, 65: 1, 66: 5, 67: 488, 69: 2, 70: 23, 71: 244,
      73: 3, 74: 13, 75: 328, 78: 25, 79: 2406, 82: 2, 83: 11, 91: 2,
      94: 3, 95: 313, 99: 13, 115: 6, 119: 1,
    }),
  },
  {
    kind: 'spell', id: 5, dhash: '4865646c65ace8e1',
    hsvHistogram: histogram({
      0: 110, 3: 13, 19: 12, 35: 9, 51: 24, 67: 258, 70: 9, 71: 568,
      72: 2, 73: 6, 74: 20, 75: 322, 76: 61, 77: 61, 78: 115, 79: 2500,
      83: 1, 92: 3, 99: 2,
    }),
  },
]
