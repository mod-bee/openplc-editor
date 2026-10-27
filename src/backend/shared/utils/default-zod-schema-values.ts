/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  ZodArray,
  ZodBoolean,
  ZodDefault,
  ZodDiscriminatedUnion,
  ZodEffects,
  ZodEnum,
  ZodLiteral,
  ZodNullable,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodRecord,
  ZodString,
  ZodTuple,
  ZodTypeAny,
  ZodUnion,
} from 'zod'

/** A field an object may leave out: `.optional()`, also under a preprocess or refinement. */
const isOptionalField = (schema: ZodTypeAny): boolean =>
  schema instanceof ZodOptional || (schema instanceof ZodEffects && isOptionalField(schema.innerType() as ZodTypeAny))

export const getDefaultSchemaValues = (schema: ZodTypeAny): unknown => {
  if (schema instanceof ZodDefault) {
    const innerType = schema._def.innerType as ZodTypeAny
    if (innerType instanceof ZodObject) {
      return getDefaultSchemaValues(innerType)
    }
    return schema._def.defaultValue()
  }
  if (schema instanceof ZodObject) {
    const shape = schema.shape
    // An optional field is not set, so it is left out. Filled with a value of
    // its type it could fail its own checks (a count of at least 1 set to 0)
    // or say something "not set" does not (0 decimals where absent means 3).
    return Object.fromEntries(
      Object.entries(shape)
        .filter(([, v]) => !isOptionalField(v as ZodTypeAny))
        .map(([k, v]) => [k, getDefaultSchemaValues(v as ZodTypeAny)]),
    )
  }
  if (schema instanceof ZodArray) return []
  if (schema instanceof ZodString) return ''
  if (schema instanceof ZodNumber) return 0
  if (schema instanceof ZodBoolean) return false
  if (schema instanceof ZodEnum) return schema.options[0]
  if (schema instanceof ZodLiteral) return schema._def.value
  if (schema instanceof ZodRecord) return {}
  if (schema instanceof ZodNullable) return null
  if (schema instanceof ZodOptional) return getDefaultSchemaValues(schema._def.innerType as ZodTypeAny)
  if (schema instanceof ZodUnion) return getDefaultSchemaValues(schema._def.options[0] as ZodTypeAny)
  if (schema instanceof ZodDiscriminatedUnion) return getDefaultSchemaValues(schema._def.options[0] as ZodTypeAny)
  if (schema instanceof ZodEffects) return getDefaultSchemaValues(schema.innerType() as ZodTypeAny)
  if (schema instanceof ZodTuple) return (schema.items as ZodTypeAny[]).map(getDefaultSchemaValues)
  return null
}
