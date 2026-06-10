/**
 * Stack View Module
 * Handles the 3D carousel visualization of layers
 */

function renderLayers() {
    const container = document.getElementById('stack-container');
    // Clear only the dynamic children (cards + cost banner), preserving the
    // breadcrumb / dots overlays which live permanently in the container.
    container.querySelectorAll('.layer-card, #stack-cost-banner').forEach(el => el.remove());
    // Suppress card transitions during initial placement so cards don't
    // animate from the origin pile (the ghost-artifact flash). selectLayer
    // clears this once positions are applied.
    container.classList.add('positioning');
    
    const layers = inSubstack && project.layers[selectedLayerIndex].substacks 
        ? project.layers[selectedLayerIndex].substacks 
        : project.layers;
    const currentIndex = inSubstack ? selectedSubstackIndex : selectedLayerIndex;
    
    // Add cost aggregation banner at top (only for main layer view)
    if (!inSubstack) {
        // Remove any existing banner
        const existingBanner = document.getElementById('stack-cost-banner');
        if (existingBanner) {
            existingBanner.remove();
        }
        
        const banner = document.createElement('div');
        banner.id = 'stack-cost-banner';
        
        const gradientStyle = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(35deg, rgba(15, 23, 42, 0) 0%, rgba(15, 23, 42, 0.3) 40%, rgba(15, 23, 42, 0.95) 70%, rgba(15, 23, 42, 0.95) 100%);
            border-bottom: 1px solid rgba(51, 65, 85, 0.5);
            padding: 12px 40px;
            text-align: right;
            font-size: 12px;
            color: #94a3b8;
            z-index: 50;
            backdrop-filter: blur(4px);
            pointer-events: auto;
        `;
        
        banner.style.cssText = gradientStyle;
        
        const bannerText = formatStackCostBanner();
        
        // Parse the banner text to extract total and remaining costs
        const totalMatch = bannerText.match(/Total:\s*(.+?)(?:\s*\|\||$)/);
        const totalAmount = totalMatch ? totalMatch[1].trim() : '';
        
        // Check if there's a variable section after ||
        const hasVariable = bannerText.includes('||');
        const remainingCosts = hasVariable ? bannerText.replace(/Total:\s*[^|]+\|\|\s*/, '') : '';
        
        // Create a wrapper for the "Total: ..." that has the tooltip
        const totalSpan = document.createElement('span');
        totalSpan.id = 'cost-total-label';
        totalSpan.style.cssText = `
            cursor: help;
            text-decoration: underline dotted;
            text-decoration-color: rgba(148, 163, 184, 0.5);
            position: relative;
            z-index: 51;
        `;
        totalSpan.innerHTML = `Total: ${totalAmount}`;
        
        // Add tooltip to total label
        const tooltipContent = buildStackCostTooltip();
        totalSpan.setAttribute('data-tooltip-content', tooltipContent);
        totalSpan.addEventListener('mouseenter', function() { showCostTooltip(this); });
        totalSpan.addEventListener('mouseleave', function() { hideCostTooltip(); });
        
        banner.appendChild(totalSpan);
        
        // Add separator and remaining cost items if there are any
        if (remainingCosts.trim()) {
            const separatorSpan = document.createElement('span');
            separatorSpan.textContent = ' || ';
            separatorSpan.style.position = 'relative';
            separatorSpan.style.zIndex = '51';
            banner.appendChild(separatorSpan);
            
            const costItemsSpan = document.createElement('span');
            costItemsSpan.innerHTML = remainingCosts;
            costItemsSpan.style.position = 'relative';
            costItemsSpan.style.zIndex = '51';
            banner.appendChild(costItemsSpan);
        }
        
        container.insertBefore(banner, container.firstChild);
        
        // Attach tooltips to individual cost buckets (after banner is in DOM)
        const aggregated = aggregateStackCosts(project.layers);
        const consolidated = consolidateVariableCosts(aggregated);
        
        // Filter to only variable costs with buckets
        const variableBuckets = consolidated.filter(c => c.type === 'variable' && c.isBucket);
        
        variableBuckets.forEach((comp, varIdx) => {
            // Build tooltip for this specific bucket
            let bucketTooltip = `<div style="font-weight: 500; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 8px;">${comp.unit.charAt(0).toUpperCase() + comp.unit.slice(1)} Costs:</div>`;
            
            // Sort contributors by amount descending
            const sortedContributors = [...comp.contributors].sort((a, b) => b.amount - a.amount);
            
            sortedContributors.forEach(contrib => {
                const currency = contrib.currency || 'USD';
                const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency;
                
                const layerName = contrib.source || 'Unknown';
                const unit = contrib.unit || '';
                bucketTooltip += `<div style="margin-bottom: 4px; color: #cbd5e1; font-size: 11px;">• ${layerName}: ${symbol}${formatCostAmount(contrib.amount)} ${unit}</div>`;
            });
            
            // Find the bucket span and attach tooltip using the variable-specific ID
            const bucketId = `cost-bucket-var-${varIdx}`;
            const bucketSpan = document.getElementById(bucketId);
            if (bucketSpan) {
                bucketSpan.setAttribute('data-tooltip-content', bucketTooltip);
                bucketSpan.style.cursor = 'help';
                bucketSpan.addEventListener('mouseenter', function(e) { 
                    e.stopPropagation();
                    showCostTooltip(this); 
                });
                bucketSpan.addEventListener('mouseleave', function() { hideCostTooltip(); });
            }
        });
    }    
    // Helper function to format cost display
    const formatCostBadge = (layer) => {
        // Get all cost components for this layer and its substacks
        const components = !inSubstack ? getLayerCostComponents(layer) : 
            (layer.costModel ? getLayerCostComponents({ costModel: layer.costModel, substacks: [] }) : []);
        
        if (components.length === 0) {
            return 'Free';
        }
        
        // Group costs by period to avoid clutter
        const groupedComponents = groupCostsByPeriod(components);
        
        // Format all components with pipe delimiter
        const costText = groupedComponents.map(comp => formatCostComponent(comp)).join(' | ');
        
        return costText;
    };

    // Build the coverflow cards. Each card is a real text-holding panel (the
    // diamond is a small accent gem, not the whole shape). selectLayer() sets
    // the per-card transform (vertical coverflow + infinite wrap).
    layers.forEach((layer, index) => {
        const accent = LAYER_TYPES[layer.type] || LAYER_TYPES['Other'] || '#6b7280';
        const card = document.createElement('div');
        card.className = 'layer-card';
        card.style.color = accent;          // currentColor drives gem + accents
        card.dataset.index = index;
        if (index === currentIndex) card.classList.add('selected');

        const subCount = (layer.substacks && layer.substacks.length) || 0;
        const future = (typeof isFutureStatus === 'function') && isFutureStatus(layer.status);
        const statusPill = (layer.status && layer.status !== 'Active')
            ? `<span class="layer-status-pill" style="${future ? 'background:rgba(245,158,11,0.18);color:#fbbf24;' : 'background:rgba(148,163,184,0.2);color:#94a3b8;'}">${escapeHtml(layer.status)}</span>`
            : '';
        const subPill = subCount
            ? `<span class="layer-sub-pill" data-enter-sub="1">↳ ${subCount} substack${subCount > 1 ? 's' : ''}</span>`
            : '';
        const techLine = layer.technology
            ? `<div class="layer-tech">${escapeHtml(layer.technology)}</div>` : '';
        const descLine = layer.description
            ? `<div class="layer-desc">${escapeHtml(layer.description)}</div>` : '';

        card.innerHTML = `
            <div class="layer-head">
                <div class="layer-gem"></div>
                <div class="layer-titles">
                    <div class="label-name">${escapeHtml(layer.name)}</div>
                    <div class="label-type">${escapeHtml(layer.type)}</div>
                </div>
            </div>
            ${techLine}
            <div class="label-meta">
                ${statusPill}
                <span class="cost-badge" id="cost-badge-${escapeHtml(String(layer.id))}"></span>
                ${subPill}
            </div>
            ${descLine}
        `;

        // Cost badge text (kept as innerHTML so multi-component costs line-break).
        const costBadge = card.querySelector('.cost-badge');
        if (costBadge) {
            const costText = formatCostBadge(layer);
            costBadge.innerHTML = costText.replace(/ \| /g, '<br>');
            if (costText === 'Free') { costBadge.style.background = 'rgba(148,163,184,0.16)'; costBadge.style.color = '#94a3b8'; }
        }

        // Click behavior: a non-selected card selects it; a selected card with
        // substacks descends; the substack pill always descends.
        card.addEventListener('click', (e) => {
            if (e.target.closest('[data-enter-sub]')) {
                e.stopPropagation();
                if (index !== currentIndex) selectLayer(index);
                enterSubstack();
                return;
            }
            if (index === currentIndex) {
                if (subCount) enterSubstack();
            } else {
                selectLayer(index);
            }
        });

        container.appendChild(card);
    });

    renderStackChrome();
}

/**
 * Render the Stack-view chrome that lives over the carousel:
 *  - breadcrumb (top-left) showing the depth path when inside substacks
 *  - position dots (right rail) reflecting the current lane, panel-aware via CSS
 * Both are permanent overlay nodes in #stack-container; we just repopulate them.
 */
function renderStackChrome() {
    const bc = document.getElementById('stack-breadcrumb');
    const dotsEl = document.getElementById('stack-dots');
    const layers = inSubstack && project.layers[selectedLayerIndex].substacks
        ? project.layers[selectedLayerIndex].substacks
        : project.layers;
    const currentIndex = inSubstack ? selectedSubstackIndex : selectedLayerIndex;

    // ---- breadcrumb (depth path) ----
    if (bc) {
        if (inSubstack && project.layers[selectedLayerIndex]) {
            const parent = project.layers[selectedLayerIndex];
            bc.innerHTML =
                `<span class="crumb crumb-link" id="crumb-root">Stack</span>` +
                `<span class="crumb-sep">›</span>` +
                `<span class="crumb crumb-current">${escapeHtml(parent.name)}</span>`;
            bc.classList.add('show');
            const root = document.getElementById('crumb-root');
            if (root) root.addEventListener('click', () => { if (typeof exitSubstack === 'function') exitSubstack(); });
        } else {
            bc.innerHTML = '';
            bc.classList.remove('show');
        }
    }

    // ---- position dots (right rail) ----
    if (dotsEl) {
        dotsEl.innerHTML = '';
        layers.forEach((layer, i) => {
            const dot = document.createElement('div');
            dot.className = 'stack-dot' + (i === currentIndex ? ' on' : '');
            dot.style.setProperty('--dot-accent', LAYER_TYPES[layer.type] || '#6b7280');
            dot.title = layer.name;
            dot.addEventListener('click', () => selectLayer(i));
            dotsEl.appendChild(dot);
        });
        // Hide the rail entirely if there's only one card.
        dotsEl.classList.toggle('show', layers.length > 1);
    }
}

/** Lightweight update of just the active dot (called by selectLayer on nav). */
function updateStackDots(index) {
    const dotsEl = document.getElementById('stack-dots');
    if (!dotsEl) return;
    dotsEl.querySelectorAll('.stack-dot').forEach((d, i) => d.classList.toggle('on', i === index));
}
