"""
GPT-SoVITS 训练面板 — 统一后端
端口 9877 | 项目管理 + 标注工具 + 音频切分 + 未来扩展模块
"""
import os
import sys
import json
import copy
import glob
import mimetypes
import argparse
import threading
import time
import shutil
import zipfile
import tempfile
import yaml
import traceback
import subprocess
from pathlib import Path
from datetime import datetime

import numpy as np
from scipy.io import wavfile
import uvicorn
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Body
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

# ============================================================
#  路径常量
# ============================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOGS_DIR = os.path.join(BASE_DIR, "logs")
PANEL_UI_DIR = os.path.join(BASE_DIR, "panel_ui")
ANNOTATE_UI_DIR = os.path.join(BASE_DIR, "panel_ui", "annotate")
STATE_FILE = os.path.join(BASE_DIR, "panel_state.json")

SUPPORTED_VERSIONS = ["v2Pro", "v2ProPlus", "v3", "v4", "v2", "v1"]

# Python 执行路径（自动检测 runtime/ 目录或系统 Python）
_runtime_python = os.path.join(BASE_DIR, "runtime", "python.exe")
PYTHON_EXEC = _runtime_python if os.path.isfile(_runtime_python) else sys.executable

# GPU 相关常量
_IS_HALF = os.environ.get("is_half", "True")
_GPU_INDEX = os.environ.get("gpu_index", "0")

# ============================================================
#  面板全局状态
# ============================================================
panel_state = {
    "active_project": None,
}


def load_panel_state():
    """加载面板状态"""
    global panel_state
    if os.path.isfile(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                panel_state.update(json.load(f))
        except Exception:
            pass


def save_panel_state():
    """保存面板状态"""
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(panel_state, f, ensure_ascii=False, indent=2)


# ============================================================
#  项目管理工具函数
# ============================================================
DEFAULT_PROJECT_META = {
    "name": "",
    "version": "v2Pro",
    "language": "zh",
    "created_at": "",
    "steps": {
        "slice":    {"status": "not_started"},
        "asr":      {"status": "not_started"},
        "annotate": {"status": "not_started", "list_file": ""},
        "format":   {"status": "not_started"},
        "train":    {"status": "not_started"},
        "infer":    {"status": "not_started"},
    }
}


def get_project_dir(name: str) -> str:
    return os.path.join(LOGS_DIR, name)


def get_project_meta_path(name: str) -> str:
    return os.path.join(get_project_dir(name), "project.json")


def load_project_meta(name: str) -> dict:
    """加载 project.json，若不存在则自动生成默认版本"""
    meta_path = get_project_meta_path(name)
    proj_dir = get_project_dir(name)

    if os.path.isfile(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        # 向后兼容：旧项目可能没有 language 字段
        if "language" not in meta:
            meta["language"] = "zh"
        return meta

    # 自动生成元数据
    meta = copy.deepcopy(DEFAULT_PROJECT_META)
    meta["name"] = name
    meta["created_at"] = datetime.fromtimestamp(
        os.path.getctime(proj_dir)
    ).isoformat()

    # 自动检测已有数据
    meta = auto_detect_project_status(name, meta)

    save_project_meta(name, meta)
    return meta


def save_project_meta(name: str, meta: dict):
    """保存 project.json"""
    meta_path = get_project_meta_path(name)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def auto_detect_project_status(name: str, meta: dict) -> dict:
    """自动检测项目目录中已有的数据，更新步骤状态"""
    proj_dir = get_project_dir(name)

    # 检查是否有 .list 文件（ASR 产出）
    list_files = glob.glob(os.path.join(proj_dir, "*.list"))
    # 也检查 output/asr_opt/ 目录
    asr_opt = os.path.join(BASE_DIR, "output", "asr_opt")
    if os.path.isdir(asr_opt):
        list_files += glob.glob(os.path.join(asr_opt, f"{name}*.list"))

    if list_files:
        meta["steps"]["asr"]["status"] = "done"
        meta["steps"]["annotate"]["list_file"] = list_files[0]

    # 检查是否有切分产物
    slice_dir = os.path.join(proj_dir, "raw")  # 常见切分输出目录
    if not os.path.isdir(slice_dir):
        # 检查 output/slicer_opt/
        slice_dir = os.path.join(BASE_DIR, "output", "slicer_opt", name)
    if os.path.isdir(slice_dir) and os.listdir(slice_dir):
        meta["steps"]["slice"]["status"] = "done"

    # 检查是否有格式化产物 (2-name2text.txt 等)
    if os.path.isfile(os.path.join(proj_dir, "2-name2text.txt")):
        meta["steps"]["format"]["status"] = "done"
        meta["steps"]["annotate"]["status"] = "done"

    # 检查是否有训练产物
    has_train = False
    for d in os.listdir(proj_dir):
        if d.startswith("logs_s1") or d.startswith("logs_s2"):
            train_dir = os.path.join(proj_dir, d)
            if os.path.isdir(train_dir) and os.listdir(train_dir):
                has_train = True
                break
    if has_train:
        meta["steps"]["train"]["status"] = "done"

    return meta


def list_all_projects() -> list:
    """列出 logs/ 下所有项目"""
    if not os.path.isdir(LOGS_DIR):
        os.makedirs(LOGS_DIR, exist_ok=True)
        return []

    projects = []
    for entry in sorted(os.listdir(LOGS_DIR)):
        proj_dir = os.path.join(LOGS_DIR, entry)
        if not os.path.isdir(proj_dir):
            continue
        # 跳过隐藏目录和特殊目录
        if entry.startswith(".") or entry.startswith("__"):
            continue
        meta = load_project_meta(entry)
        projects.append(meta)
    return projects


# ============================================================
#  标注模块全局状态（复用 audio_tool_server.py 逻辑）
# ============================================================
annotate_state = {
    "list_file": "",
    "entries": [],
    "undo_stack": [],
}
MAX_UNDO = 20


def get_audio_duration(wav_path: str) -> float:
    """获取音频时长（秒）"""
    try:
        import soundfile as sf
        info = sf.info(wav_path)
        return round(info.duration, 2)
    except Exception:
        pass
    try:
        import wave
        with wave.open(wav_path, 'rb') as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            if rate > 0:
                return round(frames / rate, 2)
    except Exception:
        pass
    return 0.0


def load_list_file(filepath: str) -> list:
    """读取 .list 文件"""
    entries = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line_no, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            parts = line.split("|")
            if len(parts) >= 4:
                wav_path = parts[0].strip()
                speaker_name = parts[1].strip()
                language = parts[2].strip()
                text = "|".join(parts[3:]).strip()
                duration = get_audio_duration(wav_path)
                entries.append({
                    "id": line_no,
                    "wav_path": wav_path,
                    "speaker_name": speaker_name,
                    "language": language,
                    "text": text,
                    "duration": duration,
                })
    return entries


def save_list_file(filepath: str, entries: list):
    """将条目写回 .list 文件"""
    with open(filepath, "w", encoding="utf-8") as f:
        for entry in entries:
            f.write(f"{entry['wav_path']}|{entry['speaker_name']}|{entry['language']}|{entry['text']}\n")


def push_undo():
    """将当前标注状态压入撤销栈"""
    annotate_state["undo_stack"].append(copy.deepcopy(annotate_state["entries"]))
    if len(annotate_state["undo_stack"]) > MAX_UNDO:
        annotate_state["undo_stack"].pop(0)


# ============================================================
#  FastAPI 应用
# ============================================================
app = FastAPI(title="GPT-SoVITS Training Panel")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- 请求/响应模型 ----------
class ProjectCreateRequest(BaseModel):
    name: str
    version: str = "v2Pro"
    language: str = "zh"

class ProjectSwitchRequest(BaseModel):
    name: str

class AnnotateLoadRequest(BaseModel):
    list_file: str

class AnnotateDeleteRequest(BaseModel):
    ids: List[int]

class AnnotateEditRequest(BaseModel):
    id: int
    text: Optional[str] = None
    speaker_name: Optional[str] = None
    language: Optional[str] = None

class SliceStartRequest(BaseModel):
    input_path: str = ""           # 输入文件/文件夹路径（空 = 使用上传目录）
    preset: str = "recommended"    # recommended / fine / coarse / custom
    threshold: float = -34
    min_length: int = 4000
    min_interval: int = 300
    hop_size: int = 10
    max_sil_kept: int = 500
    normalize_max: float = 0.9
    alpha: float = 0.25

class AsrStartRequest(BaseModel):
    engine: str = "funasr"          # funasr / fasterwhisper
    language: str = "zh"            # zh / en / ja / auto ...
    model_size: str = "large-v3"    # Whisper 模型大小
    precision: str = "float16"      # float16 / float32 / int8
    input_dir: str = ""             # 可选，输入音频目录

class FormatStartRequest(BaseModel):
    inp_text: str = ""              # 可选，.list 文件路径（默认自动取 ASR 产出）
    inp_wav_dir: str = ""           # 可选，音频目录（默认自动取切分产出）

class TrainStartRequest(BaseModel):
    target: str = "sovits"          # sovits / gpt
    batch_size: int = 0             # 0 = 自动推荐
    total_epochs: int = 0           # 0 = 使用推荐值
    save_every_epoch: int = 0       # 0 = 使用推荐值
    if_save_latest: bool = True
    if_save_every_weights: bool = True
    # SoVITS only
    text_low_lr_rate: float = 0.4
    if_grad_ckpt: bool = False
    lora_rank: int = 0
    # GPT only
    if_dpo: bool = False

class DeployConfigRequest(BaseModel):
    gsvi_path: str

class AnnotateRefTagRequest(BaseModel):
    id: int
    is_ref: bool
    emotion: str = "default"

class RefTagBatchUpdateItem(BaseModel):
    id: int
    emotion: str

class RefTagBatchUpdateRequest(BaseModel):
    updates: List[RefTagBatchUpdateItem]

class ConcatRefRequest(BaseModel):
    emotion: str
    target_duration: float = 5.0  # 3~9 seconds


# ============================================================
#  项目管理 API
# ============================================================

@app.get("/api/project/list")
async def api_project_list():
    """返回所有项目"""
    projects = list_all_projects()
    return {
        "projects": projects,
        "active_project": panel_state.get("active_project"),
    }


@app.post("/api/project/create")
async def api_project_create(req: ProjectCreateRequest):
    """创建新项目"""
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "项目名称不能为空")
    if any(c in name for c in r'\/:*?"<>|'):
        raise HTTPException(400, "项目名称包含非法字符")

    proj_dir = get_project_dir(name)
    if os.path.exists(proj_dir):
        raise HTTPException(409, f"项目 '{name}' 已存在")

    os.makedirs(proj_dir, exist_ok=True)

    meta = copy.deepcopy(DEFAULT_PROJECT_META)
    meta["name"] = name
    meta["version"] = req.version if req.version in SUPPORTED_VERSIONS else "v2Pro"
    meta["language"] = req.language if req.language in ("zh", "en", "ja", "yue", "ko") else "zh"
    meta["created_at"] = datetime.now().isoformat()
    save_project_meta(name, meta)

    # 自动切换到新项目
    panel_state["active_project"] = name
    save_panel_state()

    return {"success": True, "project": meta}


@app.get("/api/project/{name}")
async def api_project_detail(name: str):
    """获取项目详情"""
    proj_dir = get_project_dir(name)
    if not os.path.isdir(proj_dir):
        raise HTTPException(404, f"项目 '{name}' 不存在")
    meta = load_project_meta(name)
    return {"project": meta}


@app.post("/api/project/switch")
async def api_project_switch(req: ProjectSwitchRequest):
    """切换当前活跃项目"""
    name = req.name.strip()
    proj_dir = get_project_dir(name)
    if not os.path.isdir(proj_dir):
        raise HTTPException(404, f"项目 '{name}' 不存在")

    panel_state["active_project"] = name
    save_panel_state()
    meta = load_project_meta(name)
    return {"success": True, "project": meta}


class ProjectUpdateRequest(BaseModel):
    language: str = ""


@app.post("/api/project/{name}/update")
async def api_project_update(name: str, req: ProjectUpdateRequest):
    """更新项目设置（语言）"""
    proj_dir = get_project_dir(name)
    if not os.path.isdir(proj_dir):
        raise HTTPException(404, f"项目 '{name}' 不存在")

    allowed = ("zh", "en", "ja", "yue", "ko")
    if req.language not in allowed:
        raise HTTPException(400, f"不支持的语言: {req.language}")

    meta = load_project_meta(name)
    meta["language"] = req.language
    save_project_meta(name, meta)

    return {"success": True, "language": req.language}


@app.delete("/api/project/{name}")
async def api_project_delete(name: str, delete_data: bool = False):
    """删除项目。delete_data=True 时同时删除整个项目目录及训练数据"""
    proj_dir = get_project_dir(name)
    if not os.path.isdir(proj_dir):
        raise HTTPException(404, f"项目 '{name}' 不存在")

    if delete_data:
        shutil.rmtree(proj_dir)
    else:
        meta_path = get_project_meta_path(name)
        if os.path.isfile(meta_path):
            os.remove(meta_path)

    if panel_state.get("active_project") == name:
        panel_state["active_project"] = None
        save_panel_state()
    return {"success": True}


@app.get("/api/versions")
async def api_versions():
    """返回支持的版本列表"""
    return {"versions": SUPPORTED_VERSIONS}


@app.post("/api/project/import")
async def api_project_import(file: UploadFile = File(...)):
    """从 zip 归档导入项目到 logs/ 目录"""
    if not file.filename.lower().endswith(".zip"):
        raise HTTPException(400, "仅支持 .zip 格式")

    # 写入临时文件
    with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
        tmp_path = tmp.name
        content = await file.read()
        tmp.write(content)

    try:
        with zipfile.ZipFile(tmp_path, "r") as zf:
            # 找顶层目录名
            top_dirs = set()
            for info in zf.infolist():
                parts = info.filename.replace("\\", "/").split("/")
                if parts[0]:
                    top_dirs.add(parts[0])

            if len(top_dirs) != 1:
                raise HTTPException(
                    400,
                    f"zip 文件应包含且仅包含一个顶层文件夹（项目），发现 {len(top_dirs)} 个: {', '.join(top_dirs)}"
                )

            project_name = top_dirs.pop()
            proj_dir = get_project_dir(project_name)

            if os.path.isdir(proj_dir):
                raise HTTPException(409, f"项目 '{project_name}' 已存在，请先删除同名项目再导入")

            zf.extractall(LOGS_DIR)

        # 加载元数据（自动检测状态）
        meta = load_project_meta(project_name)

        return {"success": True, "project": meta}
    finally:
        os.unlink(tmp_path)


@app.get("/api/project/{name}/export")
async def api_project_export(name: str):
    """导出项目为 zip 归档下载"""
    proj_dir = get_project_dir(name)
    if not os.path.isdir(proj_dir):
        raise HTTPException(404, f"项目 '{name}' 不存在")

    # 打包到临时文件
    tmp_dir = tempfile.mkdtemp()
    try:
        archive_base = os.path.join(tmp_dir, name)
        archive_path = shutil.make_archive(archive_base, "zip", LOGS_DIR, name)
        return FileResponse(
            archive_path,
            media_type="application/zip",
            filename=f"{name}.zip",
            # 注意：FileResponse 不会自动清理临时文件
            # 但 Windows 上 NamedTemporaryFile 需手动删除
            # 实际使用中临时文件会在下次导出时被覆盖
        )
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(500, f"导出失败: {str(e)}")


# ============================================================
#  文件浏览 API（原生文件选择对话框）
# ============================================================

@app.get("/api/file/browse")
async def api_file_browse(
    title: str = "选择文件",
    filetypes: str = "",
    initialdir: str = "",
):
    """打开系统原生文件选择对话框，返回用户选择的文件路径。
    filetypes 格式: "描述1|*.ext1;*.ext2||描述2|*.ext3" （用 || 分隔多组）
    """
    import tkinter as tk
    from tkinter import filedialog

    # 在独立线程中运行 tkinter 对话框，避免阻塞事件循环
    result = {"path": ""}

    def _open_dialog():
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)

        # 解析 filetypes
        ft_list = []
        if filetypes:
            for group in filetypes.split("||"):
                parts = group.split("|", 1)
                if len(parts) == 2:
                    ft_list.append((parts[0], parts[1]))
        if not ft_list:
            ft_list = [("所有文件", "*.*")]

        kwargs = {"title": title, "filetypes": ft_list}
        if initialdir and os.path.isdir(initialdir):
            kwargs["initialdir"] = initialdir

        path = filedialog.askopenfilename(**kwargs)
        root.destroy()
        result["path"] = path or ""

    t = threading.Thread(target=_open_dialog, daemon=True)
    t.start()
    t.join(timeout=300)

    if not result["path"]:
        return {"path": "", "cancelled": True}
    return {"path": result["path"], "cancelled": False}


@app.get("/api/file/browse_dir")
async def api_file_browse_dir(
    title: str = "选择文件夹",
    initialdir: str = "",
):
    """打开系统原生文件夹选择对话框，返回用户选择的文件夹路径。"""
    import tkinter as tk
    from tkinter import filedialog

    result = {"path": ""}

    def _open_dialog():
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)

        kwargs = {"title": title}
        if initialdir and os.path.isdir(initialdir):
            kwargs["initialdir"] = initialdir

        path = filedialog.askdirectory(**kwargs)
        root.destroy()
        result["path"] = path or ""

    t = threading.Thread(target=_open_dialog, daemon=True)
    t.start()
    t.join(timeout=300)

    if not result["path"]:
        return {"path": "", "cancelled": True}
    return {"path": result["path"], "cancelled": False}


# ============================================================
#  标注 API（复用 audio_tool_server.py 逻辑）
# ============================================================

@app.post("/api/annotate/load")
async def api_annotate_load(req: AnnotateLoadRequest):
    """加载 .list 文件到标注模块"""
    list_file = req.list_file.strip().strip('"')

    # 处理 file:/// URI
    if list_file.startswith("file:///"):
        list_file = list_file[8:]
    elif list_file.startswith("file://"):
        list_file = list_file[7:]
    from urllib.parse import unquote
    list_file = unquote(list_file)
    list_file = list_file.replace("/", os.sep)
    list_file = os.path.abspath(list_file)

    if not os.path.isfile(list_file):
        raise HTTPException(404, f"文件不存在: {list_file}")

    annotate_state["list_file"] = list_file
    annotate_state["entries"] = load_list_file(list_file)
    annotate_state["undo_stack"] = []

    return {
        "success": True,
        "total": len(annotate_state["entries"]),
        "file": list_file,
    }


@app.get("/api/annotate/entries")
async def api_annotate_entries():
    """返回所有标注条目"""
    return {
        "entries": annotate_state["entries"],
        "total": len(annotate_state["entries"]),
        "file": annotate_state["list_file"],
    }


@app.get("/api/annotate/stats")
async def api_annotate_stats():
    """返回标注统计信息"""
    entries = annotate_state["entries"]
    if not entries:
        return {"total": 0, "min_duration": 0, "max_duration": 0, "avg_duration": 0}
    durations = [e["duration"] for e in entries]
    return {
        "total": len(entries),
        "min_duration": min(durations),
        "max_duration": max(durations),
        "avg_duration": round(sum(durations) / len(durations), 2),
    }


