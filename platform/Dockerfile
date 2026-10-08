# The board in a container: node and the sources are the whole image, because the platform has
# no runtime dependencies to install — that stance (ADR 0001) is what makes this file four lines
# of work.
FROM node:22-slim

WORKDIR /app/platform
COPY platform/ /app/platform/

# The knowledge assets, the draft shelf and the session records are mounted at runtime; the
# platform resolves them relative to its own directory (src/catalog.ts), so /app/domains is
# exactly where it expects the repository's copy to be.
ENV PORT=18087
EXPOSE 18087
CMD ["node", "src/ui/serve.ts"]
