/** An error that maps directly to an HTTP response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what = "Not found") => new HttpError(404, what);
export const badRequest = (msg: string) => new HttpError(400, msg);
