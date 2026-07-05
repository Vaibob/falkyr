# JobPilot — containerized web app: Fastify API + built React UI (same origin,
# port 3001) + SQLite + multi-source ingest + non-rejection strategy engine.
#
# HOST-COUPLED FEATURES NOT RUN IN-CONTAINER (see DOCKER.md):
#   - Playwright autofill/submit launches a HEADED browser for you to watch and
#     click Submit — there is no display in a container, so run `npm run apply`
#     on the host.
#   - `claude -p` generation needs the Claude CLI + your auth; in-container the
#     generate/rewrite modules fall back to deterministic templates.

# ---- build stage: install deps (with native toolchain) + build the UI ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
# Toolchain so better-sqlite3 can compile from source if no prebuilt binary exists.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install
COPY . .
# Clerk auth is opt-in: pass --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_... to
# bake auth into the UI bundle; leave unset for local (no-auth) mode.
ARG VITE_CLERK_PUBLISHABLE_KEY=
ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
RUN npm run ui:build

# ---- runtime stage ----
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Claude Code CLI — the generation/intake backend. Auth comes from the
# CLAUDE_CODE_OAUTH_TOKEN env var at runtime (user-generated via
# `claude setup-token` on the host; see DOCKER.md). Without a token the app
# degrades honestly (isClaudeAvailable() -> false), exactly as before.
RUN npm install -g @anthropic-ai/claude-code
# Copy installed deps (with the linux-native better-sqlite3), source, and web/dist.
COPY --from=build /app ./
# SQLite DB lives here; mount a volume so it persists across containers.
RUN mkdir -p /app/data
EXPOSE 3001
# Serves BOTH the API (/api/*) and the built UI (everything else) on :3001.
CMD ["npm", "run", "server"]
