import { app, BrowserWindow, dialog, session } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log/main'
import { OfficeDatabase } from './database'
import { registerIpc } from './ipc'
import { CredentialStore, credentialDirectory } from './security/credentials'
import { PathGuard } from './security/pathGuard'
import { BackupService } from './services/backupService'
import { OfficeRuntime } from './services/officeRuntime'
import { ToolRegistry } from './services/toolRegistry'

let mainWindow: BrowserWindow | null = null
let database: OfficeDatabase | null = null
app.setName('A&A Office')
const ownsSingleInstance = app.requestSingleInstanceLock()
if (!ownsSingleInstance) app.quit()
app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1100, minHeight: 720, show: false,
    backgroundColor: '#0d1117', title: 'A&A Office', autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false,
      sandbox: true, webSecurity: true, allowRunningInsecureContent: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    dialog.showErrorBox('A&A Office could not open', `The application interface failed to load (${code}). ${description}\n\nRestart A&A Office. If the problem continues, reinstall the application; your data will be retained.`)
  })
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  if (!ownsSingleInstance) return
  if (process.platform === 'win32') app.setAppUserModelId('com.aaoffice.desktop')
  log.initialize(); log.transports.file.maxSize = 2 * 1024 * 1024
  const userData = app.getPath('userData')
  const dataDir = join(userData, 'Data')
  const workspaces = join(userData, 'Workspaces')
  const exports = join(userData, 'Exports')
  mkdirSync(workspaces, { recursive:true }); mkdirSync(exports, { recursive:true })
  const databasePath = join(dataDir, 'aa-office.sqlite')
  database = new OfficeDatabase(databasePath)
  database.recoverInterruptedTasks()
  const credentials = new CredentialStore(credentialDirectory(userData))
  const runtime = new OfficeRuntime(database, credentials)
  const backups = new BackupService(database, join(userData, 'Backups'))
  const tools = new ToolRegistry(database, new PathGuard([workspaces, exports]), undefined, () => runtime.isStopped())
  registerIpc({ database, runtime, backups, tools })
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'"] } }))
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
}).catch((error) => {
  log.error('Startup failed', error)
  dialog.showErrorBox('A&A Office could not start', 'Your data was not changed. Restart the application. If the problem continues, use the latest backup or reinstall A&A Office.')
  app.quit()
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { database?.close(); database = null })

process.on('uncaughtException', (error) => log.error('Uncaught main-process error', error))
process.on('unhandledRejection', (error) => log.error('Unhandled main-process rejection', error))
