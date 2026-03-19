// =====================================================
//  Projects
// =====================================================
async function loadProjects() {
    try {
        const data = await apiGet('/api/project/list');
        projects = data.projects;
        activeProject = data.active_project;
        renderProjects();
        updateTopBar();
        updateStepStatus();
    } catch (err) {
        showToast('加载项目列表失败: ' + err.message, 'error');
    }
}

function renderProjects() {
    const grid = document.getElementById('projectGrid');

    // New project card
    let html = `
            <div class="project-card project-card-new" onclick="openModal('modalNewProject')">
                <div class="plus-icon"><i class="ph ph-plus"></i></div>
                <div class="plus-text">新建项目</div>
            </div>
        `;

    // Existing projects
    const langMap = {zh:'中文',en:'EN',ja:'日本語',yue:'粤语',ko:'한국어'};
    projects.forEach(p => {
        const isActive = p.name === activeProject;
        const steps = p.steps || {};
        // Exclude 'infer' from progress — it's an ongoing testing tool, not a completable step
        const trainingSteps = Object.entries(steps).filter(([k]) => k !== 'infer');
        const totalSteps = trainingSteps.length;
        const doneSteps = trainingSteps.filter(([, s]) => s.status === 'done').length;
        const progressPct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;

        const date = p.created_at ? new Date(p.created_at).toLocaleDateString('zh-CN') : '未知';
        const eName = escapeAttr(p.name);
        const langLabel = langMap[p.language] || p.language || '中文';

        html += `
                <div class="project-card ${isActive ? 'active-project' : ''}" onclick="switchProject('${eName}')">
                    <div class="project-card-actions">
                        <button class="card-action-btn" onclick="event.stopPropagation(); openProjectEdit('${eName}')" title="编辑项目">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="card-action-btn" onclick="event.stopPropagation(); exportProject('${eName}')" title="导出项目">
                            <i class="ph ph-download-simple"></i>
                        </button>
                        <button class="card-action-btn btn-danger" onclick="event.stopPropagation(); deleteProject('${eName}')" title="删除项目">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                    <div class="project-card-name">${escapeHtml(p.name)}</div>
                    <div class="project-card-version">${escapeHtml(p.version || 'v2Pro')} · ${escapeHtml(langLabel)}</div>
                    <div class="project-card-progress">
                        <div class="progress-bar-bg">
                            <div class="progress-bar-fill" style="width: ${progressPct}%"></div>
                        </div>
                        <span class="progress-text">${doneSteps}/${totalSteps}</span>
                    </div>
                    <div class="project-card-date">创建于 ${date}</div>
                </div>
            `;
    });

    grid.innerHTML = html;
}

// =====================================================
//  Edit Project (modal)
// =====================================================
let editingProjectName = '';

function openProjectEdit(name) {
    editingProjectName = name;
    const proj = projects.find(p => p.name === name);
    document.getElementById('editProjectLabel').textContent = `项目：${name}`;
    document.getElementById('editProjectLanguage').value = (proj && proj.language) || 'zh';
    openModal('modalEditProject');
}

async function saveProjectEdit() {
    const newLang = document.getElementById('editProjectLanguage').value;

    try {
        await apiPost(`/api/project/${encodeURIComponent(editingProjectName)}/update`, {
            language: newLang,
        });
        showToast('项目语言已更新', 'success');
        closeModal('modalEditProject');
        await loadProjects();
    } catch (err) {
        showToast('保存失败: ' + err.message, 'error');
    }
}

async function createProject() {
    const name = document.getElementById('newProjectName').value.trim();
    const version = document.getElementById('newProjectVersion').value;
    const language = document.getElementById('newProjectLanguage').value;

    if (!name) {
        showToast('请输入项目名称', 'error');
        return;
    }

    try {
        await apiPost('/api/project/create', { name, version, language });
        showToast(`项目「${name}」创建成功！`, 'success');
        closeModal('modalNewProject');
        document.getElementById('newProjectName').value = '';
        await loadProjects();
    } catch (err) {
        showToast('创建失败: ' + err.message, 'error');
    }
}

async function switchProject(name) {
    try {
        await apiPost('/api/project/switch', { name });
        activeProject = name;
        showToast(`已切换到项目「${name}」`, 'success');
        await loadProjects();
    } catch (err) {
        showToast('切换失败: ' + err.message, 'error');
    }
}

// =====================================================
//  Delete / Import / Export
// =====================================================
let pendingDeleteProject = '';
let pendingDeleteData = false;

function deleteProject(name) {
    pendingDeleteProject = name;
    pendingDeleteData = false;
    document.getElementById('deleteProjectNameLabel').textContent = name;
    // Reset radio selection
    document.querySelectorAll('#modalDeleteProject .delete-option').forEach((el, i) => {
        el.classList.toggle('selected', i === 0);
    });
    document.querySelector('#modalDeleteProject input[value="meta"]').checked = true;
    openModal('modalDeleteProject');
}

function selectDeleteOption(el, deleteData) {
    pendingDeleteData = deleteData;
    document.querySelectorAll('#modalDeleteProject .delete-option').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
}

