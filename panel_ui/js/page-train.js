        // =====================================================
        //  Train Page — Step-by-Step Flow
        //  Phase: 'sovits' → 'gpt' → 'done'
        // =====================================================
        let trainPolling = null;
        let trainDefaults = null;
        let trainPhase = 'sovits';   // 'sovits' | 'gpt' | 'done'
        let trainAdvancedOpen = false;
        let trainDataReady = false;

        function updateTrainPage() {
            const container = document.getElementById('trainContent');
            if (!activeProject) {
                container.innerHTML = `
                <div class="no-project-hint">
                    <i class="ph ph-folder-open hint-icon"></i>
                    <div class="hint-text">请先在「项目管理」中选择一个项目</div>
                </div>
            `;
                return;
            }
            renderTrainUI(container);
        }

        async function renderTrainUI(container) {
            const proj = projects.find(p => p.name === activeProject);
            const version = proj ? (proj.version || 'v2Pro') : 'v2Pro';

            container.innerHTML = `
            <!-- 前置检查 -->
            <div class="slice-section">
                <div class="slice-section-title"><i class="ph ph-check-square-offset"></i>训练前置检查</div>
                <div id="trainCheckResult" style="padding: 8px 0;">
                    <i class="ph ph-spinner" style="animation: spin 1s linear infinite; margin-right: 6px;"></i>检查中...
                </div>
            </div>

            <!-- ====== Step 1: SoVITS ====== -->
            <div class="train-step-card active" id="trainStepSovits">
                <div class="train-step-header" id="trainStepSovitsHeader">
                    <div class="train-step-number">1</div>
                    <div class="train-step-title"><i class="ph ph-speaker-high" style="margin-right:6px; color: var(--accent-purple);"></i>SoVITS 训练</div>
                    <span class="train-step-badge badge-active" id="trainBadgeSovits">
                        <i class="ph ph-arrow-right"></i> 当前步骤
                    </span>
                </div>
                <div class="train-step-body" id="trainBodySovits">
                    <div style="font-size: 15px; color: var(--text-secondary); margin-bottom: 16px;">
                        训练声学模型，控制音色和发音效果。这是训练的第一步。
                    </div>

                    <!-- 参数设置 -->
                    <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 14px;">
                        <span style="font-size: 15px; color: var(--text-secondary);">版本: <strong style="color: var(--accent-purple);">${escapeHtml(version)}</strong></span>
                        <span id="trainRecommendedSovits" style="font-size: 14px; color: var(--text-muted);"></span>
                    </div>

                    <div class="advanced-toggle ${trainAdvancedOpen ? 'open' : ''}" onclick="toggleTrainAdvanced()">
                        <i class="ph ph-caret-right"></i>
                        <span>高级参数（新手可忽略）</span>
                    </div>
                    <div id="trainAdvancedParams" class="advanced-params ${trainAdvancedOpen ? '' : 'hidden'}" style="margin-top: 14px; display: ${trainAdvancedOpen ? 'grid' : 'none'}; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px;">
                        <div class="param-group">
                            <label>Batch Size</label>
                            <input type="number" id="trainBatchSize" min="1" max="64" value="0">
                            <div class="param-hint">0 = 自动推荐。参考：12G→5, 24G→14（切片10s时）。<br>如果训练时电脑非常卡，说明 batch 太大，请降低</div>
                        </div>
                        <div class="param-group">
                            <label>总训练轮数 (Epochs)</label>
                            <input type="number" id="trainEpochs" min="1" max="100" value="0">
                            <div class="param-hint">0 = 使用推荐值</div>
                        </div>
                        <div class="param-group">
                            <label>每隔 N 轮保存</label>
                            <input type="number" id="trainSaveEvery" min="1" max="50" value="0">
                            <div class="param-hint">0 = 使用推荐值</div>
                        </div>
                        <div class="param-group">
                            <label>仅保留最新权重</label>
                            <select class="form-select" id="trainSaveLatest">
                                <option value="true" selected>是（节省空间）</option>
                                <option value="false">否（保留所有）</option>
                            </select>
                        </div>
                        <div class="param-group">
                            <label>保存每轮可推理权重</label>
                            <select class="form-select" id="trainSaveEveryWeights">
                                <option value="true" selected>是</option>
                                <option value="false">否</option>
                            </select>
                        </div>
                        <div class="param-group" id="trainTextLrGroup">
                            <label>文本模块学习率倍率</label>
                            <input type="number" id="trainTextLowLr" min="0.01" max="1" step="0.05" value="0.4">
                            <div class="param-hint">SoVITS 专用，建议 0.4</div>
                        </div>
                    </div>

                    <!-- SoVITS 操作区 -->
                    <div id="trainActionSovits" style="margin-top: 18px;">
                        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                            <button class="btn btn-primary" id="btnStartSovits" onclick="startTraining()" disabled>
                                <i class="ph ph-play"></i> 开始 SoVITS 训练
                            </button>
                            <span id="trainStatusSovits" style="font-size: 15px; color: var(--text-secondary);"></span>
                        </div>
                        <div class="inline-tip" style="margin-top: 8px;">
                            <i class="ph ph-arrow-counter-clockwise"></i>
                            <span>中断后可重新开始训练，会从上次保存点继续，不会从头开始。</span>
                        </div>
                    </div>

                    <!-- SoVITS 进度区域 -->
                    <div id="trainProgressSovits" style="display: none; margin-top: 18px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span id="trainProgLabelSovits" style="font-size: 15px; color: var(--text-secondary);">准备中…</span>
                            <span id="trainProgPctSovits" style="font-size: 15px; font-weight: 700; color: var(--accent);">0%</span>
                        </div>
                        <div style="height: 10px; border-radius: 5px; background: var(--bg-tertiary); overflow: hidden;">
                            <div id="trainProgFillSovits" style="width: 0%; height: 100%; background: var(--accent); border-radius: 5px; transition: width 0.5s ease;"></div>
                        </div>
                        <div style="display: flex; gap: 10px; align-items: center; margin-top: 12px;">
                            <button class="btn" onclick="stopTraining()" style="border-color: var(--accent-danger); color: var(--accent-danger);">
                                <i class="ph ph-stop"></i> 停止训练
                            </button>
                            <div class="inline-tip" style="margin: 0;">
                                <i class="ph ph-arrow-counter-clockwise"></i>
                                <span>中断后可重新开始，会从上次保存点继续。</span>
                            </div>
                        </div>
                    </div>

                    <!-- SoVITS 日志 -->
                    <div id="trainLogSovits" style="display: none; margin-top: 16px;">
                        <div class="log-output" id="trainLogOutputSovits" style="max-height: 350px;"></div>
                    </div>
                </div>
            </div>

            <!-- ====== Step 2: GPT ====== -->
            <div class="train-step-card ${isExpertMode() ? 'active' : 'locked'}" id="trainStepGpt">
                <div class="train-step-header" id="trainStepGptHeader">
                    <div class="train-step-number">2</div>
                    <div class="train-step-title"><i class="ph ph-brain" style="margin-right:6px; color: var(--accent);"></i>GPT 训练</div>
                    <span class="train-step-badge ${isExpertMode() ? 'badge-active' : 'badge-locked'}" id="trainBadgeGpt">
                        ${isExpertMode() ? '<i class="ph ph-arrow-right"></i> 可用' : '<i class="ph ph-lock"></i> 待解锁'}
                    </span>
                </div>
                <div class="train-step-body" id="trainBodyGpt">
                    <div class="train-locked-msg" id="trainGptLockedMsg" style="${isExpertMode() ? 'display:none' : ''}">
                        <i class="ph ph-lock"></i>
                        <span>请先完成上方的 SoVITS 训练，之后 GPT 训练将自动解锁。</span>
                    </div>

                    <!-- GPT 参数和操作（初始隐藏） -->
                    <div id="trainGptContent" style="display: ${isExpertMode() ? '' : 'none'};">
                        <div style="font-size: 15px; color: var(--text-secondary); margin-bottom: 16px;">
                            训练语义模型，控制语调和断句。SoVITS 已完成，现在开始第二步！
                        </div>

                        <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 14px;">
                            <span style="font-size: 15px; color: var(--text-secondary);">版本: <strong style="color: var(--accent-purple);">${escapeHtml(version)}</strong></span>
                            <span id="trainRecommendedGpt" style="font-size: 14px; color: var(--text-muted);"></span>
                        </div>

                        <div class="advanced-toggle ${trainAdvancedOpen ? 'open' : ''}" onclick="toggleTrainAdvancedGpt()" id="trainAdvancedToggleGpt">
                            <i class="ph ph-caret-right"></i>
                            <span>高级参数（新手可忽略）</span>
                        </div>
                        <div id="trainAdvancedParamsGpt" class="advanced-params hidden" style="margin-top: 14px; display: none; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px;">
                            <div class="param-group">
                                <label>Batch Size</label>
                                <input type="number" id="trainBatchSizeGpt" min="1" max="64" value="0">
                                <div class="param-hint">0 = 自动推荐。参考：12G→4, 24G→11（切片10s时）</div>
                            </div>
                            <div class="param-group">
                                <label>总训练轮数 (Epochs)</label>
                                <input type="number" id="trainEpochsGpt" min="1" max="100" value="0">
                                <div class="param-hint">0 = 使用推荐值。GPT 建议 ≤20 轮，推荐 10</div>
                            </div>
                            <div class="param-group">
                                <label>每隔 N 轮保存</label>
                                <input type="number" id="trainSaveEveryGpt" min="1" max="50" value="0">
                                <div class="param-hint">0 = 使用推荐值</div>
                            </div>
                            <div class="param-group">
                                <label>仅保留最新权重</label>
                                <select class="form-select" id="trainSaveLatestGpt">
                                    <option value="true" selected>是（节省空间）</option>
                                    <option value="false">否（保留所有）</option>
                                </select>
                            </div>
                            <div class="param-group">
                                <label>保存每轮可推理权重</label>
                                <select class="form-select" id="trainSaveEveryWeightsGpt">
                                    <option value="true" selected>是</option>
                                    <option value="false">否</option>
                                </select>
                            </div>
                        </div>

                        <!-- GPT 操作区 -->
                        <div id="trainActionGpt" style="margin-top: 18px;">
                            <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                                <button class="btn btn-primary" id="btnStartGpt" onclick="startTraining()">
                                    <i class="ph ph-play"></i> 开始 GPT 训练
                                </button>
                                <span id="trainStatusGpt" style="font-size: 15px; color: var(--text-secondary);"></span>
                            </div>
                            <div class="inline-tip" style="margin-top: 8px;">
                                <i class="ph ph-arrow-counter-clockwise"></i>
                                <span>中断后可重新开始训练，会从上次保存点继续，不会从头开始。</span>
                            </div>
                        </div>

                        <!-- GPT 进度区域 -->
                        <div id="trainProgressGpt" style="display: none; margin-top: 18px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                                <span id="trainProgLabelGpt" style="font-size: 15px; color: var(--text-secondary);">准备中…</span>
                                <span id="trainProgPctGpt" style="font-size: 15px; font-weight: 700; color: var(--accent);">0%</span>
                            </div>
                            <div style="height: 10px; border-radius: 5px; background: var(--bg-tertiary); overflow: hidden;">
                                <div id="trainProgFillGpt" style="width: 0%; height: 100%; background: var(--accent); border-radius: 5px; transition: width 0.5s ease;"></div>
                            </div>
                            <div style="display: flex; gap: 10px; align-items: center; margin-top: 12px;">
                                <button class="btn" onclick="stopTraining()" style="border-color: var(--accent-danger); color: var(--accent-danger);">
                                    <i class="ph ph-stop"></i> 停止训练
                                </button>
                                <div class="inline-tip" style="margin: 0;">
                                    <i class="ph ph-arrow-counter-clockwise"></i>
                                    <span>中断后可重新开始，会从上次保存点继续。</span>
                                </div>
                            </div>
                        </div>

                        <!-- GPT 日志 -->
                        <div id="trainLogGpt" style="display: none; margin-top: 16px;">
                            <div class="log-output" id="trainLogOutputGpt" style="max-height: 350px;"></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ====== 完成引导（初始隐藏） ====== -->
            <div id="trainCompletionArea" style="display: none;">
                <div class="train-completion-card">
                    <h3><i class="ph ph-confetti" style="margin-right: 8px;"></i>训练全部完成！</h3>
                    <p>
                        SoVITS 和 GPT 模型都已训练完成。<br>
                        现在可以前往推理测试页面，选择模型 + 参考音频，输入文字试听效果！
                    </p>
                    <button class="btn btn-primary" onclick="navigateTo('infer')">
                        <i class="ph ph-speaker-high"></i> 前往推理测试
                    </button>
                </div>
            </div>

            <!-- 已训练模型列表 -->
            <div class="slice-section" id="trainModelsSection">
                <div class="slice-section-title"><i class="ph ph-files"></i>已训练的模型</div>
                <div id="trainModelsList">
                    <div style="color: var(--text-muted); font-size: 15px;">加载中...</div>
                </div>
            </div>
        `;

            checkTrainPrerequisites();
            loadTrainedModels();
            checkExistingTrainStatus();
        }

        // ---- Phase management ----
        function setTrainPhase(phase) {
            trainPhase = phase;

            const stepSovits = document.getElementById('trainStepSovits');
            const stepGpt = document.getElementById('trainStepGpt');
            const badgeSovits = document.getElementById('trainBadgeSovits');
            const badgeGpt = document.getElementById('trainBadgeGpt');
            const bodySovits = document.getElementById('trainBodySovits');
            const gptLockedMsg = document.getElementById('trainGptLockedMsg');
            const gptContent = document.getElementById('trainGptContent');
            const completionArea = document.getElementById('trainCompletionArea');
            const headerSovits = document.getElementById('trainStepSovitsHeader');
            const headerGpt = document.getElementById('trainStepGptHeader');

            if (!stepSovits || !stepGpt) return;

            if (phase === 'sovits') {
                // SoVITS active, GPT locked (or active in expert mode)
                stepSovits.className = 'train-step-card active';
                stepGpt.className = isExpertMode() ? 'train-step-card active' : 'train-step-card locked';
                badgeSovits.className = 'train-step-badge badge-active';
                badgeSovits.innerHTML = '<i class="ph ph-arrow-right"></i> 当前步骤';
                badgeGpt.className = isExpertMode() ? 'train-step-badge badge-active' : 'train-step-badge badge-locked';
                badgeGpt.innerHTML = isExpertMode() ? '<i class="ph ph-arrow-right"></i> 可用' : '<i class="ph ph-lock"></i> 待解锁';
                if (bodySovits) bodySovits.style.display = '';
                if (headerSovits) headerSovits.classList.remove('no-mb');
                if (gptLockedMsg) gptLockedMsg.style.display = isExpertMode() ? 'none' : '';
                if (gptContent) gptContent.style.display = isExpertMode() ? '' : 'none';
                if (completionArea) completionArea.style.display = 'none';
            } else if (phase === 'gpt') {
                // SoVITS completed, GPT active
                stepSovits.className = 'train-step-card completed';
                stepGpt.className = 'train-step-card active';
                badgeSovits.className = 'train-step-badge badge-done';
                badgeSovits.innerHTML = '<i class="ph ph-check-circle"></i> 已完成';
                badgeGpt.className = 'train-step-badge badge-active';
                badgeGpt.innerHTML = '<i class="ph ph-arrow-right"></i> 当前步骤';
                // Collapse SoVITS body
                if (bodySovits) bodySovits.style.display = 'none';
                if (headerSovits) headerSovits.classList.add('no-mb');
                if (gptLockedMsg) gptLockedMsg.style.display = 'none';
                if (gptContent) gptContent.style.display = '';
                if (completionArea) completionArea.style.display = 'none';
                // Update GPT recommended text
                updateGptRecommendedText();
            } else if (phase === 'done') {
                // Both completed
                stepSovits.className = 'train-step-card completed';
                stepGpt.className = 'train-step-card completed';
                badgeSovits.className = 'train-step-badge badge-done';
                badgeSovits.innerHTML = '<i class="ph ph-check-circle"></i> 已完成';
                badgeGpt.className = 'train-step-badge badge-done';
                badgeGpt.innerHTML = '<i class="ph ph-check-circle"></i> 已完成';
                // Collapse both bodies
                if (bodySovits) bodySovits.style.display = 'none';
                if (headerSovits) headerSovits.classList.add('no-mb');
                if (gptLockedMsg) gptLockedMsg.style.display = 'none';
                if (gptContent) gptContent.style.display = 'none';
                if (headerGpt) headerGpt.classList.add('no-mb');
                if (completionArea) completionArea.style.display = '';
            }
        }

        // ---- Advanced params toggles ----
        function toggleTrainAdvanced() {
            trainAdvancedOpen = !trainAdvancedOpen;
            const toggle = document.querySelector('#trainStepSovits .advanced-toggle');
            const params = document.getElementById('trainAdvancedParams');
            if (toggle) toggle.classList.toggle('open', trainAdvancedOpen);
            if (params) {
                params.classList.toggle('hidden', !trainAdvancedOpen);
                params.style.display = trainAdvancedOpen ? 'grid' : 'none';
            }
        }

        let trainAdvancedGptOpen = false;
        function toggleTrainAdvancedGpt() {
            trainAdvancedGptOpen = !trainAdvancedGptOpen;
            const toggle = document.getElementById('trainAdvancedToggleGpt');
            const params = document.getElementById('trainAdvancedParamsGpt');
            if (toggle) toggle.classList.toggle('open', trainAdvancedGptOpen);
            if (params) {
                params.classList.toggle('hidden', !trainAdvancedGptOpen);
                params.style.display = trainAdvancedGptOpen ? 'grid' : 'none';
            }
        }

        function updateSovitsRecommendedText() {
            const el = document.getElementById('trainRecommendedSovits');
            if (!el || !trainDefaults) return;
            const d = trainDefaults['sovits'];
            if (d) el.textContent = `推荐: batch=${d.batch_size}, epochs=${d.epochs}, 每${d.save_every}轮保存`;
        }

        function updateGptRecommendedText() {
            const el = document.getElementById('trainRecommendedGpt');
            if (!el || !trainDefaults) return;
            const d = trainDefaults['gpt'];
            if (d) el.textContent = `推荐: batch=${d.batch_size}, epochs=${d.epochs}, 每${d.save_every}轮保存`;
        }

        // ---- Prerequisites check ----
        async function checkTrainPrerequisites() {
            const el = document.getElementById('trainCheckResult');
            const btnSovits = document.getElementById('btnStartSovits');
            if (!el) return;

            try {
                const data = await apiGet('/api/train/check');
                trainDefaults = data.defaults;

                if (data.ready) {
                    let existingHtml = '';
                    const hasSovits = data.existing_sovits && data.existing_sovits.length > 0;
                    const hasGpt = data.existing_gpt && data.existing_gpt.length > 0;

                    if (hasSovits || hasGpt) {
                        const parts = [];
                        if (hasSovits) parts.push(`SoVITS: ${data.existing_sovits.length}个`);
                        if (hasGpt) parts.push(`GPT: ${data.existing_gpt.length}个`);
                        existingHtml = `<div style="margin-top: 8px; font-size: 14px; color: var(--accent-purple);"><i class="ph ph-files" style="margin-right: 4px;"></i>已有模型: ${parts.join('、')}</div>`;
                    }
                    el.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-success);">
                        <i class="ph ph-check-circle" style="font-size: 20px;"></i>
                        <span>训练数据已就绪，可以开始训练</span>
                    </div>
                    <div style="margin-top: 8px; font-size: 14px; color: var(--text-muted);">
                        <div>训练版本: ${escapeHtml(data.version || 'v2Pro')}</div>
                    </div>
                    ${existingHtml}
                `;
                    trainDataReady = true;
                    if (btnSovits) btnSovits.disabled = false;

                    // Determine initial phase based on existing models
                    if (hasSovits && hasGpt) {
                        setTrainPhase('done');
                    } else if (hasSovits) {
                        setTrainPhase('gpt');
                    } else {
                        setTrainPhase('sovits');
                    }
                } else {
                    if (isExpertMode()) {
                        el.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-warning);">
                            <i class="ph ph-warning" style="font-size: 20px;"></i>
                            <span>${escapeHtml(data.reason)}</span>
                            <span class="expert-mode-badge"><i class="ph ph-rocket-launch"></i> 自由模式 — 不阻止操作</span>
                        </div>
                    `;
                        trainDataReady = false;
                        if (btnSovits) btnSovits.disabled = false;
                    } else {
                        el.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-warning);">
                            <i class="ph ph-warning" style="font-size: 20px;"></i>
                            <span>${escapeHtml(data.reason)}</span>
                        </div>
                        <div style="margin-top: 10px;">
                            <button class="btn" onclick="navigateTo('format')">
                                <i class="ph ph-arrow-left"></i> 先去完成格式化
                            </button>
                        </div>
                    `;
                        trainDataReady = false;
                        if (btnSovits) btnSovits.disabled = true;
                    }
                }
                updateSovitsRecommendedText();
                updateGptRecommendedText();
            } catch (err) {
                el.innerHTML = `<span style="color: var(--accent-danger);">检查失败: ${escapeHtml(err.message)}</span>`;
                trainDataReady = false;
                if (btnSovits) btnSovits.disabled = isExpertMode() ? false : true;
            }
        }

        // ---- Start / Stop ----
        async function startTraining() {
            // Determine target from current phase
            const target = trainPhase === 'gpt' ? 'gpt' : 'sovits';
            const suffix = target === 'sovits' ? 'Sovits' : 'Gpt';

            const actionArea = document.getElementById('trainAction' + suffix);
            const progressArea = document.getElementById('trainProgress' + suffix);
            const logArea = document.getElementById('trainLog' + suffix);

            if (actionArea) actionArea.style.display = 'none';
            if (progressArea) progressArea.style.display = 'block';
            if (logArea) logArea.style.display = 'block';

            const progLabel = document.getElementById('trainProgLabel' + suffix);
            const progPct = document.getElementById('trainProgPct' + suffix);
            const progFill = document.getElementById('trainProgFill' + suffix);
            if (progLabel) progLabel.textContent = '正在启动...';
            if (progPct) progPct.textContent = '0%';
            if (progFill) progFill.style.width = '0%';

            // Gather params from the correct fields
            const params = {
                target: target,
                batch_size: parseInt(document.getElementById(target === 'sovits' ? 'trainBatchSize' : 'trainBatchSizeGpt')?.value || '0'),
                total_epochs: parseInt(document.getElementById(target === 'sovits' ? 'trainEpochs' : 'trainEpochsGpt')?.value || '0'),
                save_every_epoch: parseInt(document.getElementById(target === 'sovits' ? 'trainSaveEvery' : 'trainSaveEveryGpt')?.value || '0'),
                if_save_latest: document.getElementById(target === 'sovits' ? 'trainSaveLatest' : 'trainSaveLatestGpt')?.value === 'true',
                if_save_every_weights: document.getElementById(target === 'sovits' ? 'trainSaveEveryWeights' : 'trainSaveEveryWeightsGpt')?.value === 'true',
                text_low_lr_rate: target === 'sovits' ? parseFloat(document.getElementById('trainTextLowLr')?.value || '0.4') : 0.4,
            };

            try {
                await apiPost('/api/train/start', params);
                showToast(`${target.toUpperCase()} 训练已启动`, 'success');
                startTrainPolling();
            } catch (err) {
                if (actionArea) actionArea.style.display = 'block';
                if (progressArea) progressArea.style.display = 'none';
                showToast('启动失败: ' + err.message, 'error');
            }
        }

        async function stopTraining() {
            try {
                await apiPost('/api/train/stop', {});
                showToast('训练已停止', 'success');
                if (trainPolling) {
                    clearInterval(trainPolling);
                    trainPolling = null;
                }
                // Restore UI for whichever phase is active
                const suffix = trainPhase === 'gpt' ? 'Gpt' : 'Sovits';
                const actionArea = document.getElementById('trainAction' + suffix);
                const progressArea = document.getElementById('trainProgress' + suffix);
                const statusEl = document.getElementById('trainStatus' + suffix);
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

        // ---- Polling ----
        function startTrainPolling() {
            if (trainPolling) clearInterval(trainPolling);
            trainPolling = setInterval(pollTrainStatus, 2000);
            pollTrainStatus();
        }

        async function pollTrainStatus() {
            try {
                const data = await apiGet('/api/train/status');
                const target = data.target || (trainPhase === 'gpt' ? 'gpt' : 'sovits');
                const suffix = target === 'gpt' ? 'Gpt' : 'Sovits';

                // Update progress bar
                if (data.status === 'running') {
                    const pct = data.progress || 0;
                    const epoch = data.current_epoch || 0;
                    const total = data.total_epochs || 0;
                    const targetLabel = target.toUpperCase();

                    const progLabel = document.getElementById('trainProgLabel' + suffix);
                    const progPct = document.getElementById('trainProgPct' + suffix);
                    const progFill = document.getElementById('trainProgFill' + suffix);
                    if (progLabel) {
                        progLabel.textContent = total > 0
                            ? `Epoch ${epoch}/${total} — ${targetLabel} 训练中`
                            : `${targetLabel} 训练中...`;
                    }
                    if (progPct) progPct.textContent = pct + '%';
                    if (progFill) progFill.style.width = pct + '%';
                }

                // Update logs
                const logEl = document.getElementById('trainLogOutput' + suffix);
                if (logEl && data.logs) {
                    logEl.innerHTML = data.logs.map(l => {
                        let cls = 'log-line';
                        if (l.includes('完成') || l.includes('Done') || l.includes('saved') || l.includes('Epoch')) cls += ' log-success';
                        if (l.includes('失败') || l.includes('error') || l.includes('Error')) cls += ' log-error';
                        return `<div class="${cls}">${escapeHtml(l)}</div>`;
                    }).join('');
                    logEl.scrollTop = logEl.scrollHeight;
                }

                // Check completion
                if (data.status === 'done') {
                    clearInterval(trainPolling);
                    trainPolling = null;

                    const progPct = document.getElementById('trainProgPct' + suffix);
                    const progFill = document.getElementById('trainProgFill' + suffix);
                    const progLabel = document.getElementById('trainProgLabel' + suffix);
                    if (progPct) progPct.textContent = '100%';
                    if (progFill) progFill.style.width = '100%';
                    if (progLabel) progLabel.textContent = `${target.toUpperCase()} 训练完成！`;

                    showToast(`${target.toUpperCase()} 训练完成!`, 'success');
                    loadTrainedModels();
                    loadProjects();

                    // Auto-advance phase
                    if (target === 'sovits') {
                        // SoVITS done → go to GPT phase
                        setTimeout(() => setTrainPhase('gpt'), 1500);
                    } else if (target === 'gpt') {
                        // GPT done → go to done phase
                        setTimeout(() => setTrainPhase('done'), 1500);
                    }
                } else if (data.status === 'error') {
                    clearInterval(trainPolling);
                    trainPolling = null;
                    const actionArea = document.getElementById('trainAction' + suffix);
                    const progressArea = document.getElementById('trainProgress' + suffix);
                    const statusEl = document.getElementById('trainStatus' + suffix);
                    if (actionArea) actionArea.style.display = 'block';
                    if (progressArea) progressArea.style.display = 'none';
                    if (statusEl) {
                        statusEl.textContent = '训练出错';
                        statusEl.style.color = 'var(--accent-danger)';
                    }
                    showToast('训练出错: ' + (data.error || '未知错误'), 'error');
                }
            } catch (err) {
                // network error, keep polling
            }
        }

        // ---- Trained models list ----
        async function loadTrainedModels() {
            const container = document.getElementById('trainModelsList');
            if (!container) return;

            try {
                const data = await apiGet('/api/train/models');
                const sovits = data.sovits || [];
                const gpt = data.gpt || [];

                if (sovits.length === 0 && gpt.length === 0) {
                    container.innerHTML = `<div style="color: var(--text-muted); font-size: 15px;"><i class="ph ph-info" style="margin-right: 4px;"></i>暂无已训练的模型</div>`;
                    return;
                }

                let html = '';

                if (sovits.length > 0) {
                    html += `<div style="font-size: 15px; font-weight: 700; color: var(--accent-purple); margin-bottom: 8px;"><i class="ph ph-speaker-high" style="margin-right: 4px;"></i>SoVITS 模型 (${sovits.length})</div>`;
                    html += '<div style="margin-bottom: 16px;">';
                    sovits.forEach(m => {
                        html += `
                        <div style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: rgba(255,255,255,0.02); border-radius: var(--radius-sm); margin-bottom: 4px;">
                            <i class="ph ph-file" style="color: var(--accent-success); font-size: 18px;"></i>
                            <span style="flex: 1; font-size: 15px; color: var(--text-secondary); word-break: break-all;">${escapeHtml(m.name)}</span>
                            <span style="font-size: 13px; color: var(--text-muted); white-space: nowrap;">${m.size_mb} MB</span>
                        </div>
                    `;
                    });
                    html += '</div>';
                }

                if (gpt.length > 0) {
                    html += `<div style="font-size: 15px; font-weight: 700; color: var(--accent); margin-bottom: 8px;"><i class="ph ph-brain" style="margin-right: 4px;"></i>GPT 模型 (${gpt.length})</div>`;
                    html += '<div>';
                    gpt.forEach(m => {
                        html += `
                        <div style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: rgba(255,255,255,0.02); border-radius: var(--radius-sm); margin-bottom: 4px;">
                            <i class="ph ph-file" style="color: var(--accent); font-size: 18px;"></i>
                            <span style="flex: 1; font-size: 15px; color: var(--text-secondary); word-break: break-all;">${escapeHtml(m.name)}</span>
                            <span style="font-size: 13px; color: var(--text-muted); white-space: nowrap;">${m.size_mb} MB</span>
                        </div>
                    `;
                    });
                    html += '</div>';
                }

                container.innerHTML = html;
            } catch (err) {
                container.innerHTML = `<div style="color: var(--accent-danger); font-size: 15px;">加载失败: ${escapeHtml(err.message)}</div>`;
            }
        }

        // ---- Resume running training on page load ----
        async function checkExistingTrainStatus() {
            try {
                const data = await apiGet('/api/train/status');
                const target = data.target || (trainPhase === 'gpt' ? 'gpt' : 'sovits');
                const suffix = target === 'gpt' ? 'Gpt' : 'Sovits';

                if (data.status === 'done') {
                    const statusEl = document.getElementById('trainStatus' + suffix);
                    if (statusEl) {
                        statusEl.textContent = `${target.toUpperCase()} 训练完成`;
                        statusEl.style.color = 'var(--accent-success)';
                    }
                    // Show logs
                    if (data.logs && data.logs.length > 0) {
                        const logArea = document.getElementById('trainLog' + suffix);
                        if (logArea) logArea.style.display = 'block';
                        const logEl = document.getElementById('trainLogOutput' + suffix);
                        if (logEl) {
                            logEl.innerHTML = data.logs.map(l => {
                                let cls = 'log-line';
                                if (l.includes('完成') || l.includes('saved')) cls += ' log-success';
                                if (l.includes('失败') || l.includes('error')) cls += ' log-error';
                                return `<div class="${cls}">${escapeHtml(l)}</div>`;
                            }).join('');
                        }
                    }
                } else if (data.status === 'running') {
                    // Make sure we're in the right phase for the running target
                    if (target === 'gpt' && trainPhase !== 'gpt') {
                        setTrainPhase('gpt');
                    } else if (target === 'sovits' && trainPhase !== 'sovits') {
                        setTrainPhase('sovits');
                    }
                    // Resume polling — hide action, show progress
                    const actionArea = document.getElementById('trainAction' + suffix);
                    const progressArea = document.getElementById('trainProgress' + suffix);
                    const logArea = document.getElementById('trainLog' + suffix);
                    if (actionArea) actionArea.style.display = 'none';
                    if (progressArea) progressArea.style.display = 'block';
                    if (logArea) logArea.style.display = 'block';
                    startTrainPolling();
                }
            } catch (e) { }
        }
