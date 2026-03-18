// =====================================================
//  部署到酒馆
// =====================================================
let deployValidated = false;
let deployEnvPolling = null;

function updateDeployPage() {
    const container = document.getElementById('deployContent');
    if (!container) return;

    container.innerHTML = `
            <!-- 部署向导步骤条 -->
            <div class="deploy-steps">
                <div class="deploy-step active" id="deployStep1">
                    <div class="deploy-step-num">1</div>
                    <div class="deploy-step-info">
                        <div class="deploy-step-title">定位 GSVI</div>
                        <div class="deploy-step-desc">选择推理特化包路径</div>
                    </div>
                </div>
                <div class="deploy-step-connector"></div>
                <div class="deploy-step locked" id="deployStep2">
                    <div class="deploy-step-num"><i class="ph ph-lock-simple"></i></div>
                    <div class="deploy-step-info">
                        <div class="deploy-step-title">环境准备</div>
                        <div class="deploy-step-desc">复制运行环境 + 底模</div>
                    </div>
                </div>
                <div class="deploy-step-connector"></div>
                <div class="deploy-step locked" id="deployStep3">
                    <div class="deploy-step-num"><i class="ph ph-lock-simple"></i></div>
                    <div class="deploy-step-info">
                        <div class="deploy-step-title">模型部署</div>
                        <div class="deploy-step-desc">部署权重 + 修改配置</div>
                    </div>
                </div>
                <div class="deploy-step-connector"></div>
                <div class="deploy-step locked" id="deployStep4">
                    <div class="deploy-step-num"><i class="ph ph-lock-simple"></i></div>
                    <div class="deploy-step-info">
                        <div class="deploy-step-title">参考音频</div>
                        <div class="deploy-step-desc">选择参考音频 + 情感</div>
                    </div>
                </div>
                <div class="deploy-step-connector"></div>
                <div class="deploy-step locked" id="deployStep5">
                    <div class="deploy-step-num"><i class="ph ph-lock-simple"></i></div>
                    <div class="deploy-step-info">
                        <div class="deploy-step-title">启动测试</div>
                        <div class="deploy-step-desc">启动 API + 连接酒馆</div>
                    </div>
                </div>
            </div>

            <!-- Step ① 定位 GSVI -->
            <div class="slice-section" id="deployStepContent1">
                <div class="slice-section-title"><i class="ph ph-map-pin"></i>Step 1: 定位 GSVI 推理特化包</div>

                <div class="inline-tip" style="margin-top: 0; margin-bottom: 10px;">
                    <i class="ph ph-info"></i>
                    <span><b>什么是 GSVI？</b> GSVI（GPT-SoVITS-Inference）是专门用于推理部署的精简版本，
                    相比训练版体积更小、启动更快。部署到酒馆需要用它来提供 TTS API 服务。</span>
                </div>
                <div class="inline-tip" style="margin-top: 0; margin-bottom: 14px;">
                    <i class="ph ph-folder-open"></i>
                    <span>请选择你已下载的 <b>GPT-SoVITS-Inference</b> 文件夹。
                    正确的目录下应包含 <b>gsvi.py</b>、<b>api_v2.py</b> 和 <b>GPT_SoVITS/configs/</b> 等文件。</span>
                </div>

                <div class="form-group" style="margin-bottom: 10px;">
                    <label class="form-label">GSVI 路径</label>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <input type="text" class="form-input" id="deployGsviPath"
                            placeholder="例如: D:\\GPT-SoVITS-Inference"
                            style="flex: 1;">
                        <button class="btn" onclick="browseGsviPath()" style="white-space: nowrap;">
                            <i class="ph ph-folder"></i> 浏览
                        </button>
                    </div>
                </div>

                <div style="display: flex; align-items: center; gap: 12px; margin-top: 14px;">
                    <button class="btn btn-primary" id="btnValidateGsvi" onclick="validateGsviPath()">
                        <i class="ph ph-check-circle"></i> 验证路径
                    </button>
                    <span id="deployValidateStatus" style="font-size: 15px; color: var(--text-muted);"></span>
                </div>

                <div id="deployValidateResult" style="margin-top: 14px;"></div>
            </div>

            <!-- Step ② 环境准备 -->
            <div class="slice-section" id="deployStepContent2" style="display: none;">
                <div class="slice-section-title"><i class="ph ph-hard-drives"></i>Step 2: 环境准备</div>

                <div class="inline-tip" style="margin-top: 0; margin-bottom: 14px;">
                    <i class="ph ph-info"></i>
                    <span>GSVI 推理特化包不自带 Python 运行环境和预训练底模。
                    点击「一键准备」将从训练版自动复制 <b>runtime/</b> 和 <b>pretrained_models/</b>，并安装额外 pip 依赖。</span>
                </div>

                <div id="deployEnvStatusArea" style="margin-bottom: 14px;"></div>

                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
                    <button class="btn btn-primary" id="btnPrepareEnv" onclick="startDeployCopyEnv()">
                        <i class="ph ph-rocket-launch"></i> 一键准备环境
                    </button>
                    <span id="deployEnvCopyPhase" style="font-size: 15px; color: var(--text-muted);"></span>
                </div>

                <!-- 进度条 -->
                <div id="deployEnvProgressWrap" style="display: none; margin-bottom: 14px;">
                    <div class="progress-bar-bg" style="height: 8px;">
                        <div class="progress-bar-fill" id="deployEnvProgressBar" style="width: 0%; transition: width 0.4s ease;"></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-top: 4px;">
                        <span id="deployEnvProgressLabel" style="font-size: 13px; color: var(--text-muted);">0%</span>
                        <span id="deployEnvPhaseLabel" style="font-size: 13px; color: var(--text-muted);"></span>
                    </div>
                </div>

                <!-- 日志区域 -->
                <div id="deployEnvLogWrap" style="display: none;">
                    <div style="font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px;">日志</div>
                    <div id="deployEnvLog" style="
                        background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius-sm);
                        padding: 10px 14px; font-size: 13px; font-family: 'Consolas', monospace;
                        color: var(--text-secondary); max-height: 200px; overflow-y: auto; white-space: pre-wrap;
                    "></div>
                </div>

                <div id="deployEnvDoneArea"></div>
            </div>

            <!-- Step ③ 模型部署 -->
            <div class="slice-section" id="deployStepContent3" style="display: none;">
                <div class="slice-section-title"><i class="ph ph-cube"></i>Step 3: 模型部署</div>

                <div class="inline-tip" style="margin-top: 0; margin-bottom: 14px;">
                    <i class="ph ph-info"></i>
                    <span>选择训练好的 SoVITS 和 GPT 模型，一键复制到 GSVI 并自动配置。
                    同时会注入 <b>SillyTavern 兼容层</b>，让酒馆可以直接调用 TTS API。</span>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label">SoVITS 模型</label>
                        <select class="form-select" id="deploySovitsSelect">
                            <option value="">加载中...</option>
                        </select>
                    </div>
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label">GPT 模型</label>
                        <select class="form-select" id="deployGptSelect">
                            <option value="">加载中...</option>
                        </select>
                    </div>
                </div>

                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
                    <button class="btn btn-primary" id="btnDeployModel" onclick="startDeployModel()">
                        <i class="ph ph-rocket-launch"></i> 一键部署模型
                    </button>
                    <span id="deployModelStatus" style="font-size: 15px; color: var(--text-muted);"></span>
                </div>

                <div id="deployModelResult"></div>
                <div id="deployCompatStatus" style="margin-top: 14px;"></div>
                <div id="deployStep3DoneArea"></div>
            </div>

            <!-- Step ④ 参考音频 -->
            <div class="slice-section" id="deployStepContent4" style="display: none;">
                <div class="slice-section-title"><i class="ph ph-music-notes"></i>Step 4: 参考音频部署</div>

                <div class="inline-tip" style="margin-top: 0; margin-bottom: 14px;">
                    <i class="ph ph-info"></i>
                    <span>参考音频已在<b>标注工具</b>中完成标记。点击「一键部署」将所有已标记音频复制到 GSVI 的 <code>ref_audio/</code> 目录。</span>
                </div>

                <div id="deployRefAudioListArea" style="margin-bottom: 14px;">
                    <div style="color: var(--text-muted); font-size: 14px;"><i class="ph ph-spinner" style="animation: spin 1s linear infinite;"></i> 加载已标记的参考音频...</div>
                </div>

                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
                    <button class="btn btn-primary" id="btnDeployRefAudio" onclick="oneClickDeployRef()">
                        <i class="ph ph-export"></i> 一键部署参考音频
                    </button>
                    <span id="deployRefStatus" style="font-size: 15px; color: var(--text-muted);"></span>
                </div>

                <div id="deployRefResult"></div>
                <div id="deployStep4DoneArea"></div>
            </div>

            <!-- Step ⑤ 锁定提示（显示到 Step 4 完成前） -->
            <div class="slice-section" id="deployLockedHint" style="opacity: 0.5; pointer-events: none;">
                <div class="slice-section-title" style="color: var(--text-muted);">
                    <i class="ph ph-lock-simple"></i> 后续步骤
                </div>
                <div style="padding: 20px; text-align: center; color: var(--text-muted);">
                    <i class="ph ph-steps" style="font-size: 36px; margin-bottom: 10px; display: block;"></i>
                    <div style="font-size: 15px;">完成当前步骤后，后续步骤将逐步解锁</div>
                    <div style="font-size: 14px; margin-top: 6px; color: var(--text-muted);">启动测试</div>
                </div>
            </div>

            <!-- Step ⑤ 启动测试 -->
            <div class="slice-section" id="deployStepContent5" style="display: none;">
                <div class="slice-section-title"><i class="ph ph-rocket-launch"></i>Step 5: 启动测试</div>

                <div class="inline-tip" style="margin-top: 0; margin-bottom: 14px;">
                    <i class="ph ph-info"></i>
                    <span>点击启动后，将会打开一个独立的 CMD 窗口运行 GSVI 推理 API。
                    启动完成后 <b>127.0.0.1:9881</b> 即可提供 TTS 服务。
                    日志请在 CMD 窗口中查看，关闭窗口即停止服务。</span>
                </div>

                <!-- 状态卡 -->
                <div id="deployGsviStatusCard" style="
                    padding: 14px 18px; border-radius: var(--radius-sm); margin-bottom: 14px;
                    border: 1px solid var(--border); background: var(--bg-card);
                    display: flex; align-items: center; gap: 12px;
                ">
                    <span id="deployGsviDot" style="
                        width: 12px; height: 12px; border-radius: 50%;
                        background: var(--text-muted); flex-shrink: 0;
                    "></span>
                    <span id="deployGsviStatusText" style="font-size: 15px; font-weight: 600;">未启动</span>
                </div>

                <!-- 按钮区 -->
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
                    <button class="btn btn-primary" id="btnStartGsvi" onclick="startGsvi()">
                        <i class="ph ph-play"></i> 一键启动 GSVI
                    </button>
                    <button class="btn" id="btnStopGsvi" onclick="stopGsvi()" style="display: none;">
                        <i class="ph ph-stop"></i> 停止
                    </button>
                    <span id="deployGsviActionStatus" style="font-size: 15px; color: var(--text-muted);"></span>
                </div>

                <!-- 日志区域已移到 CMD 窗口 -->

                <!-- 连接指南（就绪后显示） -->
                <div id="deployConnGuide" style="display: none;"></div>

                <div id="deployStep5DoneArea"></div>
            </div>
            `;

    // 加载已保存的配置
    loadDeployConfig();
}

