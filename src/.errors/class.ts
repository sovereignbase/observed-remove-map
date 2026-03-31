export type OOStructErrorCode = ''

export class OOStructError extends Error {
  readonly code: OOStructErrorCode

  constructor(code: OOStructErrorCode, message?: string) {
    const detail = message ?? code
    super(`{@sovereignbase/observed-overwrite-struct} ${detail}`)
    this.code = code
    this.name = 'OOStructError'
  }
}
