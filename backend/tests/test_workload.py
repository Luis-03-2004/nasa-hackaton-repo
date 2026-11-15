"""Concorrência ASGI real, sem rede, credenciais ou dados científicos."""
import asyncio
import os
import unittest
from unittest.mock import Mock, patch

from app.workload import WorkloadMiddleware, configure_arrow_threads, heavy_request


def scope(path="/explore/query", **extra):
    return {"type": "http", "method": "POST", "path": path, "root_path": "", **extra}


async def receive():
    return {"type": "http.request", "body": b"", "more_body": False}


async def send(message):
    pass


class WorkloadTests(unittest.IsolatedAsyncioTestCase):
    async def test_heavy_queries_wait_and_status_does_not(self):
        entered = asyncio.Event()
        release = asyncio.Event()
        calls = []

        async def app(request, receive, send):
            calls.append(request["path"])
            if request["path"] == "/explore/query":
                entered.set()
                await release.wait()

        middleware = WorkloadMiddleware(app, max_parallel=1)
        first = asyncio.create_task(middleware(scope(), receive, send))
        await entered.wait()
        second = asyncio.create_task(middleware(scope("/explore/map"), receive, send))
        await asyncio.wait_for(middleware(scope("/explore/status"), receive, send), timeout=1)
        await asyncio.wait_for(middleware(scope("/health"), receive, send), timeout=1)
        await asyncio.sleep(0)
        self.assertEqual(calls, ["/explore/query", "/explore/status", "/health"])
        self.assertFalse(second.done())
        release.set()
        await asyncio.wait_for(asyncio.gather(first, second), timeout=1)
        self.assertEqual(calls[-1], "/explore/map")

    async def test_streaming_holds_permit_until_final_body(self):
        first_chunk = asyncio.Event()
        release = asyncio.Event()
        second_entered = asyncio.Event()

        async def app(request, receive, send):
            if request["path"] == "/hotspots":
                await send({"type": "http.response.start", "status": 200, "headers": []})
                await send({"type": "http.response.body", "body": b"[", "more_body": True})
                first_chunk.set()
                await release.wait()
                await send({"type": "http.response.body", "body": b"]", "more_body": False})
            else:
                second_entered.set()

        middleware = WorkloadMiddleware(app, max_parallel=1)
        first = asyncio.create_task(middleware(scope("/hotspots"), receive, send))
        await first_chunk.wait()
        second = asyncio.create_task(middleware(scope("/observations/area"), receive, send))
        await asyncio.sleep(0)
        self.assertFalse(second_entered.is_set())
        release.set()
        await asyncio.wait_for(asyncio.gather(first, second), timeout=1)
        self.assertTrue(second_entered.is_set())

    async def test_cancel_active_query_releases_permit(self):
        entered = asyncio.Event()

        async def app(request, receive, send):
            if request["path"] == "/explore/query":
                entered.set()
                await asyncio.Event().wait()

        middleware = WorkloadMiddleware(app, max_parallel=1)
        first = asyncio.create_task(middleware(scope(), receive, send))
        await entered.wait()
        first.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await first
        await asyncio.wait_for(middleware(scope("/explore/map"), receive, send), timeout=1)

    async def test_cancel_waiter_does_not_release_active_query(self):
        entered = asyncio.Event()
        release = asyncio.Event()
        calls = []

        async def app(request, receive, send):
            calls.append(request["path"])
            if request["path"] == "/explore/query":
                entered.set()
                await release.wait()

        middleware = WorkloadMiddleware(app, max_parallel=1)
        first = asyncio.create_task(middleware(scope(), receive, send))
        await entered.wait()
        waiter = asyncio.create_task(middleware(scope("/explore/map"), receive, send))
        await asyncio.sleep(0)
        waiter.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await waiter
        third = asyncio.create_task(middleware(scope("/forecast/selection"), receive, send))
        await asyncio.sleep(0)
        self.assertEqual(calls, ["/explore/query"])
        release.set()
        await asyncio.wait_for(asyncio.gather(first, third), timeout=1)
        self.assertEqual(calls[-1], "/forecast/selection")

    async def test_application_error_and_memory_cleanup_do_not_leak_permit(self):
        async def app(request, receive, send):
            if request["path"] == "/explore/query":
                raise RuntimeError("fixture")

        pool = Mock()
        middleware = WorkloadMiddleware(app, max_parallel=1, release_arrow_memory=True)
        with patch("app.workload.pa.default_memory_pool", return_value=pool):
            with self.assertRaisesRegex(RuntimeError, "fixture"):
                await middleware(scope(), receive, send)
            await asyncio.wait_for(middleware(scope("/explore/map"), receive, send), timeout=1)
        self.assertEqual(pool.release_unused.call_count, 2)

    async def test_zero_limit_does_not_queue_heavy_requests(self):
        both = asyncio.Event()
        release = asyncio.Event()
        entered = 0

        async def app(request, receive, send):
            nonlocal entered
            entered += 1
            if entered == 2:
                both.set()
            await release.wait()

        middleware = WorkloadMiddleware(app, max_parallel=0)
        tasks = [asyncio.create_task(middleware(scope(), receive, send)) for _ in range(2)]
        await asyncio.wait_for(both.wait(), timeout=1)
        release.set()
        await asyncio.wait_for(asyncio.gather(*tasks), timeout=1)


class ConfigurationTests(unittest.TestCase):
    def test_root_path_and_preflight_are_classified_correctly(self):
        self.assertTrue(heavy_request(scope("/api/explore/query", root_path="/api")))
        self.assertTrue(heavy_request(scope("/explore/query", root_path="/api")))
        self.assertTrue(heavy_request(scope("/observations/region-series")))
        self.assertFalse(heavy_request(scope("/api/explore/status", root_path="/api")))
        self.assertFalse(heavy_request(scope("/explore/query", method="OPTIONS")))
        self.assertFalse(heavy_request({"type": "lifespan"}))

    def test_arrow_threads_change_only_with_explicit_environment(self):
        with patch.dict(os.environ, {}, clear=True), patch("app.workload.pa.set_cpu_count") as cpu, patch("app.workload.pa.set_io_thread_count") as io:
            configure_arrow_threads()
            cpu.assert_not_called()
            io.assert_not_called()
            os.environ["FIRE_ARROW_THREADS"] = "2"
            configure_arrow_threads()
            cpu.assert_called_once_with(2)
            io.assert_called_once_with(2)
            os.environ["FIRE_ARROW_THREADS"] = "0"
            with self.assertRaises(ValueError):
                configure_arrow_threads()

    def test_negative_query_limit_is_rejected(self):
        with self.assertRaises(ValueError):
            WorkloadMiddleware(Mock(), max_parallel=-1)


if __name__ == "__main__":
    unittest.main()
