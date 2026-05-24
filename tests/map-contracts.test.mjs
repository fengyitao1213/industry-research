import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defaultContracts,
  validateContractExample,
  validateDocument
} from '../tools/map-contracts/validate.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'))
}

test('map contract schemas use JSON Schema draft 2020-12', () => {
  for (const contract of defaultContracts) {
    const schema = readJson(contract.schemaPath)
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
    assert.match(schema.$id, /^https:\/\/kvynlim\.github\.io\/industry-research\/schemas\//)
    assert.equal(schema.type, 'object')
  }
})

test('map contract examples validate', () => {
  for (const contract of defaultContracts) {
    assert.deepEqual(validateContractExample(contract), [], `${contract.name} example should validate`)
  }
})

test('semantic map manifest requires prior input provenance fields', () => {
  const schema = readJson('schemas/semantic-map-manifest.schema.json')

  for (const field of [
    'pose_graph_digest',
    'prior_representation',
    'temporal_scope',
    'alignment_policy',
    'uncertainty_summary',
    'downstream_use'
  ]) {
    const example = readJson('examples/map-contracts/semantic-map-manifest.example.json')
    delete example.prior_inputs[0][field]

    assert.match(validateDocument(example, schema).join('\n'), new RegExp(`${field} is required`))
  }
})

test('semantic map manifest requires map hygiene layer and metric evidence', () => {
  const schema = readJson('schemas/semantic-map-manifest.schema.json')

  for (const field of [
    'map_hygiene_layer_digests',
    'map_hygiene_metrics'
  ]) {
    const example = readJson('examples/map-contracts/semantic-map-manifest.example.json')
    if (field === 'map_hygiene_layer_digests') {
      delete example.outputs[field]
    } else {
      delete example.metrics_evidence[field]
    }

    assert.match(validateDocument(example, schema).join('\n'), new RegExp(`${field} is required`))
  }

  const missingLayerDigest = readJson('examples/map-contracts/semantic-map-manifest.example.json')
  delete missingLayerDigest.outputs.map_hygiene_layer_digests.static_transient_layer_digest
  assert.match(validateDocument(missingLayerDigest, schema).join('\n'), /static_transient_layer_digest is required/)

  const missingMetric = readJson('examples/map-contracts/semantic-map-manifest.example.json')
  delete missingMetric.metrics_evidence.map_hygiene_metrics.false_permanent_rate
  assert.match(validateDocument(missingMetric, schema).join('\n'), /false_permanent_rate is required/)
})

test('runtime map contract rejects missing loader evidence', () => {
  const schema = readJson('schemas/runtime-map-contract.schema.json')
  const example = readJson('examples/map-contracts/runtime-map-contract.example.json')
  delete example.loader_evidence.pointcloud_loader_evidence_id

  assert.match(validateDocument(example, schema).join('\n'), /pointcloud_loader_evidence_id is required/)
})
