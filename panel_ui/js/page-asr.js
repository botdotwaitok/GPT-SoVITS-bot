        // =====================================================
        //  ASR Page
        // =====================================================
        let asrEngines = [];
        let asrSelectedEngine = 'funasr';
        let asrPolling = null;
        let asrCustomDir = '';  // 空 = 使用默认切分产物目录

        async function loadAsrModels() {
            try {
                const data = await apiGet('/api/asr/models');
                asrEngines = data.engines || [];
            } catch (e) {
                asrEngines = [];
            }
        }

        function updateAsrPage() {
            const container = document.getElementById('asrContent');
            if (!activeProject) {
                container.innerHTML = `
                <div class="no-project-hint">
                    <i class="ph ph-folder-open hint-icon"></i>
                    <div class="hint-text">请先在「项目管理」中选择一个项目</div>
                </div>
            `;
                return;
            }
            if (!asrEngines.length) {
                loadAsrModels().then(() => renderAsrUI(container));
            } else {
                renderAsrUI(container);
            }
        }

        function renderAsrUI(container) {
            let engine = asrEngines.find(e => e.id === asrSelectedEngine) || asrEngines[0];
            if (!engine) return;

            // Auto-switch to fasterwhisper if project language isn't supported by current engine
            const projLang = getActiveProjectLanguage();
            const engineHasLang = engine.languages.some(l => l.code === projLang);
            if (!engineHasLang && asrEngines.length > 1) {
                const fallback = asrEngines.find(e => e.languages.some(l => l.code === projLang));
                if (fallback) {
                    asrSelectedEngine = fallback.id;
                    engine = fallback;
                }
            }

            const proj = projects.find(p => p.name === activeProject);
            const sliceDir = `output/slicer_opt/${activeProject}`;

            // Language options
            const langOptions = engine.languages.map(l =>
                `<option value="${l.code}" ${l.code === getActiveProjectLanguage() ? 'selected' : ''}>${l.name} (${l.code})</option>`
            ).join('');

            // Model size options (only for fasterwhisper)
            const sizeOptions = engine.model_sizes.map(s =>
                `<option value="${s}" ${s === 'large-v3' ? 'selected' : ''}>${s}</option>`
            ).join('');

            // Precision options
            const precOptions = engine.precisions.map(p =>
                `<option value="${p}" ${p === engine.precisions[0] ? 'selected' : ''}>${p}</option>`
            ).join('');

            container.innerHTML = `
            <!-- 1. Engine Selection -->
            <div class="slice-section">
                <div class="slice-section-title"><i class="ph ph-cpu"></i>选择识别引擎</div>
                <div class="preset-grid">
                    ${asrEngines.map(eng => `
                        <div class="preset-btn ${eng.id === asrSelectedEngine ? 'preset-active' : ''}" onclick="selectAsrEngine('${eng.id}')">
                            <div class="preset-name"><i class="ph ph-${eng.id === 'funasr' ? 'translate' : 'globe-hemisphere-west'}" style="margin-right:4px;"></i>${escapeHtml(eng.name)}${eng.id === 'funasr' ? ' <span style="font-size: 13px;color:var(--accent-warning);font-weight:500;">(仅中文/粤语)</span>' : ''}</div>
                            <div class="preset-desc">${escapeHtml(eng.description)}${eng.id === 'funasr' ? '。<b>其她语种请用 Faster Whisper</b>' : ''}</div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- 2. Parameters -->
            <div class="slice-section">
                <div class="slice-section-title"><i class="ph ph-sliders-horizontal"></i>参数设置</div>
                <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;">
                    <div class="param-group">
                        <label>语言</label>
                        <select class="form-select" id="asrLanguage">${langOptions}</select>
                    </div>
                    <div class="param-group" id="asrModelSizeGroup" style="${engine.id === 'funasr' ? 'display:none;' : ''}">
                        <label>模型大小</label>
                        <select class="form-select" id="asrModelSize">${sizeOptions}</select>
                        <div class="param-hint">越大越准，但越慢。推荐 large-v3</div>
                    </div>
                    <div class="param-group" id="asrPrecisionGroup" style="${engine.id === 'funasr' ? 'display:none;' : ''}">
                        <label>计算精度</label>
                        <select class="form-select" id="asrPrecision">${precOptions}</select>
                        <div class="param-hint">推荐 float16，综合速度和精度最佳。int8 省显存但速度相近</div>
                    </div>
                </div>
            </div>

            <!-- 3. Input Directory -->
            <div class="slice-section">
                <div class="slice-section-title"><i class="ph ph-folder-notch-open"></i>输入目录</div>
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                    <div style="display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--bg-primary);border:1px solid var(--border);border-radius:var(--radius-sm);flex:1;min-width:0;">
                        <i class="ph ph-folder" style="font-size:18px;color:var(--accent);flex-shrink:0;"></i>
                        <span style="font-size:15px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" id="asrDirDisplay">
                            ${asrCustomDir ? escapeHtml(asrCustomDir) : `<span style="color:var(--text-muted);">默认: ${escapeHtml(sliceDir)}（切分产物）</span>`}
                        </span>
                    </div>
                    <button class="btn" onclick="document.getElementById('asrFolderInput').click()" style="flex-shrink:0;">
                        <i class="ph ph-folder-open"></i> 选择其她目录
                    </button>
                    ${asrCustomDir ? `<button class="btn btn-ghost" onclick="resetAsrDir()" style="flex-shrink:0;" title="恢复使用默认切分产物目录"><i class="ph ph-arrow-counter-clockwise"></i> 恢复默认</button>` : ''}
                    <input type="file" id="asrFolderInput" webkitdirectory style="display:none;" onchange="handleAsrFolderSelect(this)">
                </div>
                <div class="form-hint" style="margin-top:6px;">默认使用切分产物目录，也可以选择其她包含音频文件的文件夹</div>
            </div>

            <!-- 4. Run -->
            <div class="slice-section">
                <div style="display:flex; align-items:center; gap:12px;">
                    <button class="btn btn-primary" id="btnStartAsr" onclick="startAsr()">
                        <i class="ph ph-play"></i> 开始识别
                    </button>
                    <span id="asrStatusText" style="font-size: 15px; color:var(--text-muted);"></span>
                </div>
                <div class="slice-progress" id="asrProgressArea" style="display:none;">
                    <div class="progress-header">
                        <span class="prog-label" id="asrProgLabel">准备中…</span>
                        <span class="prog-pct" id="asrProgPct">0%</span>
                    </div>
                    <div class="progress-bar-lg">
                        <div class="fill" id="asrProgFill" style="width:0%;"></div>
                    </div>
                    <div class="log-output" id="asrLogOutput"></div>
                </div>
            </div>

            <!-- 5. Result -->
            <div class="slice-section" id="asrResultArea" style="display:none;">
                <div class="slice-section-title"><i class="ph ph-check-circle" style="color:var(--accent-success);"></i>识别完成</div>
                <div id="asrResultInfo"></div>
                <div style="margin-top:18px; display:flex; gap:10px;">
                    <button class="btn btn-primary" id="btnAsrNext" onclick="asrGoAnnotate()">
                        <i class="ph ph-arrow-right"></i> 继续下一步 (标注)
                    </button>
                </div>
            </div>
        `;

            // Check if ASR already done for this project
            checkExistingAsrResult();
        }

        function selectAsrEngine(engineId) {
            asrSelectedEngine = engineId;
            const container = document.getElementById('asrContent');
            renderAsrUI(container);
        }

        function handleAsrFolderSelect(input) {
            if (input.files && input.files.length > 0) {
                // webkitRelativePath 格式为 "folderName/fileName"  取第一层目录名
                const relativePath = input.files[0].webkitRelativePath || '';
                const folderName = relativePath.split('/')[0] || '已选择文件夹';
                asrCustomDir = folderName;
                showToast(`已选择文件夹「${folderName}」（包含 ${input.files.length} 个文件）`, 'success');
                // 上传文件到 raw_upload 目录
                handleSliceFiles(input.files);
                updateAsrPage();
            }
        }

        function resetAsrDir() {
            asrCustomDir = '';
            updateAsrPage();
            showToast('已恢复使用默认切分产物目录', 'success');
        }

        async function startAsr() {
            // 如果用户选了自定义文件夹（文件已上传到 raw_upload），使用 raw_upload 作为输入目录
            const inputDir = asrCustomDir ? `raw_upload` : '';
            const body = {
                engine: asrSelectedEngine,
                language: document.getElementById('asrLanguage')?.value || 'zh',
                model_size: document.getElementById('asrModelSize')?.value || 'large-v3',
                precision: document.getElementById('asrPrecision')?.value || 'float16',
                input_dir: inputDir,
            };

            try {
                await apiPost('/api/asr/start', body);
                showToast('ASR 任务已启动', 'success');
                document.getElementById('btnStartAsr').disabled = true;
                document.getElementById('asrProgressArea').style.display = 'block';
                document.getElementById('asrStatusText').textContent = '运行中…';
                document.getElementById('asrStatusText').style.color = 'var(--text-muted)';
                startAsrPolling();
            } catch (err) {
                showToast('启动失败: ' + err.message, 'error');
            }
        }

        function startAsrPolling() {
            if (asrPolling) clearInterval(asrPolling);
            asrPolling = setInterval(pollAsrStatus, 800);
        }

        async function pollAsrStatus() {
            try {
                const data = await apiGet('/api/asr/status');
                const phase = data.phase || '';
                const phaseTip = data.phase_tip || '';
                const isIndeterminate = (phase === 'downloading' || phase === 'loading' || phase === 'collecting');

                // Progress bar: indeterminate during download/load, normal during recognition
                const progressBar = document.querySelector('#asrProgressArea .progress-bar-lg');
                const fillEl = document.getElementById('asrProgFill');
                const pctEl = document.getElementById('asrProgPct');
                if (progressBar) {
                    if (isIndeterminate) {
                        progressBar.classList.add('indeterminate');
                        if (pctEl) pctEl.textContent = '';
                    } else {
                        progressBar.classList.remove('indeterminate');
                        const pct = data.progress || 0;
                        if (pctEl) pctEl.textContent = pct + '%';
                        if (fillEl) fillEl.style.width = pct + '%';
                    }
                }

                // Label: phase-aware with Phosphor Icons
                const labelEl = document.getElementById('asrProgLabel');
                if (labelEl) {
                    if (phase === 'downloading') {
                        labelEl.innerHTML = '<i class="ph ph-download-simple" style="margin-right:4px;"></i>' + escapeHtml(phaseTip);
                    } else if (phase === 'loading') {
                        labelEl.innerHTML = '<i class="ph ph-circuitry" style="margin-right:4px;"></i>' + escapeHtml(phaseTip);
                    } else if (phase === 'recognizing' && data.current_file) {
                        labelEl.innerHTML = '<i class="ph ph-waveform" style="margin-right:4px;"></i>'
                            + `${escapeHtml(data.current_file)} (${data.processed_files}/${data.total_files})`;
                    } else if (phase === 'saving') {
                        labelEl.innerHTML = '<i class="ph ph-floppy-disk" style="margin-right:4px;"></i>' + escapeHtml(phaseTip);
                    } else if (phase === 'collecting') {
                        labelEl.innerHTML = '<i class="ph ph-magnifying-glass" style="margin-right:4px;"></i>' + escapeHtml(phaseTip);
                    } else {
                        labelEl.textContent = phaseTip || '准备中…';
                    }
                }

                // Logs
                const logEl = document.getElementById('asrLogOutput');
                if (logEl && data.logs) {
                    logEl.innerHTML = data.logs.map(line => {
                        let cls = 'log-line';
                        if (line.includes('完成') || line.includes('已加载')) cls += ' log-success';
                        if (line.includes('出错') || line.includes('失败')) cls += ' log-error';
                        return `<div class="${cls}">${escapeHtml(line)}</div>`;
                    }).join('');
                    logEl.scrollTop = logEl.scrollHeight;
                }

                // Done / Error
                if (data.status === 'done') {
                    clearInterval(asrPolling);
                    asrPolling = null;
                    if (progressBar) progressBar.classList.remove('indeterminate');
                    const btn = document.getElementById('btnStartAsr');
                    if (btn) btn.disabled = false;
                    const statusEl = document.getElementById('asrStatusText');
                    if (statusEl) {
                        statusEl.textContent = '识别完成！';
                        statusEl.style.color = 'var(--accent-success)';
                    }
                    showToast('语音识别完成！', 'success');
                    showAsrResult(data.output_file);
                    loadProjects(); // refresh step status
                } else if (data.status === 'error') {
                    clearInterval(asrPolling);
                    asrPolling = null;
                    if (progressBar) progressBar.classList.remove('indeterminate');
                    const btn = document.getElementById('btnStartAsr');
                    if (btn) btn.disabled = false;
                    const statusEl = document.getElementById('asrStatusText');
                    if (statusEl) {
                        statusEl.textContent = '识别出错';
                        statusEl.style.color = 'var(--accent-danger)';
                    }
                    showToast('ASR 出错: ' + (data.error || '未知错误') + '。可以再次点击开始重试', 'error');
                }
            } catch (err) {
                // network error, keep polling
            }
        }

        function showAsrResult(outputFile) {
            const area = document.getElementById('asrResultArea');
            const info = document.getElementById('asrResultInfo');
            if (!area || !info) return;
            area.style.display = 'block';
            info.innerHTML = `
            <div style="background:var(--bg-primary); border:1px solid var(--border); border-radius:var(--radius-sm); padding:14px 18px;">
                <div style="font-size: 15px; font-weight:600; color:var(--accent-success); margin-bottom:6px;">
                    <i class="ph ph-check-circle" style="margin-right:4px;"></i>标注文件已生成
                </div>
                <div style="font-size: 15px; color:var(--text-secondary); word-break:break-all;">${escapeHtml(outputFile)}</div>
            </div>
        `;
        }

        function asrGoAnnotate() {
            // Get the output file from ASR status and load it into annotate
            apiGet('/api/asr/status').then(data => {
                if (data.output_file) {
                    // Update project meta so annotate page picks it up
                    loadProjects().then(() => navigateTo('annotate'));
                } else {
                    navigateTo('annotate');
                }
            }).catch(() => navigateTo('annotate'));
        }

        async function checkExistingAsrResult() {
            try {
                const data = await apiGet('/api/asr/status');
                if (data.status === 'done' && data.output_file) {
                    showAsrResult(data.output_file);
                } else if (data.status === 'running') {
                    // Resume polling if task is still running
                    document.getElementById('asrProgressArea').style.display = 'block';
                    const btn = document.getElementById('btnStartAsr');
                    if (btn) btn.disabled = true;
                    const statusEl = document.getElementById('asrStatusText');
                    if (statusEl) statusEl.textContent = '运行中…';
                    startAsrPolling();
                }
            } catch (e) { }
        }

