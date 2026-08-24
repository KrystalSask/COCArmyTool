#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

const observationCollections = [
  'observations',
  'digitObservations',
  'equipmentObservations',
  'petObservations',
  'modeObservations',
]

const prefixSample = (record, sourceBatch) => ({
  ...record,
  ...(record.sampleId ? { sampleId: `${sourceBatch}/${record.sampleId}` } : {}),
  ...(record.sample ? { sample: `${sourceBatch}/${record.sample}` } : {}),
})

export const mergeRecognitionTemplates = (payloads) => {
  if (payloads.length === 0) throw new Error('至少需要一个图鉴输入文件')
  const sourceBatches = payloads.map((payload, index) => payload.sourceBatch ?? `batch-${index + 1}`)
  const merged = {
    schemaVersion: Math.max(...payloads.map((payload) => payload.schemaVersion ?? 1)),
    sourceBatch: sourceBatches.join('+'),
    sourceBatches,
    normalization: payloads[0].normalization,
    evaluationByBatch: Object.fromEntries(payloads.map((payload, index) => [sourceBatches[index], payload.evaluation])),
    componentEvaluationByBatch: Object.fromEntries(payloads.map((payload, index) => [sourceBatches[index], payload.componentEvaluation])),
    actualEquipmentCorrectionsByBatch: Object.fromEntries(payloads
      .map((payload, index) => [sourceBatches[index], payload.actualEquipmentCorrections ?? {}])
      .filter(([, corrections]) => Object.keys(corrections).length > 0)),
  }

  for (const collection of observationCollections) {
    merged[collection] = payloads.flatMap((payload, index) =>
      (payload[collection] ?? []).map((record) => prefixSample(record, sourceBatches[index])))
  }
  for (const collection of ['digitFailures', 'heroSubcardFailures', 'mismatches']) {
    merged[collection] = payloads.flatMap((payload, index) =>
      (payload[collection] ?? []).map((record) => prefixSample(record, sourceBatches[index])))
  }

  merged.coverage = Object.fromEntries([...merged.observations.reduce((counts, observation) => {
    const key = `${observation.kind}:${observation.id}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
    return counts
  }, new Map())].sort(([left], [right]) => left.localeCompare(right)))
  return merged
}

const args = process.argv.slice(2)
if (args.length >= 3) {
  const outputIndex = args.indexOf('--output')
  if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error('用法：merge-recognition-templates.mjs <输入...> --output <输出>')
  const inputPaths = args.slice(0, outputIndex)
  const outputPath = args[outputIndex + 1]
  const payloads = inputPaths.map((path) => JSON.parse(readFileSync(path, 'utf8')))
  const merged = mergeRecognitionTemplates(payloads)
  writeFileSync(outputPath, `${JSON.stringify(merged)}\n`, 'utf8')
  console.log(`Merged ${inputPaths.map((path) => basename(path)).join(', ')} into ${outputPath}`)
  console.log(`Observations: ${merged.observations.length}; coverage: ${Object.keys(merged.coverage).length}`)
}