@app.post("/api/annotate/delete")
async def api_annotate_delete(req: AnnotateDeleteRequest):
    """批量删除标注条目"""
    push_undo()
    ids_to_delete = set(req.ids)
    annotate_state["entries"] = [
        e for e in annotate_state["entries"] if e["id"] not in ids_to_delete
    ]
    for i, entry in enumerate(annotate_state["entries"]):
        entry["id"] = i
    save_list_file(annotate_state["list_file"], annotate_state["entries"])
    return {"success": True, "remaining": len(annotate_state["entries"])}


@app.post("/api/annotate/edit")
async def api_annotate_edit(req: AnnotateEditRequest):
    """编辑单条标注条目"""
    push_undo()
    for entry in annotate_state["entries"]:
        if entry["id"] == req.id:
            if req.text is not None:
                entry["text"] = req.text
            if req.speaker_name is not None:
                entry["speaker_name"] = req.speaker_name
            if req.language is not None:
                entry["language"] = req.language
            save_list_file(annotate_state["list_file"], annotate_state["entries"])
            return {"success": True, "entry": entry}
    raise HTTPException(404, "Entry not found")


@app.post("/api/annotate/undo")
async def api_annotate_undo():
    """撤销上次标注操作"""
    if not annotate_state["undo_stack"]:
        raise HTTPException(400, "Nothing to undo")
    annotate_state["entries"] = annotate_state["undo_stack"].pop()
    for i, entry in enumerate(annotate_state["entries"]):
        entry["id"] = i
    save_list_file(annotate_state["list_file"], annotate_state["entries"])
    return {"success": True, "total": len(annotate_state["entries"])}


@app.get("/api/annotate/audio")
async def api_annotate_audio(path: str):
    """提供音频文件"""
    if not os.path.isfile(path):
        raise HTTPException(404, f"Audio file not found: {path}")
    content_type = mimetypes.guess_type(path)[0] or "audio/wav"
    return FileResponse(path, media_type=content_type)


# ============================================================
#  参考音频标签 API（ref_tags.json）
# ============================================================

def _ref_tags_path() -> str:
    """返回当前项目的 ref_tags.json 路径"""
    project = panel_state.get("active_project", "")
    if not project:
        return ""
    return os.path.join(LOGS_DIR, project, "ref_tags.json")


def _load_ref_tags() -> dict:
    """加载 ref_tags.json"""
    path = _ref_tags_path()
    if path and os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_ref_tags(tags: dict):
    """保存 ref_tags.json"""
    path = _ref_tags_path()
    if not path:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(tags, f, ensure_ascii=False, indent=2)


@app.post("/api/annotate/ref_tag")
async def api_annotate_ref_tag(req: AnnotateRefTagRequest):
    """标记/取消标记某条目为参考音频，设置情感标签"""
    project = panel_state.get("active_project", "")
    if not project:
        raise HTTPException(400, "未选择活跃项目")

    tags = _load_ref_tags()
    entry_key = str(req.id)

    if not req.is_ref:
        # 取消标记
        tags.pop(entry_key, None)
        _save_ref_tags(tags)
        return {"success": True, "action": "removed", "id": req.id}

    # 标记为参考音频 — 从 annotate_state 获取条目信息
    entry = None
    for e in annotate_state["entries"]:
        if e["id"] == req.id:
            entry = e
            break

    if not entry:
        raise HTTPException(404, f"条目 {req.id} 不存在")

    tags[entry_key] = {
        "emotion": req.emotion.strip() or "default",
        "wav_path": entry["wav_path"],
        "text": entry["text"],
        "lang": entry.get("language", "zh"),
        "duration": entry.get("duration", 0),
    }
    _save_ref_tags(tags)
    return {"success": True, "action": "tagged", "id": req.id, "emotion": tags[entry_key]["emotion"]}


@app.get("/api/annotate/ref_tags")
async def api_annotate_ref_tags():
    """返回当前项目已标记的所有参考音频标签"""
    project = panel_state.get("active_project", "")
    if not project:
        return {"tags": {}}
    return {"tags": _load_ref_tags()}


@app.post("/api/annotate/ref_tag/batch_update")
async def api_annotate_ref_tag_batch_update(req: RefTagBatchUpdateRequest):
    """批量更新参考音频的情感标签"""
    project = panel_state.get("active_project", "")
    if not project:
        raise HTTPException(400, "未选择活跃项目")

    tags = _load_ref_tags()
    updated = []
    for item in req.updates:
        key = str(item.id)
        if key in tags:
            tags[key]["emotion"] = item.emotion.strip() or "default"
            updated.append(item.id)
    _save_ref_tags(tags)
    return {"success": True, "updated": updated}


@app.delete("/api/annotate/ref_tag/{entry_id}")
async def api_annotate_ref_tag_delete(entry_id: int):
    """从 ref_tags.json 中删除一条参考音频标记"""
    project = panel_state.get("active_project", "")
    if not project:
        raise HTTPException(400, "未选择活跃项目")

    tags = _load_ref_tags()
    key = str(entry_id)
    if key not in tags:
        raise HTTPException(404, f"参考音频标记 {entry_id} 不存在")

    del tags[key]
    _save_ref_tags(tags)
    return {"success": True, "deleted_id": entry_id}


@app.post("/api/annotate/extract_ref")
async def api_annotate_extract_ref(req: dict = Body(...)):
    """提取已标记的参考音频到 ref_audio/ 目录，可选从训练集移除"""
    project = panel_state.get("active_project", "")
    if not project:
        raise HTTPException(400, "未选择活跃项目")

    tags = _load_ref_tags()
    if not tags:
        raise HTTPException(400, "没有已标记的参考音频")

    remove_from_training = req.get("remove_from_training", False)
    os.makedirs(REF_AUDIO_DIR, exist_ok=True)

    extracted = []      # 成功提取的条目
    ids_to_remove = []  # 需从训练集移除的 entry id
    errors = []

    for entry_key, info in tags.items():
        wav_path = info.get("wav_path", "")
        text = info.get("text", "")
        emotion = info.get("emotion", "default")

        if not wav_path or not os.path.isfile(wav_path):
            errors.append(f"文件不存在: {wav_path}")
            continue

        # 生成目标文件名: {emotion}_{序号}.wav
        safe_emotion = "".join(c for c in emotion if c.isalnum() or c in "_-") or "default"
        counter = 1
        out_name = f"{safe_emotion}_{counter}.wav"
        out_path = os.path.join(REF_AUDIO_DIR, out_name)
        while os.path.isfile(out_path):
            counter += 1
            out_name = f"{safe_emotion}_{counter}.wav"
            out_path = os.path.join(REF_AUDIO_DIR, out_name)

        try:
            import shutil
            shutil.copy2(wav_path, out_path)

            # 写入对应 .txt 文件
            txt_path = os.path.splitext(out_path)[0] + ".txt"
            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(text)

            extracted.append({
                "emotion": emotion,
                "filename": out_name,
                "text": text[:50],
            })

            # 记录需移除的 entry id
            if remove_from_training:
                try:
                    ids_to_remove.append(int(entry_key))
                except ValueError:
                    pass

        except Exception as e:
            errors.append(f"提取失败 ({emotion}): {str(e)}")

    # 从训练集移除
    removed_count = 0
    if remove_from_training and ids_to_remove:
        push_undo()
        ids_set = set(ids_to_remove)
        before = len(annotate_state["entries"])
        annotate_state["entries"] = [
            e for e in annotate_state["entries"] if e["id"] not in ids_set
        ]
        removed_count = before - len(annotate_state["entries"])
        # 重新编号
        for i, entry in enumerate(annotate_state["entries"]):
            entry["id"] = i
        save_list_file(annotate_state["list_file"], annotate_state["entries"])

    return {
        "success": True,
        "extracted": len(extracted),
        "removed_from_training": removed_count,
        "details": extracted,
        "errors": errors,
    }


# ============================================================
#  音频质检分析 — Phase A
# ============================================================

analyze_task = {
    "status": "idle",       # idle / running / done / error
    "progress": 0,          # 0-100
    "total": 0,
    "processed": 0,
    "results": {},          # id_str -> [list of issue tags]
    "summary": {},          # tag -> count
    "error": "",
}


def _analyze_audio_file(wav_path: str, global_stats: dict = None) -> list:
    """
    分析单个音频文件的信号质量，返回问题标签列表。
    使用 numpy + scipy（已导入），不引入新依赖。

    global_stats: 包含全局统计信息（rms_mean, rms_median, rms_q1, rms_q3, rms_iqr）
                  用于相对阈值判定。
    """
    issues = []
    try:
        sr, data = wavfile.read(wav_path)
    except Exception:
        return ["read_error"]

    # 转为 float64 归一化到 [-1, 1]
    if data.dtype == np.int16:
        samples = data.astype(np.float64) / 32768.0
    elif data.dtype == np.int32:
        samples = data.astype(np.float64) / 2147483648.0
    elif data.dtype == np.float32 or data.dtype == np.float64:
        samples = data.astype(np.float64)
    else:
        samples = data.astype(np.float64)
        max_val = np.max(np.abs(samples))
        if max_val > 0:
            samples = samples / max_val

    # 单声道
    if samples.ndim > 1:
        samples = np.mean(samples, axis=1)

    if len(samples) == 0:
        return ["empty"]

    abs_samples = np.abs(samples)
    peak = np.max(abs_samples)
    rms = np.sqrt(np.mean(samples ** 2))

    # --- 1. 削波/爆音 (clipping) ---
    # 方案：采样值 > 0.98 的占比 > 0.1% 即标记
    # 正常录音即使音量较大，也很少持续超过 0.98
    clip_ratio = np.sum(abs_samples > 0.98) / len(samples)
    if clip_ratio > 0.001:
        issues.append("clipping")

    # --- 2. 绝对音量判定 ---
    # RMS 转 dBFS：dBFS = 20 * log10(rms)
    # 绝对过大：RMS > -10 dBFS（约 0.316）→ 录音整体过响
    # 绝对过低：RMS < -40 dBFS（约 0.01）→ 几乎静音
    if rms > 0:
        dbfs = 20 * np.log10(rms)
        if dbfs > -10:
            issues.append("loud")
        elif dbfs < -40:
            issues.append("silent")

    # --- 3. 相对音量判定（基于全局统计 IQR 离群检测）---
    # 只在绝对判定未触发时使用。使用 IQR 方法：
    # loud: RMS > Q3 + 1.5 * IQR 或 > 全局均值 * 2.0
    # silent: RMS < Q1 - 1.5 * IQR 或 < 全局均值 * 0.25
    if global_stats and "loud" not in issues and "silent" not in issues:
        gs = global_stats
        if gs.get("rms_iqr", 0) > 0:
            upper_fence = gs["rms_q3"] + 1.5 * gs["rms_iqr"]
            lower_fence = gs["rms_q1"] - 1.5 * gs["rms_iqr"]
            if rms > upper_fence:
                issues.append("loud")
            elif rms < max(lower_fence, 0.001):
                issues.append("silent")
        # 后备：简单倍数法
        if gs.get("rms_mean", 0) > 0 and "loud" not in issues and "silent" not in issues:
            if rms > gs["rms_mean"] * 2.0:
                issues.append("loud")
            elif rms < gs["rms_mean"] * 0.25:
                issues.append("silent")

    # --- 4. 峰值尖刺 (spike) ---
    # Crest factor = peak / rms，正常语音约 3-10
    # > 15 表示有突发的巨大尖刺（如敲击、口水音等）
    if rms > 0.001:
        crest_factor = peak / rms
        if crest_factor > 15:
            issues.append("spike")

    # --- 5. DC 偏移 (dc_offset) ---
    # 正常录音的 DC 偏移接近 0。> 5% 表示麦克风或声卡有问题
    dc_offset = abs(np.mean(samples))
    if dc_offset > 0.05:
        issues.append("dc_offset")

    # --- 6. 频谱分析（muffled 检测）---
    from scipy.fft import rfft, rfftfreq
    n = len(samples)
    fft_mag = np.abs(rfft(samples))
    freqs = rfftfreq(n, d=1.0 / sr)

    # 闷声判定需要同时满足两个条件：
    #  ① 高频能量占比极低（4kHz+ < 1%）
    #  ② 频谱重心（spectral centroid）低于 500Hz
    # 正常语音高频占比通常 2-8%，重心通常 800-2000Hz。
    # 只有真正缺乏高频的录音（如隔墙录音、被子捂着）才会同时满足。
    high_mask = freqs >= 4000
    total_energy = np.sum(fft_mag ** 2)
    if total_energy > 0:
        high_energy_ratio = np.sum(fft_mag[high_mask] ** 2) / total_energy
        spectral_centroid = np.sum(freqs * fft_mag ** 2) / total_energy
        if high_energy_ratio < 0.01 and spectral_centroid < 500:
            issues.append("muffled")

    # --- 7. 简易 SNR（语音段 vs 静音段）---
    # 分帧计算能量
    frame_len = int(sr * 0.025)  # 25ms 帧
    hop = int(sr * 0.010)        # 10ms 步长
    if frame_len > 0 and len(samples) > frame_len:
        num_frames = (len(samples) - frame_len) // hop + 1
        frame_energies = np.array([
            np.mean(samples[i * hop: i * hop + frame_len] ** 2)
            for i in range(num_frames)
        ])
        if len(frame_energies) > 0:
            energy_threshold = np.mean(frame_energies) * 0.1
            speech_frames = frame_energies[frame_energies > energy_threshold]
            silence_frames = frame_energies[frame_energies <= energy_threshold]

            if len(silence_frames) > 0 and len(speech_frames) > 0:
                mean_speech = np.mean(speech_frames)
                mean_silence = np.mean(silence_frames)
                if mean_silence > 0:
                    snr = 10 * np.log10(mean_speech / mean_silence)
                    if snr < 10:
                        issues.append("noisy")

    return issues


def _run_analysis_task():
    """后台线程：分析所有 annotate 条目"""
    entries = list(annotate_state["entries"])  # snapshot
    analyze_task["total"] = len(entries)
    analyze_task["processed"] = 0
    analyze_task["results"] = {}
    analyze_task["summary"] = {}
    analyze_task["error"] = ""

    if not entries:
        analyze_task["status"] = "done"
        analyze_task["progress"] = 100
        return

    # 第一遍：收集所有 RMS 值用于相对阈值
    rms_values = []
    for entry in entries:
        try:
            sr, data = wavfile.read(entry["wav_path"])
            if data.dtype == np.int16:
                s = data.astype(np.float64) / 32768.0
            elif data.dtype == np.int32:
                s = data.astype(np.float64) / 2147483648.0
            else:
                s = data.astype(np.float64)
                mx = np.max(np.abs(s))
                if mx > 0:
                    s = s / mx
            if s.ndim > 1:
                s = np.mean(s, axis=1)
            rms_values.append(np.sqrt(np.mean(s ** 2)))
        except Exception:
            rms_values.append(0.0)

    # 计算全局统计量（均值 + IQR）
    rms_arr = np.array(rms_values)
    valid_rms = rms_arr[rms_arr > 0]
    global_stats = {}
    if len(valid_rms) > 0:
        global_stats = {
            "rms_mean": float(np.mean(valid_rms)),
            "rms_median": float(np.median(valid_rms)),
            "rms_q1": float(np.percentile(valid_rms, 25)),
            "rms_q3": float(np.percentile(valid_rms, 75)),
        }
        global_stats["rms_iqr"] = global_stats["rms_q3"] - global_stats["rms_q1"]

    # 第二遍：逐个分析
    all_results = {}
    tag_counts = {}
    for idx, entry in enumerate(entries):
        if analyze_task["status"] != "running":
            return  # cancelled
        try:
            issues = _analyze_audio_file(entry["wav_path"], global_stats)

            if issues:
                all_results[str(entry["id"])] = issues
                for tag in issues:
                    tag_counts[tag] = tag_counts.get(tag, 0) + 1
        except Exception:
            all_results[str(entry["id"])] = ["analyze_error"]
            tag_counts["analyze_error"] = tag_counts.get("analyze_error", 0) + 1

        analyze_task["processed"] = idx + 1
        analyze_task["progress"] = int((idx + 1) / len(entries) * 100)

    analyze_task["results"] = all_results
    analyze_task["summary"] = tag_counts
    analyze_task["status"] = "done"
    analyze_task["progress"] = 100

    # 保存到项目目录
    project = panel_state.get("active_project", "")
    if project:
        analysis_path = os.path.join(LOGS_DIR, project, "audio_analysis.json")
        try:
            with open(analysis_path, "w", encoding="utf-8") as f:
                json.dump({
                    "results": all_results,
                    "summary": tag_counts,
                    "total_analyzed": len(entries),
                }, f, ensure_ascii=False, indent=2)
        except Exception:
            pass


@app.post("/api/annotate/analyze")
async def api_annotate_analyze():
    """启动后台音频质检分析"""
    if analyze_task["status"] == "running":
        raise HTTPException(409, "分析任务正在运行中")

    if not annotate_state["entries"]:
        raise HTTPException(400, "没有已加载的标注条目可供分析")

    analyze_task["status"] = "running"
    analyze_task["progress"] = 0
    t = threading.Thread(target=_run_analysis_task, daemon=True)
    t.start()
    return {"success": True, "total": len(annotate_state["entries"])}


@app.get("/api/annotate/analyze/status")
async def api_annotate_analyze_status():
    """轮询质检分析进度和结果"""
    return {
        "status": analyze_task["status"],
        "progress": analyze_task["progress"],
        "total": analyze_task["total"],
        "processed": analyze_task["processed"],
        "results": analyze_task["results"] if analyze_task["status"] == "done" else {},
        "summary": analyze_task["summary"] if analyze_task["status"] == "done" else {},
        "error": analyze_task["error"],
    }


# ============================================================
#  短音频拼接器 — Phase C
# ============================================================

@app.get("/api/annotate/ref_concat_preview")
async def api_annotate_ref_concat_preview():
    """按情感标签分组，返回可拼接的短音频列表及预估时长"""
    project = panel_state.get("active_project", "")
    if not project:
        raise HTTPException(400, "未选择活跃项目")

    tags = _load_ref_tags()
    if not tags:
        return {"groups": {}}

    groups = {}  # emotion -> { clips: [...], total_duration, count }
    for entry_key, info in tags.items():
        emotion = info.get("emotion", "default")
        duration = info.get("duration", 0)
        wav_path = info.get("wav_path", "")
        text = info.get("text", "")

        # 跳过时长 >= 9s 的条目（已经足够长了）
        if duration >= 9:
            continue
        # 跳过不存在的文件
        if not os.path.isfile(wav_path):
            continue

        if emotion not in groups:
            groups[emotion] = {"clips": [], "total_duration": 0, "count": 0}

        groups[emotion]["clips"].append({
            "id": int(entry_key),
            "wav_path": wav_path,
            "text": text,
            "duration": duration,
        })
        groups[emotion]["total_duration"] = round(
            groups[emotion]["total_duration"] + duration, 2
        )
        groups[emotion]["count"] += 1

    # 按时长从长到短排序每组的 clips
    for emotion in groups:
        groups[emotion]["clips"].sort(key=lambda c: c["duration"], reverse=True)

    return {"groups": groups}