async function loadDeployConfig() {
    try {
        const data = await apiGet('/api/deploy/config');
        const pathInput = document.getElementById('deployGsviPath');
        if (pathInput && data.gsvi_path) {
            pathInput.value = data.gsvi_path;
            if (data.validated) {
                deployValidated = true;
                showDeployValidateSuccess({ info: {} });
            }
        }
    } catch (err) {
        // ignore
    }
}

async function browseGsviPath() {
    try {
        const data = await apiGet('/api/file/browse_dir?title=' + encodeURIComponent('选择 GSVI 推理特化包目录'));
        if (!data.cancelled && data.path) {
            const pathInput = document.getElementById('deployGsviPath');
            if (pathInput) {
                pathInput.value = data.path;
                // 短暂高亮
                pathInput.style.borderColor = 'var(--accent)';
                setTimeout(() => { pathInput.style.borderColor = ''; }, 800);
            }
            // 自动验证
            validateGsviPath();
        }
    } catch (err) {
        showToast('打开文件夹选择失败: ' + err.message, 'error');
    }
}

async function validateGsviPath() {
    const pathInput = document.getElementById('deployGsviPath');
    const btn = document.getElementById('btnValidateGsvi');
    const statusEl = document.getElementById('deployValidateStatus');
    const resultEl = document.getElementById('deployValidateResult');

    if (!pathInput || !pathInput.value.trim()) {
        showToast('请先输入或选择 GSVI 路径', 'error');
        return;
    }

    btn.disabled = true;
    statusEl.textContent = '验证中...';
    statusEl.style.color = 'var(--accent)';
    resultEl.innerHTML = '';

    try {
        const data = await apiPost('/api/deploy/validate', {
            gsvi_path: pathInput.value.trim(),
        });

        if (data.valid) {
            deployValidated = true;
            statusEl.textContent = '';
            showDeployValidateSuccess(data);
            showToast('GSVI 路径验证通过！', 'success');
        } else {
            deployValidated = false;
            statusEl.textContent = '';
            resultEl.innerHTML = `
                        <div style="padding: 14px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); border-radius: var(--radius-sm);">
                            <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-danger); margin-bottom: 8px;">
                                <i class="ph ph-x-circle" style="font-size: 20px;"></i>
                                <b>验证失败</b>
                            </div>
                            <div style="font-size: 15px; color: var(--text-secondary);">${escapeHtml(data.reason)}</div>
                            ${data.missing ? `
                            <div style="margin-top: 8px; font-size: 14px; color: var(--text-muted);">
                                缺少的文件/目录：
                                <ul style="margin: 4px 0 0 20px; padding: 0;">
                                    ${data.missing.map(m => `<li>${escapeHtml(m)}</li>`).join('')}
                                </ul>
                            </div>` : ''}
                            <div class="inline-tip" style="margin-top: 10px;">
                                <i class="ph ph-lightbulb"></i>
                                <span>请确认选择的是 <b>GPT-SoVITS-Inference</b> 的根目录，而不是子目录。
                            </div>
                        </div>
                    `;
        }
    } catch (err) {
        statusEl.textContent = '验证失败';
        statusEl.style.color = 'var(--accent-danger)';
        showToast('验证请求失败: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

function showDeployValidateSuccess(data) {
    const resultEl = document.getElementById('deployValidateResult');
    if (!resultEl) return;

    const info = data.info || {};
    const items = [
        { label: 'runtime/ 运行环境', ok: info.has_runtime },
        { label: 'models/ 模型目录', ok: info.has_models },
        { label: 'ref_audio/ 参考音频', ok: info.has_ref_audio },
    ];

    resultEl.innerHTML = `
                <div style="padding: 14px; background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); border-radius: var(--radius-sm);">
                    <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-success); margin-bottom: 10px;">
                        <i class="ph ph-check-circle" style="font-size: 20px;"></i>
                        <b>GSVI 路径验证通过</b>
                    </div>
                    <div style="font-size: 14px; color: var(--text-secondary); display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px;">
                        ${items.map(item => `
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <i class="ph ${item.ok ? 'ph-check-circle' : 'ph-minus-circle'}"
                               style="color: ${item.ok ? 'var(--accent-success)' : 'var(--text-muted)'}; font-size: 16px;"></i>
                            <span>${escapeHtml(item.label)}</span>
                        </div>
                        `).join('')}
                    </div>
                    ${!info.has_runtime ? `
                    <div class="inline-warn" style="margin-top: 10px;">
                        <i class="ph ph-warning"></i>
                        <span>未检测到 runtime/ 目录，后续 Step 2 会帮你从训练版复制运行环境。</span>
                    </div>` : ''}
                </div>
            `;

    // 更新步骤条状态
    const step1 = document.getElementById('deployStep1');
    if (step1) {
        step1.className = 'deploy-step done';
        step1.querySelector('.deploy-step-num').innerHTML = '<i class="ph ph-check"></i>';
    }

    // 解锁 Step 2
    unlockDeployStep2();
}

// =====================================================
//  Step 2: 环境准备
// =====================================================

function unlockDeployStep2() {
    // 解锁步骤条
    const step2 = document.getElementById('deployStep2');
    if (step2) {
        step2.className = 'deploy-step active';
        step2.querySelector('.deploy-step-num').innerHTML = '2';
    }
    // 显示 Step 2 内容
    const content2 = document.getElementById('deployStepContent2');
    if (content2) content2.style.display = '';

    // 自动检测环境状态
    checkDeployEnv();
}

async function checkDeployEnv() {
    const area = document.getElementById('deployEnvStatusArea');
    if (!area) return;

    area.innerHTML = '<div style="color: var(--text-muted); font-size: 14px;"><i class="ph ph-spinner" style="animation: spin 1s linear infinite;"></i> 检测环境状态...</div>';

    try {
        const data = await apiGet('/api/deploy/env_status');
        if (data.error) {
            area.innerHTML = `<div style="color: var(--accent-danger); font-size: 14px;">${escapeHtml(data.error)}</div>`;
            return;
        }
        renderDeployEnvStatus(data);

        // 如果正在复制中，启动轮询
        if (data.copy_status === 'copying' || data.copy_status === 'installing') {
            document.getElementById('btnPrepareEnv').disabled = true;
            document.getElementById('deployEnvProgressWrap').style.display = '';
            document.getElementById('deployEnvLogWrap').style.display = '';
            pollDeployCopyStatus();
        }

        // 如果全部就绪
        if (data.all_ready) {
            markDeployStep2Done();
        }
    } catch (err) {
        area.innerHTML = `<div style="color: var(--accent-danger); font-size: 14px;">检测失败: ${escapeHtml(err.message)}</div>`;
    }
}

function renderDeployEnvStatus(data) {
    const area = document.getElementById('deployEnvStatusArea');
    if (!area) return;

    const items = [
        { label: 'runtime/ (Python 运行环境)', ready: data.runtime?.ready, icon: 'ph-terminal-window' },
        { label: 'pretrained_models/ (预训练底模)', ready: data.pretrained?.ready, icon: 'ph-brain' },
        { label: 'pip 额外依赖', ready: data.pip?.ready, icon: 'ph-package',
          detail: data.pip?.missing?.length ? `缺少: ${data.pip.missing.join(', ')}` : '' },
    ];

    area.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px;">
            ${items.map(item => `
            <div style="
                padding: 12px 14px; border-radius: var(--radius-sm);
                border: 1px solid ${item.ready ? 'rgba(34,197,94,0.2)' : 'rgba(251,191,36,0.2)'};
                background: ${item.ready ? 'rgba(34,197,94,0.05)' : 'rgba(251,191,36,0.05)'};
            ">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                    <i class="ph ${item.ready ? 'ph-check-circle' : 'ph-warning-circle'}"
                       style="font-size: 18px; color: ${item.ready ? 'var(--accent-success)' : 'var(--accent-warning)'};"></i>
                    <span style="font-size: 14px; font-weight: 600;">${escapeHtml(item.label)}</span>
                </div>
                <div style="font-size: 13px; color: ${item.ready ? 'var(--accent-success)' : 'var(--accent-warning)'}; padding-left: 26px;">
                    ${item.ready ? '已就绪' : '需要准备'}
                </div>
                ${item.detail ? `<div style="font-size: 12px; color: var(--text-muted); padding-left: 26px; margin-top: 2px;">${escapeHtml(item.detail)}</div>` : ''}
            </div>
            `).join('')}
        </div>
    `;

    // 如果全部就绪，隐藏准备按钮
    if (data.all_ready) {
        const btn = document.getElementById('btnPrepareEnv');
        if (btn) btn.style.display = 'none';
    }
}

async function startDeployCopyEnv() {
    const btn = document.getElementById('btnPrepareEnv');
    btn.disabled = true;

    document.getElementById('deployEnvProgressWrap').style.display = '';
    document.getElementById('deployEnvLogWrap').style.display = '';
    document.getElementById('deployEnvDoneArea').innerHTML = '';

    try {
        const data = await apiPost('/api/deploy/copy_env', {});
        if (!data.success) {
            showToast(data.reason || '启动失败', 'error');
            btn.disabled = false;
            return;
        }
        showToast('环境准备任务已启动', 'success');
        pollDeployCopyStatus();
    } catch (err) {
        showToast('启动失败: ' + err.message, 'error');
        btn.disabled = false;
    }
}

function pollDeployCopyStatus() {
    if (deployEnvPolling) clearInterval(deployEnvPolling);

    deployEnvPolling = setInterval(async () => {
        try {
            const data = await apiGet('/api/deploy/copy_env/status');

            // 更新进度条
            const bar = document.getElementById('deployEnvProgressBar');
            const label = document.getElementById('deployEnvProgressLabel');
            const phaseLabel = document.getElementById('deployEnvPhaseLabel');
            const phaseText = document.getElementById('deployEnvCopyPhase');

            if (bar) bar.style.width = data.progress_pct + '%';
            if (label) label.textContent = data.progress_pct + '%';

            const phaseNames = { runtime: '复制 runtime/', pretrained: '复制 pretrained_models/', pip: '安装 pip 依赖' };
            const phaseName = phaseNames[data.phase] || data.phase;
            if (phaseLabel) phaseLabel.textContent = phaseName;
            if (phaseText) {
                phaseText.textContent = data.status === 'copying' ? `正在${phaseName}...` :
                                       data.status === 'installing' ? '正在安装依赖...' : '';
                phaseText.style.color = 'var(--accent)';
            }

            // 更新日志
            const logEl = document.getElementById('deployEnvLog');
            if (logEl && data.log) {
                logEl.textContent = data.log.join('\n');
                logEl.scrollTop = logEl.scrollHeight;
            }

            // 完成或错误时停止轮询
            if (data.status === 'done') {
                clearInterval(deployEnvPolling);
                deployEnvPolling = null;
                if (phaseText) { phaseText.textContent = ''; }
                markDeployStep2Done();
                checkDeployEnv(); // 刷新状态卡片
                showToast('环境准备完成！', 'success');
            } else if (data.status === 'error') {
                clearInterval(deployEnvPolling);
                deployEnvPolling = null;
                const btn = document.getElementById('btnPrepareEnv');
                if (btn) btn.disabled = false;
                if (phaseText) {
                    phaseText.textContent = '出错了';
                    phaseText.style.color = 'var(--accent-danger)';
                }
                showToast('环境准备失败: ' + (data.error || '未知错误'), 'error');
            }
        } catch (err) {
            // 网络错误，继续轮询
        }
    }, 1500);
}

function markDeployStep2Done() {
    const step2 = document.getElementById('deployStep2');
    if (step2) {
        step2.className = 'deploy-step done';
        step2.querySelector('.deploy-step-num').innerHTML = '<i class="ph ph-check"></i>';
    }
    const btn = document.getElementById('btnPrepareEnv');
    if (btn) btn.style.display = 'none';

    const doneArea = document.getElementById('deployEnvDoneArea');
    if (doneArea && !doneArea.innerHTML) {
        doneArea.innerHTML = `
            <div style="padding: 14px; background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); border-radius: var(--radius-sm); margin-top: 14px;">
                <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-success);">
                    <i class="ph ph-check-circle" style="font-size: 20px;"></i>
                    <b>环境准备完成</b>
                </div>
                <div style="font-size: 14px; color: var(--text-secondary); margin-top: 6px;">runtime、底模、pip 依赖均已就绪，可以继续下一步。</div>
            </div>
        `;
    }

    // 解锁 Step 3
    unlockDeployStep3();
}

// =====================================================
//  Step 3: 模型部署
// =====================================================

function unlockDeployStep3() {
    // 解锁步骤条
    const step3 = document.getElementById('deployStep3');
    if (step3) {
        step3.className = 'deploy-step active';
        step3.querySelector('.deploy-step-num').innerHTML = '3';
    }
    // 显示 Step 3 内容
    const content3 = document.getElementById('deployStepContent3');
    if (content3) content3.style.display = '';

    // 加载模型列表
    loadDeployModels();
}

async function loadDeployModels() {
    try {
        const data = await apiGet('/api/train/models');

        // SoVITS 下拉
        const sovitsSelect = document.getElementById('deploySovitsSelect');
        if (sovitsSelect) {
            sovitsSelect.innerHTML = data.sovits.length === 0
                ? '<option value="">暂无模型 — 请先完成训练</option>'
                : data.sovits.map(m => `<option value="${escapeAttr(m.path)}">${escapeHtml(m.name)} (${m.size_mb}MB)</option>`).join('');
        }

        // GPT 下拉
        const gptSelect = document.getElementById('deployGptSelect');
        if (gptSelect) {
            gptSelect.innerHTML = data.gpt.length === 0
                ? '<option value="">暂无模型 — 请先完成训练</option>'
                : data.gpt.map(m => `<option value="${escapeAttr(m.path)}">${escapeHtml(m.name)} (${m.size_mb}MB)</option>`).join('');
        }
    } catch (err) {
        showToast('加载模型列表失败: ' + err.message, 'error');
    }
}

async function startDeployModel() {
    const sovitsPath = document.getElementById('deploySovitsSelect')?.value;
    const gptPath = document.getElementById('deployGptSelect')?.value;
    if (!sovitsPath || !gptPath) {
        showToast('请先选择 SoVITS 和 GPT 模型', 'error');
        return;
    }

    const btn = document.getElementById('btnDeployModel');
    const statusEl = document.getElementById('deployModelStatus');
    const resultEl = document.getElementById('deployModelResult');
    const compatEl = document.getElementById('deployCompatStatus');

    btn.disabled = true;
    statusEl.textContent = '正在复制模型文件...';
    statusEl.style.color = 'var(--accent)';
    resultEl.innerHTML = '';
    compatEl.innerHTML = '';

    try {
        // Step 1: 复制模型
        statusEl.textContent = '正在复制模型文件...';
        const copyData = await apiPost('/api/deploy/model/copy', {
            sovits_path: sovitsPath,
            gpt_path: gptPath,
        });
        if (!copyData.success) {
            throw new Error(copyData.reason || '模型复制失败');
        }

        // Step 2: 修改配置
        statusEl.textContent = '正在更新配置文件...';
        const configData = await apiPost('/api/deploy/model/config', {
            sovits_path: sovitsPath,
            gpt_path: gptPath,
        });
        if (!configData.success) {
            throw new Error(configData.reason || '配置更新失败');
        }

        // Step 3: 注入兼容层
        statusEl.textContent = '正在检查 SillyTavern 兼容层...';
        const patchData = await apiPost('/api/deploy/model/patch_api', {});
        if (!patchData.success) {
            throw new Error(patchData.reason || '兼容层注入失败');
        }

        // 显示结果
        statusEl.textContent = '';
        resultEl.innerHTML = `
            <div style="padding: 14px; background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); border-radius: var(--radius-sm);">
                <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-success); margin-bottom: 10px;">
                    <i class="ph ph-check-circle" style="font-size: 20px;"></i>
                    <b>模型部署成功</b>
                </div>
                <div style="font-size: 14px; color: var(--text-secondary); display: grid; gap: 8px;">
                    ${copyData.files.map(f => `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="ph ph-check" style="color: var(--accent-success);"></i>
                        <span><b>${escapeHtml(f.type)}</b> — ${escapeHtml(f.dst.split('\\').pop() || f.dst.split('/').pop())} (${f.size_mb}MB)</span>
                    </div>
                    `).join('')}
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="ph ph-check" style="color: var(--accent-success);"></i>
                        <span><b>配置</b> — tts_infer.yaml 已更新 (${escapeHtml(configData.device)})</span>
                    </div>
                </div>
                <div style="margin-top: 10px; font-size: 13px; color: var(--text-muted);">
                    目标目录: ${escapeHtml(copyData.target_dir)}
                </div>
            </div>
        `;

        // 兼容层状态
        compatEl.innerHTML = `
            <div style="padding: 12px 14px; border-radius: var(--radius-sm);
                border: 1px solid rgba(34,197,94,0.2); background: rgba(34,197,94,0.05);">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i class="ph ph-check-circle" style="font-size: 18px; color: var(--accent-success);"></i>
                    <span style="font-size: 14px; font-weight: 600;">SillyTavern 兼容层</span>
                    <span style="font-size: 13px; color: var(--accent-success);">
                        ${patchData.already_patched ? '已就绪（之前已注入）' : '已成功注入'}
                    </span>
                </div>
                <div style="font-size: 13px; color: var(--text-muted); padding-left: 26px; margin-top: 4px;">
                    ${escapeHtml(patchData.detail)}
                </div>
            </div>
        `;

        showToast('模型部署完成！', 'success');
        markDeployStep3Done();

    } catch (err) {
        statusEl.textContent = '部署失败';
        statusEl.style.color = 'var(--accent-danger)';
        showToast('部署失败: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

function markDeployStep3Done() {
    const step3 = document.getElementById('deployStep3');
    if (step3) {
        step3.className = 'deploy-step done';
        step3.querySelector('.deploy-step-num').innerHTML = '<i class="ph ph-check"></i>';
    }
    const btn = document.getElementById('btnDeployModel');
    if (btn) btn.style.display = 'none';

    const doneArea = document.getElementById('deployStep3DoneArea');
    if (doneArea && !doneArea.innerHTML) {
        doneArea.innerHTML = `
            <div style="padding: 14px; background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); border-radius: var(--radius-sm); margin-top: 14px;">
                <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-success);">
                    <i class="ph ph-check-circle" style="font-size: 20px;"></i>
                    <b>模型部署完成</b>
                </div>
                <div style="font-size: 14px; color: var(--text-secondary); margin-top: 6px;">模型已复制、配置已更新、兼容层已就绪。</div>
            </div>
        `;
    }

    // 解锁 Step 4
    unlockDeployStep4();
}

// =====================================================
//  Step 4: 参考音频 + 情感标签
// =====================================================

let deployRefAudioPlayer = null;
let deployRefPlayingIdx = -1;

function unlockDeployStep4() {
    // 解锁步骤条
    const step4 = document.getElementById('deployStep4');
    if (step4) {
        step4.className = 'deploy-step active';
        step4.querySelector('.deploy-step-num').innerHTML = '4';
    }
    // 显示 Step 4 内容
    const content4 = document.getElementById('deployStepContent4');
    if (content4) content4.style.display = '';

    // 加载音频列表
    loadRefAudioList();
}

async function loadRefAudioList() {
    const area = document.getElementById('deployRefAudioListArea');
    if (!area) return;

    area.innerHTML = '<div style="color: var(--text-muted); font-size: 14px;"><i class="ph ph-spinner" style="animation: spin 1s linear infinite;"></i> 加载已标记的参考音频...</div>';

    try {
        const data = await apiGet('/api/deploy/ref/list');
        if (data.error) {
            area.innerHTML = `<div style="color: var(--accent-danger); font-size: 14px;">${escapeHtml(data.error)}</div>`;
            return;
        }
        if (!data.audios || data.audios.length === 0) {
            area.innerHTML = `
                <div style="padding: 24px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border); border-radius: var(--radius-sm);">
                    <i class="ph ph-star" style="font-size: 36px; display: block; margin-bottom: 10px; color: #fbbf24;"></i>
                    <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">尚未标记参考音频</div>
                    <div style="font-size: 14px; margin-bottom: 12px;">请先在标注工具中点击“☆”按钮标记 1~3 段代表性音频为参考音频</div>
                    <a href="/annotate" target="_blank" style="
                        display: inline-flex; align-items: center; gap: 6px;
                        padding: 8px 18px; border-radius: var(--radius-sm);
                        background: var(--accent); color: #fff;
                        font-size: 14px; font-weight: 600;
                        text-decoration: none; transition: var(--transition);
                    "><i class="ph ph-arrow-square-out"></i> 打开标注工具</a>
                </div>`;
            // 隐藏部署按钮
            const btn = document.getElementById('btnDeployRefAudio');
            if (btn) btn.style.display = 'none';
            return;
        }

        // 渲染摘要卡片
        window._deployRefAudios = data.audios;
        area.innerHTML = `
            <div style="
                display: flex; align-items: center; justify-content: space-between;
                padding: 12px 16px; margin-bottom: 8px;
                background: var(--bg-card); border: 1px solid var(--border);
                border-radius: var(--radius);
            ">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i class="ph-fill ph-star" style="color: #fbbf24; font-size: 18px;"></i>
                    <span style="font-size: 14px; font-weight: 600; color: var(--text-primary);">已标记 ${data.audios.length} 个参考音频</span>
                </div>
                <a href="/annotate" target="_blank" style="font-size: 13px; color: var(--accent); text-decoration: none;">
                    <i class="ph ph-pencil-simple"></i> 在标注工具中编辑
                </a>
            </div>
            <div style="display: grid; gap: 6px; max-height: 400px; overflow-y: auto; padding-right: 4px;">
                ${data.audios.map((a, i) => {
                    const durClass = a.duration_s < 1 ? 'duration-short' 
                                   : a.duration_s > 15 ? 'duration-long' 
                                   : 'duration-ok';
                    return `
                    <div class="entry-row" style="border: 1px solid rgba(251, 191, 36, 0.3); background: rgba(251, 191, 36, 0.04);" id="refCard${i}">
                        <div class="entry-index">#${i + 1}</div>
                        <button class="entry-play" onclick="event.stopPropagation(); deployPlayRefAudio(${i}, '${escapeAttr(a.path)}')" id="refPlayBtn${i}" title="试听">
                            <i class="ph-fill ph-play"></i>
                        </button>
                        <span class="entry-duration ${durClass}">${a.duration_s}s</span>
                        <span style="
                            display: inline-flex; align-items: center; gap: 4px;
                            padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;
                            background: rgba(251, 191, 36, 0.15); color: #fbbf24;
                        ">${escapeHtml(a.emotion || 'default')}</span>
                        <span class="entry-text" style="flex: 1; min-width: 0; cursor: default;">${escapeHtml(a.text || '（无文本）')}</span>
                        <div class="entry-info">
                            <span class="entry-lang">${escapeHtml(a.lang || 'zh')}</span>
                            <span class="entry-filename" title="${escapeAttr(a.filename)}">${escapeHtml(a.filename)}</span>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        `;

        // 显示部署按钮
        const btn = document.getElementById('btnDeployRefAudio');
        if (btn) btn.style.display = '';
    } catch (err) {
        area.innerHTML = `<div style="color: var(--accent-danger); font-size: 14px;">加载失败: ${escapeHtml(err.message)}</div>`;
    }
}

function deployPlayRefAudio(idx, path) {
    const btn = document.getElementById(`refPlayBtn${idx}`);
    const row = document.getElementById(`refCard${idx}`);

    // 清除所有播放状态
    document.querySelectorAll('.entry-row.playing').forEach(el => el.classList.remove('playing'));
    document.querySelectorAll('.entry-play.playing-btn').forEach(el => {
        el.classList.remove('playing-btn');
        el.innerHTML = '<i class="ph-fill ph-play"></i>';
    });

    if (deployRefAudioPlayer && deployRefPlayingIdx === idx) {
        deployRefAudioPlayer.pause();
        deployRefAudioPlayer = null;
        deployRefPlayingIdx = -1;
        return;
    }
    if (deployRefAudioPlayer) deployRefAudioPlayer.pause();

    deployRefAudioPlayer = new Audio(`/api/deploy/ref/audio?path=${encodeURIComponent(path)}`);
    deployRefPlayingIdx = idx;
    if (btn) { btn.classList.add('playing-btn'); btn.innerHTML = '<i class="ph-fill ph-pause"></i>'; }
    if (row) row.classList.add('playing');

    deployRefAudioPlayer.play().catch(err => {
        showToast('播放失败: ' + err.message, 'error');
        if (btn) { btn.classList.remove('playing-btn'); btn.innerHTML = '<i class="ph-fill ph-play"></i>'; }
        if (row) row.classList.remove('playing');
    });
    deployRefAudioPlayer.onended = () => {
        if (btn) { btn.classList.remove('playing-btn'); btn.innerHTML = '<i class="ph-fill ph-play"></i>'; }
        if (row) row.classList.remove('playing');
        deployRefPlayingIdx = -1;
        deployRefAudioPlayer = null;
    };
}

async function oneClickDeployRef() {
    const audios = window._deployRefAudios;
    if (!audios || audios.length === 0) {
        showToast('没有已标记的参考音频', 'error');
        return;
    }

    const items = audios.map(a => ({
        src_path: a.path,
        name: a.emotion || 'default',
        text: a.text || '',
        lang: a.lang || 'zh',
    }));

    // 检查名称重复
    const nameSet = new Set();
    for (const item of items) {
        if (nameSet.has(item.name)) {
            showToast(`情感名称「${item.name}」重复，请在标注工具中修改`, 'error');
            return;
        }
        nameSet.add(item.name);
    }

    const btn = document.getElementById('btnDeployRefAudio');
    const statusEl = document.getElementById('deployRefStatus');
    const resultEl = document.getElementById('deployRefResult');
    btn.disabled = true;
    statusEl.textContent = '正在复制参考音频...';
    statusEl.style.color = 'var(--accent)';
    resultEl.innerHTML = '';

    try {
        const data = await apiPost('/api/deploy/ref/copy', { items });
        if (!data.success) throw new Error(data.reason || '部署失败');

        statusEl.textContent = '';
        resultEl.innerHTML = `
            <div style="padding: 14px; background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); border-radius: var(--radius-sm);">
                <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-success); margin-bottom: 10px;">
                    <i class="ph ph-check-circle" style="font-size: 20px;"></i>
                    <b>参考音频部署成功</b>
                </div>
                <div style="font-size: 14px; color: var(--text-secondary); display: grid; gap: 6px;">
                    ${data.copied.map(c => `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="ph ph-check" style="color: var(--accent-success);"></i>
                        <span><b>${escapeHtml(c.name)}</b>.wav + .txt (${c.size_kb}KB)</span>
                    </div>
                    `).join('')}
                </div>
                ${data.errors.length > 0 ? `
                <div style="margin-top: 10px; color: var(--accent-warning); font-size: 13px;">
                    <i class="ph ph-warning"></i> 部分失败: ${data.errors.map(e => escapeHtml(e)).join(', ')}
                </div>` : ''}
                <div style="margin-top: 10px; font-size: 13px; color: var(--text-muted);">
                    目标目录: ${escapeHtml(data.ref_dir)}
                </div>
            </div>
        `;

        showToast(`参考音频部署完成！共 ${data.copied.length} 个`, 'success');
        markDeployStep4Done();

    } catch (err) {
        statusEl.textContent = '部署失败';
        statusEl.style.color = 'var(--accent-danger)';
        showToast('部署失败: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

function markDeployStep4Done() {
    const step4 = document.getElementById('deployStep4');
    if (step4) {
        step4.className = 'deploy-step done';
        step4.querySelector('.deploy-step-num').innerHTML = '<i class="ph ph-check"></i>';
    }
    const btn = document.getElementById('btnDeployRefAudio');
    if (btn) btn.style.display = 'none';

    const doneArea = document.getElementById('deployStep4DoneArea');
    if (doneArea && !doneArea.innerHTML) {
        doneArea.innerHTML = `
            <div style="padding: 14px; background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); border-radius: var(--radius-sm); margin-top: 14px;">
                <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-success);">
                    <i class="ph ph-check-circle" style="font-size: 20px;"></i>
                    <b>参考音频就绪</b>
                </div>
                <div style="font-size: 14px; color: var(--text-secondary); margin-top: 6px;">参考音频和文本已部署到 GSVI，可以继续下一步。</div>
            </div>
        `;
    }

    // 解锁 Step 5
    unlockDeployStep5();
}

// =====================================================
//  Step 5: 启动 GSVI + 酒馆连接指南
// =====================================================

let gsviPolling = null;

function unlockDeployStep5() {
    // 解锁步骤条
    const step5 = document.getElementById('deployStep5');
    if (step5) {
        step5.className = 'deploy-step active';
        step5.querySelector('.deploy-step-num').innerHTML = '5';
    }

    // 隐藏锁定提示
    const lockedHint = document.getElementById('deployLockedHint');
    if (lockedHint) lockedHint.style.display = 'none';

    // 显示 Step 5 内容
    const content5 = document.getElementById('deployStepContent5');
    if (content5) content5.style.display = '';

    // 检查是否已经在运行
    checkInitialGsviStatus();
}

async function checkInitialGsviStatus() {
    try {
        const data = await apiGet('/api/deploy/status');
        if (data.status === 'running' && data.ready) {
            // 已经在运行，更新 UI
            updateGsviStatusUI(data);
            document.getElementById('btnStartGsvi').style.display = 'none';
            document.getElementById('btnStopGsvi').style.display = '';
            showGsviConnGuide(data.port, data.gsvi_path);
        }
    } catch (err) {
        // ignore
    }
}

function updateGsviStatusUI(data) {
    const dot = document.getElementById('deployGsviDot');
    const text = document.getElementById('deployGsviStatusText');
    if (!dot || !text) return;

    const statusMap = {
        idle:     { color: 'var(--text-muted)',      label: '未启动' },
        starting: { color: '#fbbf24',                label: '启动中...' },
        running:  { color: 'var(--accent-success)',  label: '运行中' },
        error:    { color: 'var(--accent-danger)',    label: '出错了' },
        stopped:  { color: 'var(--text-muted)',      label: '已停止' },
    };
    const info = statusMap[data.status] || statusMap.idle;
    dot.style.background = info.color;
    text.textContent = info.label;
    text.style.color = info.color;

    // 添加脉冲动画
    if (data.status === 'starting') {
        dot.style.animation = 'pulse 1.5s ease-in-out infinite';
    } else {
        dot.style.animation = '';
    }

    // 错误信息
    if (data.status === 'error' && data.error) {
        const actionStatus = document.getElementById('deployGsviActionStatus');
        if (actionStatus) {
            actionStatus.textContent = data.error;
            actionStatus.style.color = 'var(--accent-danger)';
        }
    }
}

async function startGsvi() {
    const btn = document.getElementById('btnStartGsvi');
    const stopBtn = document.getElementById('btnStopGsvi');
    const actionStatus = document.getElementById('deployGsviActionStatus');

    btn.disabled = true;
    actionStatus.textContent = '正在启动...';
    actionStatus.style.color = 'var(--accent)';

    try {
        const data = await apiPost('/api/deploy/start', {});
        if (!data.success) {
            showToast(data.reason || '启动失败', 'error');
            actionStatus.textContent = data.reason || '启动失败';
            actionStatus.style.color = 'var(--accent-danger)';
            btn.disabled = false;
            return;
        }

        if (data.already_running) {
            showToast('GSVI 已在运行中！', 'success');
            actionStatus.textContent = '';
        } else {
            showToast('已打开 GSVI 启动窗口，等待就绪...', 'success');
            actionStatus.textContent = 'CMD 窗口已打开，等待 API 就绪...';
        }

        // 隐藏启动按钮，显示停止按钮
        btn.style.display = 'none';
        stopBtn.style.display = '';

        // 开始轮询
        pollGsviStatus();

    } catch (err) {
        showToast('启动失败: ' + err.message, 'error');
        actionStatus.textContent = '启动失败';
        actionStatus.style.color = 'var(--accent-danger)';
        btn.disabled = false;
    }
}

function pollGsviStatus() {
    if (gsviPolling) clearInterval(gsviPolling);

    let idleCount = 0;  // 连续 idle 计数，用于判断 CMD 窗口是否已关闭

    gsviPolling = setInterval(async () => {
        try {
            const data = await apiGet('/api/deploy/status');
            updateGsviStatusUI(data);

            const actionStatus = document.getElementById('deployGsviActionStatus');

            // 就绪
            if (data.ready && data.status === 'running') {
                idleCount = 0;
                clearInterval(gsviPolling);
                gsviPolling = null;
                if (actionStatus) actionStatus.textContent = '';
                showToast('GSVI API 已就绪！', 'success');
                showGsviConnGuide(data.port, data.gsvi_path);
                markDeployStep5Done();
            }

            // 如果还在 idle（未就绪），继续等待
            if (data.status === 'idle') {
                idleCount++;
                // 更新状态显示为 "启动中"
                const dot = document.getElementById('deployGsviDot');
                const text = document.getElementById('deployGsviStatusText');
                if (dot) { dot.style.background = '#fbbf24'; dot.style.animation = 'pulse 1.5s ease-in-out infinite'; }
                if (text) { text.textContent = '启动中...'; text.style.color = '#fbbf24'; }

                // 如果超过 120 秒 (80次 * 1.5秒) 还没启动起来，放弃轮询
                if (idleCount > 80) {
                    clearInterval(gsviPolling);
                    gsviPolling = null;
                    const btn = document.getElementById('btnStartGsvi');
                    const stopBtn = document.getElementById('btnStopGsvi');
                    if (btn) { btn.style.display = ''; btn.disabled = false; }
                    if (stopBtn) stopBtn.style.display = 'none';
                    if (actionStatus) {
                        actionStatus.textContent = '启动超时，请检查 CMD 窗口是否有错误';
                        actionStatus.style.color = 'var(--accent-danger)';
                    }
                    updateGsviStatusUI({ status: 'idle', ready: false });
                }
            }
        } catch (err) {
            // 网络错误，继续轮询
        }
    }, 1500);
}

async function stopGsvi() {
    const stopBtn = document.getElementById('btnStopGsvi');
    const startBtn = document.getElementById('btnStartGsvi');
    const actionStatus = document.getElementById('deployGsviActionStatus');

    stopBtn.disabled = true;
    actionStatus.textContent = '正在停止...';
    actionStatus.style.color = 'var(--text-muted)';

    try {
        const data = await apiPost('/api/deploy/stop', {});
        if (data.success) {
            showToast(data.detail || 'GSVI 已停止', 'success');
        } else {
            showToast(data.reason || '停止失败，请手动关闭 CMD 窗口', 'warning');
        }
    } catch (err) {
        showToast('停止失败: ' + err.message, 'error');
    }

    if (gsviPolling) { clearInterval(gsviPolling); gsviPolling = null; }

    // 重置 UI
    stopBtn.style.display = 'none';
    stopBtn.disabled = false;
    startBtn.style.display = '';
    startBtn.disabled = false;
    actionStatus.textContent = '';

    updateGsviStatusUI({ status: 'stopped' });

    // 隐藏连接指南
    const guide = document.getElementById('deployConnGuide');
    if (guide) guide.style.display = 'none';

    // 重置 step 5 状态
    const step5 = document.getElementById('deployStep5');
    if (step5) {
        step5.className = 'deploy-step active';
        step5.querySelector('.deploy-step-num').innerHTML = '5';
    }
}

function showGsviConnGuide(port, gsviPathParam) {
    const guide = document.getElementById('deployConnGuide');
    if (!guide) return;

    const endpoint = `http://127.0.0.1:${port || 9881}`;
    const gsviPath = gsviPathParam || '';

    guide.style.display = '';
    guide.innerHTML = `
        <div style="
            padding: 20px; border-radius: var(--radius-sm);
            background: linear-gradient(135deg, rgba(99,102,241,0.08), rgba(34,197,94,0.08));
            border: 1px solid rgba(34,197,94,0.25);
        ">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px;">
                <i class="ph ph-plugs-connected" style="font-size: 24px; color: var(--accent-success);"></i>
                <span style="font-size: 17px; font-weight: 700; color: var(--text-primary);">酒馆连接指南</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
                <div style="
                    padding: 14px; border-radius: var(--radius-sm);
                    background: var(--bg-primary); border: 1px solid var(--border);
                ">
                    <div style="font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">TTS Provider</div>
                    <div style="font-size: 16px; font-weight: 700; color: var(--text-primary);">Entity Whisper</div>
                </div>
                <div style="
                    padding: 14px; border-radius: var(--radius-sm);
                    background: var(--bg-primary); border: 1px solid var(--border);
                    cursor: pointer; transition: var(--transition);
                " onclick="copyGsviEndpoint('${endpoint}')" title="点击复制">
                    <div style="font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">Endpoint</div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 15px; font-weight: 700; color: var(--accent); font-family: 'Consolas', monospace;">${endpoint}</span>
                        <i class="ph ph-copy" style="font-size: 16px; color: var(--text-muted);"></i>
                    </div>
                </div>
            </div>

            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 10px;">
                <i class="ph ph-list-numbers" style="margin-right: 4px;"></i> 在酒馆中设置
            </div>
            <div style="font-size: 14px; color: var(--text-secondary); display: grid; gap: 8px; padding-left: 4px;">
                <div style="display: flex; gap: 10px;">
                    <span style="
                        width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
                        background: var(--accent); color: #fff; font-size: 13px; font-weight: 700;
                        display: flex; align-items: center; justify-content: center;
                    ">1</span>
                    <span>打开 SillyTavern → <b>Settings</b>（齿轮图标）→ <b>TTS</b> 标签页</span>
                </div>
                <div style="display: flex; gap: 10px;">
                    <span style="
                        width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
                        background: var(--accent); color: #fff; font-size: 13px; font-weight: 700;
                        display: flex; align-items: center; justify-content: center;
                    ">2</span>
                    <span>TTS Provider 选择 <b>Entity Whisper</b></span>
                </div>
                <div style="display: flex; gap: 10px;">
                    <span style="
                        width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
                        background: var(--accent); color: #fff; font-size: 13px; font-weight: 700;
                        display: flex; align-items: center; justify-content: center;
                    ">3</span>
                    <span>将上方 Endpoint 地址粘贴到 <b>Provider Endpoint</b> 输入框</span>
                </div>
                <div style="display: flex; gap: 10px;">
                    <span style="
                        width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
                        background: var(--accent); color: #fff; font-size: 13px; font-weight: 700;
                        display: flex; align-items: center; justify-content: center;
                    ">4</span>
                    <span>选择角色 → 选择情感 → 开始对话，AI 就会用你训练的声音说话了！</span>
                </div>
            </div>
        </div>

        <!-- 毕业指南 -->
        <div style="
            margin-top: 16px; padding: 20px; border-radius: var(--radius-sm);
            background: linear-gradient(135deg, rgba(251,191,36,0.08), rgba(245,158,11,0.06));
            border: 1px solid rgba(251,191,36,0.25);
        ">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">
                <i class="ph ph-graduation-cap" style="font-size: 24px; color: #f59e0b;"></i>
                <span style="font-size: 17px; font-weight: 700; color: var(--text-primary);">部署完成！以后怎么用？</span>
            </div>
            <div style="font-size: 14px; color: var(--text-secondary); line-height: 1.7;">
                <p style="margin: 0 0 10px 0;">
                    恭喜！TTS 服务已经部署完成 🎉 以后不需要再打开这个面板，只需要：
                </p>
                <div style="
                    padding: 14px 16px; border-radius: var(--radius-sm);
                    background: var(--bg-primary); border: 1px solid var(--border);
                    margin-bottom: 12px;
                ">
                    <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 6px;">每次使用时</div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="ph ph-terminal-window" style="font-size: 22px; color: var(--accent);"></i>
                        <div>
                            <div style="font-weight: 700; color: var(--text-primary);">双击 <code style="
                                padding: 2px 8px; border-radius: 4px; font-size: 13px;
                                background: rgba(99,102,241,0.12); color: var(--accent);
                            ">start_api.bat</code></div>
                            <div style="font-size: 13px; color: var(--text-muted); margin-top: 2px;">
                                等 CMD 窗口显示就绪 → 打开酒馆即可使用 TTS
                            </div>
                        </div>
                    </div>
                </div>
                ${gsviPath ? `
                <div style="
                    padding: 10px 14px; border-radius: var(--radius-sm);
                    background: var(--bg-primary); border: 1px solid var(--border);
                    margin-bottom: 12px; cursor: pointer;
                " onclick="copyGsviEndpoint('${gsviPath.replace(/\\/g, '\\\\')}\\\\start_api.bat')" title="点击复制路径">
                    <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">
                        <i class="ph ph-folder-open" style="margin-right: 4px;"></i>BAT 文件位置（点击复制）
                    </div>
                    <div style="font-size: 13px; font-family: 'Consolas', monospace; color: var(--accent); word-break: break-all;">
                        ${gsviPath}\\start_api.bat
                    </div>
                </div>
                ` : ''}
                <p style="margin: 0; font-size: 13px; color: var(--text-muted);">
                    <i class="ph ph-lightbulb" style="margin-right: 4px;"></i>
                    提示：如果你需要换模型、换参考音频，再回到这个面板操作即可。
                </p>
            </div>
        </div>
    `;
}


function copyGsviEndpoint(endpoint) {
    navigator.clipboard.writeText(endpoint).then(() => {
        showToast('已复制地址: ' + endpoint, 'success');
    }).catch(() => {
        // fallback
        const input = document.createElement('input');
        input.value = endpoint;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('已复制地址: ' + endpoint, 'success');
    });
}

function markDeployStep5Done() {
    const step5 = document.getElementById('deployStep5');
    if (step5) {
        step5.className = 'deploy-step done';
        step5.querySelector('.deploy-step-num').innerHTML = '<i class="ph ph-check"></i>';
    }
}
