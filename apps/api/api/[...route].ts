import app from "../src/index.js";

export function fetch(request: Request): Response | Promise<Response> {
  return app.fetch(request, process.env);
}