@app.post("/api/annotate/concat_ref")
async def api_annotate_concat_ref(req: ConcatRefRequest):
    """将同情感标签的短音频拼接为参考音频"""
    project = panel_state.get("active_project", "")
    if not project:
        raise HTTPException(400, "未选择活跃项目")

    emotion = req.emotion.strip()
    if not emotion:
        raise HTTPException(400, "情感标签不能为空")

    target = max(3.0, min(9.0, req.target_duration))

    # 收集同情感的短音频
    tags = _load_ref_tags()
    candidates = []
    for entry_key, info in tags.items():
        if info.get("emotion", "default") != emotion:
            continue
        dur = info.get("duration", 0)
        wav = info.get("wav_path", "")
        if dur <= 0 or dur >= 9 or not os.path.isfile(wav):
            continue
        candidates.append({
            "id": int(entry_key),
            "wav_path": wav,
            "text": info.get("text", ""),
            "duration": dur,
        })

    if not candidates:
        raise HTTPException(404, f"没有找到情感 '{emotion}' 的可拼接短音频")

    # 按时长从长到短排序
    candidates.sort(key=lambda c: c["duration"], reverse=True)

    # 贪心选择：凑到目标时长（±0.5s 容差）
    SILENCE_DURATION = 0.2  # 200ms 静音
    selected = []
    accumulated = 0.0

    for clip in candidates:
        if accumulated >= target - 0.5:
            break
        gap = SILENCE_DURATION if selected else 0
        accumulated += clip["duration"] + gap
        selected.append(clip)

    if not selected:
        raise HTTPException(400, "无法凑出足够时长的拼接音频")

    # 单条音频重复补足目标时长
    if len(selected) == 1 and accumulated < target - 0.5:
        single = selected[0]
        while accumulated < target - 0.5:
            gap = SILENCE_DURATION
            accumulated += single["duration"] + gap
            selected.append(single)  # 重复同一条

    # 读取音频并拼接
    try:
        segments = []
        target_sr = None
        texts = []

        for i, clip in enumerate(selected):
            sr, data = wavfile.read(clip["wav_path"])
            if target_sr is None:
                target_sr = sr

            # 转为 float64
            if data.dtype == np.int16:
                samples = data.astype(np.float64) / 32768.0
            elif data.dtype == np.int32:
                samples = data.astype(np.float64) / 2147483648.0
            elif data.dtype == np.float32 or data.dtype == np.float64:
                samples = data.astype(np.float64)
            else:
                samples = data.astype(np.float64)
                mx = np.max(np.abs(samples))
                if mx > 0:
                    samples = samples / mx

            # 单声道
            if samples.ndim > 1:
                samples = np.mean(samples, axis=1)

            # 重采样到第一个文件的采样率（简易方式）
            if sr != target_sr and target_sr > 0:
                ratio = target_sr / sr
                new_len = int(len(samples) * ratio)
                indices = np.linspace(0, len(samples) - 1, new_len)
                samples = np.interp(indices, np.arange(len(samples)), samples)

            # 插入静音间隔
            if i > 0:
                silence = np.zeros(int(target_sr * SILENCE_DURATION))
                segments.append(silence)

            segments.append(samples)
            texts.append(clip["text"])

        # 拼接
        concat_audio = np.concatenate(segments)
        final_duration = round(len(concat_audio) / target_sr, 2)

        # 归一化到 int16 范围
        peak = np.max(np.abs(concat_audio))
        if peak > 0:
            concat_audio = concat_audio / peak * 0.9
        concat_int16 = (concat_audio * 32767).astype(np.int16)

        # 写入 ref_audio/ 目录
        os.makedirs(REF_AUDIO_DIR, exist_ok=True)
        safe_emotion = "".join(c for c in emotion if c.isalnum() or c in "_-")
        out_name = f"{safe_emotion}_concat.wav"
        out_path = os.path.join(REF_AUDIO_DIR, out_name)

        # 如果同名存在，加序号
        if os.path.isfile(out_path):
            counter = 1
            while os.path.isfile(out_path):
                out_name = f"{safe_emotion}_concat_{counter}.wav"
                out_path = os.path.join(REF_AUDIO_DIR, out_name)
                counter += 1

        wavfile.write(out_path, target_sr, concat_int16)

        # 写入对应 .txt 文件
        txt_path = os.path.splitext(out_path)[0] + ".txt"
        combined_text = "，".join(texts)
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(combined_text)

        return {
            "success": True,
            "path": out_path,
            "filename": out_name,
            "duration": final_duration,
            "clips_used": len(selected),
            "text": combined_text,
        }

    except Exception as e:
        raise HTTPException(500, f"拼接失败: {str(e)}")


# ============================================================
#  音频切分 — 状态 & 工具函数
# ============================================================
SLICE_PRESETS = {
    "recommended": {"threshold": -34, "min_length": 4000, "min_interval": 300, "hop_size": 10, "max_sil_kept": 500},
    "fine":        {"threshold": -30, "min_length": 2000, "min_interval": 200, "hop_size": 10, "max_sil_kept": 300},
    "coarse":      {"threshold": -40, "min_length": 8000, "min_interval": 500, "hop_size": 10, "max_sil_kept": 1000},
}

slice_task = {
    "status": "idle",        # idle / running / done / error
    "progress": 0,           # 0-100
    "current_file": "",
    "total_files": 0,
    "processed_files": 0,
    "output_dir": "",
    "logs": [],              # 最近日志行
    "error": "",
}
MAX_SLICE_LOGS = 200


# ============================================================
#  ASR 语音识别 — 状态 & 工具函数
# ============================================================
asr_task = {
    "status": "idle",        # idle / running / done / error
    "phase": "",             # collecting / downloading / loading / recognizing / saving
    "phase_tip": "",         # 用户友好的中文提示
    "progress": 0,           # 0-100
    "current_file": "",
    "total_files": 0,
    "processed_files": 0,
    "output_file": "",       # 生成的 .list 文件路径
    "logs": [],
    "error": "",
}
MAX_ASR_LOGS = 200


def _asr_log(msg: str):
    """添加一条 ASR 日志"""
    asr_task["logs"].append(msg)
    if len(asr_task["logs"]) > MAX_ASR_LOGS:
        asr_task["logs"] = asr_task["logs"][-MAX_ASR_LOGS:]


def _run_asr_task(input_dir: str, output_dir: str, project_name: str,
                  engine: str, language: str, model_size: str, precision: str):
    """ASR 工作线程"""
    try:
        # ── 阶段 1: 收集音频文件 ──
        asr_task["phase"] = "collecting"
        asr_task["phase_tip"] = "正在扫描音频文件…"
        audio_exts = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}
        if not os.path.isdir(input_dir):
            asr_task["status"] = "error"
            asr_task["error"] = f"输入目录不存在: {input_dir}"
            return

        input_files = [
            os.path.join(input_dir, f)
            for f in sorted(os.listdir(input_dir))
            if os.path.splitext(f)[1].lower() in audio_exts
        ]

        if not input_files:
            asr_task["status"] = "error"
            asr_task["error"] = "输入目录中没有找到音频文件"
            return

        asr_task["total_files"] = len(input_files)
        _asr_log(f"找到 {len(input_files)} 个音频文件")
        _asr_log(f"引擎: {engine} | 语言: {language}")

        os.makedirs(output_dir, exist_ok=True)
        output_file_name = os.path.basename(input_dir)
        output_lines = []

        if engine == "funasr":
            # ── 阶段 2: 加载模型 ──
            asr_task["phase"] = "loading"
            asr_task["phase_tip"] = "正在加载 FunASR 模型到内存，请稍候…"
            _asr_log("正在加载 FunASR 模型…")
            tools_dir = os.path.join(BASE_DIR, "tools")
            asr_dir = os.path.join(tools_dir, "asr")
            if asr_dir not in sys.path:
                sys.path.insert(0, asr_dir)
            if tools_dir not in sys.path:
                sys.path.insert(0, tools_dir)

            from funasr_asr import create_model as create_funasr_model
            asr_lang = language if language in ["zh", "yue"] else "zh"
            model = create_funasr_model(asr_lang)
            _asr_log("FunASR 模型已加载")

            # ── 阶段 3: 逐文件识别 ──
            asr_task["phase"] = "recognizing"
            asr_task["phase_tip"] = "正在逐个识别音频文件…"
            for idx, file_path in enumerate(input_files):
                asr_task["processed_files"] = idx
                asr_task["current_file"] = os.path.basename(file_path)
                asr_task["progress"] = int((idx / len(input_files)) * 100)
                asr_task["phase_tip"] = f"正在识别第 {idx+1}/{len(input_files)} 个文件"

                try:
                    text = model.generate(input=file_path)[0]["text"]
                    output_lines.append(
                        f"{file_path}|{output_file_name}|{asr_lang.upper()}|{text}"
                    )
                    _asr_log(f"[{idx+1}/{len(input_files)}] {os.path.basename(file_path)}")
                except Exception:
                    err = traceback.format_exc()
                    _asr_log(f"[{idx+1}/{len(input_files)}] 出错: {err}")

        elif engine == "fasterwhisper":
            tools_dir = os.path.join(BASE_DIR, "tools")
            asr_dir = os.path.join(tools_dir, "asr")
            if asr_dir not in sys.path:
                sys.path.insert(0, asr_dir)
            if tools_dir not in sys.path:
                sys.path.insert(0, tools_dir)
            if BASE_DIR not in sys.path:
                sys.path.insert(0, BASE_DIR)

            from fasterwhisper_asr import download_model
            from faster_whisper import WhisperModel
            import torch

            # ── 阶段 2a: 下载模型（如果需要） ──
            # 检查模型文件是否已存在
            expected_model_path = f"tools/asr/models/faster-whisper-{model_size}"
            model_bin = os.path.join(BASE_DIR, expected_model_path, "model.bin")
            if not os.path.isfile(model_bin):
                asr_task["phase"] = "downloading"
                asr_task["phase_tip"] = f"首次使用需下载模型（{model_size}，约 3GB），请耐心等待…"
                _asr_log(f"正在下载 Faster Whisper 模型 ({model_size})…")
                _asr_log("首次使用需从 HuggingFace 下载，可能需要几分钟")
            else:
                asr_task["phase"] = "loading"
                asr_task["phase_tip"] = f"正在加载 Faster Whisper 模型 ({model_size})…"
                _asr_log(f"正在加载 Faster Whisper 模型 ({model_size})…")

            model_path = download_model(model_size)
            _asr_log(f"模型路径: {model_path}")

            # ── 阶段 2b: 加载模型到 GPU ──
            asr_task["phase"] = "loading"
            asr_task["phase_tip"] = "正在将模型加载到 GPU，可能需要 30 秒左右…"
            _asr_log("正在将模型加载到 GPU…")
            device = "cuda" if torch.cuda.is_available() else "cpu"
            model = WhisperModel(model_path, device=device, compute_type=precision)
            _asr_log(f"Faster Whisper 模型已加载 (device={device})")

            whisper_lang = language if language != "auto" else None

            # ── 阶段 3: 逐文件识别 ──
            asr_task["phase"] = "recognizing"
            asr_task["phase_tip"] = "正在逐个识别音频文件…"
            for idx, file_path in enumerate(input_files):
                asr_task["processed_files"] = idx
                asr_task["current_file"] = os.path.basename(file_path)
                asr_task["progress"] = int((idx / len(input_files)) * 100)
                asr_task["phase_tip"] = f"正在识别第 {idx+1}/{len(input_files)} 个文件"

                try:
                    segments, info = model.transcribe(
                        audio=file_path,
                        beam_size=5,
                        vad_filter=True,
                        vad_parameters=dict(min_silence_duration_ms=700),
                        language=whisper_lang,
                    )
                    text = ""

                    # 中文文本转 FunASR 处理（更准确）
                    if info.language in ["zh", "yue"]:
                        try:
                            from funasr_asr import only_asr
                            text = only_asr(file_path, language=info.language.lower())
                        except Exception:
                            pass

                    if text == "":
                        for segment in segments:
                            text += segment.text

                    output_lines.append(
                        f"{file_path}|{output_file_name}|{info.language.upper()}|{text}"
                    )
                    _asr_log(f"[{idx+1}/{len(input_files)}] {os.path.basename(file_path)}")
                except Exception:
                    err = traceback.format_exc()
                    _asr_log(f"[{idx+1}/{len(input_files)}] 出错: {err}")

        else:
            asr_task["status"] = "error"
            asr_task["error"] = f"不支持的 ASR 引擎: {engine}"
            return

        # ── 阶段 4: 保存结果 ──
        asr_task["phase"] = "saving"
        asr_task["phase_tip"] = "正在保存识别结果…"
        output_file_path = os.path.abspath(
            os.path.join(output_dir, f"{output_file_name}.list")
        )
        with open(output_file_path, "w", encoding="utf-8") as f:
            f.write("\n".join(output_lines))

        asr_task["processed_files"] = len(input_files)
        asr_task["progress"] = 100
        asr_task["status"] = "done"
        asr_task["phase"] = ""
        asr_task["phase_tip"] = ""
        asr_task["output_file"] = output_file_path
        _asr_log(f"ASR 完成！共识别 {len(output_lines)} 条")
        _asr_log(f"标注文件: {output_file_path}")

        # 更新项目状态
        try:
            meta = load_project_meta(project_name)
            meta["steps"]["asr"]["status"] = "done"
            meta["steps"]["asr"]["output_file"] = output_file_path
            meta["steps"]["annotate"]["list_file"] = output_file_path
            save_project_meta(project_name, meta)
        except Exception:
            pass

    except Exception:
        asr_task["status"] = "error"
        asr_task["error"] = traceback.format_exc()
        _asr_log(f"ASR 失败: {asr_task['error']}")


def _slice_log(msg: str):
    """添加一条切分日志"""
    slice_task["logs"].append(msg)
    if len(slice_task["logs"]) > MAX_SLICE_LOGS:
        slice_task["logs"] = slice_task["logs"][-MAX_SLICE_LOGS:]


def _load_audio_for_slice(file_path: str, sr: int = 32000):
    """加载音频文件为 numpy 数组（使用 ffmpeg）"""
    import ffmpeg as ff
    file_path = file_path.strip().strip('"')
    out, _ = (
        ff.input(file_path, threads=0)
        .output("-", format="f32le", acodec="pcm_f32le", ac=1, ar=sr)
        .run(cmd=["ffmpeg", "-nostdin"], capture_stdout=True, capture_stderr=True)
    )
    return np.frombuffer(out, np.float32).flatten()


def _run_slice_task(input_path: str, output_dir: str, project_name: str,
                    threshold: float, min_length: int, min_interval: int,
                    hop_size: int, max_sil_kept: int,
                    normalize_max: float, alpha: float):
    """切分工作线程"""
    try:
        # 设置 Python 路径以便导入 slicer2
        tools_dir = os.path.join(BASE_DIR, "tools")
        if tools_dir not in sys.path:
            sys.path.insert(0, tools_dir)
        from slicer2 import Slicer

        os.makedirs(output_dir, exist_ok=True)

        # 收集输入文件
        audio_exts = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".wma"}
        if os.path.isfile(input_path):
            input_files = [input_path]
        elif os.path.isdir(input_path):
            input_files = [
                os.path.join(input_path, f)
                for f in sorted(os.listdir(input_path))
                if os.path.splitext(f)[1].lower() in audio_exts
            ]
        else:
            slice_task["status"] = "error"
            slice_task["error"] = f"输入路径不存在: {input_path}"
            return

        if not input_files:
            slice_task["status"] = "error"
            slice_task["error"] = "未找到任何音频文件"
            return

        slice_task["total_files"] = len(input_files)
        _slice_log(f"找到 {len(input_files)} 个音频文件")
        _slice_log(f"输出目录: {output_dir}")
        _slice_log(f"参数: threshold={threshold}, min_length={min_length}, min_interval={min_interval}")

        slicer = Slicer(
            sr=32000,
            threshold=int(threshold),
            min_length=int(min_length),
            min_interval=int(min_interval),
            hop_size=int(hop_size),
            max_sil_kept=int(max_sil_kept),
        )

        total_chunks = 0
        for idx, file_path in enumerate(input_files):
            slice_task["processed_files"] = idx
            slice_task["current_file"] = os.path.basename(file_path)
            slice_task["progress"] = int((idx / len(input_files)) * 100)
            _slice_log(f"[{idx+1}/{len(input_files)}] 正在处理: {os.path.basename(file_path)}")

            try:
                audio = _load_audio_for_slice(file_path, 32000)
                name = os.path.basename(file_path)

                for chunk, start, end in slicer.slice(audio):
                    tmp_max = np.abs(chunk).max()
                    if tmp_max > 1:
                        chunk /= tmp_max
                    chunk = (chunk / tmp_max * (normalize_max * alpha)) + (1 - alpha) * chunk
                    out_name = f"{name}_{start:010d}_{end:010d}.wav"
                    wavfile.write(
                        os.path.join(output_dir, out_name),
                        32000,
                        (chunk * 32767).astype(np.int16),
                    )
                    total_chunks += 1

                _slice_log(f"  完成，已累计产出 {total_chunks} 个片段")
            except Exception:
                err = traceback.format_exc()
                _slice_log(f"  出错: {err}")

        # 完成
        slice_task["processed_files"] = len(input_files)
        slice_task["progress"] = 100
        slice_task["status"] = "done"
        _slice_log(f"全部完成！共产出 {total_chunks} 个音频片段")

        # 更新项目状态
        try:
            meta = load_project_meta(project_name)
            meta["steps"]["slice"]["status"] = "done"
            meta["steps"]["slice"]["output_dir"] = output_dir
            meta["steps"]["slice"]["total_chunks"] = total_chunks
            save_project_meta(project_name, meta)
        except Exception:
            pass

    except Exception:
        slice_task["status"] = "error"
        slice_task["error"] = traceback.format_exc()
        _slice_log(f"切分失败: {slice_task['error']}")


# ============================================================
#  音频切分 API
# ============================================================

@app.get("/api/slice/files")
async def api_slice_files():
    """列出当前项目 raw_upload 目录中的所有已上传文件"""
    project = panel_state.get("active_project")
    if not project:
        raise HTTPException(400, "请先选择一个项目")

    upload_dir = os.path.join(get_project_dir(project), "raw_upload")
    if not os.path.isdir(upload_dir):
        return {"files": [], "upload_dir": upload_dir}

    audio_exts = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".wma"}
    files = []
    for name in sorted(os.listdir(upload_dir)):
        ext = os.path.splitext(name)[1].lower()
        if ext not in audio_exts:
            continue
        fpath = os.path.join(upload_dir, name)
        files.append({
            "name": name,
            "size": os.path.getsize(fpath),
        })

    return {"files": files, "upload_dir": upload_dir}


@app.post("/api/slice/upload")
async def api_slice_upload(files: List[UploadFile] = File(...)):
    """上传音频文件到当前项目的 raw_upload 目录（自动跳过同名文件）"""
    project = panel_state.get("active_project")
    if not project:
        raise HTTPException(400, "请先选择一个项目")

    upload_dir = os.path.join(get_project_dir(project), "raw_upload")
    os.makedirs(upload_dir, exist_ok=True)

    existing = set(os.listdir(upload_dir))
    saved = []
    skipped = []
    errors = []
    for f in files:
        if not f.filename:
            continue
        # webkitdirectory 上传的文件名可能包含路径分隔符（如 "subfolder/audio.wav"）
        # 只取文件名部分，避免子目录创建失败
        safe_name = os.path.basename(f.filename.replace("\\", "/"))
        if not safe_name:
            continue
        if safe_name in existing:
            skipped.append(safe_name)
            await f.read()  # 消耗掉流，避免连接问题
            continue
        try:
            dest = os.path.join(upload_dir, safe_name)
            content = await f.read()
            with open(dest, "wb") as out:
                out.write(content)
            saved.append(safe_name)
            existing.add(safe_name)
        except Exception as e:
            errors.append(f"{safe_name}: {str(e)}")

    return {
        "success": True,
        "uploaded": saved,
        "skipped": skipped,
        "errors": errors,
        "upload_dir": upload_dir,
        "total": len(saved),
    }


