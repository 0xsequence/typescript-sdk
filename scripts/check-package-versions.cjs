const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const rootDir = join(__dirname, '..')
const rootPackage = readPackage('package.json')
const packagePaths = [
  'packages/oms-wallet-wagmi-connector/package.json',
]

let hasMismatch = false

for (const packagePath of packagePaths) {
  const packageJson = readPackage(packagePath)

  if (packageJson.version !== rootPackage.version) {
    report(`${packageJson.name} version ${packageJson.version} does not match ${rootPackage.name} version ${rootPackage.version}.`)
  }

  const sdkPeerVersion = packageJson.peerDependencies?.[rootPackage.name]
  if (sdkPeerVersion !== undefined && sdkPeerVersion !== rootPackage.version) {
    report(`${packageJson.name} peer dependency ${rootPackage.name}@${sdkPeerVersion} does not match ${rootPackage.version}.`)
  }
}

if (hasMismatch) {
  process.exitCode = 1
} else {
  console.log(`Publishable package versions match ${rootPackage.version}.`)
}

function readPackage(packagePath) {
  return JSON.parse(readFileSync(join(rootDir, packagePath), 'utf8'))
}

function report(message) {
  hasMismatch = true
  console.error(message)
}
