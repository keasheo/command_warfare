/** Local readable timestamp: `2026-08-03 10:26:45` */
export function formatLogTimestamp(at: number | Date = Date.now()): string {
  const d = at instanceof Date ? at : new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function serverLog(tag: string, message: string) {
  console.log(`[${formatLogTimestamp()}] [${tag}] ${message}`)
}
