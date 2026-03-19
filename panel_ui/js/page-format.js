        // =====================================================
        //  Format Page
        // =====================================================
        let formatPolling = null;

        function updateFormatPage() {
            const container = document.getElementById('formatContent');
            if (!activeProject) {
                container.innerHTML = `
                <div class="no-project-hint">
                    <i class="ph ph-folder-open hint-icon"></i>
                    <div class="hint-text">请先在「项目管理」中选择一个项目</div>
                </div>
            `;
                return;
            }

            container.innerHTML = `
            <div id="formatCheckArea" style="margin-bottom: 20px;">
                <div class="slice-section">
                    <div class="slice-section-title"><i class="ph ph-check-circle"></i> 前置检查</div>
                    <div id="formatCheckResult" style="color: var(--text-secondary); font-size: 16px;">检查中...</div>
                </div>
            </div>

            <div class="slice-section">
                <div class="slice-section-title"><i class="ph ph-lightning"></i> 一键格式化</div>
                <div style="font-size: 15px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.6;">
                    点击按钮将依次执行三步处理：文本分词 + BERT 特征提取 → SSL 特征 + 32k 音频 → 语义 Token 提取。<br>
                    已完成的步骤会自动跳过，无需担心重复处理。
                </div>
                <div class="inline-warn" style="margin-top: 4px;">
                    <i class="ph ph-warning"></i>
                    <span>请关注下方日志中是否有报错信息。界面显示「完成」不一定是真的完成，<b>要看日志确认每一步真正成功</b>。</span>
                </div>

                <!-- 三步进度指示器 -->
                <div id="formatSteps" style="display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap;">
                    <div class="format-step-card" id="fmtStep1a" style="flex:1; min-width: 200px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                            <i class="ph ph-text-aa" style="font-size: 20px; color: var(--accent);"></i>
                            <span style="font-size: 16px; font-weight: 700;">Step A</span>
                            <span id="fmtIcon1a" style="margin-left: auto; font-size: 18px;"></span>
                        </div>
                        <div style="font-size: 14px; color: var(--text-muted);">文本分词 + BERT 特征</div>
                    </div>
                    <div class="format-step-card" id="fmtStep1b" style="flex:1; min-width: 200px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                            <i class="ph ph-waveform" style="font-size: 20px; color: var(--accent-purple);"></i>
                            <span style="font-size: 16px; font-weight: 700;">Step B</span>
                            <span id="fmtIcon1b" style="margin-left: auto; font-size: 18px;"></span>
                        </div>
                        <div style="font-size: 14px; color: var(--text-muted);">SSL 特征 + 32k 音频</div>
                    </div>
                    <div class="format-step-card" id="fmtStep1c" style="flex:1; min-width: 200px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                            <i class="ph ph-hash" style="font-size: 20px; color: var(--accent-warning);"></i>
                            <span style="font-size: 16px; font-weight: 700;">Step C</span>
                            <span id="fmtIcon1c" style="margin-left: auto; font-size: 18px;"></span>
                        </div>
                        <div style="font-size: 14px; color: var(--text-muted);">语义 Token 提取</div>
                    </div>
                </div>

                <div id="formatActionArea">
                    <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                        <button class="btn btn-primary" id="btnStartFormat" onclick="startFormat()" disabled>
                            <i class="ph ph-play"></i> 开始格式化
                        </button>
                        <span id="formatStatusText" style="font-size: 15px; color: var(--text-secondary);"></span>
                    </div>
                </div>

                <!-- 进度区域（运行时显示） -->
                <div id="formatProgressArea" style="display: none;">
                    <div class="progress-header" style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                        <span class="prog-label" id="formatProgLabel" style="font-size: 15px; color: var(--text-secondary);">准备中…</span>
                        <span class="prog-pct" id="formatProgPct" style="font-size: 15px; font-weight: 700; color: var(--accent);">0%</span>
                    </div>
                    <div class="progress-bar-lg" style="height: 10px; border-radius: 5px; background: var(--bg-tertiary); overflow: hidden;">
                        <div class="fill" id="formatProgFill" style="width: 0%; height: 100%; background: var(--accent); border-radius: 5px; transition: width 0.5s ease;"></div>
                    </div>
                    <div style="display: flex; gap: 10px; align-items: center; margin-top: 12px;">
                        <button class="btn" id="btnStopFormat" onclick="stopFormat()">
                            <i class="ph ph-stop"></i> 停止
                        </button>
                    </div>
                </div>

                <!-- 日志输出 -->
                <div id="formatLogArea" style="display: none; margin-top: 16px;">
                    <div class="log-output" id="formatLogOutput" style="max-height: 300px;"></div>
                </div>
            </div>

            <!-- 完成结果 -->
            <div id="formatResultArea" style="display: none; margin-top: 20px;">
                <div class="slice-section">
                    <div class="slice-section-title" style="color: var(--accent-success);"><i class="ph ph-check-circle"></i> 格式化完成</div>
                    <div id="formatResultInfo"></div>
                    <div style="margin-top: 14px;">
                        <button class="btn btn-primary" onclick="navigateTo('train')">
                            <i class="ph ph-arrow-right"></i> 下一步：模型训练
                        </button>
                    </div>
                </div>
            </div>
        `;

            checkFormatPrerequisites();
            checkExistingFormatStatus();
        }

        async function checkFormatPrerequisites() {
            const el = document.getElementById('formatCheckResult');
            const btn = document.getElementById('btnStartFormat');
            if (!el || !btn) return;

            try {
                const data = await apiGet('/api/format/check');
                if (data.ready) {
                    let existingHtml = '';
                    if (data.existing) {
                        const checks = [];
                        if (data.existing.text) checks.push('文本特征');
                        if (data.existing.hubert) checks.push('SSL特征');
                        if (data.existing.semantic) checks.push('语义Token');
                        if (checks.length > 0) {
                            existingHtml = `<div style="margin-top: 8px; font-size: 14px; color: var(--accent-warning);"><i class="ph ph-info" style="margin-right: 4px;"></i>已有产物: ${checks.join('、')}（将自动跳过）</div>`;
                        }
                    }
                    el.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-success);">
                        <i class="ph ph-check-circle" style="font-size: 20px;"></i>
                        <span>前置步骤已完成，可以开始格式化</span>
                    </div>
                    <div style="margin-top: 8px; font-size: 14px; color: var(--text-muted);">
                        <div>标注文件: ${escapeHtml(data.inp_text)}</div>
                        <div>音频目录: ${escapeHtml(data.inp_wav_dir)}</div>
                        <div>训练版本: ${escapeHtml(data.version || 'v2Pro')}</div>
                    </div>
                    ${existingHtml}
                `;
                    btn.disabled = false;
                } else {
                    // Expert mode: show warning but don't disable button
                    if (isExpertMode()) {
                        el.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-warning);">
                            <i class="ph ph-warning" style="font-size: 20px;"></i>
                            <span>${escapeHtml(data.reason)}</span>
                            <span class="expert-mode-badge"><i class="ph ph-rocket-launch"></i> 自由模式 — 不阻止操作</span>
                        </div>
                    `;
                        btn.disabled = false;
                    } else {
                        el.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-warning);">
                            <i class="ph ph-warning" style="font-size: 20px;"></i>
                            <span>${escapeHtml(data.reason)}</span>
                        </div>
                    `;
                        btn.disabled = true;
                    }
                }
            } catch (err) {
                el.innerHTML = `<span style="color: var(--accent-danger);">检查失败: ${escapeHtml(err.message)}</span>`;
                btn.disabled = isExpertMode() ? false : true;
            }
        }

        async function startFormat() {
            const actionArea = document.getElementById('formatActionArea');
            const progressArea = document.getElementById('formatProgressArea');
            const logArea = document.getElementById('formatLogArea');

            actionArea.style.display = 'none';
            progressArea.style.display = 'block';
            logArea.style.display = 'block';
            document.getElementById('formatProgLabel').textContent = '正在启动...';
            document.getElementById('formatProgPct').textContent = '0%';
            document.getElementById('formatProgFill').style.width = '0%';

            try {
                await apiPost('/api/format/start', {});
                showToast('格式化任务已启动', 'success');
                startFormatPolling();
            } catch (err) {
                actionArea.style.display = 'block';
                progressArea.style.display = 'none';
                showToast('启动失败: ' + err.message, 'error');
            }
        }

        async function stopFormat() {
            try {
                await apiPost('/api/format/stop', {});
                showToast('格式化任务已停止', 'success');
                if (formatPolling) {
                    clearInterval(formatPolling);
                    formatPolling = null;
                }
                const actionArea = document.getElementById('formatActionArea');
                const progressArea = document.getElementById('formatProgressArea');
                const statusEl = document.getElementById('formatStatusText');
                if (actionArea) actionArea.style.display = 'block';
                if (progressArea) progressArea.style.display = 'none';
                if (statusEl) {
                    statusEl.textContent = '已停止';
                    statusEl.style.color = 'var(--text-muted)';
                }
            } catch (err) {
                showToast('停止失败: ' + err.message, 'error');
            }
        }

        function startFormatPolling() {
            if (formatPolling) clearInterval(formatPolling);
            formatPolling = setInterval(pollFormatStatus, 1000);
            pollFormatStatus();
        }

        function getStepIcon(status) {
            switch (status) {
                case 'done': return '<i class="ph-fill ph-check-circle" style="color: var(--accent-success);"></i>';
                case 'running': return '<i class="ph ph-spinner" style="color: var(--accent); animation: spin 1s linear infinite;"></i>';
                case 'skipped': return '<i class="ph ph-fast-forward" style="color: var(--text-muted);"></i>';
                case 'error': return '<i class="ph-fill ph-x-circle" style="color: var(--accent-danger);"></i>';
                default: return '<i class="ph ph-circle" style="color: var(--text-muted); opacity: 0.4;"></i>';
            }
        }

        function getStepBorder(status) {
            switch (status) {
                case 'done': return 'var(--accent-success)';
                case 'running': return 'var(--accent)';
                case 'error': return 'var(--accent-danger)';
                default: return 'var(--border)';
            }
        }

        function calcFormatProgress(stepProgress, currentStep) {
            // 每个 step 权重: 1a=33%, 1b=34%, 1c=33%
            const weights = { '1a': 33, '1b': 34, '1c': 33 };
            let pct = 0;
            for (const [key, w] of Object.entries(weights)) {
                const st = stepProgress[key];
                if (st === 'done' || st === 'skipped') {
                    pct += w;
                } else if (st === 'running') {
                    pct += Math.round(w * 0.5); // 运行中算一半
                }
            }
            return Math.min(pct, 100);
        }

        function getFormatStepLabel(currentStep) {
            const stepNames = { '1a': 'Step A: 文本分词 + BERT', '1b': 'Step B: SSL 特征 + 32k 音频', '1b_sv': 'Step B: 说话人嵌入', '1c': 'Step C: 语义 Token' };
            return stepNames[currentStep] || '处理中...';
        }

        async function pollFormatStatus() {
            try {
                const data = await apiGet('/api/format/status');

                // Update step icons and borders
                ['1a', '1b', '1c'].forEach(key => {
                    const icon = document.getElementById(`fmtIcon${key}`);
                    const card = document.getElementById(`fmtStep${key}`);
                    const status = data.step_progress[key];
                    if (icon) icon.innerHTML = getStepIcon(status);
                    if (card) card.style.borderColor = getStepBorder(status);
                });

                // Update progress bar
                if (data.status === 'running') {
                    const pct = calcFormatProgress(data.step_progress, data.current_step);
                    const progLabel = document.getElementById('formatProgLabel');
                    const progPct = document.getElementById('formatProgPct');
                    const progFill = document.getElementById('formatProgFill');
                    if (progLabel) progLabel.textContent = getFormatStepLabel(data.current_step);
                    if (progPct) progPct.textContent = pct + '%';
                    if (progFill) progFill.style.width = pct + '%';
                }

                // Update logs
                const logEl = document.getElementById('formatLogOutput');
                if (logEl && data.logs) {
                    logEl.innerHTML = data.logs.map(l => {
                        let cls = 'log-line';
                        if (l.includes('完成') || l.includes('Done') || l.includes('跳过')) cls += ' log-success';
                        if (l.includes('失败') || l.includes('error') || l.includes('Error')) cls += ' log-error';
                        return `<div class="${cls}">${escapeHtml(l)}</div>`;
                    }).join('');
                    logEl.scrollTop = logEl.scrollHeight;
                }

                // Check if finished
                if (data.status === 'done') {
                    clearInterval(formatPolling);
                    formatPolling = null;
                    // 进度条到 100%
                    const progPct = document.getElementById('formatProgPct');
                    const progFill = document.getElementById('formatProgFill');
                    const progLabel = document.getElementById('formatProgLabel');
                    if (progPct) progPct.textContent = '100%';
                    if (progFill) progFill.style.width = '100%';
                    if (progLabel) progLabel.textContent = '格式化完成！';
                    // 恢复按钮
                    const actionArea = document.getElementById('formatActionArea');
                    const progressArea = document.getElementById('formatProgressArea');
                    const statusEl = document.getElementById('formatStatusText');
                    if (actionArea) actionArea.style.display = 'block';
                    if (progressArea) progressArea.style.display = 'none';
                    if (statusEl) {
                        statusEl.textContent = '格式化完成！';
                        statusEl.style.color = 'var(--accent-success)';
                    }
                    showToast('训练集格式化完成！', 'success');
                    showFormatResult();
                    loadProjects();
                } else if (data.status === 'error') {
                    clearInterval(formatPolling);
                    formatPolling = null;
                    const actionArea = document.getElementById('formatActionArea');
                    const progressArea = document.getElementById('formatProgressArea');
                    const statusEl = document.getElementById('formatStatusText');
                    if (actionArea) actionArea.style.display = 'block';
                    if (progressArea) progressArea.style.display = 'none';
                    if (statusEl) {
                        statusEl.textContent = '格式化出错';
                        statusEl.style.color = 'var(--accent-danger)';
                    }
                    showToast('格式化出错: ' + (data.error || '未知错误'), 'error');
                }
            } catch (err) {
                // network error, keep polling
            }
        }

        function showFormatResult() {
            const area = document.getElementById('formatResultArea');
            const info = document.getElementById('formatResultInfo');
            if (!area || !info) return;
            area.style.display = 'block';
            info.innerHTML = `
            <div style="background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px 18px;">
                <div style="font-size: 15px; font-weight: 600; color: var(--accent-success); margin-bottom: 8px;">
                    <i class="ph ph-check-circle" style="margin-right: 4px;"></i>训练数据已准备就绪
                </div>
                <div style="font-size: 14px; color: var(--text-muted); line-height: 1.8;">
                    <div><i class="ph ph-file-text" style="margin-right: 4px;"></i>2-name2text.txt — 文本音素特征</div>
                    <div><i class="ph ph-folder" style="margin-right: 4px;"></i>3-bert/ — BERT 语言特征</div>
                    <div><i class="ph ph-folder" style="margin-right: 4px;"></i>4-cnhubert/ — SSL 自监督特征</div>
                    <div><i class="ph ph-folder" style="margin-right: 4px;"></i>5-wav32k/ — 32kHz 标准化音频</div>
                    <div><i class="ph ph-file-text" style="margin-right: 4px;"></i>6-name2semantic.tsv — 语义 Token</div>
                </div>
            </div>
        `;
        }

        async function checkExistingFormatStatus() {
            try {
                const data = await apiGet('/api/format/status');
                if (data.status === 'done') {
                    // Show step status
                    ['1a', '1b', '1c'].forEach(key => {
                        const icon = document.getElementById(`fmtIcon${key}`);
                        const card = document.getElementById(`fmtStep${key}`);
                        const status = data.step_progress[key];
                        if (icon) icon.innerHTML = getStepIcon(status);
                        if (card) card.style.borderColor = getStepBorder(status);
                    });
                    showFormatResult();
                    const statusEl = document.getElementById('formatStatusText');
                    if (statusEl) {
                        statusEl.textContent = '格式化完成';
                        statusEl.style.color = 'var(--accent-success)';
                    }
                    // Show logs
                    if (data.logs && data.logs.length > 0) {
                        const logArea = document.getElementById('formatLogArea');
                        if (logArea) logArea.style.display = 'block';
                        const logEl = document.getElementById('formatLogOutput');
                        if (logEl) {
                            logEl.innerHTML = data.logs.map(l => {
                                let cls = 'log-line';
                                if (l.includes('完成') || l.includes('跳过')) cls += ' log-success';
                                if (l.includes('失败') || l.includes('error')) cls += ' log-error';
                                return `<div class="${cls}">${escapeHtml(l)}</div>`;
                            }).join('');
                        }
                    }
                } else if (data.status === 'running') {
                    // Resume polling — hide action, show progress
                    const actionArea = document.getElementById('formatActionArea');
                    const progressArea = document.getElementById('formatProgressArea');
                    const logArea = document.getElementById('formatLogArea');
                    if (actionArea) actionArea.style.display = 'none';
                    if (progressArea) progressArea.style.display = 'block';
                    if (logArea) logArea.style.display = 'block';
                    startFormatPolling();
                }
            } catch (e) { }
        }

