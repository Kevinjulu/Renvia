import app from "../src/index";

export default function handler(request: Request) {
  return app.fetch(request, process.env);
}
