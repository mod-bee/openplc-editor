/* eslint-disable */
const notarize = require('@electron/notarize')

exports.default = async function notarizeMacos(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') {
    return
  }

  // Must set process.env.CI to true for notarization to work
  if (process.env.CI !== 'true') {
    console.warn('Skipping notarizing step. Packaging is not running in CI')
    return
  }

  const appleId = process.env.APPLE_ID
  const appleIdPassword = process.env.APPLE_ID_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID

  // An unsigned build (no Apple credentials) is not notarized.
  if (!appleId || !appleIdPassword || !teamId) {
    console.warn('Skipping notarizing step. APPLE_ID, APPLE_ID_PASSWORD and APPLE_TEAM_ID are not all set')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appBundleId = `${teamId}.${context.packager.appInfo.id}`

  console.log(`Notarizing ${appName}.app...`)

  await notarize.notarize({
    appBundleId,
    appPath: `${appOutDir}/${appName}.app`,
    teamId,
    appleId,
    appleIdPassword,
  })

  console.log(`Successfully notarized ${appName}.app`)
}
