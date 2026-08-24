import type { ArmyRecord, ArmyScenario } from '../domain/types'

export interface RecordFieldValue {
  name: string
  tagsText: string
  scenario: ArmyScenario
  notes: string
}

interface Props {
  value: RecordFieldValue
  onChange: (value: RecordFieldValue) => void
  idPrefix: string
}

const scenarios: ArmyScenario[] = ['部落战', '联赛', '打鱼', '冲杯', '练习', '其他']

export const fieldsFromRecord = (record?: ArmyRecord): RecordFieldValue => ({
  name: record?.name ?? '',
  tagsText: record?.tags.join('、') ?? '',
  scenario: record?.scenario ?? '部落战',
  notes: record?.notes ?? '',
})

export const parseTags = (value: string) => value.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean)

export function RecordFields({ value, onChange, idPrefix }: Props) {
  const set = <K extends keyof RecordFieldValue>(key: K, next: RecordFieldValue[K]) => onChange({ ...value, [key]: next })
  return <div className="record-fields">
    <label htmlFor={`${idPrefix}-name`}>方案名称
      <input id={`${idPrefix}-name`} value={value.name} onChange={(event) => set('name', event.target.value)} placeholder="例如：图腾龙骑" />
    </label>
    <label htmlFor={`${idPrefix}-scenario`}>适用场景
      <select id={`${idPrefix}-scenario`} value={value.scenario} onChange={(event) => set('scenario', event.target.value as ArmyScenario)}>
        {scenarios.map((scenario) => <option key={scenario}>{scenario}</option>)}
      </select>
    </label>
    <label htmlFor={`${idPrefix}-tags`}>标签
      <input id={`${idPrefix}-tags`} value={value.tagsText} onChange={(event) => set('tagsText', event.target.value)} placeholder="空军、稳定、三星" />
    </label>
    <label className="notes-field" htmlFor={`${idPrefix}-notes`}>备注
      <textarea id={`${idPrefix}-notes`} value={value.notes} onChange={(event) => set('notes', event.target.value)} placeholder="记录下兵时机、适用阵型等" rows={3} />
    </label>
  </div>
}