@app.post("/api/slice/delete")
async def api_slice_delete(req: Request):
    """删除已上传的音频文件"""
    project = panel_state.get("active_project")
    if not project:
        raise HTTPException(400, "请先选择一个项目")

    body = await req.json()
    filenames = body.get("filenames", [])
    if not filenames:
        raise HTTPException(400, "请指定要删除的文件名")

    upload_dir = os.path.join(get_project_dir(project), "raw_upload")
    deleted = []
    not_found = []
    for name in filenames:
        fpath = os.path.join(upload_dir, name)
        # 安全检查：防止路径穿越
        if os.path.abspath(fpath) != os.path.normpath(fpath):
            continue
        if os.path.isfile(fpath):
            os.remove(fpath)
            deleted.append(name)
        else:
            not_found.append(name)

    return {
        "success": True,
        "deleted": deleted,
        "not_found": not_found,
    }


@app.post("/api/slice/start")
async def api_slice_start(req: SliceStartRequest):
    """启动切分任务"""
    project = panel_state.get("active_project")
    if not project:
        raise HTTPException(400, "请先选择一个项目")

    if slice_task["status"] == "running":
        raise HTTPException(409, "切分任务正在运行中")

    # 应用预设
    if req.preset in SLICE_PRESETS:
        preset = SLICE_PRESETS[req.preset]
        threshold = preset["threshold"]
        min_length = preset["min_length"]
        min_interval = preset["min_interval"]
        hop_size_val = preset["hop_size"]
        max_sil_kept = preset["max_sil_kept"]
    else:
        threshold = req.threshold
        min_length = req.min_length
        min_interval = req.min_interval
        hop_size_val = req.hop_size
        max_sil_kept = req.max_sil_kept

    # 确定输入路径
    input_path = req.input_path.strip().strip('"') if req.input_path.strip() else ""
    if not input_path:
        # 默认使用上传目录
        input_path = os.path.join(get_project_dir(project), "raw_upload")
    if not os.path.exists(input_path):
        raise HTTPException(404, f"输入路径不存在: {input_path}")

    # 输出目录
    output_dir = os.path.join(BASE_DIR, "output", "slicer_opt", project)
    os.makedirs(output_dir, exist_ok=True)

    # 重置状态
    slice_task["status"] = "running"
    slice_task["progress"] = 0
    slice_task["current_file"] = ""
    slice_task["total_files"] = 0
    slice_task["processed_files"] = 0
    slice_task["output_dir"] = output_dir
    slice_task["logs"] = []
    slice_task["error"] = ""

    _slice_log(f"启动切分任务: 项目={project}")
    _slice_log(f"输入: {input_path}")
    _slice_log(f"预设: {req.preset}")

    # 后台线程执行
    t = threading.Thread(
        target=_run_slice_task,
        args=(input_path, output_dir, project,
              threshold, min_length, min_interval,
              hop_size_val, max_sil_kept,
              req.normalize_max, req.alpha),
        daemon=True,
    )
    t.start()

    return {"success": True, "message": "切分任务已启动"}


@app.get("/api/slice/status")
async def api_slice_status():
    """查询切分进度"""
    return {
        "status": slice_task["status"],
        "progress": slice_task["progress"],
        "current_file": slice_task["current_file"],
        "total_files": slice_task["total_files"],
        "processed_files": slice_task["processed_files"],
        "logs": slice_task["logs"],
        "error": slice_task["error"],
    }


@app.get("/api/slice/preview")
async def api_slice_preview():
    """获取切分结果列表"""
    project = panel_state.get("active_project")
    if not project:
        raise HTTPException(400, "请先选择一个项目")

    output_dir = os.path.join(BASE_DIR, "output", "slicer_opt", project)
    if not os.path.isdir(output_dir):
        return {"files": [], "total": 0, "output_dir": output_dir}

    files = []
    for name in sorted(os.listdir(output_dir)):
        if not name.endswith(".wav"):
            continue
        fpath = os.path.join(output_dir, name)
        duration = get_audio_duration(fpath)
        files.append({
            "name": name,
            "path": fpath,
            "duration": duration,
            "size": os.path.getsize(fpath),
        })

    durations = [f["duration"] for f in files if f["duration"] > 0]
    stats = {
        "total": len(files),
        "min_duration": min(durations) if durations else 0,
        "max_duration": max(durations) if durations else 0,
        "avg_duration": round(sum(durations) / len(durations), 2) if durations else 0,
    }

    return {"files": files, "stats": stats, "output_dir": output_dir}


@app.get("/api/slice/audio")
async def api_slice_audio(path: str):
    """提供切分后的音频文件"""
    if not os.path.isfile(path):
        raise HTTPException(404, f"Audio file not found: {path}")
    content_type = mimetypes.guess_type(path)[0] or "audio/wav"
    return FileResponse(path, media_type=content_type)


# ============================================================
#  ASR 语音识别 API
# ============================================================

@app.get("/api/asr/models")
async def api_asr_models():
    """返回可用的 ASR 引擎及其配置"""
    engines = [
        {
            "id": "funasr",
            "name": "达摩 ASR (中文)",
            "languages": [{"code": "zh", "name": "中文"}, {"code": "yue", "name": "粤语"}],
            "model_sizes": ["large"],
            "precisions": ["float32"],
            "description": "阿里达摩院语音识别，中文识别效果最好",
        },
        {
            "id": "fasterwhisper",
            "name": "Faster Whisper (多语种)",
            "languages": [
                {"code": "auto", "name": "自动检测"},
                {"code": "zh", "name": "中文"},
                {"code": "en", "name": "英文"},
                {"code": "ja", "name": "日文"},
                {"code": "ko", "name": "韩文"},
            ],
            "model_sizes": ["medium", "large-v2", "large-v3", "large-v3-turbo"],
            "precisions": ["float16", "float32", "int8"],
            "description": "OpenAI Whisper 加速版，支持多语种",
        },
    ]
    return {"engines": engines}


@app.post("/api/asr/start")
async def api_asr_start(req: AsrStartRequest):
    """启动 ASR 任务"""
    project = panel_state.get("active_project")
    if not project:
        raise HTTPException(400, "请先选择一个项目")

    if asr_task["status"] == "running":
        raise HTTPException(409, "ASR 任务正在运行中")

    # 确定输入目录
    input_dir = req.input_dir.strip().strip('"') if req.input_dir.strip() else ""
    if not input_dir:
        # 默认使用切分输出目录
        input_dir = os.path.join(BASE_DIR, "output", "slicer_opt", project)
    if not os.path.isdir(input_dir):
        raise HTTPException(404, f"输入目录不存在: {input_dir}。请先完成音频切分。")

    # 输出目录
    output_dir = os.path.join(BASE_DIR, "output", "asr_opt")

    # 重置状态
    asr_task["status"] = "running"
    asr_task["phase"] = "collecting"
    asr_task["phase_tip"] = "正在准备…"
    asr_task["progress"] = 0
    asr_task["current_file"] = ""
    asr_task["total_files"] = 0
    asr_task["processed_files"] = 0
    asr_task["output_file"] = ""
    asr_task["logs"] = []
    asr_task["error"] = ""

    _asr_log(f"启动 ASR 任务: 项目={project}")
    _asr_log(f"输入: {input_dir}")
    _asr_log(f"引擎: {req.engine} | 语言: {req.language}")

    t = threading.Thread(
        target=_run_asr_task,
        args=(input_dir, output_dir, project,
              req.engine, req.language, req.model_size, req.precision),
        daemon=True,
    )
    t.start()

    return {"success": True, "message": "ASR 任务已启动"}


@app.get("/api/asr/status")
async def api_asr_status():
    """查询 ASR 进度"""
    return {
        "status": asr_task["status"],
        "phase": asr_task["phase"],
        "phase_tip": asr_task["phase_tip"],
        "progress": asr_task["progress"],
        "current_file": asr_task["current_file"],
        "total_files": asr_task["total_files"],
        "processed_files": asr_task["processed_files"],
        "output_file": asr_task["output_file"],
        "logs": asr_task["logs"],
        "error": asr_task["error"],
    }


# ============================================================
#  训练集格式化 — 常量 & 状态
# ============================================================

# Python 可执行文件路径（优先使用 runtime/python.exe）
_runtime_python = os.path.join(BASE_DIR, "runtime", "python.exe")
PYTHON_EXEC = _runtime_python if os.path.isfile(_runtime_python) else sys.executable

# 预训练模型路径 (相对于 BASE_DIR)
PRETRAINED_S2G = {
    "v1": "GPT_SoVITS/pretrained_models/s2G488k.pth",
    "v2": "GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s2G2333k.pth",
    "v3": "GPT_SoVITS/pretrained_models/s2Gv3.pth",
    "v4": "GPT_SoVITS/pretrained_models/gsv-v4-pretrained/s2Gv4.pth",
    "v2Pro": "GPT_SoVITS/pretrained_models/v2Pro/s2Gv2Pro.pth",
    "v2ProPlus": "GPT_SoVITS/pretrained_models/v2Pro/s2Gv2ProPlus.pth",
}
S2_CONFIGS = {
    "v2Pro": "GPT_SoVITS/configs/s2v2Pro.json",
    "v2ProPlus": "GPT_SoVITS/configs/s2v2ProPlus.json",
}
S2_CONFIG_DEFAULT = "GPT_SoVITS/configs/s2.json"
BERT_PRETRAINED_DIR = os.path.join(BASE_DIR, "GPT_SoVITS", "pretrained_models", "chinese-roberta-wwm-ext-large")
CNHUBERT_BASE_DIR = os.path.join(BASE_DIR, "GPT_SoVITS", "pretrained_models", "chinese-hubert-base")
SV_MODEL_PATH = os.path.join(BASE_DIR, "GPT_SoVITS", "pretrained_models", "sv", "pretrained_eres2netv2w24s4ep4.ckpt")

import torch as _torch
_IS_HALF = str(_torch.cuda.is_available())  # GPU 可用时用 half
_GPU_INDEX = "0"  # 默认 GPU 序号

format_task = {
    "status": "idle",         # idle / running / done / error
    "current_step": "",       # 1a / 1b / 1b_sv / 1c / ""
    "step_progress": {
        "1a": "pending",      # pending / running / done / skipped / error
        "1b": "pending",
        "1c": "pending",
    },
    "logs": [],
    "error": "",
    "process": None,          # 当前子进程对象
}
MAX_FORMAT_LOGS = 300


def _format_log(msg: str):
    """添加一条格式化日志"""
    format_task["logs"].append(msg)
    if len(format_task["logs"]) > MAX_FORMAT_LOGS:
        format_task["logs"] = format_task["logs"][-MAX_FORMAT_LOGS:]


def _run_subprocess_with_log(cmd: str, env: dict, step_label: str) -> bool:
    """运行子进程，实时捕获输出到日志。返回 True=成功"""
    _format_log(f"[{step_label}] 执行: {cmd}")
    merged_env = os.environ.copy()
    merged_env.update(env)
    try:
        proc = subprocess.Popen(
            cmd, shell=True, env=merged_env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            cwd=BASE_DIR, encoding="utf-8", errors="replace",
        )
        format_task["process"] = proc
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                _format_log(f"  {line}")
        proc.wait()
        format_task["process"] = None
        if proc.returncode != 0:
            _format_log(f"[{step_label}] 子进程退出码: {proc.returncode}")
            return False
        return True
    except Exception:
        format_task["process"] = None
        _format_log(f"[{step_label}] 异常: {traceback.format_exc()}")
        return False


def _run_format_task(project_name: str, version: str,
                     inp_text: str, inp_wav_dir: str, opt_dir: str):
    """格式化工作线程：依次执行 1A → 1B → 1C"""
    try:
        gpu_index = _GPU_INDEX

        # ======================== Step 1A ========================
        format_task["current_step"] = "1a"
        format_task["step_progress"]["1a"] = "running"
        path_text = os.path.join(opt_dir, "2-name2text.txt")

        # 检查是否已有产出（跳过）
        if os.path.isfile(path_text) and os.path.getsize(path_text) > 10:
            _format_log("[Step 1A] 文本特征已存在，跳过")
            format_task["step_progress"]["1a"] = "skipped"
        else:
            _format_log("[Step 1A] 文本分词 + BERT 特征提取...")
            env_1a = {
                "inp_text": inp_text,
                "inp_wav_dir": inp_wav_dir,
                "exp_name": project_name,
                "opt_dir": opt_dir,
                "bert_pretrained_dir": BERT_PRETRAINED_DIR,
                "is_half": _IS_HALF,
                "i_part": "0",
                "all_parts": "1",
                "_CUDA_VISIBLE_DEVICES": gpu_index,
                "version": version if version else "v2Pro",
            }
            cmd = f'"{PYTHON_EXEC}" -s GPT_SoVITS/prepare_datasets/1-get-text.py'
            ok = _run_subprocess_with_log(cmd, env_1a, "Step 1A")

            if ok:
                # 合并分片文件
                txt_part = os.path.join(opt_dir, "2-name2text-0.txt")
                if os.path.isfile(txt_part):
                    with open(txt_part, "r", encoding="utf-8") as f:
                        content = f.read()
                    with open(path_text, "w", encoding="utf-8") as f:
                        f.write(content)
                    os.remove(txt_part)

                if os.path.isfile(path_text) and os.path.getsize(path_text) > 0:
                    format_task["step_progress"]["1a"] = "done"
                    _format_log("[Step 1A] 完成")
                else:
                    format_task["step_progress"]["1a"] = "error"
                    format_task["status"] = "error"
                    format_task["error"] = "Step 1A 未产出文本特征文件"
                    _format_log("[Step 1A] 失败: 未产出文件")
                    return
            else:
                format_task["step_progress"]["1a"] = "error"
                format_task["status"] = "error"
                format_task["error"] = "Step 1A 执行失败"
                return

        # 检查是否被取消
        if format_task["status"] != "running":
            return

        # ======================== Step 1B ========================
        format_task["current_step"] = "1b"
        format_task["step_progress"]["1b"] = "running"

        hubert_dir = os.path.join(opt_dir, "4-cnhubert")
        wav32k_dir = os.path.join(opt_dir, "5-wav32k")
        has_hubert = os.path.isdir(hubert_dir) and len(os.listdir(hubert_dir)) > 0
        has_wav32k = os.path.isdir(wav32k_dir) and len(os.listdir(wav32k_dir)) > 0

        if has_hubert and has_wav32k:
            _format_log("[Step 1B] SSL 特征已存在，跳过")
            format_task["step_progress"]["1b"] = "skipped"
        else:
            _format_log("[Step 1B] SSL 特征提取 + 32k 音频...")
            env_1b = {
                "inp_text": inp_text,
                "inp_wav_dir": inp_wav_dir,
                "exp_name": project_name,
                "opt_dir": opt_dir,
                "cnhubert_base_dir": CNHUBERT_BASE_DIR,
                "sv_path": SV_MODEL_PATH,
                "is_half": _IS_HALF,
                "i_part": "0",
                "all_parts": "1",
                "_CUDA_VISIBLE_DEVICES": gpu_index,
            }
            cmd = f'"{PYTHON_EXEC}" -s GPT_SoVITS/prepare_datasets/2-get-hubert-wav32k.py'
            ok = _run_subprocess_with_log(cmd, env_1b, "Step 1B")
            if not ok:
                format_task["step_progress"]["1b"] = "error"
                format_task["status"] = "error"
                format_task["error"] = "Step 1B (HuBERT) 执行失败"
                return
            _format_log("[Step 1B] HuBERT + wav32k 完成")

            # Pro 版本额外提取说话人嵌入 (2-get-sv.py)
            if "Pro" in (version or ""):
                _format_log("[Step 1B] 提取说话人嵌入 (Pro)...")
                format_task["current_step"] = "1b_sv"
                cmd_sv = f'"{PYTHON_EXEC}" -s GPT_SoVITS/prepare_datasets/2-get-sv.py'
                ok_sv = _run_subprocess_with_log(cmd_sv, env_1b, "Step 1B-SV")
                if not ok_sv:
                    format_task["step_progress"]["1b"] = "error"
                    format_task["status"] = "error"
                    format_task["error"] = "Step 1B (SV) 执行失败"
                    return
                _format_log("[Step 1B] 说话人嵌入完成")

            format_task["step_progress"]["1b"] = "done"
            _format_log("[Step 1B] 全部完成")

        if format_task["status"] != "running":
            return

        # ======================== Step 1C ========================
        format_task["current_step"] = "1c"
        format_task["step_progress"]["1c"] = "running"

        path_semantic = os.path.join(opt_dir, "6-name2semantic.tsv")
        if os.path.isfile(path_semantic) and os.path.getsize(path_semantic) > 30:
            _format_log("[Step 1C] 语义 Token 已存在，跳过")
            format_task["step_progress"]["1c"] = "skipped"
        else:
            _format_log("[Step 1C] 语义 Token 提取...")
            s2g_path = PRETRAINED_S2G.get(version, PRETRAINED_S2G["v2Pro"])
            s2g_abs = os.path.join(BASE_DIR, s2g_path)
            config_key = version if version in S2_CONFIGS else None
            s2_config = S2_CONFIGS.get(config_key, S2_CONFIG_DEFAULT) if config_key else S2_CONFIG_DEFAULT

            env_1c = {
                "inp_text": inp_text,
                "exp_name": project_name,
                "opt_dir": opt_dir,
                "pretrained_s2G": s2g_abs,
                "s2config_path": s2_config,
                "is_half": _IS_HALF,
                "i_part": "0",
                "all_parts": "1",
                "_CUDA_VISIBLE_DEVICES": gpu_index,
            }
            cmd = f'"{PYTHON_EXEC}" -s GPT_SoVITS/prepare_datasets/3-get-semantic.py'
            ok = _run_subprocess_with_log(cmd, env_1c, "Step 1C")
            if not ok:
                format_task["step_progress"]["1c"] = "error"
                format_task["status"] = "error"
                format_task["error"] = "Step 1C 执行失败"
                return

            # 合并分片文件
            semantic_part = os.path.join(opt_dir, "6-name2semantic-0.tsv")
            if os.path.isfile(semantic_part):
                opt_lines = ["item_name\tsemantic_audio"]
                with open(semantic_part, "r", encoding="utf-8") as f:
                    opt_lines += f.read().strip("\n").split("\n")
                with open(path_semantic, "w", encoding="utf-8") as f:
                    f.write("\n".join(opt_lines) + "\n")
                os.remove(semantic_part)

            format_task["step_progress"]["1c"] = "done"
            _format_log("[Step 1C] 完成")

        # ======================== 全部完成 ========================
        format_task["current_step"] = ""
        format_task["status"] = "done"
        _format_log("训练集格式化全部完成！")

        # 更新项目状态
        try:
            meta = load_project_meta(project_name)
            meta["steps"]["format"]["status"] = "done"
            meta["steps"]["annotate"]["status"] = "done"
            save_project_meta(project_name, meta)
        except Exception:
            pass

    except Exception:
        format_task["status"] = "error"
        format_task["error"] = traceback.format_exc()
        _format_log(f"格式化失败: {format_task['error']}")


# ============================================================
#  训练集格式化 API
# ============================================================

