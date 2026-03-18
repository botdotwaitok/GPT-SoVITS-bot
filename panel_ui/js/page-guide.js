        // =====================================================
        //  Guide Page — Accordion
        // =====================================================
        function toggleAccordion(headerEl) {
            const item = headerEl.closest('.guide-acc-item');
            item.classList.toggle('open');
        }
