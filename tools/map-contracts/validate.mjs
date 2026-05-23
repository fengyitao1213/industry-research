import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const defaultContracts = [
  {
    name: 'semantic-map-manifest',
    schemaPath: 'schemas/semantic-map-manifest.schema.json',
    examplePath: 'examples/map-contracts/semantic-map-manifest.example.json'
  },
  {
    name: 'runtime-map-contract',
    schemaPath: 'schemas/runtime-map-contract.schema.json',
    examplePath: 'examples/map-contracts/runtime-map-contract.example.json'
  }
]

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'))
}

function typeMatches(value, expectedType) {
  if (expectedType === 'array') return Array.isArray(value)
  if (expectedType === 'integer') return Number.isInteger(value)
  if (expectedType === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (expectedType === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  return typeof value === expectedType
}

function pathLabel(pathSegments) {
  return pathSegments.length === 0 ? '$' : `$${pathSegments.join('')}`
}

function validateValue(value, schema, pathSegments = []) {
  const errors = []
  const here = pathLabel(pathSegments)

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${here} should equal ${JSON.stringify(schema.const)}`)
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${here} should be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`)
  }

  if (schema.type && !typeMatches(value, schema.type)) {
    errors.push(`${here} should be ${schema.type}`)
    return errors
  }

  if (schema.type === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${here} should have length >= ${schema.minLength}`)
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${here} should match ${schema.pattern}`)
    }
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${here} should be >= ${schema.minimum}`)
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${here} should be <= ${schema.maximum}`)
    }
  }

  if (schema.type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${here} should contain at least ${schema.minItems} items`)
    }
    if (schema.uniqueItems) {
      const serialized = value.map((item) => JSON.stringify(item))
      if (new Set(serialized).size !== serialized.length) {
        errors.push(`${here} should contain unique items`)
      }
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateValue(item, schema.items, [...pathSegments, `[${index}]`]))
      })
    }
  }

  if (schema.type === 'object') {
    const properties = schema.properties ?? {}

    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(`${here}.${key} is required`)
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push(`${here}.${key} is not allowed`)
        }
      }
    }

    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(...validateValue(value[key], propertySchema, [...pathSegments, `.${key}`]))
      }
    }
  }

  return errors
}

export function validateDocument(document, schema) {
  return validateValue(document, schema)
}

export function validateContractExample(contract) {
  const schema = readJson(contract.schemaPath)
  const example = readJson(contract.examplePath)
  return validateDocument(example, schema)
}

export function validateDefaultExamples() {
  return defaultContracts.flatMap((contract) =>
    validateContractExample(contract).map((error) => `${contract.name}: ${error}`)
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = validateDefaultExamples()
  if (errors.length > 0) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  } else {
    console.log('Map contract examples validate against their schemas.')
  }
}