@app.post("/api/format/start")
async def api_format_start(req: FormatStartRequest):
    """启动格式化任务"""
    project = panel_state.get("active_project")
    if not project:
        raise HTTPException(400, "请先选择一个项目")

    if format_task["status"] == "running":
        raise HTTPException(409, "格式化任务正在运行中")

    proj_dir = get_project_dir(project)
    meta = load_project_meta(project)
    version = meta.get("version", "v2Pro")

    # 确定 .list 文件路径
    inp_text = req.inp_text.strip().strip('"') if req.inp_text.strip() else ""
    if not inp_text:
        # 尝试从 ASR 产出或标注状态获取
        asr_step = meta.get("steps", {}).get("asr", {})
        annotate_step = meta.get("steps", {}).get("annotate", {})
        inp_text = annotate_step.get("list_file", "") or asr_step.get("output_file", "")
        if not inp_text:
            # 搜索项目目录和 output/asr_opt/
            import glob as _glob
            candidates = _glob.glob(os.path.join(proj_dir, "*.list"))
            asr_opt = os.path.join(BASE_DIR, "output", "asr_opt")
            if os.path.isdir(asr_opt):
                candidates += _glob.glob(os.path.join(asr_opt, f"{project}*.list"))
            if candidates:
                inp_text = candidates[0]
    if not inp_text or not os.path.isfile(inp_text):
        raise HTTPException(404, f".list 文件不存在: {inp_text or '(未找到)'}。请先完成 ASR 识别和标注。")

    # 确定音频目录
    inp_wav_dir = req.inp_wav_dir.strip().strip('"') if req.inp_wav_dir.strip() else ""
    if not inp_wav_dir:
        # 默认使用切分产出目录
        inp_wav_dir = os.path.join(BASE_DIR, "output", "slicer_opt", project)
    if not os.path.isdir(inp_wav_dir):
        raise HTTPException(404, f"音频目录不存在: {inp_wav_dir}。请先完成音频切分。")

    opt_dir = proj_dir

    # 重置格式化状态
    format_task["status"] = "running"
    format_task["current_step"] = ""
    format_task["step_progress"] = {"1a": "pending", "1b": "pending", "1c": "pending"}
    format_task["logs"] = []
    format_task["error"] = ""
    format_task["process"] = None

    _format_log(f"启动格式化: 项目={project}, 版本={version}")
    _format_log(f"标注文件: {inp_text}")
    _format_log(f"音频目录: {inp_wav_dir}")

    t = threading.Thread(
        target=_run_format_task,
        args=(project, version, inp_text, inp_wav_dir, opt_dir),
        daemon=True,
    )
    t.start()

    return {"success": True, "message": "格式化任务已启动"}


@app.get("/api/format/status")
async def api_format_status():
    """查询格式化进度"""
    return {
        "status": format_task["status"],
        "current_step": format_task["current_step"],
        "step_progress": format_task["step_progress"],
        "logs": format_task["logs"],
        "error": format_task["error"],
    }


@app.post("/api/format/stop")
async def api_format_stop():
    """终止格式化任务"""
    if format_task["status"] != "running":
        return {"success": False, "message": "没有正在运行的格式化任务"}

    proc = format_task.get("process")
    if proc and proc.poll() is None:
        try:
            import signal as _signal
            if sys.platform == "win32":
                proc.terminate()
            else:
                os.killpg(os.getpgid(proc.pid), _signal.SIGTERM)
        except Exception:
            pass

    format_task["status"] = "idle"
    format_task["current_step"] = ""
    format_task["process"] = None
    _format_log("格式化任务已被用户终止")

    return {"success": True, "message": "格式化任务已终止"}


@app.get("/api/format/check")
async def api_format_check():
    """检查格式化前置条件"""
    project = panel_state.get("active_project")
    if not project:
        return {"ready": False, "reason": "未选择项目", "inp_text": "", "inp_wav_dir": ""}

    proj_dir = get_project_dir(project)
    meta = load_project_meta(project)

    # 查找 .list 文件
    inp_text = ""
    asr_step = meta.get("steps", {}).get("asr", {})
    annotate_step = meta.get("steps", {}).get("annotate", {})
    inp_text = annotate_step.get("list_file", "") or asr_step.get("output_file", "")
    if not inp_text or not os.path.isfile(inp_text):
        import glob as _glob
        candidates = _glob.glob(os.path.join(proj_dir, "*.list"))
        asr_opt = os.path.join(BASE_DIR, "output", "asr_opt")
        if os.path.isdir(asr_opt):
            candidates += _glob.glob(os.path.join(asr_opt, f"{project}*.list"))
        inp_text = candidates[0] if candidates else ""

    has_list = bool(inp_text) and os.path.isfile(inp_text)

    # 查找音频目录
    inp_wav_dir = os.path.join(BASE_DIR, "output", "slicer_opt", project)
    has_wav = os.path.isdir(inp_wav_dir) and bool(os.listdir(inp_wav_dir))

    # 检查已有格式化产物
    has_text = os.path.isfile(os.path.join(proj_dir, "2-name2text.txt"))
    has_hubert = os.path.isdir(os.path.join(proj_dir, "4-cnhubert")) and bool(os.listdir(os.path.join(proj_dir, "4-cnhubert")))
    has_semantic = os.path.isfile(os.path.join(proj_dir, "6-name2semantic.tsv"))

    ready = has_list and has_wav
    reason = ""
    if not has_list:
        reason = "缺少 .list 标注文件，请先完成 ASR 和标注"
    elif not has_wav:
        reason = "缺少音频文件，请先完成音频切分"

    return {
        "ready": ready,
        "reason": reason,
        "inp_text": inp_text,
        "inp_wav_dir": inp_wav_dir,
        "existing": {
            "text": has_text,
            "hubert": has_hubert,
            "semantic": has_semantic,
        },
        "version": meta.get("version", "v2Pro"),
    }


# ============================================================
#  模型训练 — 常量 & 状态
# ============================================================

# 预训练模型路径 (SoVITS Generator)
PRETRAINED_S2G_MAP = {
    "v1": "GPT_SoVITS/pretrained_models/s2G488k.pth",
    "v2": "GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s2G2333k.pth",
    "v3": "GPT_SoVITS/pretrained_models/s2Gv3.pth",
    "v4": "GPT_SoVITS/pretrained_models/gsv-v4-pretrained/s2Gv4.pth",
    "v2Pro": "GPT_SoVITS/pretrained_models/v2Pro/s2Gv2Pro.pth",
    "v2ProPlus": "GPT_SoVITS/pretrained_models/v2Pro/s2Gv2ProPlus.pth",
}
# 预训练模型路径 (SoVITS Discriminator)
PRETRAINED_S2D_MAP = {k: v.replace("s2G", "s2D") for k, v in PRETRAINED_S2G_MAP.items()}
# 预训练模型路径 (GPT)
PRETRAINED_GPT_MAP = {
    "v1": "GPT_SoVITS/pretrained_models/s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt",
    "v2": "GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt",
    "v3": "GPT_SoVITS/pretrained_models/s1v3.ckpt",
    "v4": "GPT_SoVITS/pretrained_models/s1v3.ckpt",
    "v2Pro": "GPT_SoVITS/pretrained_models/s1v3.ckpt",
    "v2ProPlus": "GPT_SoVITS/pretrained_models/s1v3.ckpt",
}
# 训练权重输出目录
SOVITS_WEIGHT_DIR_MAP = {
    "v1": "SoVITS_weights", "v2": "SoVITS_weights_v2",
    "v3": "SoVITS_weights_v3", "v4": "SoVITS_weights_v4",
    "v2Pro": "SoVITS_weights_v2Pro", "v2ProPlus": "SoVITS_weights_v2ProPlus",
}
GPT_WEIGHT_DIR_MAP = {
    "v1": "GPT_weights", "v2": "GPT_weights_v2",
    "v3": "GPT_weights_v3", "v4": "GPT_weights_v4",
    "v2Pro": "GPT_weights_v2Pro", "v2ProPlus": "GPT_weights_v2ProPlus",
}
# SoVITS config templates
S2_CONFIG_MAP = {
    "v2Pro": "GPT_SoVITS/configs/s2v2Pro.json",
    "v2ProPlus": "GPT_SoVITS/configs/s2v2ProPlus.json",
}
S2_CONFIG_DEFAULT_PATH = "GPT_SoVITS/configs/s2.json"
# 默认训练参数
V3V4_SET = {"v3", "v4"}

train_task = {
    "status": "idle",         # idle / running / done / error
    "target": "",             # sovits / gpt
    "current_epoch": 0,
    "total_epochs": 0,
    "progress": 0,            # 0-100
    "logs": [],
    "error": "",
    "process": None,
}
MAX_TRAIN_LOGS = 500


def _train_log(msg: str):
    """添加一条训练日志"""
    train_task["logs"].append(msg)
    if len(train_task["logs"]) > MAX_TRAIN_LOGS:
        train_task["logs"] = train_task["logs"][-MAX_TRAIN_LOGS:]