async function confirmDeleteProject() {
    if (!pendingDeleteProject) return;
    const name = pendingDeleteProject;
    const deleteData = pendingDeleteData;

    try {
        const res = await fetch(`/api/project/${encodeURIComponent(name)}?delete_data=${deleteData}`, {
            method: 'DELETE',
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${res.status}`);
        }

        closeModal('modalDeleteProject');
        showToast(
            deleteData
                ? `项目「${name}」及其所有数据已彻底删除`
                : `项目「${name}」已移除元数据`,
            'success'
        );
        pendingDeleteProject = '';
        await loadProjects();
    } catch (err) {
        showToast('删除失败: ' + err.message, 'error');
    }
}

// --- Import ---
let importFile = null;

function onImportFileSelected(input) {
    const file = input.files[0];
    if (!file) return;
    importFile = file;
    const nameEl = document.getElementById('importFileName');
    const wrap = document.getElementById('importSelectedFile');
    nameEl.textContent = file.name + ' (' + (file.size / 1024 / 1024).toFixed(1) + ' MB)';
    wrap.classList.add('visible');
    document.getElementById('btnDoImport').disabled = false;
}

async function doImportProject() {
    if (!importFile) {
        showToast('请先选择 .zip 文件', 'error');
        return;
    }

    const btn = document.getElementById('btnDoImport');
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner" style="animation: spin 1s linear infinite;"></i> 导入中...';

    try {
        const formData = new FormData();
        formData.append('file', importFile);

        const res = await fetch('/api/project/import', {
            method: 'POST',
            body: formData,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${res.status}`);
        }

        const data = await res.json();
        closeModal('modalImportProject');
        showToast(`项目「${data.project?.name || ''}」导入成功！`, 'success');

        // Reset
        importFile = null;
        document.getElementById('importFileInput').value = '';
        document.getElementById('importSelectedFile').classList.remove('visible');

        await loadProjects();
    } catch (err) {
        showToast('导入失败: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="ph ph-upload-simple"></i> 开始导入';
    }
}

// --- Export ---
function exportProject(name) {
    showToast(`正在导出项目「${name}」，请稍候...`, 'info');
    const a = document.createElement('a');
    a.href = `/api/project/${encodeURIComponent(name)}/export`;
    a.download = name + '.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function updateTopBar() {
    const el = document.getElementById('topProjectName');
    el.textContent = activeProject || '未选择';
}

function updateStepStatus() {
    const stepPages = ['slice', 'asr', 'annotate', 'format', 'train', 'infer'];
    const badgeIds = { slice: 'badgeSlice', asr: 'badgeAsr', annotate: 'badgeAnnotate', format: 'badgeFormat', train: 'badgeTrain', infer: 'badgeInfer' };

    // No project selected — reset all badges
    if (!activeProject) {
        stepPages.forEach(page => {
            const stepEl = document.querySelector(`.step-item[data-page="${page}"]`);
            if (stepEl) stepEl.classList.remove('step-done');
            const badge = document.getElementById(badgeIds[page]);
            if (badge) {
                badge.className = 'sidebar-badge badge-future';
                badge.textContent = '—';
            }
        });
        return;
    }

    const proj = projects.find(p => p.name === activeProject);
    if (!proj) return;

    const steps = proj.steps || {};
    stepPages.forEach(page => {
        const stepEl = document.querySelector(`.step-item[data-page="${page}"]`);
        const badge = document.getElementById(badgeIds[page]);
        const stepData = steps[page];
        const status = stepData ? stepData.status : null;

        // Update step bar
        if (stepEl) {
            stepEl.classList.toggle('step-done', status === 'done');
        }

        // Update sidebar badge
        if (badge) {
            if (status === 'done') {
                badge.className = 'sidebar-badge badge-done';
                badge.textContent = '完成';
            } else if (status === 'running' || status === 'wip') {
                badge.className = 'sidebar-badge badge-wip';
                badge.textContent = '进行中';
            } else if (page === 'annotate' || page === 'infer') {
                badge.className = 'sidebar-badge badge-future';
                badge.textContent = '可选';
            } else {
                badge.className = 'sidebar-badge badge-future';
                badge.textContent = '待开始';
            }
        }
    });
}

// =====================================================
//  Annotate Page
// =====================================================
function updateAnnotatePage() {
    const container = document.getElementById('annotateContent');

    if (!activeProject) {
        container.innerHTML = `
                <div class="no-project-hint">
                    <i class="ph ph-clipboard-text hint-icon"></i>
                    <div class="hint-text">请先在「项目管理」中选择一个项目</div>
                </div>
            `;
        return;
    }

    const proj = projects.find(p => p.name === activeProject);
    const listFile = proj?.steps?.annotate?.list_file || '';

    let html = '';

    if (listFile) {
        html += `
                <div class="annotate-file-info">
                    <div style="font-size: 15px; font-weight: 600; color: var(--accent-success); margin-bottom: 6px;">
                        <i class="ph ph-check-circle" style="margin-right: 4px;"></i>已找到标注文件
                    </div>
                    <div class="annotate-file-path">${escapeHtml(listFile)}</div>
                </div>
                <div class="annotate-actions">
                    <button class="btn btn-primary" data-list-file="${escapeAttr(listFile)}" onclick="openAnnotateTool(this.dataset.listFile)">
                        <i class="ph ph-pencil-simple-line"></i> 打开标注工具
                    </button>
                    <span style="font-size: 14px; color: var(--text-muted);">将在新窗口中打开独立标注工具</span>
                </div>

                <div style="background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 20px; margin-top: 16px;">
                    <div style="font-size: 15px; font-weight: 700; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                        <i class="ph ph-list-numbers" style="color: var(--accent);"></i> 标注工具操作指引
                    </div>
                    <div style="font-size: 14px; color: var(--text-secondary); line-height: 2;">
                        <div><b style="color: var(--accent);">①</b> 点击播放按钮逐条听音频，<b>音质差的</b>（杂音/电流声/混响）<b>勾选左侧 checkbox</b>，然后点工具栏「批量删除」一次清除</div>
                        <div><b style="color: var(--accent);">②</b> 音质 OK 的，直接<b>点击文字</b>即可编辑，修改后点击别处<b>自动保存</b></div>
                        <div><b style="color: var(--accent);">③</b> 可用<b>时长筛选</b>快速定位过短（&lt; 1s）或过长的异常片段，批量勾选后删除</div>
                    </div>
                </div>
                <div class="inline-tip">
                    <i class="ph ph-keyboard"></i>
                    <span>支持键盘快捷键：<b>Space</b> 播放/暂停、<b>Del</b> 删除选中、<b>Ctrl+A</b> 全选、<b>Ctrl+Z</b> 撤销、<b>↑↓</b> 导航。</span>
                </div>
                <div class="inline-tip">
                    <i class="ph ph-info"></i>
                    <span>校对要求不特别高可以放松标准——音译专有名词的同音字小错误影响不大，但请确保没有严重的文字错误。</span>
                </div>
                <div class="inline-tip">
                    <i class="ph ph-lightbulb"></i>
                    <span>校对时留意效果好的音频，之后可用作推理参考音频（<b>3~10 秒</b>最佳）。误删了可以点「撤销」按钮恢复。</span>
                </div>
                <div class="inline-tip" style="border: 1px solid rgba(251, 191, 36, 0.3); background: rgba(251, 191, 36, 0.06);">
                    <i class="ph ph-warning" style="color: #fbbf24;"></i>
                    <span><b style="color: #fbbf24;">恶灵低语用户注意：</b>标记参考音频时，<b>必须使用下拉框中的预设情感标签</b>（如 happy、sad、whisper 等），不要使用自定义名称。恶灵系列中的 <code style="background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 3px; font-size: 13px;">&lt;say tone="..."&gt;</code> 指令依赖这些预设值来匹配参考音频。</span>
                </div>
            `;
    } else {
        html += `
                <div class="no-project-hint" style="min-height: 200px;">
                    <i class="ph ph-tray hint-icon"></i>
                    <div class="hint-text">当前项目还没有 .list 文件</div>
                    <div style="font-size: 15px; color: var(--text-muted); max-width: 400px;">
                        请先完成「音频切分」和「语音识别(ASR)」步骤，<br>
                        ASR 会生成 .list 文件供标注使用。
                    </div>
                </div>
            `;
    }

    // Manual load option
    html += `
            <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border);">
                <div style="font-size: 15px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px;">
                    手动加载 .list 文件
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <input type="text" class="form-input" id="manualListFile" 
                           placeholder="输入 .list 文件的完整路径" style="flex: 1;">
                    <button class="btn" onclick="browseListFile()" title="浏览文件">
                        <i class="ph ph-folder-open"></i> 浏览
                    </button>
                    <button class="btn" onclick="openAnnotateManual()">打开</button>
                </div>
            </div>
        `;

    container.innerHTML = html;
}

function openAnnotateTool(listFile) {
    // Open the standalone annotation tool in a new tab
    // First, load the list file into the annotate API
    apiPost('/api/annotate/load', { list_file: listFile })
        .then(() => {
            window.open('/annotate/', '_blank');
        })
        .catch(err => {
            showToast('加载标注文件失败: ' + err.message, 'error');
        });
}

async function browseListFile() {
    try {
        const data = await apiGet('/api/file/browse?title=选择 .list 标注文件&filetypes=标注文件|*.list||所有文件|*.*');
        if (data.cancelled || !data.path) return;
        const input = document.getElementById('manualListFile');
        if (input) input.value = data.path;
        // 自动打开标注工具
        openAnnotateTool(data.path);
    } catch (err) {
        showToast('打开文件浏览器失败: ' + err.message, 'error');
    }
}


function openAnnotateManual() {
    const listFile = document.getElementById('manualListFile').value.trim();
    if (!listFile) {
        showToast('请输入 .list 文件路径', 'error');
        return;
    }
    openAnnotateTool(listFile);
}
