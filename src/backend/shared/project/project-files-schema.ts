import { deviceConfigurationSchema, pinMappingFileSchema } from '@root/backend/shared/types/PLC/devices'
import { PLCProjectSchema } from '@root/backend/shared/types/PLC/open-plc'

export const projectDefaultFilesMapSchema = {
  'project.json': PLCProjectSchema,
  'devices/configuration.json': deviceConfigurationSchema,
  // Accepts both the per-board dict (canonical) and the legacy flat
  // array. See `pinMappingFileSchema` for the migration contract.
  'devices/pin-mapping.json': pinMappingFileSchema,
} as const
export type ProjectDefaultFilesMapKeys = keyof typeof projectDefaultFilesMapSchema
export type ProjectDefaultFilesMapValues = (typeof projectDefaultFilesMapSchema)[ProjectDefaultFilesMapKeys]

export const projectPouDirectories = ['pous/functions', 'pous/function-blocks', 'pous/programs'] as const
/**
 * Every folder a POU is read from: the default ones, and `pous/interfaces`
 * (IEC 61131-3 INTERFACEs), which is created only when a project has one.
 */
export const projectPouReadDirectories = [...projectPouDirectories, 'pous/interfaces'] as const
// Kept out of projectPouDirectories: pou-path detection
// (detectPouTypeFromPath) must never see datatypes/ entries.
export const projectDataTypeDirectories = ['datatypes'] as const
export const projectDefaultDirectories = ['devices', ...projectPouDirectories, ...projectDataTypeDirectories] as const
export const projectDefaultDirectoriesValidation = [...projectDefaultDirectories, 'build'] as readonly string[]
export type ProjectDefaultDirectories = (typeof projectDefaultDirectories)[number]
