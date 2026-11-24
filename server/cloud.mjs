import { api } from "./api.mjs";

// Bind DB to D1 and ASSETS to public/. The browser hosts inference in this mode.
export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith("/api/")) {
      try {
        return await api(request, env.DB);
      } catch {
        return Response.json(
          { error: "The session database is unavailable. Retry shortly." },
          { status: 503 },
        );
      }
    }
    return env.ASSETS.fetch(request);
  },
};
