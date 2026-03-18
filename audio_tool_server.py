"""
GPT-SoVITS 音频标注工具 - 后端服务
用法: python audio_tool_server.py --list <你的.list文件路径>
"""
import os
import sys
import json
import copy
import argparse
import mimetypes
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

# ============== 全局状态 ==============
g_list_file = ""
g_entries = []        # 当前数据 [{wav_path, speaker_name, language, text, duration, index}]
g_undo_stack = []     # 撤销栈（保存之前的完整状态快照）
MAX_UNDO = 20

# ============== 数据读写 ==============

def get_audio_duration(wav_path: str) -> float:
    """获取音频时长（秒），使用 soundfile 或 wave 模块"""
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
    """读取 .list 文件，返回条目列表"""
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
                text = "|".join(parts[3:]).strip()  # text 中可能含有 |
                
                # 获取时长
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
    """将当前状态压入撤销栈"""
    global g_undo_stack
    g_undo_stack.append(copy.deepcopy(g_entries))
    if len(g_undo_stack) > MAX_UNDO:
        g_undo_stack.pop(0)


# ============== FastAPI ==============

app = FastAPI(title="GPT-SoVITS Audio Tool")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 请求模型 ---
class DeleteRequest(BaseModel):
    ids: List[int]

class EditRequest(BaseModel):
    id: int
    text: Optional[str] = None
    speaker_name: Optional[str] = None
    language: Optional[str] = None

class EditBatchRequest(BaseModel):
    edits: List[EditRequest]

# --- API ---

@app.get("/api/entries")
async def get_entries():
    """返回所有条目"""
    return {
        "entries": g_entries,
        "total": len(g_entries),
        "file": g_list_file,
    }


@app.get("/api/stats")
async def get_stats():
    """返回统计信息"""
    if not g_entries:
        return {"total": 0, "min_duration": 0, "max_duration": 0, "avg_duration": 0}
    durations = [e["duration"] for e in g_entries]
    return {
        "total": len(g_entries),
        "min_duration": min(durations),
        "max_duration": max(durations),
        "avg_duration": round(sum(durations) / len(durations), 2),
    }


@app.post("/api/delete")
async def delete_entries(req: DeleteRequest):
    """批量删除条目（自动保存）"""
    global g_entries
    push_undo()
    
    ids_to_delete = set(req.ids)
    g_entries = [e for e in g_entries if e["id"] not in ids_to_delete]
    
    # 重新编号
    for i, entry in enumerate(g_entries):
        entry["id"] = i

    save_list_file(g_list_file, g_entries)
    return {"success": True, "remaining": len(g_entries)}


@app.post("/api/edit")
async def edit_entry(req: EditRequest):
    """编辑单条条目（自动保存）"""
    global g_entries
    push_undo()
    
    for entry in g_entries:
        if entry["id"] == req.id:
            if req.text is not None:
                entry["text"] = req.text
            if req.speaker_name is not None:
                entry["speaker_name"] = req.speaker_name
            if req.language is not None:
                entry["language"] = req.language
            save_list_file(g_list_file, g_entries)
            return {"success": True, "entry": entry}
    
    raise HTTPException(status_code=404, detail="Entry not found")


@app.post("/api/undo")
async def undo():
    """撤销上次操作"""
    global g_entries, g_undo_stack
    if not g_undo_stack:
        raise HTTPException(status_code=400, detail="Nothing to undo")
    
    g_entries = g_undo_stack.pop()
    # 重新编号
    for i, entry in enumerate(g_entries):
        entry["id"] = i
    save_list_file(g_list_file, g_entries)
    return {"success": True, "total": len(g_entries)}


@app.get("/api/audio")
async def get_audio(path: str):
    """提供音频文件"""
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"Audio file not found: {path}")
    
    content_type = mimetypes.guess_type(path)[0] or "audio/wav"
    return FileResponse(path, media_type=content_type)


# 挂载前端静态文件
ui_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audio_tool_ui")
if os.path.exists(ui_dir):
    app.mount("/", StaticFiles(directory=ui_dir, html=True), name="ui")


# ============== 启动 ==============
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GPT-SoVITS Audio Annotation Tool")
    parser.add_argument("--list", type=str, required=True, help=".list file path")
    parser.add_argument("--port", type=int, default=9877, help="port (default 9877)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="host")
    args = parser.parse_args()

    # 处理 file:/// URI 和 URL 编码
    list_path = args.list.strip().strip('"')
    if list_path.startswith("file:///"):
        list_path = list_path[8:]  # 去掉 file:///
    elif list_path.startswith("file://"):
        list_path = list_path[7:]
    from urllib.parse import unquote
    list_path = unquote(list_path)  # %20 -> 空格
    list_path = list_path.replace("/", os.sep)  # 统一路径分隔符

    g_list_file = os.path.abspath(list_path)
    if not os.path.isfile(g_list_file):
        print(f"错误: 文件不存在 -> {g_list_file}")
        sys.exit(1)

    # 切换到 .list 文件所在目录，使相对路径能正确解析
    list_dir = os.path.dirname(g_list_file)
    if list_dir:
        os.chdir(list_dir)
        print(f"📁 工作目录: {list_dir}")

    print(f"📂 加载文件: {g_list_file}")
    g_entries = load_list_file(g_list_file)
    print(f"✅ 已加载 {len(g_entries)} 条音频条目")
    
    # 显示时长统计
    durations = [e["duration"] for e in g_entries if e["duration"] > 0]
    if durations:
        print(f"📊 时长范围: {min(durations):.1f}s - {max(durations):.1f}s (平均 {sum(durations)/len(durations):.1f}s)")
    
    print(f"🌐 启动服务: http://{args.host}:{args.port}")

    import webbrowser
    webbrowser.open(f"http://127.0.0.1:{args.port}")
    uvicorn.run(app=app, host=args.host, port=args.port)
