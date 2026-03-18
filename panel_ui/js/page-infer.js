        // =====================================================
        //  推理测试
        // =====================================================
        let inferEnginePolling = null;
        let inferModelsData = null;
        let inferAdvancedOpen = false;
        let inferHistory = [];  // {id, text, blob, url}
        let inferHistoryId = 0;

        // Cleanup blob URLs to prevent memory leaks
        function cleanupInferHistory() {
            inferHistory.forEach(item => {
                if (item.url) URL.revokeObjectURL(item.url);
            });
            inferHistory = [];
        }
        window.addEventListener('beforeunload', cleanupInferHistory);

        // 预设示例句子（按语言分类）
        const INFER_PRESET_SENTENCES = {
            zh: [
                '你好呀，今天天气真不错，要不要一起出去走走？',
                '这件事情我已经考虑很久了，我觉得我们应该好好谈谈。',
                '太好了！没想到这么快就完成了，真是太开心了！',
                '我不太确定这样做对不对，但是我会尽力而为的。',
            ],
            en: [
                'Hello! How are you doing today? It\'s such a beautiful day outside.',
                'I\'ve been thinking about this for a while, and I believe we should talk about it.',
                'That\'s amazing! I can\'t believe we actually made it. I\'m so happy right now!',
                'I\'m not sure if this is the right choice, but I\'ll do my best.',
            ],
            ja: [
                'こんにちは！今日はとてもいい天気ですね、一緒に散歩しませんか？',
                'この件についてずっと考えていたんですけど、ちゃんと話し合うべきだと思います。',
                'やったー！こんなに早く終わるなんて思わなかった、本当に嬉しい！',
                'これでいいのかよく分からないけど、精一杯頑張ります。',
            ],
            yue: [
                '你好呀，今日天气好靓啊，不如一齐出去行下？',
                '呢件事我谂咗好耐，我觉得我哋应该好好倾下。',
                '太好喇！冇谂到咁快就搞掂，真系好开心！',
                '我唔系好肯定咁做啱唔啱，但系我会尽力嘅。',
            ],
            ko: [
                '안녕하세요! 오늘 날씨가 정말 좋네요, 같이 산책할까요?',
                '이 일에 대해 오래 고민했는데, 우리 진지하게 얘기해 봐야 할 것 같아요.',
                '대박! 이렇게 빨리 끝날 줄 몰랐어요, 정말 기뻐요!',
                '이게 맞는 선택인지 잘 모르겠지만, 최선을 다할게요.',
            ],
        };

        function updateInferPage() {
            const container = document.getElementById('inferContent');
            if (!container) return;
            if (!activeProject) {
                container.innerHTML = `
                <div class="no-project-hint">
                    <i class="ph ph-folder-open hint-icon"></i>
                    <div class="hint-text">请先在「项目管理」中选择一个项目</div>
                </div>`;
                return;
            }

            container.innerHTML = `
            <!-- ① 选择模型 -->
            <div class="slice-section">
                <div class="slice-section-title"><i class="ph ph-cube"></i>选择模型</div>
                <div id="inferCheckResult" style="margin-bottom: 14px;">
                    <span style="color: var(--text-muted); font-size: 15px;">检查中...</span>
                </div>
                <div class="inline-tip" style="margin-top: 0; margin-bottom: 10px;">
                    <i class="ph ph-lightbulb"></i>
                    <span>训练完成后会生成模型文件，文件名中的数字（如 <b>e8</b>、<b>e15</b>）代表训练轮数（epoch）。
                    你需要选择一个 SoVITS 模型和一个 GPT 模型来启动推理引擎。</span>
                </div>
                <div class="inline-warn" style="margin-top: 0; margin-bottom: 14px;">
                    <i class="ph ph-warning"></i>
                    <span><b>轮数不是越多越好！</b>过度训练（过拟合）反而会让声音走样、出现杂音。
                    建议每个存档都试听一下，选效果最好的那个。一般 GPT 模型 <b>10~15 轮</b>就够了。</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label">SoVITS 模型</label>
                        <select class="form-select" id="inferSovitsSelect">
                            <option value="">加载中...</option>
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label">GPT 模型</label>
                        <select class="form-select" id="inferGptSelect">
                            <option value="">加载中...</option>
                        </select>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                    <button class="btn btn-primary" id="btnStartEngine" onclick="startInferEngine()">
                        <i class="ph ph-rocket-launch"></i> 启动推理引擎
                    </button>
                    <button class="btn" id="btnStopEngine" onclick="stopInferEngine()" style="display: none; border-color: var(--accent-danger); color: var(--accent-danger);">
                        <i class="ph ph-stop"></i> 停止引擎
                    </button>
                    <span id="inferEngineStatus" style="font-size: 15px; color: var(--text-muted);">未启动</span>
                </div>
                <!-- 引擎日志 -->
                <div id="inferLogArea" style="display: none; margin-top: 14px;">
                    <div class="advanced-toggle" onclick="toggleInferLog()">
                        <i class="ph ph-caret-right"></i> 引擎日志
                    </div>
                    <div class="log-output" id="inferLogOutput" style="max-height: 200px; display: none;"></div>
                </div>
            </div>

            <!-- ② 参考音频 -->
            <div class="slice-section">
                <div class="slice-section-title"><i class="ph ph-microphone"></i>参考音频</div>
                <div class="inline-warn" style="margin-top: 0; margin-bottom: 12px;">
                    <i class="ph ph-timer"></i>
                    <span>参考音频时长必须在 <b>3~10 秒</b>之间，多了少了效果都不好。</span>
                </div>
                <div class="inline-tip" style="margin-top: 0; margin-bottom: 10px;">
                    <i class="ph ph-lightbulb"></i>
                    <span>参考音频的情感和语调会影响合成效果。选择与目标风格匹配的音频，可以准备多条不同情绪的参考。</span>
                </div>
                <div class="inline-tip" style="margin-top: 0; margin-bottom: 14px;">
                    <i class="ph ph-folder-open"></i>
                    <span>如果没有专门准备参考音频，也可以从下拉列表的「项目切分音频」中选一条 <b>3~10 秒</b>的片段来试听。</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: end;">
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label">选择参考音频</label>
                        <select class="form-select" id="inferRefSelect" onchange="onRefAudioChange()">
                            <option value="">加载中...</option>
                        </select>
                    </div>
                    <button class="btn" id="btnPlayRef" onclick="inferPlayRefAudio()" style="margin-bottom: 0; height: 40px;">
                        <i class="ph ph-play"></i> 试听
                    </button>
                    <button class="btn" onclick="inferUploadRefAudio()" style="margin-bottom: 0; height: 40px;" title="上传自定义参考音频">
                        <i class="ph ph-upload-simple"></i> 上传
                    </button>
                    <input type="file" id="inferRefUploadInput" accept=".wav,.mp3,.ogg,.flac" style="display: none;" onchange="onInferRefFileSelected(event)">
                </div>
                <div style="margin-top: 10px;">
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label">参考音频文本</label>
                        <input type="text" class="form-input" id="inferPromptText" placeholder="参考音频对应的文字（自动填充）">
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 10px;">
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label">参考音频语言</label>
                        <select class="form-select" id="inferPromptLang">
                            <option value="zh" selected>中文</option>
                            <option value="en">英文</option>
                            <option value="ja">日文</option>
                            <option value="yue">粤语</option>
                            <option value="ko">韩文</option>
                            <option value="auto">自动</option>
                        </select>
                    </div>
                    <div></div>
                </div>
            </div>

            <!-- ③ 文字转语音 -->
            <div class="slice-section">
                <div class="slice-section-title"><i class="ph ph-text-aa"></i>文字转语音</div>
                <div class="inline-tip" style="margin-top: 0; margin-bottom: 14px;">
                    <i class="ph ph-lightbulb"></i>
                    <span>新手保持默认设置即可。「文本切分方式」会自动把长文本分段合成，默认按标点符号切分效果最好。
                    效果不理想时再展开「高级参数」微调。</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px;">
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label">合成语言</label>
                        <select class="form-select" id="inferTextLang" onchange="onInferTextLangChange()">
                            <option value="zh" selected>中文</option>
                            <option value="en">英文</option>
                            <option value="ja">日文</option>
                            <option value="yue">粤语</option>
                            <option value="ko">韩文</option>
                            <option value="auto">自动</option>
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label">文本切分方式</label>
                        <select class="form-select" id="inferSplitMethod">
                            <option value="cut5" selected>按标点符号切</option>
                            <option value="cut0">不切</option>
                            <option value="cut1">凑四句一切</option>
                            <option value="cut2">凑50字一切</option>
                            <option value="cut3">按中文句号切</option>
                            <option value="cut4">按英文句号切</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">输入文字</label>
                    <textarea class="form-input" id="inferTextInput" rows="4" placeholder="输入要合成的文字，或点击下方示例快速填充..."
                        style="resize: vertical; min-height: 80px;"></textarea>
                </div>
                <div id="inferPresetChips" style="margin-top: -6px; margin-bottom: 14px;"></div>

                <!-- 高级参数 -->
                <div class="advanced-toggle" onclick="toggleInferAdvanced()">
                    <i class="ph ph-caret-right"></i> 高级参数
                </div>
                <div id="inferAdvancedParams" class="advanced-params hidden" style="margin-top: 14px; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px;">
                    <div class="param-group">
                        <label>Top K</label>
                        <input type="number" id="inferTopK" min="1" max="100" value="5">
                        <div class="param-hint">保留概率最高的 K 个候选词</div>
                    </div>
                    <div class="param-group">
                        <label>Top P</label>
                        <input type="number" id="inferTopP" min="0" max="1" step="0.05" value="1">
                        <div class="param-hint">累积概率阈值，越低越精确</div>
                    </div>
                    <div class="param-group">
                        <label>Temperature</label>
                        <input type="number" id="inferTemp" min="0" max="2" step="0.05" value="1">
                        <div class="param-hint">越高越有变化，越低越稳定</div>
                    </div>
                    <div class="param-group">
                        <label>语速</label>
                        <input type="number" id="inferSpeed" min="0.5" max="2" step="0.05" value="1">
                        <div class="param-hint">1 = 原速，<1 变慢，>1 变快</div>
                    </div>
                    <div class="param-group">
                        <label>Batch Size</label>
                        <input type="number" id="inferBatch" min="1" max="32" value="1">
                    </div>
                    <div class="param-group">
                        <label>Seed</label>
                        <input type="number" id="inferSeed" value="-1">
                        <div class="param-hint">-1 = 随机</div>
                    </div>
                    <div class="param-group">
                        <label>重复惩罚</label>
                        <input type="number" id="inferRepPenalty" min="1" max="2" step="0.05" value="1.35">
                    </div>
                    <div class="param-group">
                        <label>采样步数</label>
                        <input type="number" id="inferSampleSteps" min="4" max="64" value="32">
                    </div>
                </div>

                <!-- 生成按钮 -->
                <div style="margin-top: 16px; display: flex; align-items: center; gap: 12px;">
                    <button class="btn btn-primary" id="btnGenerateTTS" onclick="generateTTS()" disabled>
                        <i class="ph ph-speaker-high"></i> 生成语音
                    </button>
                    <span id="inferGenStatus" style="font-size: 15px; color: var(--text-muted);"></span>
                </div>
            </div>

            <!-- ④ 生成结果 -->
            <div class="slice-section" id="inferResultSection" style="display: none;">
                <div class="slice-section-title"><i class="ph ph-playlist"></i>生成结果</div>
                <div id="inferResultList"></div>
            </div>

            <!-- ⑤ 部署到酒馆快捷入口 -->
            <div class="slice-section" style="border-color: rgba(96, 165, 250, 0.2); background: linear-gradient(135deg, rgba(96, 165, 250, 0.04) 0%, rgba(167, 139, 250, 0.04) 100%);">
                <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 200px;">
                        <div style="font-size: 16px; font-weight: 700; margin-bottom: 4px;">
                            <i class="ph ph-cloud-arrow-up" style="color: var(--accent); margin-right: 6px;"></i>准备部署到酒馆？
                        </div>
                        <div style="font-size: 14px; color: var(--text-secondary);">
                            测试满意后，一站式把模型部署到 SillyTavern
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="navigateTo('deploy')" style="white-space: nowrap;">
                        <i class="ph ph-arrow-right"></i> 前往部署
                    </button>
                </div>
            </div>
        `;

            // 加载数据
            checkInferPrerequisites();
            loadInferModels();
            checkInferEngineStatus();
            renderInferPresetChips();
        }

        function renderInferPresetChips() {
            const container = document.getElementById('inferPresetChips');
            if (!container) return;
            const lang = document.getElementById('inferTextLang')?.value || 'zh';
            const sentences = INFER_PRESET_SENTENCES[lang] || INFER_PRESET_SENTENCES['zh'];
            container.innerHTML = `
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
                    <i class="ph ph-chat-dots" style="font-size: 15px; color: var(--text-muted);"></i>
                    <span style="font-size: 13px; color: var(--text-muted);">点击示例快速填充：</span>
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    ${sentences.map(s => `
                        <button type="button" onclick="fillInferText(this)" class="btn" style="
                            padding: 6px 14px; font-size: 13px; line-height: 1.5;
                            border: 1px solid var(--border); border-radius: 20px;
                            background: rgba(255,255,255,0.03); color: var(--text-secondary);
                            cursor: pointer; transition: all 0.15s ease;
                            white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis;
                        " onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)';this.style.background='rgba(99,102,241,0.08)'"
                           onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-secondary)';this.style.background='rgba(255,255,255,0.03)'"
                           data-text="${escapeAttr(s)}" title="${escapeAttr(s)}">
                            ${escapeHtml(s.length > 25 ? s.substring(0, 25) + '...' : s)}
                        </button>
                    `).join('')}
                </div>
            `;
        }

        function onInferTextLangChange() {
            renderInferPresetChips();
        }

        function fillInferText(btn) {
            const text = btn.dataset.text;
            const textarea = document.getElementById('inferTextInput');
            if (textarea && text) {
                textarea.value = text;
                textarea.focus();
                // 短暂高亮效果
                textarea.style.borderColor = 'var(--accent)';
                setTimeout(() => { textarea.style.borderColor = ''; }, 800);
            }
        }

        async function checkInferPrerequisites() {
            const el = document.getElementById('inferCheckResult');
            if (!el) return;
            try {
                const data = await apiGet('/api/infer/check');
                if (data.ready) {
                    el.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-success);">
                        <i class="ph ph-check-circle" style="font-size: 20px;"></i>
                        <span>已有训练模型，可以进行推理测试</span>
                    </div>
                    <div style="margin-top: 6px; font-size: 14px; color: var(--text-muted);">
                        版本: ${escapeHtml(data.version || 'v2Pro')}
                        ${data.has_ref_audio ? '' : ' | <span style="color: var(--accent-warning);">未找到参考音频 (ref_audio/)</span>'}
                    </div>`;
                } else {
                    el.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-warning);">
                        <i class="ph ph-warning" style="font-size: 20px;"></i>
                        <span>${escapeHtml(data.reason)}</span>
                    </div>
                    <div style="margin-top: 10px;">
                        <button class="btn" onclick="navigateTo('train')">
                            <i class="ph ph-arrow-left"></i> 先去完成训练
                        </button>
                    </div>`;
                }
            } catch (err) {
                el.innerHTML = `<span style="color: var(--accent-danger);">检查失败: ${escapeHtml(err.message)}</span>`;
            }
        }

        async function loadInferModels() {
            try {
                const data = await apiGet('/api/infer/models');
                inferModelsData = data;

                // 填充 SoVITS 下拉
                const sovitsSelect = document.getElementById('inferSovitsSelect');
                if (sovitsSelect) {
                    sovitsSelect.innerHTML = data.sovits.length === 0
                        ? '<option value="">暂无模型</option>'
                        : data.sovits.map(m => `<option value="${escapeAttr(m.path)}">${escapeHtml(m.name)} (${m.size_mb}MB)</option>`).join('');
                }

                // 填充 GPT 下拉
                const gptSelect = document.getElementById('inferGptSelect');
                if (gptSelect) {
                    gptSelect.innerHTML = data.gpt.length === 0
                        ? '<option value="">暂无模型</option>'
                        : data.gpt.map(m => `<option value="${escapeAttr(m.path)}">${escapeHtml(m.name)} (${m.size_mb}MB)</option>`).join('');
                }

                // 填充参考音频下拉
                const refSelect = document.getElementById('inferRefSelect');
                if (refSelect) {
                    let refHtml = '';
                    if (data.ref_audios.length > 0) {
                        refHtml += '<optgroup label="参考音频 (ref_audio/)">';
                        data.ref_audios.forEach(r => {
                            refHtml += `<option value="${escapeAttr(r.path)}" data-prompt="${escapeAttr(r.prompt_text)}">${escapeHtml(r.name)}</option>`;
                        });
                        refHtml += '</optgroup>';
                    }
                    if (data.project_audios.length > 0) {
                        refHtml += '<optgroup label="项目切分音频">';
                        data.project_audios.forEach(r => {
                            const dur = r.duration ? ` (${r.duration.toFixed(1)}s)` : '';
                            refHtml += `<option value="${escapeAttr(r.path)}">${escapeHtml(r.name)}${dur}</option>`;
                        });
                        refHtml += '</optgroup>';
                    }
                    if (!refHtml) {
                        refHtml = '<option value="">暂无参考音频</option>';
                    }
                    refSelect.innerHTML = refHtml;
                    // 自动填充 prompt text
                    onRefAudioChange();
                }
            } catch (err) {
                showToast('加载模型列表失败: ' + err.message, 'error');
            }
        }

        function onRefAudioChange() {
            const sel = document.getElementById('inferRefSelect');
            const promptInput = document.getElementById('inferPromptText');
            if (!sel || !promptInput) return;
            const opt = sel.options[sel.selectedIndex];
            const promptText = opt ? (opt.dataset.prompt || '') : '';
            promptInput.value = promptText;
        }

        let _inferRefPlayer = null;

        async function inferPlayRefAudio() {
            const sel = document.getElementById('inferRefSelect');
            if (!sel || !sel.value) { showToast('请先选择参考音频', 'error'); return; }

            // 如果正在播放则停止
            if (_inferRefPlayer) {
                _inferRefPlayer.pause();
                _inferRefPlayer = null;
                const btn = document.getElementById('btnPlayRef');
                if (btn) btn.innerHTML = '<i class="ph ph-play"></i> 试听';
                return;
            }

            const btn = document.getElementById('btnPlayRef');
            if (btn) btn.innerHTML = '<i class="ph ph-spinner" style="animation: spin 1s linear infinite;"></i> 加载...';

            try {
                const url = `/api/infer/ref_audio?path=${encodeURIComponent(sel.value)}`;
                _inferRefPlayer = new Audio(url);
                _inferRefPlayer.oncanplaythrough = () => {
                    if (btn) btn.innerHTML = '<i class="ph ph-pause"></i> 停止';
                };
                _inferRefPlayer.onended = () => {
                    _inferRefPlayer = null;
                    if (btn) btn.innerHTML = '<i class="ph ph-play"></i> 试听';
                };
                _inferRefPlayer.onerror = () => {
                    showToast('音频加载失败，请检查文件是否存在', 'error');
                    _inferRefPlayer = null;
                    if (btn) btn.innerHTML = '<i class="ph ph-play"></i> 试听';
                };
                await _inferRefPlayer.play();
            } catch (err) {
                showToast('播放失败: ' + err.message, 'error');
                _inferRefPlayer = null;
                if (btn) btn.innerHTML = '<i class="ph ph-play"></i> 试听';
            }
        }

        function inferUploadRefAudio() {
            const input = document.getElementById('inferRefUploadInput');
            if (input) input.click();
        }

        async function onInferRefFileSelected(event) {
            const file = event.target.files[0];
            if (!file) return;

            showToast('正在上传参考音频...', 'success');

            const formData = new FormData();
            formData.append('file', file);

            try {
                const res = await fetch('/api/infer/ref_audio/upload', {
                    method: 'POST',
                    body: formData,
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.detail || `HTTP ${res.status}`);
                }
                const data = await res.json();
                showToast(`参考音频已上传: ${data.filename}`, 'success');

                // 重新加载参考音频列表并选中上传的文件
                await loadInferModels();
                const sel = document.getElementById('inferRefSelect');
                if (sel && data.path) {
                    // 尝试选中刚上传的文件
                    for (let i = 0; i < sel.options.length; i++) {
                        if (sel.options[i].value === data.path) {
                            sel.selectedIndex = i;
                            onRefAudioChange();
                            break;
                        }
                    }
                }
            } catch (err) {
                showToast('上传失败: ' + err.message, 'error');
            }

            // 重置 input 以允许重复上传同一文件
            event.target.value = '';
        }

        async function startInferEngine() {
            const sovitsPath = document.getElementById('inferSovitsSelect')?.value;
            const gptPath = document.getElementById('inferGptSelect')?.value;
            if (!sovitsPath || !gptPath) {
                showToast('请先选择 SoVITS 和 GPT 模型', 'error');
                return;
            }

            const btn = document.getElementById('btnStartEngine');
            const stopBtn = document.getElementById('btnStopEngine');
            const statusEl = document.getElementById('inferEngineStatus');

            btn.disabled = true;
            stopBtn.style.display = 'inline-flex';
            statusEl.textContent = '正在启动...';
            statusEl.style.color = 'var(--accent)';

            // 显示日志
            const logArea = document.getElementById('inferLogArea');
            if (logArea) logArea.style.display = 'block';

            try {
                await apiPost('/api/infer/start', {
                    sovits_path: sovitsPath,
                    gpt_path: gptPath,
                });
                showToast('推理引擎正在启动...', 'success');
                startInferPolling();
            } catch (err) {
                btn.disabled = false;
                stopBtn.style.display = 'none';
                statusEl.textContent = '启动失败';
                statusEl.style.color = 'var(--accent-danger)';
                showToast('启动失败: ' + err.message, 'error');
            }
        }

        async function stopInferEngine() {
            try {
                await apiPost('/api/infer/stop', {});
                showToast('推理引擎已停止', 'success');
                if (inferEnginePolling) {
                    clearInterval(inferEnginePolling);
                    inferEnginePolling = null;
                }
                updateInferEngineUI('idle');
            } catch (err) {
                showToast('停止失败: ' + err.message, 'error');
            }
        }

        function startInferPolling() {
            if (inferEnginePolling) clearInterval(inferEnginePolling);
            inferEnginePolling = setInterval(pollInferStatus, 2000);
            pollInferStatus();
        }

        async function pollInferStatus() {
            try {
                const data = await apiGet('/api/infer/status');

                // 更新日志
                const logEl = document.getElementById('inferLogOutput');
                if (logEl && data.logs) {
                    logEl.innerHTML = data.logs.slice(-50).map(l => {
                        let cls = 'log-line';
                        if (l.includes('就绪') || l.includes('ready') || l.includes('成功')) cls += ' log-success';
                        if (l.includes('失败') || l.includes('error') || l.includes('Error')) cls += ' log-error';
                        return `<div class="${cls}">${escapeHtml(l)}</div>`;
                    }).join('');
                    logEl.scrollTop = logEl.scrollHeight;
                }

                if (data.status === 'running') {
                    updateInferEngineUI('running');
                    clearInterval(inferEnginePolling);
                    inferEnginePolling = null;
                } else if (data.status === 'error') {
                    updateInferEngineUI('error', data.error);
                    clearInterval(inferEnginePolling);
                    inferEnginePolling = null;
                }
                // 'starting' — keep polling
            } catch (err) {
                // keep polling on network errors
            }
        }

        function updateInferEngineUI(status, errorMsg) {
            const btn = document.getElementById('btnStartEngine');
            const stopBtn = document.getElementById('btnStopEngine');
            const statusEl = document.getElementById('inferEngineStatus');
            const genBtn = document.getElementById('btnGenerateTTS');

            if (!statusEl) return;

            switch (status) {
                case 'idle':
                    if (btn) btn.disabled = false;
                    if (stopBtn) stopBtn.style.display = 'none';
                    statusEl.textContent = '未启动';
                    statusEl.style.color = 'var(--text-muted)';
                    if (genBtn) genBtn.disabled = true;
                    break;
                case 'starting':
                    if (btn) btn.disabled = true;
                    if (stopBtn) stopBtn.style.display = 'inline-flex';
                    statusEl.textContent = '正在启动...';
                    statusEl.style.color = 'var(--accent)';
                    if (genBtn) genBtn.disabled = true;
                    break;
                case 'running':
                    if (btn) btn.disabled = true;
                    if (stopBtn) stopBtn.style.display = 'inline-flex';
                    statusEl.innerHTML = '<i class="ph ph-check-circle" style="margin-right: 4px;"></i>运行中';
                    statusEl.style.color = 'var(--accent-success)';
                    if (genBtn) genBtn.disabled = false;
                    showToast('推理引擎已就绪！', 'success');
                    break;
                case 'error':
                    if (btn) btn.disabled = false;
                    if (stopBtn) stopBtn.style.display = 'none';
                    statusEl.textContent = errorMsg || '启动失败';
                    statusEl.style.color = 'var(--accent-danger)';
                    if (genBtn) genBtn.disabled = true;
                    break;
            }
        }

        async function checkInferEngineStatus() {
            try {
                const data = await apiGet('/api/infer/status');
                if (data.status === 'running') {
                    updateInferEngineUI('running');
                    // 显示日志
                    const logArea = document.getElementById('inferLogArea');
                    if (logArea) logArea.style.display = 'block';
                } else if (data.status === 'starting') {
                    updateInferEngineUI('starting');
                    const logArea = document.getElementById('inferLogArea');
                    if (logArea) logArea.style.display = 'block';
                    startInferPolling();
                } else if (data.status === 'error') {
                    updateInferEngineUI('error', data.error);
                }
            } catch (e) { }
        }

        function toggleInferAdvanced() {
            inferAdvancedOpen = !inferAdvancedOpen;
            const toggle = document.querySelector('#inferContent .advanced-toggle');
            const params = document.getElementById('inferAdvancedParams');
            if (toggle) toggle.classList.toggle('open', inferAdvancedOpen);
            if (params) {
                params.classList.toggle('hidden', !inferAdvancedOpen);
                params.style.display = inferAdvancedOpen ? 'grid' : 'none';
            }
        }

        function toggleInferLog() {
            const logEl = document.getElementById('inferLogOutput');
            if (logEl) {
                const isVisible = logEl.style.display !== 'none';
                logEl.style.display = isVisible ? 'none' : 'block';
            }
        }

        async function generateTTS() {
            const text = document.getElementById('inferTextInput')?.value?.trim();
            if (!text) { showToast('请输入要合成的文字', 'error'); return; }

            const btn = document.getElementById('btnGenerateTTS');
            const statusEl = document.getElementById('inferGenStatus');
            btn.disabled = true;
            statusEl.textContent = '生成中...';
            statusEl.style.color = 'var(--accent)';

            const payload = {
                text: text,
                text_lang: document.getElementById('inferTextLang')?.value || 'zh',
                ref_audio_path: document.getElementById('inferRefSelect')?.value || '',
                prompt_text: document.getElementById('inferPromptText')?.value || '',
                prompt_lang: document.getElementById('inferPromptLang')?.value || 'zh',
                top_k: parseInt(document.getElementById('inferTopK')?.value || '5'),
                top_p: parseFloat(document.getElementById('inferTopP')?.value || '1'),
                temperature: parseFloat(document.getElementById('inferTemp')?.value || '1'),
                text_split_method: document.getElementById('inferSplitMethod')?.value || 'cut5',
                batch_size: parseInt(document.getElementById('inferBatch')?.value || '1'),
                speed_factor: parseFloat(document.getElementById('inferSpeed')?.value || '1'),
                seed: parseInt(document.getElementById('inferSeed')?.value || '-1'),
                repetition_penalty: parseFloat(document.getElementById('inferRepPenalty')?.value || '1.35'),
                sample_steps: parseInt(document.getElementById('inferSampleSteps')?.value || '32'),
                media_type: 'wav',
            };

            try {
                const res = await fetch('/api/infer/tts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.detail || `HTTP ${res.status}`);
                }
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);

                // 添加到历史
                inferHistoryId++;
                inferHistory.unshift({
                    id: inferHistoryId,
                    text: text.length > 40 ? text.substring(0, 40) + '...' : text,
                    url: url,
                    blob: blob,
                    time: new Date().toLocaleTimeString('zh-CN'),
                });
                if (inferHistory.length > 20) {
                    const removed = inferHistory.pop();
                    if (removed.url) URL.revokeObjectURL(removed.url);
                }

                renderInferResults();

                // 自动播放
                const audio = new Audio(url);
                audio.play();

                statusEl.textContent = '生成完成!';
                statusEl.style.color = 'var(--accent-success)';
                showToast('语音生成成功！', 'success');
            } catch (err) {
                statusEl.textContent = '生成失败';
                statusEl.style.color = 'var(--accent-danger)';
                showToast('生成失败: ' + err.message, 'error');
            } finally {
                btn.disabled = false;
            }
        }

        function renderInferResults() {
            const section = document.getElementById('inferResultSection');
            const list = document.getElementById('inferResultList');
            if (!section || !list) return;

            if (inferHistory.length === 0) {
                section.style.display = 'none';
                return;
            }
            section.style.display = 'block';

            list.innerHTML = inferHistory.map(item => `
            <div style="display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: rgba(255,255,255,0.02); border-radius: var(--radius-sm); margin-bottom: 6px; border: 1px solid var(--border);">
                <button class="play-btn" onclick="new Audio('${item.url}').play()" title="播放">
                    <i class="ph ph-play-circle" style="font-size: 26px;"></i>
                </button>
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 15px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(item.text)}</div>
                    <div style="font-size: 13px; color: var(--text-muted); margin-top: 2px;">${item.time}</div>
                </div>
                <a href="${item.url}" download="tts_${item.id}.wav" class="btn btn-ghost" style="padding: 6px 10px; font-size: 14px;">
                    <i class="ph ph-download-simple"></i>
                </a>
            </div>
        `).join('');
        }

