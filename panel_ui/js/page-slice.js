        // =====================================================
        //  Slice Page
        // =====================================================
        let slicePreset = 'recommended';
        let sliceUploaded = [];
        let slicePolling = null;
        let sliceAudioEl = null;

        const PRESETS = {
            recommended: { name: '推荐', desc: '通用默认，适合大多数场景', threshold: -34, min_length: 4000, min_interval: 300, hop_size: 10, max_sil_kept: 500 },
            fine: { name: '精细切割', desc: '切更短的片段，适合精确控制', threshold: -30, min_length: 2000, min_interval: 200, hop_size: 10, max_sil_kept: 300 },
            coarse: { name: '粗切割', desc: '切更长的片段，减少碎片', threshold: -40, min_length: 8000, min_interval: 500, hop_size: 10, max_sil_kept: 1000 },
        };

        function updateSlicePage() {
            const container = document.getElementById('sliceContent');
            if (!activeProject) {
                container.innerHTML = `
                <div class="no-project-hint">
                    <i class="ph ph-folder-open hint-icon"></i>
                    <div class="hint-text">请先在「项目管理」中选择一个项目</div>
                </div>
            `;
                return;
            }
            renderSliceUI(container);
        }

        function renderSliceUI(container) {
            const p = PRESETS[slicePreset];
            const uploadedHtml = sliceUploaded.map(name =>
                `<div class="uploaded-item">
                <i class="ph ph-check-circle"></i>
                <span class="uploaded-name">${escapeHtml(name)}</span>
                <button class="uploaded-del-btn" onclick="deleteUploadedFile('${escapeAttr(name)}')" title="删除此文件">
                    <i class="ph ph-x"></i>
                </button>
            </div>`
            ).join('');

            container.innerHTML = `
            <!-- 1. Upload Section -->
            <div class="slice-section">
                <div class="slice-section-title"><i class="ph ph-upload-simple"></i>选择音频</div>
                <div class="upload-zone" id="uploadZone">
                    <input type="file" id="sliceFileInput" multiple accept="audio/*" onchange="handleSliceFiles(this.files)">
                    <div class="uz-icon"><i class="ph ph-cloud-arrow-up"></i></div>
                    <div class="uz-text">拖拽音频文件到这里，或点击选择</div>
                    <div class="uz-hint">支持 WAV、MP3、FLAC、OGG 等格式</div>
                </div>
                ${uploadedHtml ? `<div class="uploaded-list">${uploadedHtml}</div>` : ''}

                <div class="or-divider">或者</div>

                <div style="display:flex;gap:10px;align-items:center;">
                    <button class="btn" onclick="document.getElementById('sliceFolderInput').click()" style="flex-shrink:0;">
                        <i class="ph ph-folder-open"></i> 选择整个文件夹
                    </button>
                    <span style="font-size:14px;color:var(--text-muted);">选择后会自动上传文件夹内的所有音频文件</span>
                    <input type="file" id="sliceFolderInput" webkitdirectory multiple style="display:none;" onchange="handleSliceFiles(this.files)">
                </div>
            </div>

            <!-- 2. Params Section -->
            <div class="slice-section">
                <div class="slice-section-title"><i class="ph ph-sliders-horizontal"></i>切分参数</div>
                <div class="preset-grid">
                    <div class="preset-btn ${slicePreset === 'recommended' ? 'preset-active' : ''}" onclick="selectPreset('recommended')">
                        <div class="preset-name"><i class="ph ph-star" style="margin-right:4px;"></i>推荐</div>
                        <div class="preset-desc">通用默认，适合大多数场景</div>
                    </div>
                    <div class="preset-btn ${slicePreset === 'fine' ? 'preset-active' : ''}" onclick="selectPreset('fine')">
                        <div class="preset-name"><i class="ph ph-magnifying-glass-plus" style="margin-right:4px;"></i>精细切割</div>
                        <div class="preset-desc">切更短片段，精确控制</div>
                    </div>
                    <div class="preset-btn ${slicePreset === 'coarse' ? 'preset-active' : ''}" onclick="selectPreset('coarse')">
                        <div class="preset-name"><i class="ph ph-arrows-out-simple" style="margin-right:4px;"></i>粗切割</div>
                        <div class="preset-desc">切更长片段，减少碎片</div>
                    </div>
                </div>

                <div class="advanced-toggle" id="advToggle" onclick="toggleAdvanced()">
                    <i class="ph ph-caret-right"></i> 高级参数
                </div>
                <div class="advanced-params hidden" id="advParams">
                    <div class="param-group">
                        <label>Threshold (dB)</label>
                        <input type="number" id="pThreshold" value="${p.threshold}" step="1">
                        <div class="param-hint">静音判定阈值，越大越灵敏</div>
                    </div>
                    <div class="param-group">
                        <label>Min Length (ms)</label>
                        <input type="number" id="pMinLength" value="${p.min_length}" step="100">
                        <div class="param-hint">每段最短长度</div>
                    </div>
                    <div class="param-group">
                        <label>Min Interval (ms)</label>
                        <input type="number" id="pMinInterval" value="${p.min_interval}" step="50">
                        <div class="param-hint">最短切割间隔。如果音频切不开，试试降低到 100~200</div>
                    </div>
                    <div class="param-group">
                        <label>Hop Size (ms)</label>
                        <input type="number" id="pHopSize" value="${p.hop_size}" step="5">
                        <div class="param-hint">精度控制，越小越精确</div>
                    </div>
                    <div class="param-group">
                        <label>Max Silence (ms)</label>
                        <input type="number" id="pMaxSil" value="${p.max_sil_kept}" step="100">
                        <div class="param-hint">保留的最大静音长度</div>
                    </div>
                    <div class="param-group">
                        <label>Normalize Max</label>
                        <input type="number" id="pMax" value="0.9" step="0.05" min="0" max="1">
                        <div class="param-hint">音量归一化目标</div>
                    </div>
                    <div class="param-group">
                        <label>Alpha</label>
                        <input type="number" id="pAlpha" value="0.25" step="0.05" min="0" max="1">
                        <div class="param-hint">音量混合系数</div>
                    </div>
                </div>
            </div>

            <!-- 3. Run Section -->
            <div class="slice-section">
                <div style="display:flex;align-items:center;gap:12px;">
                    <button class="btn btn-primary" id="btnStartSlice" onclick="startSlice()">
                        <i class="ph ph-play"></i> 开始切分
                    </button>
                    <span id="sliceStatusText" style="font-size: 15px;color:var(--text-muted);"></span>
                </div>
                <div class="slice-progress" id="sliceProgressArea" style="display:none;">
                    <div class="progress-header">
                        <span class="prog-label" id="progLabel">准备中…</span>
                        <span class="prog-pct" id="progPct">0%</span>
                    </div>
                    <div class="progress-bar-lg">
                        <div class="fill" id="progFill" style="width:0%;"></div>
                    </div>
                    <div class="log-output" id="logOutput"></div>
                </div>
            </div>

            <!-- 4. Result Section -->
            <div class="slice-section" id="sliceResultArea" style="display:none;">
                <div class="slice-section-title"><i class="ph ph-list-checks"></i>切分结果</div>
                <div class="result-stats" id="resultStats"></div>
                <div class="result-table-wrap">
                    <table class="result-table">
                        <thead><tr><th></th><th>文件名</th><th>时长</th><th>大小</th></tr></thead>
                        <tbody id="resultBody"></tbody>
                    </table>
                </div>
                <div style="margin-top:18px;display:flex;gap:10px;">
                    <button class="btn btn-primary" onclick="navigateTo('asr')">
                        <i class="ph ph-arrow-right"></i> 继续下一步 (ASR)
                    </button>
                    <button class="btn" onclick="loadSlicePreview()">
                        <i class="ph ph-arrows-clockwise"></i> 刷新列表
                    </button>
                </div>
            </div>

            <audio id="sliceAudio" style="display:none;"></audio>
        `;

            // Setup drag & drop
            setupUploadZone();

            // Load already-uploaded files from server (persists across page reloads)
            loadUploadedFiles();

            // Check if there are existing results
            checkExistingSliceResults();
        }

        function setupUploadZone() {
            const zone = document.getElementById('uploadZone');
            if (!zone) return;
            zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
            zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');
                if (e.dataTransfer.files.length) handleSliceFiles(e.dataTransfer.files);
            });
        }

        async function handleSliceFiles(fileList) {
            if (!fileList || !fileList.length) return;

            // 过滤音频文件（文件夹选择时可能包含非音频文件）
            const audioExts = new Set(['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.wma']);
            const audioFiles = Array.from(fileList).filter(f => {
                const ext = f.name.lastIndexOf('.') >= 0 ? f.name.slice(f.name.lastIndexOf('.')).toLowerCase() : '';
                return audioExts.has(ext);
            });
            if (!audioFiles.length) {
                showToast('未找到支持的音频文件（WAV/MP3/FLAC/OGG 等）', 'error');
                return;
            }

            // 前端预过滤：跳过已存在的同名文件
            const existingSet = new Set(sliceUploaded);
            const newFiles = [];
            const frontendSkipped = [];
            for (const f of audioFiles) {
                if (existingSet.has(f.name)) {
                    frontendSkipped.push(f.name);
                } else {
                    newFiles.push(f);
                }
            }

            if (frontendSkipped.length > 0 && newFiles.length === 0) {
                showToast(`所有文件均已存在，已跳过`, 'error');
                return;
            }

            const formData = new FormData();
            for (const f of newFiles) formData.append('files', f);

            try {
                const res = await fetch('/api/slice/upload', { method: 'POST', body: formData });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.detail || res.status);
                }
                const data = await res.json();
                sliceUploaded = [...sliceUploaded, ...data.uploaded];

                const allSkipped = [...frontendSkipped, ...(data.skipped || [])];
                if (data.total > 0) {
                    showToast(`已上传 ${data.total} 个文件` + (allSkipped.length ? `，跳过 ${allSkipped.length} 个重复文件` : ''), 'success');
                } else if (allSkipped.length > 0) {
                    showToast(`所有文件均已存在，已跳过`, 'error');
                }
                updateSlicePage();
            } catch (err) {
                showToast('上传失败: ' + err.message, 'error');
            }
        }

        async function loadUploadedFiles() {
            try {
                const data = await apiGet('/api/slice/files');
                if (data.files && data.files.length > 0) {
                    sliceUploaded = data.files.map(f => f.name);
                    // Re-render the uploaded list only (avoid infinite loop by not calling updateSlicePage)
                    const listEl = document.querySelector('#sliceContent .uploaded-list');
                    if (listEl) {
                        listEl.innerHTML = sliceUploaded.map(name =>
                            `<div class="uploaded-item">
                            <i class="ph ph-check-circle"></i>
                            <span class="uploaded-name">${escapeHtml(name)}</span>
                            <button class="uploaded-del-btn" onclick="deleteUploadedFile('${escapeAttr(name)}')" title="删除此文件">
                                <i class="ph ph-x"></i>
                            </button>
                        </div>`
                        ).join('');
                    } else if (sliceUploaded.length > 0) {
                        // If no list element exists yet (first load with existing files), re-render
                        const container = document.getElementById('sliceContent');
                        if (container && activeProject) renderSliceUI(container);
                    }
                }
            } catch (e) { }
        }

        async function deleteUploadedFile(filename) {
            try {
                const res = await fetch('/api/slice/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filenames: [filename] }),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.detail || res.status);
                }
                sliceUploaded = sliceUploaded.filter(n => n !== filename);
                showToast(`已删除「${filename}」`, 'success');
                updateSlicePage();
            } catch (err) {
                showToast('删除失败: ' + err.message, 'error');
            }
        }

        function selectPreset(name) {
            slicePreset = name;
            updateSlicePage();
        }

        function toggleAdvanced() {
            const params = document.getElementById('advParams');
            const toggle = document.getElementById('advToggle');
            if (!params) return;
            params.classList.toggle('hidden');
            toggle.classList.toggle('open');
        }

        async function startSlice() {
            if (!sliceUploaded.length) {
                showToast('请先上传音频文件或选择文件夹', 'error');
                return;
            }

            // Read params
            const body = {
                input_path: '',
                preset: slicePreset,
                threshold: parseFloat(document.getElementById('pThreshold')?.value ?? PRESETS[slicePreset].threshold),
                min_length: parseInt(document.getElementById('pMinLength')?.value ?? PRESETS[slicePreset].min_length),
                min_interval: parseInt(document.getElementById('pMinInterval')?.value ?? PRESETS[slicePreset].min_interval),
                hop_size: parseInt(document.getElementById('pHopSize')?.value ?? PRESETS[slicePreset].hop_size),
                max_sil_kept: parseInt(document.getElementById('pMaxSil')?.value ?? PRESETS[slicePreset].max_sil_kept),
                normalize_max: parseFloat(document.getElementById('pMax')?.value ?? '0.9'),
                alpha: parseFloat(document.getElementById('pAlpha')?.value ?? '0.25'),
            };

            try {
                await apiPost('/api/slice/start', body);
                showToast('切分任务已启动', 'success');
                document.getElementById('btnStartSlice').disabled = true;
                document.getElementById('sliceProgressArea').style.display = 'block';
                document.getElementById('sliceStatusText').textContent = '运行中…';
                document.getElementById('sliceStatusText').style.color = 'var(--text-muted)';
                startSlicePolling();
            } catch (err) {
                showToast('启动失败: ' + err.message, 'error');
            }
        }

        function startSlicePolling() {
            if (slicePolling) clearInterval(slicePolling);
            slicePolling = setInterval(pollSliceStatus, 800);
        }

        async function pollSliceStatus() {
            try {
                const data = await apiGet('/api/slice/status');

                // Update progress bar
                const pct = data.progress || 0;
                document.getElementById('progPct').textContent = pct + '%';
                document.getElementById('progFill').style.width = pct + '%';

                // Update label
                const label = data.current_file
                    ? `正在处理: ${data.current_file} (${data.processed_files}/${data.total_files})`
                    : '准备中…';
                document.getElementById('progLabel').textContent = label;

                // Update logs
                const logEl = document.getElementById('logOutput');
                if (logEl && data.logs) {
                    logEl.innerHTML = data.logs.map(line => {
                        let cls = 'log-line';
                        if (line.includes('完成') || line.includes('成功')) cls += ' log-success';
                        if (line.includes('出错') || line.includes('失败')) cls += ' log-error';
                        return `<div class="${cls}">${escapeHtml(line)}</div>`;
                    }).join('');
                    logEl.scrollTop = logEl.scrollHeight;
                }

                // Check done
                if (data.status === 'done') {
                    clearInterval(slicePolling);
                    slicePolling = null;
                    document.getElementById('btnStartSlice').disabled = false;
                    document.getElementById('sliceStatusText').textContent = '切分完成！';
                    document.getElementById('sliceStatusText').style.color = 'var(--accent-success)';
                    showToast('音频切分完成！', 'success');
                    loadSlicePreview();
                    loadProjects(); // refresh step status
                } else if (data.status === 'error') {
                    clearInterval(slicePolling);
                    slicePolling = null;
                    document.getElementById('btnStartSlice').disabled = false;
                    document.getElementById('sliceStatusText').textContent = '切分出错';
                    document.getElementById('sliceStatusText').style.color = 'var(--accent-danger)';
                    showToast('切分出错: ' + (data.error || '未知错误'), 'error');
                }
            } catch (err) {
                // network error, keep polling
            }
        }

        async function loadSlicePreview() {
            try {
                const data = await apiGet('/api/slice/preview');
                if (!data.files || !data.files.length) return;

                const area = document.getElementById('sliceResultArea');
                if (!area) return;
                area.style.display = 'block';

                // Stats
                const s = data.stats;
                document.getElementById('resultStats').innerHTML = `
                <div class="stat-card">
                    <div class="stat-value">${s.total}</div>
                    <div class="stat-label">总片段数</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${s.min_duration}s</div>
                    <div class="stat-label">最短时长</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${s.max_duration}s</div>
                    <div class="stat-label">最长时长</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${s.avg_duration}s</div>
                    <div class="stat-label">平均时长</div>
                </div>
            `;

                // Dynamic warning for long audio clips
                const maxDur = parseFloat(s.max_duration);
                if (maxDur > 15) {
                    document.getElementById('resultStats').innerHTML += `
                    <div style="width:100%; flex-basis:100%;">
                        <div class="inline-warn" style="margin-top:8px;">
                            <i class="ph ph-warning"></i>
                            <span>发现超长音频（最长 ${s.max_duration}s）。建议将超过「你的显存 GB 数」秒的音频手动切短，否则训练时可能爆显存。例如 24GB 显存就要保证没有超过 24 秒的音频。</span>
                        </div>
                    </div>
                `;
                }

                // Table
                document.getElementById('resultBody').innerHTML = data.files.map(f => {
                    const sizeKB = (f.size / 1024).toFixed(1);
                    return `<tr>
                    <td><button class="play-btn" onclick="playSliceAudio('${escapeAttr(f.path)}')"><i class="ph ph-play-circle"></i></button></td>
                    <td>${escapeHtml(f.name)}</td>
                    <td>${f.duration}s</td>
                    <td>${sizeKB} KB</td>
                </tr>`;
                }).join('');
            } catch (err) {
                // silent
            }
        }

        async function checkExistingSliceResults() {
            try {
                const data = await apiGet('/api/slice/preview');
                if (data.files && data.files.length > 0) {
                    loadSlicePreview();
                }
            } catch (e) { }
        }

        function playSliceAudio(path) {
            const audio = document.getElementById('sliceAudio');
            if (!audio) return;
            audio.src = '/api/slice/audio?path=' + encodeURIComponent(path);
            audio.play();
        }

