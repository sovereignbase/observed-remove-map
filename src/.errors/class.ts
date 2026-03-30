export type ORMapErrorCode = 'BAD_SNAPSHOT'

export class ORMapError extends Error {
  readonly code: ORMapErrorCode

  constructor(code: ORMapErrorCode, message?: string) {
    const detail = message ?? code
    super(`{@sovereignbase/observed-remove-map} ${detail}`)
    this.code = code
    this.name = 'ORMapError'
  }
}
