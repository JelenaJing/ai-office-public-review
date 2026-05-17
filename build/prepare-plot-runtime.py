from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path


def log(message: str) -> None:
    print(f"[plot-runtime] {message}")


def update_pth(runtime_root: Path) -> None:
    pth_files = list(runtime_root.glob("python*._pth"))
    if not pth_files:
        raise RuntimeError("未找到 python._pth 文件，无法启用 site-packages")

    pth_file = pth_files[0]
    lines = pth_file.read_text(encoding="ascii").splitlines()
    updated: list[str] = []
    has_site_packages = False
    for line in lines:
        if line.strip() == "#import site":
            updated.append("import site")
        else:
            updated.append(line)
        if line.strip() == "Lib\\site-packages":
            has_site_packages = True

    if not has_site_packages:
      updated.append("Lib\\site-packages")

    pth_file.write_text("\n".join(updated) + "\n", encoding="ascii")


def prepare_runtime(python_version: str, runtime_root: Path, requirements_file: Path) -> None:
    project_root = runtime_root.parent.parent
    agent_root = project_root.parent / "merged-plot-agent"
    python_tag = "310"
    python_tag_dotted = "3.10"

    if runtime_root.exists():
        shutil.rmtree(runtime_root)
    runtime_root.mkdir(parents=True, exist_ok=True)

    embed_zip_url = f"https://www.python.org/ftp/python/{python_version}/python-{python_version}-embed-amd64.zip"
    log(f"projectRoot={project_root}")
    log(f"runtimeRoot={runtime_root}")
    log(f"agentRoot={agent_root}")
    log(f"downloading embedded python from {embed_zip_url}")

    with tempfile.TemporaryDirectory(prefix="plot-runtime-") as temp_dir:
        temp_path = Path(temp_dir)
        embed_zip = temp_path / f"python-{python_version}-embed-amd64.zip"
        urllib.request.urlretrieve(embed_zip_url, embed_zip)

        with zipfile.ZipFile(embed_zip) as archive:
            archive.extractall(runtime_root)

        update_pth(runtime_root)
        site_packages = runtime_root / "Lib" / "site-packages"
        site_packages.mkdir(parents=True, exist_ok=True)

        log("installing Windows wheels into Lib/site-packages")
        install_cmd = [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--upgrade",
            "--only-binary=:all:",
            "--platform",
            "win_amd64",
            "--python-version",
            python_tag_dotted,
            "--implementation",
            "cp",
            "--target",
            str(site_packages),
            "-r",
            str(requirements_file),
        ]
        subprocess.run(install_cmd, check=True)

    marker = runtime_root / "RUNTIME_READY.txt"
    marker.write_text(
        "\n".join(
            [
                "plot-agent-runtime prepared successfully",
                f"python={python_version}",
                f"generated_with={sys.executable}",
                f"agent_root={agent_root}",
                f"requirements_file={requirements_file}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    log(f"ready: {runtime_root}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python-version", default="3.10.11")
    parser.add_argument("--runtime-root", default="build/plot-agent-runtime")
    parser.add_argument("--requirements", default="build/plot-runtime-requirements-win.txt")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    runtime_root = (project_root / args.runtime_root).resolve()
    requirements_file = (project_root / args.requirements).resolve()

    if not requirements_file.exists():
        raise RuntimeError(f"requirements 文件不存在: {requirements_file}")

    prepare_runtime(args.python_version, runtime_root, requirements_file)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())