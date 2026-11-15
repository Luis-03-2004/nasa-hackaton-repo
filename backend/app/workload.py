"""Limite opcional de consultas pesadas para instâncias com pouca memória."""
from __future__ import annotations

import asyncio
import logging
import os

import pyarrow as pa
from starlette.types import ASGIApp, Receive, Scope, Send

logger = logging.getLogger(__name__)
HEAVY_PATHS = frozenset({"/explore/query", "/explore/map", "/forecast/selection", "/hotspots"})


def configure_arrow_threads() -> None:
    """Preserva a configuração local quando FIRE_ARROW_THREADS não foi definido."""
    configured = os.getenv("FIRE_ARROW_THREADS")
    if configured is None:
        return
    threads = int(configured)
    if threads < 1:
        raise ValueError("FIRE_ARROW_THREADS deve ser um inteiro positivo")
    pa.set_cpu_count(threads)
    pa.set_io_thread_count(threads)


def heavy_request(scope: Scope) -> bool:
    if scope["type"] != "http" or scope.get("method") == "OPTIONS":
        return False
    path = scope.get("path", "")
    prefix = scope.get("root_path", "").rstrip("/")
    if prefix and path.startswith(prefix + "/"):
        path = path[len(prefix):]
    path = path.rstrip("/")
    return path in HEAVY_PATHS or path == "/observations" or path.startswith("/observations/")


class WorkloadMiddleware:
    """Mantém a permissão até o fim da resposta, incluindo seu streaming.

    FIRE_MAX_PARALLEL_QUERIES=0 desliga o limite. Status, saúde, CORS e
    lifespan não entram na fila. O controle vale por processo; use um worker
    quando o objetivo for limitar a memória da instância inteira.
    """

    def __init__(self, app: ASGIApp, max_parallel: int | None = None,
                 release_arrow_memory: bool | None = None) -> None:
        self.app = app
        limit = int(os.getenv("FIRE_MAX_PARALLEL_QUERIES", "0")) if max_parallel is None else max_parallel
        if limit < 0:
            raise ValueError("FIRE_MAX_PARALLEL_QUERIES deve ser zero ou um inteiro positivo")
        self.semaphore = asyncio.Semaphore(limit) if limit else None
        self.release_arrow_memory = (os.getenv("FIRE_RELEASE_ARROW_MEMORY", "0").lower() in {"1", "true", "yes"}
                                     if release_arrow_memory is None else release_arrow_memory)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self.semaphore is None or not heavy_request(scope):
            await self.app(scope, receive, send)
            return
        async with self.semaphore:
            try:
                await self.app(scope, receive, send)
            finally:
                if self.release_arrow_memory:
                    # A liberação pode chamar malloc_trim/madvise. Não bloqueia o
                    # event loop nem faz uma falha de limpeza invalidar a resposta.
                    try:
                        await asyncio.to_thread(pa.default_memory_pool().release_unused)
                    except Exception as error:
                        logger.warning("Não foi possível liberar memória Arrow (%s).", type(error).__name__)
