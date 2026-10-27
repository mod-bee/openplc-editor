import { z } from 'zod'

const persistentStorageSchema = z.object({
  enabled: z.boolean().default(false),
  path: z.string().default(''),
  flushSeconds: z.number().int().default(5),
})

/**
 * The vendor package a VPP board was authored against.
 *
 * `contentHash` is what makes this a pin rather than a label: a package can be
 * republished under the same version, and the hash is what notices. Recorded
 * per board, mirroring `vendorScreenDataByBoard` — a pin belongs to the target
 * it was authored for, so retargeting must not carry it across.
 */
const vppPackagePinSchema = z.object({
  packageId: z.string(),
  version: z.string(),
  contentHash: z.string(),
})

/**
 * The vPLC this project targets on web, so reopening the project selects it
 * again. Identifies the device only: the binding (package, backplane access)
 * is re-read from the live device listing when the selection is restored.
 */
const targetDeviceSchema = z.object({
  orchestratorId: z.string(),
  deviceId: z.string(),
  deviceName: z.string(),
})

const deviceConfigurationSchema = z.object({
  deviceBoard: z.string().default('OpenPLC Simulator'),
  communicationPort: z.string().default(''),
  runtimeIpAddress: z.string().optional(),
  // Active board's vendor-screen data — the flat view consumers and the
  // compile pipeline read. Always mirrors vendorScreenDataByBoard[deviceBoard].
  vendorScreenData: z.record(z.string(), z.unknown()).optional(),
  // Per-board archive of vendor-screen data. VPP screens are board-specific,
  // so each target keeps its own bucket and switching boards swaps the active
  // view rather than bleeding stale modules across targets. Legacy projects
  // (flat vendorScreenData only) are migrated on load.
  vendorScreenDataByBoard: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  // Persistent storage (RETAIN) for the runtime's built-in file store.
  //
  // A PROJECT property, not a device one. It travels with the project, is
  // configurable offline, and reaches the device as `retain.conf` in the upload
  // — the same shape as VPP plugin config. Optional so every project written
  // before this field still validates; absent means "this project does not use
  // persistent storage", which is also what tells the runtime's built-in store
  // to stay switched off.
  //
  // An empty `path` means "use the runtime's default". The editor deliberately
  // does not hardcode a device filesystem layout — the runtime fills it in.
  persistentStorage: persistentStorageSchema.optional(),
  // Per-board archive, mirroring `vendorScreenDataByBoard`: a storage path is a
  // property of the target box, not of the program, so retargeting must not
  // silently carry one device's path onto another.
  persistentStorageByBoard: z.record(z.string(), persistentStorageSchema).optional(),
  // What the outputs do when the PLC stops or goes to ERROR, as CODESYS's
  // "Behaviour of outputs in Stop": 'off' (every output switched off) or
  // 'hold' (each keeps its last value). A property of the machine the project
  // drives, so the project's, not a board's. Absent means 'off'. Reaches both
  // runtimes as OPENPLC_OUTPUTS_ON_STOP in defines.h. Retained values are kept
  // either way.
  outputsOnStop: z.enum(['off', 'hold']).optional(),
  // Keep each successful build's output in the project (output/<board>/...),
  // outside the build folder that is regenerated. Absent means off, and so
  // does `keep: false`: editors up to 4.3.3-modbee.3 wrote `{ keep: false,
  // count: 0 }` into every new project, a count the check below refuses.
  buildOutput: z.preprocess(
    (value) => (typeof value === 'object' && value !== null && 'keep' in value && value.keep === false ? undefined : value),
    z
      .object({
        keep: z.boolean(),
        count: z.number().int().min(1).max(100).optional(),
      })
      .optional(),
  ),
  // How the debugger shows values on the diagrams. Absent fields take their defaults.
  debugDisplay: z
    .object({
      decimals: z.number().int().min(0).max(6).optional(),
      blockInputs: z.boolean().optional(),
      functionInputs: z.boolean().optional(),
      hideSecrets: z.boolean().optional(),
    })
    .optional(),
  // User picks from VPP `target.platformOptions` (e.g. Nano cpu=atmega328old).
  // Keyed by option `key`, value is the chosen `values[].id`. The compile and
  // upload pipelines fall back to each manifest option's `default` when a key
  // is missing here.
  selectedPlatformOptions: z.record(z.string(), z.string()).default({}),
  // Optional so every project written before pinning existed still validates;
  // absent simply means "no pin recorded", which warns about nothing.
  vppPackagePinsByBoard: z.record(z.string(), vppPackagePinSchema).optional(),
  // Optional so every project written before it still validates; absent means no vPLC to restore.
  targetDevice: targetDeviceSchema.optional(),
})

type DeviceConfiguration = z.infer<typeof deviceConfigurationSchema>
type VppPackagePin = z.infer<typeof vppPackagePinSchema>

const outputsOnStopSchema = deviceConfigurationSchema.shape.outputsOnStop
const buildOutputSchema = deviceConfigurationSchema.shape.buildOutput
const debugDisplaySchema = deviceConfigurationSchema.shape.debugDisplay

export {
  buildOutputSchema,
  debugDisplaySchema,
  deviceConfigurationSchema,
  outputsOnStopSchema,
  persistentStorageSchema,
  targetDeviceSchema,
  vppPackagePinSchema,
}
export type { DeviceConfiguration, VppPackagePin }
