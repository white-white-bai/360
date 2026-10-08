# vLLM and other local inference: a document, not a deployment

This machine cannot run it, and saying so is cheaper than a broken manifest: the GPU here is a
**GeForce GT 710** — a display card from 2014, without the compute capability any transformer
runtime needs. Nothing in this repository depends on vLLM; this page is the path for a machine
that has a real GPU.

## What would change

Nothing in the code. The stack already talks to any OpenAI-compatible endpoint, and vLLM serves
one:

```bash
# on the GPU machine
vllm serve Qwen/Qwen3-8B --port 8000
```

```bash
# here, pointed at it (the .env or the shell)
ATP_BASE_URL=http://gpu-box:8000/v1
ATP_MODEL=Qwen/Qwen3-8B
ATP_API_KEY=dummy            # vLLM ignores it; config_from_env still requires the pair
```

Then everything built in stages 1-4 runs against local inference: the classroom, the builder's
drafting calls, the verifier, the challenger, and the MCP doors. Two honest notes:

- **The embedding model stays local either way.** fastembed runs on CPU; a GPU box would make it
  faster, not different, and retrieval does not need to leave the machine.
- **Capacity, not correctness, is what a GPU changes here.** The verifier is a second call per
  answer and the agent loop is bounded; on a shared local endpoint those calls queue. The ledger
  already reports the per-actor cost, which on a local endpoint is time rather than money.

## What is deliberately absent

No vLLM container in `docker-compose.yml`, no Kubernetes manifest for it, no quantization
recipes. A deployment document for hardware nobody here has is a document that rots; when a GPU
machine is actually in the loop, this file becomes a stage with its own acceptance.
