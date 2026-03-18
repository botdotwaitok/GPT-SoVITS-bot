        // =====================================================
        //  State
        // =====================================================
        let projects = [];
        let activeProject = null;
        let currentPage = 'projects';

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
