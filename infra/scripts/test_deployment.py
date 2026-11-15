"""Verificações locais do empacotamento e extração; não acessam AWS."""
import importlib.util
import io
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import REPO
from deploy import package
from unittest.mock import patch
import hashlib

spec = importlib.util.spec_from_file_location("host_runtime", REPO / "deploy/aws/host_runtime.py")
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class ReleaseTests(unittest.TestCase):
    def test_prepared_sources_require_matching_content_before_restoring_mtime(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            scientific = root / 'data/global_1km_2000_2025'
            source = scientific / 'parquet_025deg/modis/modis_2025.parquet'
            source.parent.mkdir(parents=True)
            source.write_bytes(b'fixture')
            original_mtime = source.stat().st_mtime_ns
            staging = root / 'source-prepared'
            (staging / 'web_v2/f2').mkdir(parents=True)
            (staging / 'web_v2/exploration.sqlite').write_bytes(b'synthetic')
            (staging / 'web_v2/f2/weekly.sqlite').write_bytes(b'synthetic')
            import json
            entry = {'name':'parquet_025deg/modis/modis_2025.parquet','size':7,'mtime_ns':1,'sha256':'incorrect'}
            (staging / 'source_inventory.json').write_text(json.dumps([entry] * 48))
            artifact = root / 'prepared.tar.gz'
            with tarfile.open(artifact,'w:gz') as stream:
                for path in staging.rglob('*'):
                    if path.is_file():stream.add(path,arcname=str(path.relative_to(staging)))
            digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
            with patch.object(runtime,'ROOT',root), patch.object(runtime,'run'):
                with self.assertRaisesRegex(RuntimeError,'Conteúdo da fonte'):
                    runtime.install_prepared({'region':'us-east-1','artifact_bucket':'fixture'},{'prepared':{'key':'fixture','sha256':digest}})
            self.assertEqual(source.stat().st_mtime_ns, original_mtime)
            self.assertFalse((scientific / 'web_v2/exploration.sqlite').exists())

    def test_archive_omits_credentials_builds_and_external_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "repo"
            for name in ("backend/app/main.py", "frontend/src/App.tsx", "deploy/aws/Caddyfile", ".dockerignore",
                         "backend/.env", "frontend/.env.production", "frontend/node_modules/secret.txt",
                         "backend/key.pem", "backend/.aws/credentials", "frontend/dist/generated.js"):
                target = source / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("fixture")
            (source / "backend/external.py").symlink_to(root / "outside.py")
            archive, manifest = package(source=source, output=root / "out")
            with tarfile.open(archive) as stream:
                self.assertEqual(set(stream.getnames()), {"backend/app/main.py", "frontend/src/App.tsx", "deploy/aws/Caddyfile", ".dockerignore"})
            self.assertEqual(len(manifest["sha256"]), 64)

    def test_extract_rejects_traversal_and_symlinks(self):
        for name, link in (("../escape", False), ("/escape", False), ("link", True)):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = root / "source.tar.gz"
                with tarfile.open(archive, "w:gz") as stream:
                    member = tarfile.TarInfo(name)
                    if link:
                        member.type = tarfile.SYMTYPE
                        member.linkname = "/etc/passwd"
                    else:
                        member.size = 1
                    stream.addfile(member, None if link else io.BytesIO(b"x"))
                with self.assertRaises(RuntimeError):
                    runtime.extract_source(archive, root / "release")

    def test_private_files_replace_atomically_with_restricted_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "private.env"
            runtime.write_private(path, "fixture")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            runtime.write_private(path, "changed")
            self.assertEqual(path.read_text(), "changed")
            self.assertFalse(path.with_suffix(".env.new").exists())

    def test_extracted_sources_remain_readable_under_service_umask(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "source.tar.gz"
            with tarfile.open(archive, "w:gz") as stream:
                member = tarfile.TarInfo("backend/app/main.py")
                member.mode = 0o600
                member.size = 1
                stream.addfile(member, io.BytesIO(b"x"))
            previous = os.umask(0o077)
            try:
                runtime.extract_source(archive, root / "release")
            finally:
                os.umask(previous)
            self.assertEqual((root / "release/backend/app").stat().st_mode & 0o777, 0o755)
            self.assertEqual((root / "release/backend/app/main.py").stat().st_mode & 0o777, 0o644)


if __name__ == "__main__":
    unittest.main()
