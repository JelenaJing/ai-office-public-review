# -*- coding: utf-8 -*-
"""模型 A 内置绘图：随安装包发布，不依赖大模型生成代码。"""
from __future__ import annotations

import json
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402


def _setup_font() -> None:
    plt.rcParams["font.sans-serif"] = ["SimHei", "Microsoft YaHei", "SimSun", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False


def _pick_num_cols(df: pd.DataFrame) -> list[str]:
    out: list[str] = []
    for c in df.columns:
        s = pd.to_numeric(df[c], errors="coerce")
        if s.notna().sum() >= max(1, len(df) // 10):
            out.append(str(c))
    return out


def main() -> None:
    _setup_font()
    inp = os.environ.get("AI_OFFICE_INPUT_CSV", "").strip()
    out_dir = os.environ.get("AI_OFFICE_OUTPUT_DIR", "").strip()
    hint = os.environ.get("AI_OFFICE_USER_HINT", "").strip()

    if not inp or not out_dir or not os.path.isfile(inp):
        print(
            "EXCEL_ANALYSIS_RESULT_JSON: "
            + json.dumps(
                {"summary": "错误：AI_OFFICE_INPUT_CSV 或输出目录无效", "chart_files": [], "pivot_description": ""},
                ensure_ascii=False,
            )
        )
        sys.exit(1)

    os.makedirs(out_dir, exist_ok=True)
    df = pd.read_csv(inp, encoding="utf-8-sig")

    soh_col = None
    for c in df.columns:
        u = str(c).upper()
        if "SOH" in u or "健康" in str(c):
            soh_col = c
            break

    x_col = None
    if soh_col:
        for c in df.columns:
            if c == soh_col:
                continue
            t = str(c).lower()
            if any(k in t for k in ("cycle", "cyc", "循环", "周", "次", "圈", "n")):
                x_col = c
                break
        if x_col is None and len(df.columns) >= 2:
            x_col = [c for c in df.columns if c != soh_col][0]

    fig, ax = plt.subplots(figsize=(8.5, 4.8))
    chart_files: list[str] = []

    if soh_col is not None:
        y = pd.to_numeric(df[soh_col], errors="coerce")
        if x_col is not None:
            x = pd.to_numeric(df[x_col], errors="coerce")
            ax.plot(x, y, marker="o", linewidth=1.6, markersize=4)
            ax.set_xlabel(str(x_col))
        else:
            ax.plot(range(len(df)), y, marker="o", linewidth=1.6, markersize=4)
            ax.set_xlabel("序号")
        ax.set_ylabel("SoH_%")
        title = "容量保持率 (SoH)"
        if hint:
            title = f"{title} · {hint[:40]}"
        ax.set_title(title)
        ax.grid(True, alpha=0.35)
    else:
        nums = _pick_num_cols(df)
        if len(nums) >= 2:
            ax.scatter(
                pd.to_numeric(df[nums[0]], errors="coerce"),
                pd.to_numeric(df[nums[1]], errors="coerce"),
                alpha=0.65,
                s=22,
            )
            ax.set_xlabel(nums[0])
            ax.set_ylabel(nums[1])
            ax.set_title("散点预览（未识别 SoH 列）")
        elif len(nums) == 1:
            s = pd.to_numeric(df[nums[0]], errors="coerce")
            ax.bar(range(len(s)), s, color="#3b82f6", alpha=0.85)
            ax.set_xlabel("序号")
            ax.set_ylabel(nums[0])
            ax.set_title("柱状预览（未识别 SoH 列）")
        else:
            ax.text(0.5, 0.5, "未找到足够数值列绘图", ha="center", va="center", transform=ax.transAxes, fontsize=12)
            ax.set_title("内置绘图")

    out1 = os.path.join(out_dir, "excel_chart_01.png")
    fig.tight_layout()
    fig.savefig(out1, dpi=150, bbox_inches="tight")
    plt.close(fig)
    chart_files.append("excel_chart_01.png")

    summary = "模型 A 内置绘图已生成 excel_chart_01.png"
    print(
        "EXCEL_ANALYSIS_RESULT_JSON: "
        + json.dumps(
            {
                "summary": summary,
                "chart_files": chart_files,
                "pivot_description": "builtin model_a plot_builtin.py",
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
