/** A present-but-malformed `mtproto-config.ts` env value (e.g. a non-numeric port). Mirrors `SshConfigurationError`'s role for the SSH layer's own env vars, kept as its own type rather than reused across layers — an invalid MTProto env var isn't an SSH problem. */
export class MtprotoConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MtprotoConfigurationError';
  }
}

/** No candidate in the scan result passed the selector's filters (TLS1.3, valid cert, allowed country/issuer). Not a bug — a legitimate "nothing good found this run" outcome the use case must report, not crash on. */
export class NoCandidateFoundError extends Error {
  constructor(message = 'No suitable candidate found in scan results') {
    super(message);
    this.name = 'NoCandidateFoundError';
  }
}

/** A second update was requested while one is already in flight — the in-process mutex case. Caller shows "Обновление уже выполняется", not a stack trace. */
export class UpdateAlreadyRunningError extends Error {
  constructor(message = 'An MTProto update is already running') {
    super(message);
    this.name = 'UpdateAlreadyRunningError';
  }
}

/**
 * The remote lock-marker already existed when a new run tried to start —
 * a previous run was interrupted (bot crash/restart) mid-flight, possibly
 * leaving the host in a half-applied state. `UpdateJobRunner` throws this
 * instead of silently proceeding; the caller must resolve it (typically by
 * running a recovery rollback to the last backup) before a fresh update
 * can start.
 */
export class OrphanedUpdateDetectedError extends Error {
  constructor(
    message: string,
    public readonly markerCreatedAt?: Date,
  ) {
    super(message);
    this.name = 'OrphanedUpdateDetectedError';
  }
}

/**
 * `RollbackManager` could not get the host back to a healthy state after
 * restoring the backup. This must never be swallowed — it's the "panic +
 * full report" case: the use case catches it only to attach full context
 * to `UpdateReport`, never to retry silently.
 */
export class RollbackFailedError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RollbackFailedError';
  }
}
