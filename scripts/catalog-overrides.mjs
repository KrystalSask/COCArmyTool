// Upstream static metadata occasionally carries placeholder Town Hall values.
// Keep narrowly scoped, authoritative corrections here so generation and audit
// use the same rule. Keys are `${kind}:${CopyArmy suffix id}`.
export const townHallOverrides = new Map([
  ['troop:177', 17], // Meteor Golem: permanent troop introduced with TH18, unlocks at TH17.
])

export const resolveTownHall = (item, kind, suffixId) => {
  const override = townHallOverrides.get(`${kind}:${suffixId(item._id)}`)
  if (override !== undefined) return override
  const levels = item.levels ?? []
  const values = levels.map((level) => level.required_townhall).filter(Number.isFinite)
  return values.length ? Math.min(...values) : null
}
