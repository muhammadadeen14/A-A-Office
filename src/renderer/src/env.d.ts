import type { OfficeApi } from '../../preload'

declare global { interface Window { office: OfficeApi } }
export {}
