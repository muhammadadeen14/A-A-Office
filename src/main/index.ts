import { app, BrowserWindow, session } from 'electron'
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
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('file:') && !url.startsWith('http://localhost')) event.preventDefault() })
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  app.setName('A&A Office')
  log.initialize(); log.transports.file.maxSize = 2 * 1024 * 1024
  const userData = app.getPath('userData')
  const dataDir = join(userData, 'Data')
  const workspaces = join(userData, 'Workspaces')
  const exports = join(userData, 'Exports')
  const databasePath = join(dataDir, 'aa-office.sqlite')
  database = new OfficeDatabase(databasePath)
  database.recoverInterruptedTasks()
  const credentials = new CredentialStore(credentialDirectory(userData))
  const runtime = new OfficeRuntime(database, credentials)
  const backups = new BackupService(database, join(userData, 'Backups'))
  const tools = new ToolRegistry(database, new PathGuard([workspaces, exports]))
  registerIpc({ database, runtime, backups, tools })
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src https: http://localhost:*; font-src 'self'"] } }))
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
}).catch((error) => { log.error('Startup failed', error); app.quit() })

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { database?.close(); database = null })

process.on('uncaughtException', (error) => log.error('Uncaught main-process error', error))
process.on('unhandledRejection', (error) => log.error('Unhandled main-process rejection', error))
