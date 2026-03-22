# 🎤 GPT-SoVITS 接入 SillyTavern 完整教程

> 零基础保姆级教程！让你训练好的语音模型在酒馆（SillyTavern）里开口说话 ✨

---

## 📋 你需要准备什么

在开始之前，确认你已经有了这些东西：

| 准备项 | 说明 |
|--------|------|
| **GPT-SoVITS v2Pro** | 已下载并解压好的 GPT-SoVITS 程序 |
| **训练好的语音模型** | 包含 GPT 权重文件（`.ckpt`）和 SoVITS 权重文件（`.pth`） |
| **SillyTavern** | 已安装好并能正常运行的酒馆 |
| **参考音频** | 一段你训练时用的说话人音频（`.wav` 格式，3-10秒左右） |

---

## 🔧 第一步：修改配置文件，指向你的模型

找到这个文件并用记事本/VSCode 打开：

```
GPT-SoVITS-v2pro/GPT_SoVITS/configs/tts_infer.yaml
```

找到最上面的 `custom:` 部分，把 `t2s_weights_path` 和 `vits_weights_path` 改成**你自己训练好的模型路径**：

```yaml
custom:
  bert_base_path: GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large
  cnhuhbert_base_path: GPT_SoVITS/pretrained_models/chinese-hubert-base
  device: cuda          # 用显卡加速，没显卡就改成 cpu
  is_half: true         # cuda 时建议 true，cpu 时必须 false
  t2s_weights_path: GPT_weights_v2Pro/你的模型名-e5.ckpt      # ← 你的 GPT 权重
  version: v2Pro
  vits_weights_path: SoVITS_weights_v2Pro/你的模型名_e4_s68.pth  # ← 你的 SoVITS 权重
```

> [!TIP]
> **怎么找到你的模型文件？**
> - GPT 权重在 `GPT_weights_v2Pro/` 文件夹下，后缀是 `.ckpt`
> - SoVITS 权重在 `SoVITS_weights_v2Pro/` 文件夹下，后缀是 `.pth`

保存，关闭。

---

## 🎵 第二步：准备参考音频

GPT-SoVITS 在合成语音时需要一段"参考音频"来学习说话人的声音特征。

