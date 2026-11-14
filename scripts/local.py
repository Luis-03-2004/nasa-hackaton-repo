"""Inicia API e Vite locais; Ctrl+C encerra ambos sem tocar outros processos."""
from pathlib import Path
import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
from urllib.request import urlopen
from urllib.error import URLError

WEB_DIR = Path(__file__).resolve().parents[1]


def wait_http(url, child, timeout=40):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError(f"Processo encerrou com código {child.returncode}: {url}")
        try:
            with urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (URLError, TimeoutError, ConnectionError):
            pass
        time.sleep(.25)
    raise RuntimeError(f"Tempo esgotado aguardando {url}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--detach', action='store_true', help='Inicia em segundo plano com logs em data/')
    mode.add_argument('--stop', action='store_true', help='Encerra somente o supervisor salvo por --detach')
    mode.add_argument('--status', action='store_true', help='Consulta os serviços iniciados por --detach')
    mode.add_argument('--serve', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if sys.version_info[:3] != (3, 12, 2):
        raise SystemExit(f"Use Python 3.12.2; encontrado {sys.version.split()[0]}")
    data_dir = Path(os.getenv("FIRE_DATA_DIR", WEB_DIR.parent / "data/global_1km_2000_2025")).resolve()
    runtime_dir = data_dir / "web_local"
    pid_path = runtime_dir / "supervisor.pid"
    def owned_pid():
        try:
            pid = int(pid_path.read_text().strip())
            command = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\x00")
            if str(Path(__file__).resolve()).encode() in command and b"--serve" in command:
                return pid
        except (OSError, ValueError):
            pass
        return None
    if args.status or args.stop:
        pid = owned_pid()
        if args.stop and pid:
            os.kill(pid, signal.SIGTERM)
            deadline = time.monotonic() + 12
            while owned_pid() and time.monotonic() < deadline:
                time.sleep(.1)
            print("Serviços encerrados." if not owned_pid() else "Encerramento solicitado; confira o log.")
        elif pid:
            print(f"Supervisor ativo (PID {pid}) · interface http://localhost:5173 · API http://localhost:8000/docs")
        else:
            print("Nenhum supervisor local salvo está ativo.")
        return
    if args.detach:
        if owned_pid():
            raise SystemExit("Sistema já iniciado em segundo plano. Use --status ou --stop.")
        runtime_dir.mkdir(parents=True, exist_ok=True)
        log_path = runtime_dir / "firecal.log"
        with log_path.open("a") as log:
            supervisor = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--serve"], stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        pid_path.write_text(str(supervisor.pid))
        try:
            wait_http("http://127.0.0.1:5173", supervisor)
            wait_http("http://127.0.0.1:8000/health", supervisor)
        except Exception:
            if supervisor.poll() is None:
                supervisor.terminate()
            raise RuntimeError(f"Falha na inicialização. Consulte {log_path}") from None
        print(f"Sistema iniciado em segundo plano (PID {supervisor.pid}).\nInterface: http://localhost:5173\nAPI: http://localhost:8000/docs\nLog: {log_path}\nEncerrar: ./iniciar_local.sh --stop")
        return
    if not (data_dir / "previsao_mapa_mundi/catalogo_pontos_globais_previsao.parquet").is_file():
        raise SystemExit(f"Catálogo de dados ausente em {data_dir}; configure FIRE_DATA_DIR.")
    if not (WEB_DIR / "frontend/node_modules/.bin/vite").is_file():
        raise SystemExit("Instale as dependências com: cd frontend && npm ci")
    for port in (8000, 5173):
        with socket.socket() as connection:
            if connection.connect_ex(("127.0.0.1", port)) == 0:
                raise SystemExit(f"Porta {port} ocupada; encerre o serviço existente antes de iniciar.")
    env = {**os.environ, "FIRE_STORAGE": "parquet", "FIRE_DATA_DIR": str(data_dir)}
    children = []
    def shutdown_signal(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, shutdown_signal)
    try:
        api = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], cwd=WEB_DIR / "backend", env=env, start_new_session=True)
        children.append(api)
        wait_http("http://127.0.0.1:8000/health", api)
        web = subprocess.Popen(["npm", "run", "dev"], cwd=WEB_DIR / "frontend", env=env, start_new_session=True)
        children.append(web)
        wait_http("http://127.0.0.1:5173", web)
        with urlopen("http://127.0.0.1:8000/health") as response:
            health = json.load(response)
        print(f"\nSistema local disponível: http://localhost:5173\nAPI e documentação: http://localhost:8000/docs\n{health['world_points']:,} pontos · armazenamento {health['storage']} · Ctrl+C encerra ambos\n", flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(1)
        raise RuntimeError("Um dos serviços encerrou; consulte a saída acima.")
    except KeyboardInterrupt:
        print("\nEncerrando os serviços desta sessão…", flush=True)
    finally:
        for child in reversed(children):
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
        for child in reversed(children):
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()


if __name__ == "__main__":
    main()
