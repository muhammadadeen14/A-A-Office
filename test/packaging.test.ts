import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname,'..')
const manifest = JSON.parse(readFileSync(join(root,'package.json'),'utf8')) as {
  main:string; scripts:Record<string,string>; dependencies:Record<string,string>
  build:{ appId:string; productName:string; artifactName:string; files:string[]; asarUnpack:string[]; win:{ icon:string; executableName:string }; nsis:Record<string,unknown> }
}

describe('Windows clean-machine packaging', () => {
  it('packages the Electron runtime, application bundles, and native SQLite binding', () => {
    expect(manifest.main).toBe('out/main/index.js')
    expect(manifest.build.files).toContain('out/**/*')
    expect(manifest.build.asarUnpack).toContain('**/*.node')
    expect(manifest.dependencies).toHaveProperty('better-sqlite3')
  })

  it('uses stable product, executable, installer, and shortcut metadata', () => {
    expect(manifest.build).toMatchObject({ appId:'com.aaoffice.desktop', productName:'A&A Office', artifactName:'A&A-Office-Setup.${ext}' })
    expect(manifest.build.win).toMatchObject({ executableName:'A&A Office', icon:'build/icon.ico' })
    expect(manifest.build.nsis).toMatchObject({ oneClick:false, createDesktopShortcut:true, createStartMenuShortcut:true, deleteAppDataOnUninstall:false, shortcutName:'A&A Office' })
  })

  it('has a repeatable Windows release workflow with verification and artifact upload', () => {
    const workflow = readFileSync(join(root,'.github/workflows/windows.yml'),'utf8')
    for (const command of ['actions/setup-python@v5','npm_config_msvs_version','npm ci','npm run lint','npm run typecheck','npm test','npm run dist:win:release','actions/upload-artifact@v4']) expect(workflow).toContain(command)
    expect(workflow).toContain('release/A&A-Office-Setup.exe')
  })
})
