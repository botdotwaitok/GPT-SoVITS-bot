        // =====================================================
        //  Init
        // =====================================================
        loadProjects();

        // Init mode switcher UI from persisted state
        document.querySelectorAll('.mode-switch-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === panelMode);
        });