def _get_default_batch_size(version: str, target: str) -> int:
    """根据显存自动推荐 batch_size"""
    try:
        import torch as _t
        if _t.cuda.is_available():
            mem_gb = _t.cuda.get_device_properties(0).total_memory / (1024**3)
            if target == "gpt":
                return max(1, int(mem_gb // 2))
            else:
                return max(1, int(mem_gb // 2 if version not in V3V4_SET else mem_gb // 8))
    except Exception:
        pass
    return 4


def _get_default_epochs(version: str, target: str) -> int:
    if target == "gpt":
        return 15
    return 8 if version not in V3V4_SET else 2


def _get_default_save_every(version: str, target: str) -> int:
    if target == "gpt":
        return 5
    return 4 if version not in V3V4_SET else 1


import re as _re

def _parse_epoch_from_line(line: str):
    """尝试从训练输出行中解析 epoch 进度"""
    # PyTorch Lightning: "Epoch 3:  45%|..."
    m = _re.search(r'Epoch\s+(\d+)', line)
    if m:
        epoch = int(m.group(1)) + 1  # 0-indexed → 1-indexed
        total = train_task["total_epochs"]
        if total > 0:
            train_task["current_epoch"] = min(epoch, total)
            train_task["progress"] = min(100, int((epoch / total) * 100))
        else:
            train_task["current_epoch"] = epoch


def _run_train_subprocess_with_log(cmd: str, env: dict, label: str) -> bool:
    """运行训练子进程，实时捕获输出。返回 True=成功"""
    _train_log(f"[{label}] 执行: {cmd}")
    merged_env = os.environ.copy()
    merged_env.update(env)
    try:
        proc = subprocess.Popen(
            cmd, shell=True, env=merged_env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            cwd=BASE_DIR, encoding="utf-8", errors="replace",
        )
        train_task["process"] = proc
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                _train_log(line)
                _parse_epoch_from_line(line)
        proc.wait()
        train_task["process"] = None
        if proc.returncode != 0:
            _train_log(f"[{label}] 子进程退出码: {proc.returncode}")
            return False
        return True
    except Exception:
        train_task["process"] = None
        _train_log(f"[{label}] 异常: {traceback.format_exc()}")
        return False


def _run_train_sovits(project_name: str, version: str,
                      batch_size: int, total_epochs: int,
                      save_every_epoch: int, if_save_latest: bool,
                      if_save_every_weights: bool, text_low_lr_rate: float,
                      if_grad_ckpt: bool, lora_rank: int):
    """SoVITS 训练工作线程"""
    try:
        proj_dir = get_project_dir(project_name)
        s2_dir = proj_dir

        # 选择 config 模板
        config_file = S2_CONFIG_MAP.get(version, S2_CONFIG_DEFAULT_PATH)
        config_abs = os.path.join(BASE_DIR, config_file)
        if not os.path.isfile(config_abs):
            config_abs = os.path.join(BASE_DIR, S2_CONFIG_DEFAULT_PATH)
        with open(config_abs, "r", encoding="utf-8") as f:
            data = json.load(f)

        # 创建 checkpoint 目录
        logs_s2_dir = os.path.join(s2_dir, f"logs_s2_{version}")
        os.makedirs(logs_s2_dir, exist_ok=True)

        # 修改训练参数
        if not _IS_HALF or _IS_HALF == "False":
            data["train"]["fp16_run"] = False
            batch_size = max(1, batch_size // 2)
        data["train"]["batch_size"] = batch_size
        data["train"]["epochs"] = total_epochs
        data["train"]["text_low_lr_rate"] = text_low_lr_rate
        data["train"]["if_save_latest"] = if_save_latest
        data["train"]["if_save_every_weights"] = if_save_every_weights
        data["train"]["save_every_epoch"] = save_every_epoch
        data["train"]["gpu_numbers"] = _GPU_INDEX
        data["train"]["grad_ckpt"] = if_grad_ckpt
        data["train"]["lora_rank"] = lora_rank

        # 预训练模型路径
        s2g = PRETRAINED_S2G_MAP.get(version, PRETRAINED_S2G_MAP["v2Pro"])
        s2d = PRETRAINED_S2D_MAP.get(version, PRETRAINED_S2D_MAP["v2Pro"])
        data["train"]["pretrained_s2G"] = s2g
        data["train"]["pretrained_s2D"] = s2d

        # 模型版本
        data["model"]["version"] = version
        data["data"]["exp_dir"] = s2_dir
        data["s2_ckpt_dir"] = s2_dir
        data["save_weight_dir"] = SOVITS_WEIGHT_DIR_MAP.get(version, "SoVITS_weights_v2Pro")
        data["name"] = project_name
        data["version"] = version

        # 写入临时 config
        os.makedirs(os.path.join(BASE_DIR, "TEMP"), exist_ok=True)
        tmp_config = os.path.join(BASE_DIR, "TEMP", "tmp_s2.json")
        with open(tmp_config, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)

        _train_log(f"SoVITS 训练配置已生成: {tmp_config}")
        _train_log(f"版本: {version} | batch_size: {batch_size} | epochs: {total_epochs}")
        _train_log(f"预训练 G: {s2g}")
        _train_log(f"预训练 D: {s2d}")

        # 选择训练脚本
        if version in ["v1", "v2", "v2Pro", "v2ProPlus"]:
            script = "GPT_SoVITS/s2_train.py"
        else:
            script = "GPT_SoVITS/s2_train_v3_lora.py"

        cmd = f'"{PYTHON_EXEC}" -s {script} --config "{tmp_config}"'
        _train_log(f"启动 SoVITS 训练...")
        ok = _run_train_subprocess_with_log(cmd, {}, "SoVITS")

        if ok:
            train_task["status"] = "done"
            _train_log("SoVITS 训练完成！")
        else:
            if train_task["status"] == "running":  # 没被手动停止
                train_task["status"] = "error"
                train_task["error"] = "SoVITS 训练进程异常退出"
                _train_log("SoVITS 训练失败")

        # 更新项目状态
        try:
            meta = load_project_meta(project_name)
            if train_task["status"] == "done":
                meta["steps"]["train"]["status"] = "done"
            save_project_meta(project_name, meta)
        except Exception:
            pass

    except Exception:
        train_task["status"] = "error"
        train_task["error"] = traceback.format_exc()
        _train_log(f"SoVITS 训练失败: {train_task['error']}")


def _run_train_gpt(project_name: str, version: str,
                   batch_size: int, total_epochs: int,
                   save_every_epoch: int, if_save_latest: bool,
                   if_save_every_weights: bool, if_dpo: bool):
    """GPT 训练工作线程"""
    try:
        proj_dir = get_project_dir(project_name)
        s1_dir = proj_dir

        # 选择 YAML 模板
        yaml_file = (
            "GPT_SoVITS/configs/s1longer.yaml"
            if version == "v1"
            else "GPT_SoVITS/configs/s1longer-v2.yaml"
        )
        yaml_abs = os.path.join(BASE_DIR, yaml_file)
        with open(yaml_abs, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        logs_s1_dir = os.path.join(s1_dir, f"logs_s1_{version}")
        os.makedirs(os.path.join(s1_dir, "logs_s1"), exist_ok=True)
        os.makedirs(logs_s1_dir, exist_ok=True)

        # 修改训练参数
        if not _IS_HALF or _IS_HALF == "False":
            data["train"]["precision"] = "32"
            batch_size = max(1, batch_size // 2)
        data["train"]["batch_size"] = batch_size
        data["train"]["epochs"] = total_epochs
        data["train"]["save_every_n_epoch"] = save_every_epoch
        data["train"]["if_save_every_weights"] = if_save_every_weights
        data["train"]["if_save_latest"] = if_save_latest
        data["train"]["if_dpo"] = if_dpo
        data["train"]["exp_name"] = project_name
        data["train"]["half_weights_save_dir"] = GPT_WEIGHT_DIR_MAP.get(version, "GPT_weights_v2Pro")

        # 预训练模型
        pretrained_s1 = PRETRAINED_GPT_MAP.get(version, PRETRAINED_GPT_MAP["v2Pro"])
        data["pretrained_s1"] = pretrained_s1

        # 数据路径
        data["train_semantic_path"] = os.path.join(s1_dir, "6-name2semantic.tsv")
        data["train_phoneme_path"] = os.path.join(s1_dir, "2-name2text.txt")
        data["output_dir"] = logs_s1_dir

        # 写入临时 config
        os.makedirs(os.path.join(BASE_DIR, "TEMP"), exist_ok=True)
        tmp_config = os.path.join(BASE_DIR, "TEMP", "tmp_s1.yaml")
        with open(tmp_config, "w", encoding="utf-8") as f:
            yaml.dump(data, f, default_flow_style=False, allow_unicode=True)

        _train_log(f"GPT 训练配置已生成: {tmp_config}")
        _train_log(f"版本: {version} | batch_size: {batch_size} | epochs: {total_epochs}")
        _train_log(f"预训练: {pretrained_s1}")
        _train_log(f"语义路径: {data['train_semantic_path']}")
        _train_log(f"音素路径: {data['train_phoneme_path']}")

        env = {
            "_CUDA_VISIBLE_DEVICES": _GPU_INDEX,
            "hz": "25hz",
        }

        cmd = f'"{PYTHON_EXEC}" -s GPT_SoVITS/s1_train.py --config_file "{tmp_config}"'
        _train_log("启动 GPT 训练...")
        ok = _run_train_subprocess_with_log(cmd, env, "GPT")

        if ok:
            train_task["status"] = "done"
            _train_log("GPT 训练完成！")
        else:
            if train_task["status"] == "running":
                train_task["status"] = "error"
                train_task["error"] = "GPT 训练进程异常退出"
                _train_log("GPT 训练失败")

        # 更新项目状态
        try:
            meta = load_project_meta(project_name)
            if train_task["status"] == "done":
                meta["steps"]["train"]["status"] = "done"
            save_project_meta(project_name, meta)
        except Exception:
            pass

    except Exception:
        train_task["status"] = "error"
        train_task["error"] = traceback.format_exc()
        _train_log(f"GPT 训练失败: {train_task['error']}")


# ============================================================
#  模型训练 API
# ============================================================

@app.get("/api/train/check")
async def api_train_check():
    """检查训练前置条件（格式化是否完成）"""
    project = panel_state.get("active_project")
    if not project:
        return {"ready": False, "reason": "未选择项目"}

    proj_dir = get_project_dir(project)
    meta = load_project_meta(project)
    version = meta.get("version", "v2Pro")

    # 检查格式化产物
    has_text = os.path.isfile(os.path.join(proj_dir, "2-name2text.txt"))
    has_semantic = os.path.isfile(os.path.join(proj_dir, "6-name2semantic.tsv"))
    has_hubert = os.path.isdir(os.path.join(proj_dir, "4-cnhubert")) and bool(os.listdir(os.path.join(proj_dir, "4-cnhubert")))

    ready = has_text and has_semantic and has_hubert
    reason = ""
    if not has_text:
        reason = "缺少 2-name2text.txt，请先完成训练集格式化"
    elif not has_semantic:
        reason = "缺少 6-name2semantic.tsv，请先完成训练集格式化"
    elif not has_hubert:
        reason = "缺少 SSL 特征，请先完成训练集格式化"

    # 推荐参数
    defaults = {
        "sovits": {
            "batch_size": _get_default_batch_size(version, "sovits"),
            "epochs": _get_default_epochs(version, "sovits"),
            "save_every": _get_default_save_every(version, "sovits"),
        },
        "gpt": {
            "batch_size": _get_default_batch_size(version, "gpt"),
            "epochs": _get_default_epochs(version, "gpt"),
            "save_every": _get_default_save_every(version, "gpt"),
        },
    }

    # 检查已有训练产物
    sovits_weight_dir = os.path.join(BASE_DIR, SOVITS_WEIGHT_DIR_MAP.get(version, "SoVITS_weights_v2Pro"))
    gpt_weight_dir = os.path.join(BASE_DIR, GPT_WEIGHT_DIR_MAP.get(version, "GPT_weights_v2Pro"))
    existing_sovits = []
    existing_gpt = []
    if os.path.isdir(sovits_weight_dir):
        existing_sovits = [f for f in os.listdir(sovits_weight_dir) if f.endswith(".pth") and project in f]
    if os.path.isdir(gpt_weight_dir):
        existing_gpt = [f for f in os.listdir(gpt_weight_dir) if f.endswith(".ckpt") and project in f]

    return {
        "ready": ready,
        "reason": reason,
        "version": version,
        "defaults": defaults,
        "existing_sovits": existing_sovits,
        "existing_gpt": existing_gpt,
    }


@app.post("/api/train/start")
async def api_train_start(req: TrainStartRequest):
    """启动 SoVITS 或 GPT 训练"""
    project = panel_state.get("active_project")
    if not project:
        raise HTTPException(400, "请先选择一个项目")

    if train_task["status"] == "running":
        raise HTTPException(409, "训练任务正在运行中")

    proj_dir = get_project_dir(project)
    meta = load_project_meta(project)
    version = meta.get("version", "v2Pro")
    target = req.target.lower()

    if target not in ("sovits", "gpt"):
        raise HTTPException(400, f"不支持的训练目标: {target}")

    # 参数处理 (0 = 使用推荐值)
    batch_size = req.batch_size or _get_default_batch_size(version, target)
    total_epochs = req.total_epochs or _get_default_epochs(version, target)
    save_every = req.save_every_epoch or _get_default_save_every(version, target)

    # 重置状态
    train_task["status"] = "running"
    train_task["target"] = target
    train_task["current_epoch"] = 0
    train_task["total_epochs"] = total_epochs
    train_task["progress"] = 0
    train_task["logs"] = []
    train_task["error"] = ""
    train_task["process"] = None

    _train_log(f"启动{target.upper()}训练: 项目={project}, 版本={version}")

    if target == "sovits":
        t = threading.Thread(
            target=_run_train_sovits,
            args=(project, version, batch_size, total_epochs,
                  save_every, req.if_save_latest, req.if_save_every_weights,
                  req.text_low_lr_rate, req.if_grad_ckpt, req.lora_rank),
            daemon=True,
        )
    else:
        t = threading.Thread(
            target=_run_train_gpt,
            args=(project, version, batch_size, total_epochs,
                  save_every, req.if_save_latest, req.if_save_every_weights,
                  req.if_dpo),
            daemon=True,
        )
    t.start()

    return {"success": True, "message": f"{target.upper()} 训练已启动"}


@app.get("/api/train/status")
async def api_train_status():
    """查询训练进度/日志"""
    return {
        "status": train_task["status"],
        "target": train_task["target"],
        "current_epoch": train_task["current_epoch"],
        "total_epochs": train_task["total_epochs"],
        "progress": train_task["progress"],
        "logs": train_task["logs"],
        "error": train_task["error"],
    }


@app.post("/api/train/stop")
async def api_train_stop():
    """终止训练"""
    if train_task["status"] != "running":
        return {"success": False, "message": "没有正在运行的训练任务"}

    proc = train_task.get("process")
    if proc and proc.poll() is None:
        try:
            import signal as _signal
            if sys.platform == "win32":
                proc.terminate()
            else:
                os.killpg(os.getpgid(proc.pid), _signal.SIGTERM)
        except Exception:
            pass

    train_task["status"] = "idle"
    train_task["target"] = ""
    train_task["process"] = None
    _train_log("训练任务已被用户终止")

    return {"success": True, "message": "训练任务已终止"}


@app.get("/api/train/models")
async def api_train_models():
    """列出已训练的模型文件"""
    project = panel_state.get("active_project")
    if not project:
        return {"sovits": [], "gpt": []}

    meta = load_project_meta(project)
    version = meta.get("version", "v2Pro")

    sovits_models = []
    gpt_models = []

    # 扫描所有 SoVITS 权重目录
    sovits_dir = os.path.join(BASE_DIR, SOVITS_WEIGHT_DIR_MAP.get(version, "SoVITS_weights_v2Pro"))
    if os.path.isdir(sovits_dir):
        for fname in sorted(os.listdir(sovits_dir)):
            if fname.endswith(".pth") and project in fname:
                fpath = os.path.join(sovits_dir, fname)
                sovits_models.append({
                    "name": fname,
                    "path": fpath,
                    "size_mb": round(os.path.getsize(fpath) / 1024 / 1024, 1),
                    "mtime": os.path.getmtime(fpath),
                })

    # 扫描所有 GPT 权重目录
    gpt_dir = os.path.join(BASE_DIR, GPT_WEIGHT_DIR_MAP.get(version, "GPT_weights_v2Pro"))
    if os.path.isdir(gpt_dir):
        for fname in sorted(os.listdir(gpt_dir)):
            if fname.endswith(".ckpt") and project in fname:
                fpath = os.path.join(gpt_dir, fname)
                gpt_models.append({
                    "name": fname,
                    "path": fpath,
                    "size_mb": round(os.path.getsize(fpath) / 1024 / 1024, 1),
                    "mtime": os.path.getmtime(fpath),
                })

    return {"sovits": sovits_models, "gpt": gpt_models, "version": version}


# ============================================================
#  推理测试 — 状态 & 工具函数
# ============================================================
INFER_PORT = 9881  # api_v2.py 的端口
REF_AUDIO_DIR = os.path.join(BASE_DIR, "ref_audio")

infer_task = {
    "status": "idle",        # idle / starting / running / error
    "process": None,         # api_v2.py 子进程
    "port": INFER_PORT,
    "sovits_path": "",
    "gpt_path": "",
    "logs": [],
    "error": "",
}
MAX_INFER_LOGS = 200


class InferStartRequest(BaseModel):
    sovits_path: str          # SoVITS 模型路径
    gpt_path: str             # GPT 模型路径


class InferTTSRequest(BaseModel):
    text: str
    text_lang: str = "zh"
    ref_audio_path: str = ""
    prompt_text: str = ""
    prompt_lang: str = ""
    top_k: int = 5
    top_p: float = 1
    temperature: float = 1
    text_split_method: str = "cut5"
    batch_size: int = 1
    speed_factor: float = 1.0
    seed: int = -1
    media_type: str = "wav"
    sample_steps: int = 32
    super_sampling: bool = False
    repetition_penalty: float = 1.35


def _infer_log(msg: str):
    """添加一条推理日志"""
    infer_task["logs"].append(msg)
    if len(infer_task["logs"]) > MAX_INFER_LOGS:
        infer_task["logs"] = infer_task["logs"][-MAX_INFER_LOGS:]


def _write_infer_config(sovits_path: str, gpt_path: str) -> str:
    """写入 tts_infer.yaml 的 custom 段，返回配置文件路径"""
    config_path = os.path.join(BASE_DIR, "GPT_SoVITS", "configs", "tts_infer.yaml")

    # 读取现有配置
    configs = {}
    if os.path.isfile(config_path):
        with open(config_path, "r", encoding="utf-8") as f:
            configs = yaml.safe_load(f) or {}

    # 检测设备
    try:
        import torch as _t
        device = "cuda" if _t.cuda.is_available() else "cpu"
        is_half = _t.cuda.is_available()
    except Exception:
        device = "cpu"
        is_half = False

    # 从 SoVITS 路径推断版本
    version = "v2Pro"  # 默认
    for v in SUPPORTED_VERSIONS:
        if v.lower() in sovits_path.lower():
            version = v
            break

    configs["custom"] = {
        "device": device,
        "is_half": is_half,
        "version": version,
        "t2s_weights_path": gpt_path,
        "vits_weights_path": sovits_path,
        "bert_base_path": "GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large",
        "cnhuhbert_base_path": "GPT_SoVITS/pretrained_models/chinese-hubert-base",
    }

    with open(config_path, "w", encoding="utf-8") as f:
        yaml.dump(configs, f, default_flow_style=False, allow_unicode=True)

    return config_path


def _wait_for_infer_ready(port: int, timeout: int = 120) -> bool:
    """等待推理引擎就绪"""
    import urllib.request
    import urllib.error
    start = time.time()
    while time.time() - start < timeout:
        try:
            url = f"http://127.0.0.1:{port}/speakers_list"
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(2)
    return False


def _start_infer_engine(sovits_path: str, gpt_path: str):
    """启动推理引擎的工作线程"""
    try:
        _infer_log("正在写入推理配置...")
        config_path = _write_infer_config(sovits_path, gpt_path)
        _infer_log(f"配置已写入: {config_path}")
        _infer_log(f"SoVITS: {sovits_path}")
        _infer_log(f"GPT: {gpt_path}")

        port = infer_task["port"]
        cmd = f'"{PYTHON_EXEC}" -s api_v2.py -a 127.0.0.1 -p {port} -c "{config_path}"'
        _infer_log(f"启动命令: {cmd}")

        proc = subprocess.Popen(
            cmd, shell=True,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            cwd=BASE_DIR, encoding="utf-8", errors="replace",
        )
        infer_task["process"] = proc

        # 启动日志读取线程
        def _read_output():
            try:
                for line in proc.stdout:
                    line = line.rstrip()
                    if line:
                        _infer_log(line)
            except Exception:
                pass

        log_thread = threading.Thread(target=_read_output, daemon=True)
        log_thread.start()

        _infer_log(f"等待推理引擎启动 (端口 {port})...")
        ready = _wait_for_infer_ready(port, timeout=120)

        if ready:
            infer_task["status"] = "running"
            _infer_log("推理引擎已就绪！")
        else:
            # 检查进程是否已退出
            if proc.poll() is not None:
                infer_task["status"] = "error"
                infer_task["error"] = "推理引擎进程异常退出"
                _infer_log("推理引擎启动失败：进程已退出")
            else:
                infer_task["status"] = "error"
                infer_task["error"] = "推理引擎启动超时"
                _infer_log("推理引擎启动超时（120秒）")
                try:
                    proc.terminate()
                except Exception:
                    pass

    except Exception:
        infer_task["status"] = "error"
        infer_task["error"] = traceback.format_exc()
        _infer_log(f"启动失败: {infer_task['error']}")


def _list_ref_audios() -> list:
    """列出 ref_audio/ 目录下的参考音频"""
    if not os.path.isdir(REF_AUDIO_DIR):
        return []
    audio_exts = {".wav", ".mp3", ".ogg", ".flac"}
    refs = []
    for fname in sorted(os.listdir(REF_AUDIO_DIR)):
        ext = os.path.splitext(fname)[1].lower()
        if ext not in audio_exts:
            continue
        fpath = os.path.join(REF_AUDIO_DIR, fname)
        name_no_ext = os.path.splitext(fname)[0]
        # 查找同名 .txt
        txt_path = os.path.join(REF_AUDIO_DIR, f"{name_no_ext}.txt")
        prompt_text = ""
        if os.path.isfile(txt_path):
            try:
                with open(txt_path, "r", encoding="utf-8") as f:
                    prompt_text = f.read().strip()
            except Exception:
                pass
        refs.append({
            "name": fname,
            "path": fpath,
            "prompt_text": prompt_text,
        })
    return refs


def _list_project_audios(project: str) -> list:
    """列出项目的切分音频（可作为参考音频使用）"""
    slicer_dir = os.path.join(BASE_DIR, "output", "slicer_opt", project)
    if not os.path.isdir(slicer_dir):
        return []
    audio_exts = {".wav", ".mp3", ".ogg", ".flac"}
    audios = []
    for fname in sorted(os.listdir(slicer_dir))[:50]:  # 最多 50 个
        ext = os.path.splitext(fname)[1].lower()
        if ext not in audio_exts:
            continue
        fpath = os.path.join(slicer_dir, fname)
        duration = get_audio_duration(fpath)
        audios.append({
            "name": fname,
            "path": fpath,
            "duration": duration,
        })
    return audios


# ============================================================
#  推理测试 API
# ============================================================

@app.get("/api/infer/check")
async def api_infer_check():
    """检查推理前置条件"""
    project = panel_state.get("active_project")
    if not project:
        return {"ready": False, "reason": "未选择项目", "has_models": False}

    meta = load_project_meta(project)
    version = meta.get("version", "v2Pro")

    # 检查是否有训练好的模型
    sovits_dir = os.path.join(BASE_DIR, SOVITS_WEIGHT_DIR_MAP.get(version, "SoVITS_weights_v2Pro"))
    gpt_dir = os.path.join(BASE_DIR, GPT_WEIGHT_DIR_MAP.get(version, "GPT_weights_v2Pro"))

    has_sovits = False
    has_gpt = False
    if os.path.isdir(sovits_dir):
        has_sovits = any(f.endswith(".pth") and project in f for f in os.listdir(sovits_dir))
    if os.path.isdir(gpt_dir):
        has_gpt = any(f.endswith(".ckpt") and project in f for f in os.listdir(gpt_dir))

    has_models = has_sovits and has_gpt
    ready = has_models
    reason = ""
    if not has_sovits:
        reason = "缺少 SoVITS 训练模型，请先完成 SoVITS 训练"
    elif not has_gpt:
        reason = "缺少 GPT 训练模型，请先完成 GPT 训练"

    # 检查参考音频
    has_ref = len(_list_ref_audios()) > 0

    return {
        "ready": ready,
        "reason": reason,
        "has_models": has_models,
        "has_ref_audio": has_ref,
        "version": version,
        "engine_status": infer_task["status"],
    }


@app.get("/api/infer/models")
async def api_infer_models():
    """列出可用模型 + 参考音频"""
    project = panel_state.get("active_project")
    if not project:
        return {"sovits": [], "gpt": [], "ref_audios": [], "project_audios": []}

    meta = load_project_meta(project)
    version = meta.get("version", "v2Pro")

    sovits_models = []
    gpt_models = []

    # 扫描 SoVITS 权重
    sovits_dir = os.path.join(BASE_DIR, SOVITS_WEIGHT_DIR_MAP.get(version, "SoVITS_weights_v2Pro"))
    if os.path.isdir(sovits_dir):
        for fname in sorted(os.listdir(sovits_dir)):
            if fname.endswith(".pth") and project in fname:
                fpath = os.path.join(sovits_dir, fname)
                sovits_models.append({
                    "name": fname,
                    "path": fpath,
                    "size_mb": round(os.path.getsize(fpath) / 1024 / 1024, 1),
                })

    # 扫描 GPT 权重
    gpt_dir = os.path.join(BASE_DIR, GPT_WEIGHT_DIR_MAP.get(version, "GPT_weights_v2Pro"))
    if os.path.isdir(gpt_dir):
        for fname in sorted(os.listdir(gpt_dir)):
            if fname.endswith(".ckpt") and project in fname:
                fpath = os.path.join(gpt_dir, fname)
                gpt_models.append({
                    "name": fname,
                    "path": fpath,
                    "size_mb": round(os.path.getsize(fpath) / 1024 / 1024, 1),
                })

    ref_audios = _list_ref_audios()
    project_audios = _list_project_audios(project)

    return {
        "sovits": sovits_models,
        "gpt": gpt_models,
        "ref_audios": ref_audios,
        "project_audios": project_audios,
        "version": version,
    }


@app.post("/api/infer/start")
async def api_infer_start(req: InferStartRequest):
    """启动推理引擎子进程"""
    if infer_task["status"] in ("starting", "running"):
        raise HTTPException(409, "推理引擎已在运行中")

    sovits_path = req.sovits_path.strip()
    gpt_path = req.gpt_path.strip()

    if not sovits_path or not os.path.isfile(sovits_path):
        raise HTTPException(400, f"SoVITS 模型不存在: {sovits_path}")
    if not gpt_path or not os.path.isfile(gpt_path):
        raise HTTPException(400, f"GPT 模型不存在: {gpt_path}")

    # 重置状态
    infer_task["status"] = "starting"
    infer_task["sovits_path"] = sovits_path
    infer_task["gpt_path"] = gpt_path
    infer_task["logs"] = []
    infer_task["error"] = ""
    infer_task["process"] = None

    _infer_log(f"启动推理引擎...")

    t = threading.Thread(
        target=_start_infer_engine,
        args=(sovits_path, gpt_path),
        daemon=True,
    )
    t.start()

    return {"success": True, "message": "推理引擎正在启动..."}


@app.get("/api/infer/status")
async def api_infer_status():
    """查询推理引擎状态"""
    # 检查进程是否意外退出
    if infer_task["status"] == "running" and infer_task["process"]:
        if infer_task["process"].poll() is not None:
            infer_task["status"] = "error"
            infer_task["error"] = "推理引擎进程意外退出"
            _infer_log("推理引擎进程意外退出")

    return {
        "status": infer_task["status"],
        "port": infer_task["port"],
        "sovits_path": infer_task["sovits_path"],
        "gpt_path": infer_task["gpt_path"],
        "logs": infer_task["logs"],
        "error": infer_task["error"],
    }


@app.post("/api/infer/stop")
async def api_infer_stop():
    """终止推理引擎"""
    proc = infer_task.get("process")
    if proc and proc.poll() is None:
        try:
            if sys.platform == "win32":
                proc.terminate()
            else:
                import signal as _signal
                os.killpg(os.getpgid(proc.pid), _signal.SIGTERM)
        except Exception:
            pass

    infer_task["status"] = "idle"
    infer_task["process"] = None
    infer_task["sovits_path"] = ""
    infer_task["gpt_path"] = ""
    _infer_log("推理引擎已停止")

    return {"success": True, "message": "推理引擎已停止"}


@app.post("/api/infer/tts")
async def api_infer_tts(req: InferTTSRequest):
    """代理 TTS 请求到推理引擎"""
    if infer_task["status"] != "running":
        raise HTTPException(400, "推理引擎未运行，请先启动")

    import urllib.request
    import urllib.error

    port = infer_task["port"]
    url = f"http://127.0.0.1:{port}/tts"

    # 构建请求体
    payload = {
        "text": req.text,
        "text_lang": req.text_lang.lower(),
        "ref_audio_path": req.ref_audio_path,
        "prompt_text": req.prompt_text,
        "prompt_lang": req.prompt_lang.lower() if req.prompt_lang else req.text_lang.lower(),
        "top_k": req.top_k,
        "top_p": req.top_p,
        "temperature": req.temperature,
        "text_split_method": req.text_split_method,
        "batch_size": req.batch_size,
        "speed_factor": req.speed_factor,
        "seed": req.seed,
        "media_type": req.media_type,
        "streaming_mode": False,
        "parallel_infer": True,
        "repetition_penalty": req.repetition_penalty,
        "sample_steps": req.sample_steps,
        "super_sampling": req.super_sampling,
    }

    try:
        data = json.dumps(payload).encode("utf-8")
        http_req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(http_req, timeout=120) as resp:
            audio_data = resp.read()
            content_type = resp.headers.get("Content-Type", "audio/wav")

        return Response(content=audio_data, media_type=content_type)

    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        _infer_log(f"TTS 请求失败: {e.code} {body}")
        raise HTTPException(e.code, f"推理引擎返回错误: {body}")
    except urllib.error.URLError as e:
        _infer_log(f"TTS 连接失败: {e.reason}")
        raise HTTPException(502, f"无法连接推理引擎: {e.reason}")
    except Exception as e:
        _infer_log(f"TTS 请求异常: {traceback.format_exc()}")
        raise HTTPException(500, f"TTS 请求异常: {str(e)}")


@app.get("/api/infer/ref_audio")
async def api_infer_ref_audio(path: str):
    """提供参考音频文件（自动转换为浏览器可播放的 16-bit PCM WAV）"""
    if not os.path.isfile(path):
        raise HTTPException(404, f"音频文件不存在: {path}")

    ext = os.path.splitext(path)[1].lower()

    # 对 WAV 文件：读取并转为 16-bit PCM（浏览器不支持 32-bit float WAV）
    if ext == ".wav":
        try:
            import io
            import wave
            sr, data = wavfile.read(path)

            # 如果已经是 int16 且单声道/双声道，直接返回原文件
            if data.dtype == np.int16:
                return FileResponse(path, media_type="audio/wav")

            # 转换为 int16
            if data.dtype == np.float32 or data.dtype == np.float64:
                # float → 归一化到 [-1, 1] 然后缩放到 int16 范围
                peak = np.max(np.abs(data)) if np.max(np.abs(data)) > 0 else 1.0
                data = (data / peak * 32767).astype(np.int16)
            elif data.dtype == np.int32:
                data = (data >> 16).astype(np.int16)
            else:
                data = data.astype(np.int16)

            # 写入内存中的 WAV
            buf = io.BytesIO()
            wavfile.write(buf, sr, data)
            buf.seek(0)
            return Response(content=buf.read(), media_type="audio/wav")
        except Exception:
            # 转换失败则原样返回
            pass

    content_type = mimetypes.guess_type(path)[0] or "audio/wav"
    return FileResponse(path, media_type=content_type)


@app.post("/api/infer/ref_audio/upload")
async def api_infer_ref_audio_upload(file: UploadFile = File(...)):
    """上传参考音频文件到 ref_audio/ 目录"""
    if not file.filename:
        raise HTTPException(400, "文件名为空")

    # 验证扩展名
    audio_exts = {".wav", ".mp3", ".ogg", ".flac"}
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in audio_exts:
        raise HTTPException(400, f"不支持的音频格式: {ext}，支持: {', '.join(audio_exts)}")

    os.makedirs(REF_AUDIO_DIR, exist_ok=True)

    # 安全文件名（避免路径注入）
    safe_name = os.path.basename(file.filename)
    dst_path = os.path.join(REF_AUDIO_DIR, safe_name)

    # 如果同名文件存在，自动添加序号
    if os.path.isfile(dst_path):
        name_no_ext = os.path.splitext(safe_name)[0]
        counter = 1
        while os.path.isfile(dst_path):
            dst_path = os.path.join(REF_AUDIO_DIR, f"{name_no_ext}_{counter}{ext}")
            counter += 1
        safe_name = os.path.basename(dst_path)

    try:
        content = await file.read()
        with open(dst_path, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(500, f"保存文件失败: {str(e)}")

    return {
        "success": True,
        "filename": safe_name,
        "path": dst_path,
        "size_kb": round(os.path.getsize(dst_path) / 1024, 1),
    }


@app.delete("/api/infer/ref_audio")
async def api_infer_ref_audio_delete(path: str):
    """删除 ref_audio/ 目录中的指定参考音频文件"""
    if not path:
        raise HTTPException(400, "路径不能为空")

    # 安全检查：确认文件在 REF_AUDIO_DIR 内
    real_path = os.path.realpath(path)
    real_ref_dir = os.path.realpath(REF_AUDIO_DIR)
    if not real_path.startswith(real_ref_dir):
        raise HTTPException(403, "只能删除 ref_audio/ 目录内的文件")

    if not os.path.isfile(real_path):
        raise HTTPException(404, f"文件不存在: {path}")

    filename = os.path.basename(real_path)
    os.remove(real_path)

    # 同时删除同名 .txt 文件
    name_no_ext = os.path.splitext(filename)[0]
    txt_path = os.path.join(REF_AUDIO_DIR, f"{name_no_ext}.txt")
    if os.path.isfile(txt_path):
        os.remove(txt_path)

    return {"success": True, "deleted": filename}


# ============================================================
#  部署到酒馆 API (Phase 1: 路径配置)
# ============================================================

@app.get("/api/deploy/config")
async def api_deploy_config_get():
    """读取已保存的 GSVI 路径配置"""
    gsvi_path = panel_state.get("gsvi_path", "")
    return {
        "gsvi_path": gsvi_path,
        "validated": bool(gsvi_path and os.path.isfile(os.path.join(gsvi_path, "gsvi.py"))),
    }


@app.post("/api/deploy/config")
async def api_deploy_config_save(req: DeployConfigRequest):
    """保存 GSVI 路径到 panel_state.json"""
    gsvi_path = req.gsvi_path.strip().strip('"')
    panel_state["gsvi_path"] = gsvi_path
    save_panel_state()
    return {"success": True, "gsvi_path": gsvi_path}


@app.post("/api/deploy/validate")
async def api_deploy_validate(req: DeployConfigRequest):
    """验证路径是否为有效的 GSVI 目录"""
    gsvi_path = req.gsvi_path.strip().strip('"')

    if not gsvi_path:
        return {"valid": False, "reason": "路径不能为空"}

    if not os.path.isdir(gsvi_path):
        return {"valid": False, "reason": f"目录不存在: {gsvi_path}"}

    # 检查关键文件/目录
    checks = [
        ("gsvi.py", "gsvi.py（GSVI 主入口）"),
        ("api_v2.py", "api_v2.py（推理 API）"),
    ]
    check_dirs = [
        (os.path.join("GPT_SoVITS", "configs"), "GPT_SoVITS/configs/（模型配置目录）"),
    ]

    missing = []
    for rel_path, desc in checks:
        if not os.path.isfile(os.path.join(gsvi_path, rel_path)):
            missing.append(desc)
    for rel_path, desc in check_dirs:
        if not os.path.isdir(os.path.join(gsvi_path, rel_path)):
            missing.append(desc)

    if missing:
        return {
            "valid": False,
            "reason": f"缺少关键文件: {', '.join(missing)}",
            "missing": missing,
        }

    # 验证通过，自动保存路径
    panel_state["gsvi_path"] = gsvi_path
    save_panel_state()

    # 收集一些基本信息
    has_runtime = os.path.isdir(os.path.join(gsvi_path, "runtime"))
    has_models = os.path.isdir(os.path.join(gsvi_path, "models"))
    has_ref_audio = os.path.isdir(os.path.join(gsvi_path, "ref_audio"))

    return {
        "valid": True,
        "info": {
            "has_runtime": has_runtime,
            "has_models": has_models,
            "has_ref_audio": has_ref_audio,
        },
    }


# ============================================================
#  部署到酒馆 API (Phase 2: 环境准备)
# ============================================================

# 复制任务全局状态
deploy_env_state = {
    "status": "idle",        # idle | copying | installing | done | error
    "phase": "",             # "runtime" | "pretrained" | "pip"
    "progress_pct": 0,
    "log": [],
    "error": "",
}
_DEPLOY_ENV_LOG_MAX = 200

def _deploy_env_log(msg):
    """向 deploy_env_state 添加日志"""
    deploy_env_state["log"].append(msg)
    if len(deploy_env_state["log"]) > _DEPLOY_ENV_LOG_MAX:
        deploy_env_state["log"] = deploy_env_state["log"][-_DEPLOY_ENV_LOG_MAX:]

# 需要安装的额外 pip 包
GSVI_EXTRA_DEPS = ["soundfile", "huggingface_hub", "tokenizers", "wmi", "loguru", "pyfiglet", "pydub"]


@app.get("/api/deploy/env_status")
async def api_deploy_env_status():
    """检测 GSVI 目标目录的环境就绪状态"""
    gsvi_path = panel_state.get("gsvi_path", "")
    if not gsvi_path or not os.path.isdir(gsvi_path):
        return {"error": "GSVI 路径未配置或不存在"}

    # 1. runtime/ 检测
    runtime_dir = os.path.join(gsvi_path, "runtime")
    runtime_python = os.path.join(runtime_dir, "python.exe")
    runtime_ready = os.path.isfile(runtime_python)

    # 2. pretrained_models/ 检测（检查几个关键文件）
    pretrained_dir = os.path.join(gsvi_path, "GPT_SoVITS", "pretrained_models")
    pretrained_checks = [
        "chinese-hubert-base",
        "chinese-roberta-wwm-ext-large",
    ]
    pretrained_ready = all(
        os.path.isdir(os.path.join(pretrained_dir, d)) for d in pretrained_checks
    )

    # 3. pip deps 检测（只有 runtime 就绪时才检查）
    pip_ready = False
    pip_missing = []
    if runtime_ready:
        try:
            result = subprocess.run(
                [runtime_python, "-c",
                 "import importlib, sys; mods=" + repr(GSVI_EXTRA_DEPS) +
                 "; missing=[m for m in mods if importlib.util.find_spec(m) is None];"
                 "print(','.join(missing))"],
                capture_output=True, text=True, timeout=30
            )
            output = result.stdout.strip()
            if output:
                pip_missing = [m for m in output.split(",") if m]
            pip_ready = len(pip_missing) == 0
        except Exception:
            pip_missing = GSVI_EXTRA_DEPS[:]

    all_ready = runtime_ready and pretrained_ready and pip_ready

    return {
        "all_ready": all_ready,
        "runtime": {"ready": runtime_ready, "path": runtime_dir},
        "pretrained": {"ready": pretrained_ready, "path": pretrained_dir},
        "pip": {"ready": pip_ready, "missing": pip_missing},
        "copy_status": deploy_env_state["status"],
    }


@app.post("/api/deploy/copy_env")
async def api_deploy_copy_env():
    """启动后台任务：复制 runtime/ + pretrained_models/ + 安装 pip 依赖"""
    if deploy_env_state["status"] in ("copying", "installing"):
        return {"success": False, "reason": "复制任务已在进行中"}

    gsvi_path = panel_state.get("gsvi_path", "")
    if not gsvi_path or not os.path.isdir(gsvi_path):
        return {"success": False, "reason": "GSVI 路径未配置"}

    # 重置状态
    deploy_env_state.update({
        "status": "copying",
        "phase": "runtime",
        "progress_pct": 0,
        "log": [],
        "error": "",
    })

    def _do_copy():
        try:
            src_runtime = os.path.join(BASE_DIR, "runtime")
            dst_runtime = os.path.join(gsvi_path, "runtime")
            src_pretrained = os.path.join(BASE_DIR, "GPT_SoVITS", "pretrained_models")
            dst_pretrained = os.path.join(gsvi_path, "GPT_SoVITS", "pretrained_models")

            # --- Phase 1: runtime/ ---
            if os.path.isfile(os.path.join(dst_runtime, "python.exe")):
                _deploy_env_log("✅ runtime/ 已存在，跳过复制")
                deploy_env_state["progress_pct"] = 50
            else:
                deploy_env_state["phase"] = "runtime"
                _deploy_env_log(f"📁 开始复制 runtime/ ...")
                _deploy_env_log(f"   源: {src_runtime}")
                _deploy_env_log(f"   目标: {dst_runtime}")

                if not os.path.isdir(src_runtime):
                    raise RuntimeError(f"训练版 runtime/ 不存在: {src_runtime}")

                # 用 robocopy 多线程复制
                cmd = [
                    "robocopy", src_runtime, dst_runtime,
                    "/E", "/MT:8", "/NJH", "/NJS", "/NDL", "/NP", "/NFL",
                    "/R:2", "/W:1"
                ]
                _deploy_env_log(f"   执行: robocopy /E /MT:8 ...")
                proc = subprocess.Popen(
                    cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, encoding="utf-8", errors="replace"
                )
                line_count = 0
                for line in proc.stdout:
                    line = line.strip()
                    if line:
                        line_count += 1
                        # 每 50 行记一条日志，避免刷屏
                        if line_count % 50 == 0:
                            _deploy_env_log(f"   ... 已处理 {line_count} 项")
                        # 粗略进度：runtime 占 0-50%
                        deploy_env_state["progress_pct"] = min(45, int(line_count / 20))
                proc.wait()
                # robocopy 返回码 <8 表示成功
                if proc.returncode >= 8:
                    raise RuntimeError(f"robocopy 失败 (code={proc.returncode})")
                _deploy_env_log(f"✅ runtime/ 复制完成 ({line_count} 项)")
                deploy_env_state["progress_pct"] = 50

            # --- Phase 2: pretrained_models/ ---
            pretrained_checks = ["chinese-hubert-base", "chinese-roberta-wwm-ext-large"]
            if all(os.path.isdir(os.path.join(dst_pretrained, d)) for d in pretrained_checks):
                _deploy_env_log("✅ pretrained_models/ 已存在，跳过复制")
                deploy_env_state["progress_pct"] = 80
            else:
                deploy_env_state["phase"] = "pretrained"
                _deploy_env_log(f"📁 开始复制 pretrained_models/ ...")

                if not os.path.isdir(src_pretrained):
                    raise RuntimeError(f"训练版 pretrained_models/ 不存在: {src_pretrained}")

                cmd = [
                    "robocopy", src_pretrained, dst_pretrained,
                    "/E", "/MT:8", "/NJH", "/NJS", "/NDL", "/NP", "/NFL",
                    "/R:2", "/W:1"
                ]
                _deploy_env_log(f"   执行: robocopy /E /MT:8 ...")
                proc = subprocess.Popen(
                    cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, encoding="utf-8", errors="replace"
                )
                line_count = 0
                for line in proc.stdout:
                    line = line.strip()
                    if line:
                        line_count += 1
                        if line_count % 30 == 0:
                            _deploy_env_log(f"   ... 已处理 {line_count} 项")
                        deploy_env_state["progress_pct"] = min(78, 50 + int(line_count / 10))
                proc.wait()
                if proc.returncode >= 8:
                    raise RuntimeError(f"robocopy pretrained 失败 (code={proc.returncode})")
                _deploy_env_log(f"✅ pretrained_models/ 复制完成 ({line_count} 项)")
                deploy_env_state["progress_pct"] = 80

            # --- Phase 3: pip install ---
            deploy_env_state["phase"] = "pip"
            deploy_env_state["status"] = "installing"
            runtime_python = os.path.join(dst_runtime, "python.exe")

            if not os.path.isfile(runtime_python):
                raise RuntimeError(f"python.exe 不存在: {runtime_python}")

            _deploy_env_log(f"📦 安装额外依赖: {', '.join(GSVI_EXTRA_DEPS)}")
            cmd = [
                runtime_python, "-m", "pip", "install",
                "--quiet", "--disable-pip-version-check",
            ] + GSVI_EXTRA_DEPS
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
                cwd=gsvi_path,
            )
            for line in proc.stdout:
                line = line.strip()
                if line:
                    _deploy_env_log(f"   pip: {line}")
            proc.wait()
            deploy_env_state["progress_pct"] = 95

            if proc.returncode != 0:
                _deploy_env_log(f"⚠️ pip install 返回码 {proc.returncode}（部分包可能安装失败）")
            else:
                _deploy_env_log("✅ pip 依赖安装完成")

            deploy_env_state["progress_pct"] = 100
            deploy_env_state["status"] = "done"
            _deploy_env_log("🎉 环境准备全部完成！")

        except Exception as e:
            deploy_env_state["status"] = "error"
            deploy_env_state["error"] = str(e)
            _deploy_env_log(f"❌ 错误: {str(e)}")

    t = threading.Thread(target=_do_copy, daemon=True)
    t.start()
    return {"success": True}


@app.get("/api/deploy/copy_env/status")
async def api_deploy_copy_env_status():
    """轮询环境复制进度"""
    return {
        "status": deploy_env_state["status"],
        "phase": deploy_env_state["phase"],
        "progress_pct": deploy_env_state["progress_pct"],
        "log": deploy_env_state["log"][-30:],   # 最近 30 条
        "error": deploy_env_state["error"],
    }


# ============================================================
#  部署到酒馆 API (Phase 3: 模型部署 + 配置)
# ============================================================

class DeployModelRequest(BaseModel):
    sovits_path: str
    gpt_path: str


@app.post("/api/deploy/model/copy")
async def api_deploy_model_copy(req: DeployModelRequest):
    """复制 SoVITS + GPT 权重到 GSVI models/<version>/<project>/"""
    gsvi_path = panel_state.get("gsvi_path", "")
    if not gsvi_path or not os.path.isdir(gsvi_path):
        return {"success": False, "reason": "GSVI 路径未配置或不存在"}

    project = panel_state.get("active_project", "")
    if not project:
        return {"success": False, "reason": "未选择活跃项目"}

    sovits_path = req.sovits_path
    gpt_path = req.gpt_path

    if not os.path.isfile(sovits_path):
        return {"success": False, "reason": f"SoVITS 模型文件不存在: {sovits_path}"}
    if not os.path.isfile(gpt_path):
        return {"success": False, "reason": f"GPT 模型文件不存在: {gpt_path}"}

    # 从路径推断版本
    version = "v2Pro"
    for v in SUPPORTED_VERSIONS:
        if v.lower() in sovits_path.lower():
            version = v
            break

    # 目标目录: models/<version>/<project>/
    target_dir = os.path.join(gsvi_path, "models", version, project)
    os.makedirs(target_dir, exist_ok=True)

    results = []
    try:
        # 复制 SoVITS
        sovits_dst = os.path.join(target_dir, os.path.basename(sovits_path))
        shutil.copy2(sovits_path, sovits_dst)
        results.append({"type": "SoVITS", "src": sovits_path, "dst": sovits_dst,
                        "size_mb": round(os.path.getsize(sovits_dst) / 1024 / 1024, 1)})

        # 复制 GPT
        gpt_dst = os.path.join(target_dir, os.path.basename(gpt_path))
        shutil.copy2(gpt_path, gpt_dst)
        results.append({"type": "GPT", "src": gpt_path, "dst": gpt_dst,
                        "size_mb": round(os.path.getsize(gpt_dst) / 1024 / 1024, 1)})

    except Exception as e:
        return {"success": False, "reason": f"复制失败: {str(e)}"}

    return {
        "success": True,
        "version": version,
        "project": project,
        "target_dir": target_dir,
        "files": results,
    }


@app.post("/api/deploy/model/config")
async def api_deploy_model_config(req: DeployModelRequest):
    """修改 GSVI 的 tts_infer.yaml，写入模型路径"""
    gsvi_path = panel_state.get("gsvi_path", "")
    if not gsvi_path or not os.path.isdir(gsvi_path):
        return {"success": False, "reason": "GSVI 路径未配置或不存在"}

    project = panel_state.get("active_project", "")
    if not project:
        return {"success": False, "reason": "未选择活跃项目"}

    config_path = os.path.join(gsvi_path, "GPT_SoVITS", "configs", "tts_infer.yaml")
    if not os.path.isfile(config_path):
        return {"success": False, "reason": f"配置文件不存在: {config_path}"}

    # 从路径推断版本
    version = "v2Pro"
    for v in SUPPORTED_VERSIONS:
        if v.lower() in req.sovits_path.lower():
            version = v
            break

    # 构建 GSVI 内的相对路径
    sovits_rel = f"models/{version}/{project}/{os.path.basename(req.sovits_path)}"
    gpt_rel = f"models/{version}/{project}/{os.path.basename(req.gpt_path)}"

    # 检测设备
    try:
        import torch as _t
        device = "cuda" if _t.cuda.is_available() else "cpu"
        is_half = _t.cuda.is_available()
    except Exception:
        device = "cpu"
        is_half = False

    try:
        # 读取现有配置
        with open(config_path, "r", encoding="utf-8") as f:
            configs = yaml.safe_load(f) or {}

        # 更新 custom 段
        configs["custom"] = {
            "device": device,
            "is_half": is_half,
            "version": version,
            "t2s_weights_path": gpt_rel,
            "vits_weights_path": sovits_rel,
            "bert_base_path": "GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large",
            "cnhuhbert_base_path": "GPT_SoVITS/pretrained_models/chinese-hubert-base",
        }

        # 同时更新对应版本段
        if version in configs:
            configs[version]["t2s_weights_path"] = gpt_rel
            configs[version]["vits_weights_path"] = sovits_rel
            configs[version]["device"] = device
            configs[version]["is_half"] = is_half

        # 备份 + 写入
        backup_path = config_path + ".bak"
        shutil.copy2(config_path, backup_path)

        with open(config_path, "w", encoding="utf-8") as f:
            yaml.dump(configs, f, default_flow_style=False, allow_unicode=True)

        return {
            "success": True,
            "config_path": config_path,
            "version": version,
            "sovits_rel": sovits_rel,
            "gpt_rel": gpt_rel,
            "device": device,
        }
    except Exception as e:
        return {"success": False, "reason": f"配置写入失败: {str(e)}"}


# SillyTavern 兼容层代码模板
_ST_COMPAT_TEMPLATE = '''
# ============================================================
# SillyTavern GPT-SoVITS Adapter 兼容层 (自动注入)
# ============================================================
# ref_audio/ 目录结构（按角色组织）:
#   ref_audio/
#   └── {project_name}/
#       ├── default.wav + .txt    ← 默认情感
#       ├── happy.wav + .txt
#       └── whisper.wav + .txt
#
# target_voice 格式:
#   "{project_name}"        → ref_audio/{project_name}/default.wav
#   "{project_name}/happy"  → ref_audio/{project_name}/happy.wav
# ============================================================

from typing import Any, Union

REF_AUDIO_DIR = os.path.join(now_dir, "ref_audio")
os.makedirs(REF_AUDIO_DIR, exist_ok=True)

class ST_TTS_Request(BaseModel):
    """SillyTavern 发来的请求格式，允许额外字段"""
    text: str = ""
    text_lang: str = "zh"
    ref_audio_path: str = None
    prompt_lang: str = None
    prompt_text: str = ""
    target_voice: str = None
    card_name: Any = None
    use_st_adapter: bool = False
    text_split_method: str = "cut5"
    batch_size: int = 1
    media_type: str = "wav"
    streaming_mode: Union[bool, int, str] = False
    top_k: int = 18
    top_p: float = 0.45
    temperature: float = 0.1
    speed_factor: float = 0.9
    seed: int = -1
    parallel_infer: bool = True
    repetition_penalty: float = 1.35
    sample_steps: int = 32
    super_sampling: bool = False

    class Config:
        extra = "allow"

def _find_ref_audio(character: str, emotion: str = "default"):
    """根据 角色 + 情感 在 ref_audio/角色/ 目录下查找参考音频和文本"""
    char_dir = os.path.join(REF_AUDIO_DIR, character)
    if not os.path.isdir(char_dir):
        return None, ""

    for ext in ["wav", "mp3", "ogg", "flac"]:
        audio_path = os.path.join(char_dir, f"{{emotion}}.{{ext}}")
        if os.path.exists(audio_path):
            txt_path = os.path.join(char_dir, f"{{emotion}}.txt")
            prompt_text = ""
            if os.path.exists(txt_path):
                with open(txt_path, "r", encoding="utf-8") as f:
                    prompt_text = f.read().strip()
            return audio_path, prompt_text

    # emotion 找不到时 fallback 到 default
    if emotion != "default":
        print(f"[SillyTavern] 情感 '{{emotion}}' 未找到，fallback 到 default")
        return _find_ref_audio(character, "default")

    return None, ""

def _get_characters():
    """扫描 ref_audio/ 下的子目录作为角色列表"""
    characters = []
    if not os.path.isdir(REF_AUDIO_DIR):
        return characters
    for name in sorted(os.listdir(REF_AUDIO_DIR)):
        char_dir = os.path.join(REF_AUDIO_DIR, name)
        if os.path.isdir(char_dir) and not name.startswith('.'):
            characters.append(name)
    return characters

def _get_emotions(character: str):
    """扫描 ref_audio/角色/ 下的音频文件名作为情感列表"""
    emotions = []
    char_dir = os.path.join(REF_AUDIO_DIR, character)
    if not os.path.isdir(char_dir):
        return emotions
    seen = set()
    for f in sorted(os.listdir(char_dir)):
        name, ext = os.path.splitext(f)
        if ext.lower() in ('.wav', '.mp3', '.ogg', '.flac') and not name.startswith('.'):
            if name not in seen:
                seen.add(name)
                emotions.append(name)
    return emotions

@APP.post("/")
async def st_tts_endpoint(request: ST_TTS_Request):
    """SillyTavern 兼容入口: 解析 target_voice 为 角色/情感"""
    req = request.dict()

    target = req.get("target_voice", "") or ""
    character = target
    emotion = "default"

    if "/" in target:
        parts = target.split("/", 1)
        character = parts[0]
        emotion = parts[1] if parts[1] else "default"

    if not character:
        character = "{project_name}"

    audio_path, prompt_text = _find_ref_audio(character, emotion)
    if audio_path is None:
        return JSONResponse(status_code=400, content={{
            "message": f"找不到参考音频! 请创建 ref_audio/{{character}}/{{emotion}}.wav"
        }})
    req["ref_audio_path"] = audio_path
    if not req.get("prompt_text"):
        req["prompt_text"] = prompt_text

    if not req.get("prompt_lang"):
        req["prompt_lang"] = "{default_lang}"

    sm = req.get("streaming_mode", False)
    if isinstance(sm, str):
        req["streaming_mode"] = 1 if sm.lower() == "true" else 0

    if req.get("media_type", "wav") == "auto":
        req["media_type"] = "wav"

    for key in ["target_voice", "card_name", "use_st_adapter"]:
        req.pop(key, None)

    print(f"[SillyTavern] character={{character}} emotion={{emotion}} text={{req.get('text', '')[:30]}}...")
    return await tts_handle(req)

@APP.get("/speakers_list")
async def speakers_list_endpoint():
    return JSONResponse(status_code=200, content=_get_characters() or ["{project_name}"])

@APP.get("/speakers")
async def speakers_endpoint():
    """返回角色列表（扫描 ref_audio/ 下的子目录）"""
    characters = _get_characters()
    voices = [{{"name": c, "voice_id": c}} for c in characters]
    if not voices:
        voices.append({{"name": "{project_name}", "voice_id": "{project_name}"}})
    print(f"[SillyTavern] 角色列表: {{[v['name'] for v in voices]}}")
    return JSONResponse(status_code=200, content=voices)

@APP.get("/character_emotions")
async def character_emotions_endpoint(character: str = ""):
    if not character:
        return JSONResponse(status_code=400, content={{"message": "character parameter is required"}})
    emotions = _get_emotions(character)
    return JSONResponse(status_code=200, content=emotions)
'''


@app.post("/api/deploy/model/patch_api")
async def api_deploy_model_patch_api():
    """检测并注入 SillyTavern 兼容层到 GSVI 的 api_v2.py"""
    gsvi_path = panel_state.get("gsvi_path", "")
    if not gsvi_path or not os.path.isdir(gsvi_path):
        return {"success": False, "reason": "GSVI 路径未配置或不存在"}

    project = panel_state.get("active_project", "")
    if not project:
        return {"success": False, "reason": "未选择活跃项目"}

    api_file = os.path.join(gsvi_path, "api_v2.py")
    if not os.path.isfile(api_file):
        return {"success": False, "reason": f"api_v2.py 不存在: {api_file}"}

    # 读取文件内容
    with open(api_file, "r", encoding="utf-8") as f:
        content = f.read()

    # 检测是否已注入
    if "ST_TTS_Request" in content:
        return {
            "success": True,
            "already_patched": True,
            "detail": "SillyTavern 兼容层已存在，无需注入",
        }

    # 生成注入代码
    patch_code = _ST_COMPAT_TEMPLATE.format(
        project_name=project,
        default_lang="zh",
    )

    # 找到 if __name__ == "__main__": 行并在其前面注入
    main_marker = 'if __name__ == "__main__":'
    if main_marker not in content:
        # 无 main 入口，追加到文件末尾
        content = content.rstrip() + "\n\n" + patch_code + "\n"
    else:
        content = content.replace(main_marker, patch_code + "\n\n" + main_marker)

    # 备份 + 写入
    backup_path = api_file + ".bak"
    shutil.copy2(api_file, backup_path)

    with open(api_file, "w", encoding="utf-8") as f:
        f.write(content)

    return {
        "success": True,
        "already_patched": False,
        "detail": f"SillyTavern 兼容层已注入，默认角色名: {project}",
        "backup": backup_path,
    }


# ============================================================
#  部署到酒馆 API (Phase 4: 参考音频 + 情感)
# ============================================================

@app.get("/api/deploy/ref/list")
async def api_deploy_ref_list():
    """返回已在标注工具中标记的参考音频列表（从 ref_tags.json 读取）"""
    project = panel_state.get("active_project", "")
    if not project:
        return {"audios": [], "error": "未选择活跃项目"}

    tags = _load_ref_tags()
    if not tags:
        return {"audios": [], "project": project}

    audios = []
    for entry_id, info in tags.items():
        wav_path = info.get("wav_path", "")
        if not os.path.isfile(wav_path):
            continue

        size_kb = round(os.path.getsize(wav_path) / 1024, 1)
        duration_s = info.get("duration", 0)
        if not duration_s:
            try:
                sr, data = wavfile.read(wav_path)
                duration_s = round(len(data) / sr, 1)
            except Exception:
                pass

        audios.append({
            "id": int(entry_id),
            "filename": os.path.basename(wav_path),
            "path": wav_path,
            "text": info.get("text", ""),
            "lang": info.get("lang", "zh"),
            "emotion": info.get("emotion", "default"),
            "duration_s": duration_s,
            "size_kb": size_kb,
        })

    return {"audios": audios, "project": project}


@app.get("/api/deploy/ref/audio")
async def api_deploy_ref_audio(path: str):
    """流式返回音频文件（预览播放用），仅允许 slicer_opt 目录"""
    slicer_root = os.path.join(BASE_DIR, "output", "slicer_opt")
    # 安全检查：规范化路径并确保在 slicer_opt 目录内
    real_path = os.path.realpath(path)
    real_root = os.path.realpath(slicer_root)
    if not real_path.startswith(real_root):
        raise HTTPException(status_code=403, detail="只能访问切分输出目录下的音频文件")
    if not os.path.isfile(real_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    # 转换为浏览器可播放的 16-bit PCM WAV
    ext = os.path.splitext(real_path)[1].lower()
    if ext == ".wav":
        try:
            import io
            sr, data = wavfile.read(real_path)
            if data.dtype != np.int16:
                if data.dtype == np.float32 or data.dtype == np.float64:
                    peak = np.max(np.abs(data)) if np.max(np.abs(data)) > 0 else 1.0
                    data = (data / peak * 32767).astype(np.int16)
                elif data.dtype == np.int32:
                    data = (data >> 16).astype(np.int16)
                else:
                    data = data.astype(np.int16)
                buf = io.BytesIO()
                wavfile.write(buf, sr, data)
                buf.seek(0)
                return Response(content=buf.read(), media_type="audio/wav")
        except Exception:
            pass

    return FileResponse(
        real_path,
        media_type="audio/wav",
        filename=os.path.basename(real_path),
    )


class DeployRefItem(BaseModel):
    src_path: str
    name: str
    text: str
    lang: str = "zh"

class DeployRefCopyRequest(BaseModel):
    items: List[DeployRefItem]

@app.post("/api/deploy/ref/copy")
async def api_deploy_ref_copy(req: DeployRefCopyRequest):
    """复制选定参考音频到 GSVI ref_audio/ 并生成同名 .txt"""
    gsvi_path = panel_state.get("gsvi_path", "")
    if not gsvi_path or not os.path.isdir(gsvi_path):
        return {"success": False, "reason": "GSVI 路径未配置或不存在"}

    if not req.items:
        return {"success": False, "reason": "未选择任何音频"}

    ref_dir = os.path.join(gsvi_path, "ref_audio")
    # 按角色（项目名）创建子目录: ref_audio/{project}/
    project = panel_state.get("active_project", "default")
    char_dir = os.path.join(ref_dir, project)
    os.makedirs(char_dir, exist_ok=True)

    results = []
    errors = []
    for item in req.items:
        try:
            if not os.path.isfile(item.src_path):
                errors.append(f"源文件不存在: {item.src_path}")
                continue

            # 复制音频到 ref_audio/{project}/{emotion}.wav
            ext = os.path.splitext(item.src_path)[1] or ".wav"
            dst_audio = os.path.join(char_dir, f"{item.name}{ext}")
            shutil.copy2(item.src_path, dst_audio)

            # 写入文本
            dst_txt = os.path.join(char_dir, f"{item.name}.txt")
            with open(dst_txt, "w", encoding="utf-8") as f:
                f.write(item.text)

            results.append({
                "name": item.name,
                "audio": dst_audio,
                "txt": dst_txt,
                "size_kb": round(os.path.getsize(dst_audio) / 1024, 1),
            })
        except Exception as e:
            errors.append(f"{item.name}: {str(e)}")

    return {
        "success": len(results) > 0,
        "copied": results,
        "errors": errors,
        "ref_dir": ref_dir,
    }


# ============================================================
#  Phase 5: GSVI 启动 / 状态 / 停止 (BAT 窗口方式)
# ============================================================
# 不在网页端管理子进程，而是直接打开 start_api.bat 独立窗口。
# 状态通过 TCP 端口探测判断，停止通过 kill 端口进程实现。
# ============================================================

GSVI_PORT = 9881


def _is_port_open(port: int, host: str = "127.0.0.1", timeout: float = 1.0) -> bool:
    """检测本地端口是否可连接"""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        s.connect((host, port))
        s.close()
        return True
    except Exception:
        return False


def _kill_port_processes(port: int) -> list:
    """查找并杀死占用指定端口的所有 LISTENING 进程"""
    killed = []
    try:
        # 用 netstat 找到占用端口的 PID
        result = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True, text=True, timeout=10,
        )
        for line in result.stdout.splitlines():
            # 匹配 LISTENING 状态的连接
            if f":{port}" in line and "LISTENING" in line:
                parts = line.split()
                if parts:
                    pid_str = parts[-1]
                    try:
                        pid = int(pid_str)
                        if pid > 0:
                            subprocess.run(
                                ["taskkill", "/F", "/PID", str(pid)],
                                capture_output=True, timeout=10,
                            )
                            killed.append(pid)
                    except (ValueError, subprocess.TimeoutExpired):
                        pass
    except Exception:
        pass
    return killed


@app.post("/api/deploy/start")
async def api_deploy_start():
    """打开 GSVI 的 start_api.bat（独立 CMD 窗口）"""
    gsvi_path = panel_state.get("gsvi_path", "")
    if not gsvi_path or not os.path.isdir(gsvi_path):
        return {"success": False, "reason": "GSVI 路径未配置或不存在"}

    # 如果端口已被占用，说明已在运行
    if _is_port_open(GSVI_PORT):
        return {"success": True, "already_running": True,
                "detail": f"GSVI 已在 127.0.0.1:{GSVI_PORT} 运行中"}

    bat_file = os.path.join(gsvi_path, "start_api.bat")
    if not os.path.isfile(bat_file):
        return {"success": False, "reason": f"未找到 start_api.bat: {bat_file}"}

    try:
        # 在独立 CMD 窗口中启动 bat 文件
        os.startfile(bat_file)
        return {"success": True, "port": GSVI_PORT,
                "detail": "已打开 start_api.bat 窗口，等待 API 就绪..."}
    except Exception as e:
        return {"success": False, "reason": str(e)}


@app.get("/api/deploy/status")
async def api_deploy_status():
    """通过端口探测判断 GSVI API 是否运行中"""
    running = _is_port_open(GSVI_PORT)
    return {
        "status": "running" if running else "idle",
        "ready": running,
        "port": GSVI_PORT,
        "gsvi_path": panel_state.get("gsvi_path", ""),
        "error": "",
        "log": [],   # BAT 窗口有自己的日志，不在网页显示
    }


@app.post("/api/deploy/stop")
async def api_deploy_stop():
    """停止占用 GSVI 端口的进程"""
    if not _is_port_open(GSVI_PORT):
        return {"success": True, "detail": "GSVI 未在运行"}

    killed = _kill_port_processes(GSVI_PORT)
    if killed:
        return {"success": True, "detail": f"已终止进程 PID: {killed}"}
    else:
        return {"success": False,
                "reason": f"未能找到/杀死占用端口 {GSVI_PORT} 的进程，请手动关闭 GSVI 窗口"}



# ============================================================
#  静态文件服务
# ============================================================

# 标注工具 UI（panel_ui/annotate/）
if os.path.isdir(ANNOTATE_UI_DIR):
    app.mount("/annotate", StaticFiles(directory=ANNOTATE_UI_DIR, html=True), name="annotate_ui")

# 面板主 UI（panel_ui/）
if os.path.isdir(PANEL_UI_DIR):
    app.mount("/", StaticFiles(directory=PANEL_UI_DIR, html=True), name="panel_ui")


# ============================================================
#  启动入口
# ============================================================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GPT-SoVITS Training Panel")
    parser.add_argument("--port", type=int, default=9877, help="port (default 9877)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="host")
    args = parser.parse_args()

    os.makedirs(LOGS_DIR, exist_ok=True)
    os.makedirs(PANEL_UI_DIR, exist_ok=True)

    load_panel_state()

    print()
    print("  ╔══════════════════════════════════════╗")
    print("  ║   🎙️ GPT-SoVITS Training Panel      ║")
    print("  ╚══════════════════════════════════════╝")
    print()

    projects = list_all_projects()
    print(f"  📁 Found {len(projects)} project(s) in logs/")
    for p in projects:
        done_steps = sum(1 for s in p["steps"].values() if s.get("status") == "done")
        total_steps = len(p["steps"])
        print(f"     • {p['name']} ({p.get('version', '?')}) — {done_steps}/{total_steps} steps done")

    active = panel_state.get("active_project")
    if active:
        print(f"\n  🎯 Active project: {active}")

    print(f"\n  🌐 Starting server: http://{args.host}:{args.port}")
    print()

    import webbrowser
    webbrowser.open(f"http://127.0.0.1:{args.port}")

    uvicorn.run(app=app, host=args.host, port=args.port)
