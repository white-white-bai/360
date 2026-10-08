# The full-stack service (ADR 0013). Two stages so the runtime image carries the venv, not pip's
# cache or a compiler toolchain.
FROM python:3.12-slim AS build

WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir .

FROM python:3.12-slim

WORKDIR /app
COPY --from=build /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=build /usr/local/bin /usr/local/bin
COPY src ./src

# The assets are mounted, not copied: domains/ is the one thing the two stacks share (ADR 0013),
# and a teaching service that carried a stale copy of its own catalogue would teach yesterday's
# material with today's confidence.
ENV ATP_DOMAINS_DIR=/domains
EXPOSE 8788
CMD ["uvicorn", "agent.app:app", "--host", "0.0.0.0", "--port", "8788"]
