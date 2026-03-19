        // =====================================================
        //  State
        // =====================================================
        let projects = [];
        let activeProject = null;
        let currentPage = 'projects';

        /** 获取当前活跃项目的语言设置，找不到则返回 'zh' */
        function getActiveProjectLanguage() {
            if (!activeProject) return 'zh';
            const proj = projects.find(p => p.name === activeProject);
            return (proj && proj.language) ? proj.language : 'zh';
        }

        // ---- Dual Mode: guided (beginner) / expert (free) ----
        let panelMode = localStorage.getItem('panelMode') || 'guided';

        function isExpertMode() {
            return panelMode === 'expert';
        }

        function togglePanelMode(mode) {
            if (panelMode === mode) return; // already in this mode

            const title = document.getElementById('modeSwitchTitle');
            const body = document.getElementById('modeSwitchBody');
            const confirmBtn = document.getElementById('btnConfirmModeSwitch');

            if (mode === 'expert') {
                title.innerHTML = '<i class="ph ph-rocket-launch" style="margin-right: 6px; color: var(--accent);"></i>切换到自由模式？';
                body.innerHTML = `
                    <div style="margin-bottom: 14px;">自由模式适合<b>有经验的用户</b>，所有功能全解锁：</div>
                    <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px;">
                        <div style="display: flex; align-items: flex-start; gap: 8px;">
                            <i class="ph ph-lock-simple-open" style="color: var(--accent-success); font-size: 18px; margin-top: 2px; flex-shrink: 0;"></i>
                            <span>所有步骤<b>不再锁定</b>，可按任意顺序操作</span>
                        </div>
                        <div style="display: flex; align-items: flex-start; gap: 8px;">
                            <i class="ph ph-warning" style="color: var(--accent-warning); font-size: 18px; margin-top: 2px; flex-shrink: 0;"></i>
                            <span>不会阻止跳步操作，<b>可能导致错误</b>（如未切分就格式化）</span>
                        </div>
                        <div style="display: flex; align-items: flex-start; gap: 8px;">
                            <i class="ph ph-user-circle-gear" style="color: var(--text-muted); font-size: 18px; margin-top: 2px; flex-shrink: 0;"></i>
                            <span>适合已经熟悉训练流程的用户</span>
                        </div>
                    </div>
                `;
            } else {
                title.innerHTML = '<i class="ph ph-compass" style="margin-right: 6px; color: var(--accent);"></i>切换到引导模式？';
                body.innerHTML = `
                    <div style="margin-bottom: 14px;">引导模式适合<b>新手用户</b>，会为你保驾护航：</div>
                    <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px;">
                        <div style="display: flex; align-items: flex-start; gap: 8px;">
                            <i class="ph ph-lock-simple" style="color: var(--accent); font-size: 18px; margin-top: 2px; flex-shrink: 0;"></i>
                            <span>按顺序<b>逐步解锁</b>功能，避免跳步导致错误</span>
                        </div>
                        <div style="display: flex; align-items: flex-start; gap: 8px;">
                            <i class="ph ph-shield-check" style="color: var(--accent-success); font-size: 18px; margin-top: 2px; flex-shrink: 0;"></i>
                            <span>未完成前置步骤时，<b>会提示你先去完成</b></span>
                        </div>
                        <div style="display: flex; align-items: flex-start; gap: 8px;">
                            <i class="ph ph-graduation-cap" style="color: var(--text-muted); font-size: 18px; margin-top: 2px; flex-shrink: 0;"></i>
                            <span>适合第一次使用、不熟悉流程的用户</span>
                        </div>
                    </div>
                `;
            }

            confirmBtn.onclick = () => {
                closeModal('modalModeSwitch');
                applyPanelMode(mode);
            };

            openModal('modalModeSwitch');
        }

        function applyPanelMode(mode) {
            panelMode = mode;
            localStorage.setItem('panelMode', mode);
            // Update toggle UI
            document.querySelectorAll('.mode-switch-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.mode === mode);
            });
            // Refresh current page so it picks up the new mode
            refreshCurrentPage();
            showToast(mode === 'expert' ? '已切换到自由模式' : '已切换到引导模式', 'info');
        }

        function refreshCurrentPage() {
            const refreshMap = {
                slice: typeof updateSlicePage !== 'undefined' ? updateSlicePage : null,
                asr: typeof updateAsrPage !== 'undefined' ? updateAsrPage : null,
                annotate: typeof updateAnnotatePage !== 'undefined' ? updateAnnotatePage : null,
                format: typeof updateFormatPage !== 'undefined' ? updateFormatPage : null,
                train: typeof updateTrainPage !== 'undefined' ? updateTrainPage : null,
                infer: typeof updateInferPage !== 'undefined' ? updateInferPage : null,
                deploy: typeof updateDeployPage !== 'undefined' ? updateDeployPage : null,
            };
            const fn = refreshMap[currentPage];
            if (fn) fn();
        }

        // =====================================================
        //  API Helpers
        // =====================================================
        async function apiGet(url) {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`API Error: ${res.status}`);
            return res.json();
        }
        async function apiPost(url, body) {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || `API Error: ${res.status}`);
            }
            return res.json();
        }
        async function apiDelete(url) {
            const res = await fetch(url, { method: 'DELETE' });
            if (!res.ok) throw new Error(`API Error: ${res.status}`);
            return res.json();
        }

        // =====================================================
        //  Navigation
        // =====================================================
        function cleanupPollingTimers() {
            // Slice
            if (typeof slicePolling !== 'undefined' && slicePolling) { clearInterval(slicePolling); slicePolling = null; }
            // ASR
            if (typeof asrPolling !== 'undefined' && asrPolling) { clearInterval(asrPolling); asrPolling = null; }
            // Format
            if (typeof formatPolling !== 'undefined' && formatPolling) { clearInterval(formatPolling); formatPolling = null; }
            // Train
            if (typeof trainPolling !== 'undefined' && trainPolling) { clearInterval(trainPolling); trainPolling = null; }
            // Infer
            if (typeof inferEnginePolling !== 'undefined' && inferEnginePolling) { clearInterval(inferEnginePolling); inferEnginePolling = null; }
            // Deploy
            if (typeof deployEnvPolling !== 'undefined' && deployEnvPolling) { clearInterval(deployEnvPolling); deployEnvPolling = null; }
        }

        function navigateTo(page) {
            // Clean up any running polling timers from the previous page
            cleanupPollingTimers();

            currentPage = page;

            // Update sidebar
            document.querySelectorAll('.sidebar-item').forEach(el => {
                el.classList.toggle('active', el.dataset.page === page);
            });

            // Update step bar
            const stepPages = ['slice', 'asr', 'annotate', 'format', 'train', 'infer'];
            document.querySelectorAll('.step-item').forEach(el => {
                el.classList.toggle('step-active', el.dataset.page === page);
            });

            // Show/hide pages
            document.querySelectorAll('.page').forEach(el => {
                el.classList.remove('active');
            });
            const targetPage = document.getElementById(`page-${page}`);
            if (targetPage) {
                targetPage.classList.add('active');
                // Re-trigger animation
                targetPage.style.animation = 'none';
                targetPage.offsetHeight; // force reflow
                targetPage.style.animation = '';
            }

            // Update page content when navigating
            if (page === 'annotate') {
                updateAnnotatePage();
            }
            if (page === 'slice') {
                updateSlicePage();
            }
            if (page === 'asr') {
                updateAsrPage();
            }
            if (page === 'format') {
                updateFormatPage();
            }
            if (page === 'train') {
                updateTrainPage();
            }
            if (page === 'infer') {
                updateInferPage();
            }
            if (page === 'deploy') {
                updateDeployPage();
            }
        }

        // =====================================================
        //  Utilities
        // =====================================================
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        }

        function escapeAttr(text) {
            return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }


        // =====================================================
        //  Toast
        // =====================================================
        function showToast(message, type = 'success') {
            const container = document.getElementById('toastContainer');
            const icon = type === 'success' ? '<i class="ph ph-check-circle"></i>' : type === 'error' ? '<i class="ph ph-x-circle"></i>' : '<i class="ph ph-info"></i>';
            const toast = document.createElement('div');
            toast.className = `toast toast-${type}`;
            toast.innerHTML = `<span>${icon}</span> ${escapeHtml(message)}`;
            container.appendChild(toast);
            setTimeout(() => {
                toast.style.transition = 'opacity 0.3s';
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        // =====================================================
        //  Modal
        // =====================================================
        function openModal(id) {
            document.getElementById(id).classList.add('open');
            // Focus the first input
            setTimeout(() => {
                const input = document.querySelector(`#${id} .form-input`);
                if (input) input.focus();
            }, 100);
        }

        function closeModal(id) {
            document.getElementById(id).classList.remove('open');
        }

        // Close modal on overlay click
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.classList.remove('open');
                }
            });
        });

        // Close modal on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
            }
            // Enter to submit in new project modal (with debounce)
            if (e.key === 'Enter' && document.getElementById('modalNewProject').classList.contains('open')) {
                e.preventDefault();
                const btn = document.querySelector('#modalNewProject .btn-primary');
                if (btn && !btn.disabled) {
                    btn.disabled = true;
                    createProject().finally(() => { btn.disabled = false; });
                }
            }
        });
