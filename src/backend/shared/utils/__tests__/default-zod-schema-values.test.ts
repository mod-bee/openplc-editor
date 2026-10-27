import { z } from 'zod'

import { deviceConfigurationSchema } from '../../types/PLC/devices/configuration'
import { getDefaultSchemaValues } from '../default-zod-schema-values'

describe('getDefaultSchemaValues', () => {
  it('returns the default value for a ZodDefault schema', () => {
    const schema = z.string().default('hello')
    expect(getDefaultSchemaValues(schema)).toBe('hello')
  })

  it('returns an object with defaults for a ZodObject schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })
    expect(getDefaultSchemaValues(schema)).toEqual({ name: '', age: 0 })
  })

  it('returns an empty array for a ZodArray schema', () => {
    const schema = z.array(z.string())
    expect(getDefaultSchemaValues(schema)).toEqual([])
  })

  it('returns empty string for a ZodString schema', () => {
    expect(getDefaultSchemaValues(z.string())).toBe('')
  })

  it('returns 0 for a ZodNumber schema', () => {
    expect(getDefaultSchemaValues(z.number())).toBe(0)
  })

  it('returns false for a ZodBoolean schema', () => {
    expect(getDefaultSchemaValues(z.boolean())).toBe(false)
  })

  it('returns the first option for a ZodEnum schema', () => {
    const schema = z.enum(['alpha', 'beta', 'gamma'])
    expect(getDefaultSchemaValues(schema)).toBe('alpha')
  })

  it('returns the literal value for a ZodLiteral schema', () => {
    expect(getDefaultSchemaValues(z.literal('fixed'))).toBe('fixed')
    expect(getDefaultSchemaValues(z.literal(42))).toBe(42)
  })

  it('returns an empty object for a ZodRecord schema', () => {
    const schema = z.record(z.string())
    expect(getDefaultSchemaValues(schema)).toEqual({})
  })

  it('returns null for a ZodNullable schema', () => {
    const schema = z.string().nullable()
    expect(getDefaultSchemaValues(schema)).toBeNull()
  })

  it('returns the inner type default for a ZodOptional schema', () => {
    const schema = z.string().optional()
    expect(getDefaultSchemaValues(schema)).toBe('')
  })

  it('returns the first option default for a ZodUnion schema', () => {
    const schema = z.union([z.string(), z.number()])
    expect(getDefaultSchemaValues(schema)).toBe('')
  })

  it('returns the first option default for a ZodDiscriminatedUnion schema', () => {
    const schema = z.discriminatedUnion('type', [
      z.object({ type: z.literal('a'), value: z.string() }),
      z.object({ type: z.literal('b'), value: z.number() }),
    ])
    expect(getDefaultSchemaValues(schema)).toEqual({ type: 'a', value: '' })
  })

  it('returns an array of defaults for a ZodTuple schema', () => {
    const schema = z.tuple([z.string(), z.number(), z.boolean()])
    expect(getDefaultSchemaValues(schema)).toEqual(['', 0, false])
  })

  it('returns null for an unrecognized schema type', () => {
    // z.any() is not handled by any of the explicit branches
    expect(getDefaultSchemaValues(z.any())).toBeNull()
  })

  it('handles nested object schemas recursively', () => {
    const schema = z.object({
      nested: z.object({
        flag: z.boolean(),
        count: z.number(),
      }),
      label: z.string(),
    })

    expect(getDefaultSchemaValues(schema)).toEqual({
      nested: { flag: false, count: 0 },
      label: '',
    })
  })

  it('handles ZodDefault wrapping a complex type', () => {
    const schema = z.number().default(99)
    expect(getDefaultSchemaValues(schema)).toBe(99)
  })

  it('handles ZodOptional wrapping a ZodObject', () => {
    const schema = z.object({ x: z.number() }).optional()
    expect(getDefaultSchemaValues(schema)).toEqual({ x: 0 })
  })

  it('leaves an optional field of an object out', () => {
    const schema = z.object({
      name: z.string(),
      count: z.number().int().min(1).optional(),
      settings: z.object({ on: z.boolean() }).optional(),
    })
    expect(getDefaultSchemaValues(schema)).toEqual({ name: '' })
  })

  it('keeps a field with a default', () => {
    const schema = z.object({ board: z.string().default('sim'), port: z.string().optional() })
    expect(getDefaultSchemaValues(schema)).toEqual({ board: 'sim' })
  })

  it('treats an optional field under a preprocess as optional', () => {
    const schema = z.object({ a: z.string(), b: z.preprocess((v) => v, z.number().optional()) })
    expect(getDefaultSchemaValues(schema)).toEqual({ a: '' })
  })

  it('gives the inner default of a preprocessed schema', () => {
    expect(getDefaultSchemaValues(z.preprocess((v) => v, z.string()))).toBe('')
  })

  it("gives a new project's device configuration that its own schema accepts", () => {
    const defaults = getDefaultSchemaValues(deviceConfigurationSchema)
    expect(deviceConfigurationSchema.safeParse(defaults).success).toBe(true)
    expect(defaults).not.toHaveProperty('buildOutput')
    expect(defaults).not.toHaveProperty('debugDisplay')
  })
})

describe('deviceConfigurationSchema buildOutput', () => {
  it('reads the { keep: false, count: 0 } older editors wrote as off', () => {
    const result = deviceConfigurationSchema.safeParse({ deviceBoard: 'ModBee Node UIO', buildOutput: { keep: false, count: 0 } })
    expect(result.success).toBe(true)
    expect(result.success && result.data.buildOutput).toBeUndefined()
    expect(result.success && result.data.deviceBoard).toBe('ModBee Node UIO')
  })

  it('keeps a switched-on setting and still refuses a count below 1', () => {
    const on = deviceConfigurationSchema.safeParse({ buildOutput: { keep: true, count: 5 } })
    expect(on.success && on.data.buildOutput).toEqual({ keep: true, count: 5 })
    expect(deviceConfigurationSchema.safeParse({ buildOutput: { keep: true, count: 0 } }).success).toBe(false)
  })
})