1. 在 GPT-SoVITS 根目录下**创建**一个文件夹叫 [ref_audio](file:///d:/TTS%20LOCAL/GPT/GPT-SoVITS-v2pro-20250604/GPT-SoVITS-v2pro-20250604/api_v2.py#567-580)

```
GPT-SoVITS-v2pro/
├── ref_audio/        ← 创建这个文件夹
│   ├── YourVoice.wav ← 放入参考音频
│   └── YourVoice.txt ← 放入音频对应的文字
├── api_v2.py
├── ...
```

2. 放入你的**参考音频**，命名格式：`角色名.wav`
   - 比如你的角色叫 MyVoice，那就叫 `MyVoice.wav`
   - ⚠️ **必须是 `.wav` 格式**！如果你的音频是 [.mp3](file:///d:/TTS%20LOCAL/GPT/GPT-SoVITS-v2pro-20250604/GPT-SoVITS-v2pro-20250604/ref_audio/MyVoice.mp3)，需要先转换成 `.wav`

3. 在同目录创建一个**同名的 [.txt](file:///d:/TTS%20LOCAL/GPT/GPT-SoVITS-v2pro-20250604/GPT-SoVITS-v2pro-20250604/ref_audio/MyVoice.txt) 文件**（比如 [MyVoice.txt](file:///d:/TTS%20LOCAL/GPT/GPT-SoVITS-v2pro-20250604/GPT-SoVITS-v2pro-20250604/ref_audio/MyVoice.txt)），里面写上这段参考音频里**说的话**
   - 这一步很重要，能显著提升语音质量！

> [!IMPORTANT]
> **参考音频要求：**
> - 时长 3~10 秒
> - 只有说话人一个人的声音，没有背景音乐或杂音
> - `.wav` 格式

---

## ✏️ 第三步：修改 [api_v2.py](file:///d:/TTS%20LOCAL/GPT/GPT-SoVITS-v2pro-20250604/GPT-SoVITS-v2pro-20250604/api_v2.py)（核心步骤）

GPT-SoVITS 自带的 [api_v2.py](file:///d:/TTS%20LOCAL/GPT/GPT-SoVITS-v2pro-20250604/GPT-SoVITS-v2pro-20250604/api_v2.py) 并不直接兼容 SillyTavern，我们需要在文件末尾添加一个**兼容层**。

用 VSCode 或记事本打开 [api_v2.py](file:///d:/TTS%20LOCAL/GPT/GPT-SoVITS-v2pro-20250604/GPT-SoVITS-v2pro-20250604/api_v2.py)，做以下修改：

### 3.1 修改 import（文件顶部）

找到这一行：
```python
from typing import Generator, Union
```
改成：
```python
from typing import Any, Generator, Union
```

### 3.2 在文件末尾、`if __name__ == "__main__":` 之前添加以下代码

> [!CAUTION]
> 以下代码要添加在 `if __name__ == "__main__":` **之前**！不要放到它后面去了。

```python
# ============================================================
# SillyTavern GPT-SoVITS Adapter 兼容层
# ============================================================
# SillyTavern 自带的 gpt-sovits-adapter.js 会 POST 到根路径 /
# 请求体格式和 api_v2 原生格式不同，需要做转换
#
# 使用方法:
#   1. 在 ref_audio/ 目录下放入参考音频，命名为 <voice_id>.wav
#      例如: ref_audio/MyVoice.wav
#   2. 同目录创建同名 .txt 文件写入参考音频的文字内容
#      例如: ref_audio/MyVoice.txt (内容为音频里说的话)
#   3. SillyTavern Provider Endpoint 填 http://127.0.0.1:9881
# ============================================================

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
    card_name: Any = None           # SillyTavern 可能传字符串或列表
    use_st_adapter: bool = False
    text_split_method: str = "cut5"
    batch_size: int = 1
    media_type: str = "wav"
    streaming_mode: Union[bool, int, str] = False
    top_k: int = 5
    top_p: float = 1
    temperature: float = 1
    speed_factor: float = 1.0
    seed: int = -1
    parallel_infer: bool = True
    repetition_penalty: float = 1.35
    sample_steps: int = 32
    super_sampling: bool = False

    class Config:
        extra = "allow"  # 允许 SillyTavern 传入的额外字段

def _find_ref_audio(voice_name: str):
    """根据 voice_name 在 ref_audio/ 目录下查找参考音频和文本"""
    for ext in ["wav", "mp3", "ogg", "flac"]:
        audio_path = os.path.join(REF_AUDIO_DIR, f"{voice_name}.{ext}")
        if os.path.exists(audio_path):
            # 查找同名 .txt
            txt_path = os.path.join(REF_AUDIO_DIR, f"{voice_name}.txt")
            prompt_text = ""
            if os.path.exists(txt_path):
                with open(txt_path, "r", encoding="utf-8") as f:
                    prompt_text = f.read().strip()
            return audio_path, prompt_text
    return None, ""

@APP.post("/")
async def st_tts_endpoint(request: ST_TTS_Request):
    """SillyTavern 兼容入口: 自动补全 ref_audio_path / prompt_text / prompt_lang"""
    req = request.dict()

    # ---- 从 ref_audio_path 或 target_voice 中提取 voice_name ----
    raw_ref = req.get("ref_audio_path") or ""
    voice_name = req.get("target_voice", "") or ""

    # SillyTavern 可能传一个构造出来的路径(如 ./参考音频/MyVoice.wav)
    # 我们从中提取出不带后缀的文件名作为 voice_name
    if raw_ref:
        basename = os.path.splitext(os.path.basename(raw_ref))[0]
        # 处理类似 MyVoice.wav.mp3 的双后缀情况
        if "." in basename:
            basename = basename.rsplit(".", 1)[0]
        if basename:
            voice_name = basename

    if not voice_name:
        voice_name = "MyVoice"  # 默认 fallback，改成你自己的角色名

    # 用 voice_name 去 ref_audio/ 目录查找实际文件
    audio_path, prompt_text = _find_ref_audio(voice_name)
    if audio_path is None:
        return JSONResponse(status_code=400, content={
            "message": f"找不到参考音频! 请把音频放到 ref_audio/{voice_name}.wav"
        })
    req["ref_audio_path"] = audio_path
    if not req.get("prompt_text"):
        req["prompt_text"] = prompt_text

    # 如果没有 prompt_lang，默认和 text_lang 一致
    if not req.get("prompt_lang"):
        req["prompt_lang"] = req.get("text_lang", "zh")

    # streaming_mode 可能是字符串 "true"/"false"，转成 int
    sm = req.get("streaming_mode", False)
    if isinstance(sm, str):
        req["streaming_mode"] = 1 if sm.lower() == "true" else 0

    # media_type 为 "auto" 时默认 wav
    if req.get("media_type", "wav") == "auto":
        req["media_type"] = "wav"

    # 清理 SillyTavern 特有的字段，避免干扰 tts_handle
    for key in ["target_voice", "card_name", "use_st_adapter"]:
        req.pop(key, None)

    print(f"[SillyTavern] 合成请求: text={req.get('text', '')[:30]}... voice={voice_name} ref={req.get('ref_audio_path')}")
    return await tts_handle(req)

@APP.get("/speakers_list")
async def speakers_list_endpoint():
    return JSONResponse(status_code=200, content=["female", "male"])

@APP.get("/speakers")
async def speakers_endpoint():
    return JSONResponse(status_code=200, content=[
        {
            "name": "MyVoice",       # ← 改成你的角色名
            "voice_id": "MyVoice"    # ← 和上面保持一致
        }
    ])
```

> [!NOTE]
> **关于 `/speakers` 端点里的角色名：**
> 把 `"MyVoice"` 改成你自己的角色名。这个名字要和你 [ref_audio/](file:///d:/TTS%20LOCAL/GPT/GPT-SoVITS-v2pro-20250604/GPT-SoVITS-v2pro-20250604/api_v2.py#567-580) 文件夹里的文件名一致！
> 比如你的参考音频叫 `Miku.wav`，那这里就填 `"Miku"`。
>
> 如果你有**多个角色**，可以这样写：
> ```python
> return JSONResponse(status_code=200, content=[
>     {"name": "角色A", "voice_id": "角色A"},
>     {"name": "角色B", "voice_id": "角色B"},
> ])
> ```

---

## 🚀 第四步：启动 API 服务

打开**命令行/终端**，`cd` 到 GPT-SoVITS 的根目录，运行：

```bash
runtime\python.exe api_v2.py -a 127.0.0.1 -p 9881
```

> [!IMPORTANT]
> **端口必须是 9881！** SillyTavern 的 GPT-SoVITS 适配器默认连接 9881 端口，改不了。

看到类似以下输出就说明启动成功了：

```
INFO:     Uvicorn running on http://127.0.0.1:9881 (Press CTRL+C to quit)
```

---

## 🏠 第五步：配置 SillyTavern

1. 打开 SillyTavern，点击右侧工具栏，找到 **Extensions**（扩展）面板
2. 找到 **TTS** 分类，点进去
3. 做以下设置：

| 设置项 | 填什么 |
|--------|--------|
| **TTS Provider** | `GPT-SoVITS` |
| **Provider Endpoint** | `http://127.0.0.1:9881` |
| **Audio format** | [wav](file:///d:/TTS%20LOCAL/GPT/GPT-SoVITS-v2pro-20250604/GPT-SoVITS-v2pro-20250604/api_v2.py#239-243) |

4. 点击 **Available Voices** 旁边的刷新按钮 🔄
5. 你应该能看到你的角色名出现在列表里
6. 在 **Voice Map** 中，给你的角色卡分配对应的声音

> [!TIP]
> 如果 Available Voices 里看不到你的角色，先检查一下：
> - API 是否还在运行（终端里有没有报错）
> - 端口是否是 9881
> - [ref_audio/](file:///d:/TTS%20LOCAL/GPT/GPT-SoVITS-v2pro-20250604/GPT-SoVITS-v2pro-20250604/api_v2.py#567-580) 文件夹里有没有 `.wav` 文件

---

## ✅ 搞定！

现在去跟你的角色聊天试试，应该能听到 ta 的声音了~ 🎉

---

## 🔥 常见问题 FAQ

### Q: 报错 `ERR_CONNECTION_REFUSED`
**A:** API 没有在运行，或者端口不对。确认你的启动命令用的是 `-p 9881`。

### Q: 报错 `422 Unprocessable Entity`
**A:** [api_v2.py](file:///d:/TTS%20LOCAL/GPT/GPT-SoVITS-v2pro-20250604/GPT-SoVITS-v2pro-20250604/api_v2.py) 里的兼容层代码没有正确添加。特别检查 `card_name: Any = None` 这一行，必须是 `Any` 不是 [str](file:///d:/TTS%20LOCAL/GPT/GPT-SoVITS-v2pro-20250604/GPT-SoVITS-v2pro-20250604/api_v2.py#429-437)。

### Q: 报错 `ref_audio_path not exists`
**A:** 参考音频路径有问题。确保：
- [ref_audio/](file:///d:/TTS%20LOCAL/GPT/GPT-SoVITS-v2pro-20250604/GPT-SoVITS-v2pro-20250604/api_v2.py#567-580) 文件夹里有你的音频文件
- 音频是 **`.wav` 格式**（不是 .mp3！）
- 文件名和 `/speakers` 端点里的 `voice_id` 一致

### Q: 报错 `manifest.json 404`
**A:** 这个错误可以忽略，不影响功能。它只是 SillyTavern 在检查一个不存在的第三方扩展。

### Q: 声音质量不好 / 有杂音
**A:** 换一段更干净、更清晰的参考音频。确保你的 [.txt](file:///d:/TTS%20LOCAL/GPT/GPT-SoVITS-v2pro-20250604/GPT-SoVITS-v2pro-20250604/ref_audio/MyVoice.txt) 文件里正确写了参考音频的文字内容。

### Q: 我用的是 mp3 参考音频，不想转格式怎么办？
**A:** 建议还是转成 `.wav`。如果实在不想转，代码已经支持 [.mp3](file:///d:/TTS%20LOCAL/GPT/GPT-SoVITS-v2pro-20250604/GPT-SoVITS-v2pro-20250604/ref_audio/MyVoice.mp3)，但 SillyTavern 的 Audio Format 设置中也要相应调整，可能会有兼容性问题。推荐统一用 `.wav`。

---

## 📁 最终文件结构参考

```
GPT-SoVITS-v2pro/
├── api_v2.py                          ← 修改过的 API 文件
├── ref_audio/                         ← 参考音频目录
│   ├── MyVoice.wav                       ← 参考音频
│   └── MyVoice.txt                       ← 音频里说的话
├── GPT_SoVITS/
│   └── configs/
│       └── tts_infer.yaml             ← 配置了你的模型路径
├── GPT_weights_v2Pro/
│   └── MyVoice-e5.ckpt                   ← 你的 GPT 权重
├── SoVITS_weights_v2Pro/
│   └── MyVoice_e4_s68.pth                ← 你的 SoVITS 权重
└── runtime/
    └── python.exe
```

---

> 教程写于 2026.02.28，基于 GPT-SoVITS v2pro-20250604 + SillyTavern 测试通过。
> 如果有问题欢迎评论区交流~ 💬
