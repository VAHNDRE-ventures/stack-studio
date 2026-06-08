/**
 * Stack View Module
 * Handles the 3D carousel visualization of layers
 */

function renderLayers() {
    const container = document.getElementById('stack-container');
    container.innerHTML = '';
    
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
                bucketTooltip += `<div style="margin-bottom: 4px; color: #cbd5e1; font-size: 11px;">• ${layerName}: ${symbol}${contrib.amount} ${unit}</div>`;
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
    
    // If in substack, render parent layer on the left
    if (inSubstack) {
        const parentLayer = project.layers[selectedLayerIndex];
        const parentCard = document.createElement('div');
        parentCard.className = 'layer-card parent-layer';
        parentCard.style.color = LAYER_TYPES[parentLayer.type];
        parentCard.style.transform = 'translateX(-300px) scale(0.8)';
        parentCard.style.opacity = '0.6';
        parentCard.style.zIndex = '1';
        
        const parentLabel = document.createElement('div');
        parentLabel.className = 'layer-label';
        parentLabel.style.left = '250px';
        parentLabel.style.opacity = '1';
        parentLabel.innerHTML = `
            <div class="label-name" style="font-size: 18px;">${escapeHtml(parentLayer.name)}</div>
            <div class="label-type" style="font-size: 11px;">Parent Layer</div>
        `;
        parentCard.appendChild(parentLabel);
        parentCard.addEventListener('click', exitSubstack);
        container.appendChild(parentCard);
    }
    
    layers.forEach((layer, index) => {
        const card = document.createElement('div');
        card.className = 'layer-card';
        card.style.color = LAYER_TYPES[layer.type];
        card.dataset.index = index;
        
        const zOffset = (layers.length - index - 1) * 20;
        card.style.zIndex = layers.length - index;
        
        if (index === currentIndex) {
            card.classList.add('selected');
        }
        
        const label = document.createElement('div');
        label.className = 'layer-label';
        if (index === currentIndex) {
            label.classList.add('selected');
        }
        
        // Determine if this layer is selected (used for hover effects)
        const isSelected = index === currentIndex;
        
        const hasSubstacks = !inSubstack && layer.substacks && layer.substacks.length > 0;
        const substackPreview = hasSubstacks ? `
            <span style="font-size: 12px; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px; cursor: ${isSelected ? 'pointer' : 'default'}; transition: background 0.2s; pointer-events: ${isSelected ? 'auto' : 'none'};" 
                  onmouseover="${isSelected ? "this.style.background='rgba(255,255,255,0.2)'" : ''}" 
                  onmouseout="${isSelected ? "this.style.background='rgba(255,255,255,0.1)'" : ''}"
                  onclick="event.stopPropagation(); enterSubstack();">(${layer.substacks.length})</span>
        ` : '';
        const safeName = escapeHtml(layer.name);
        const displayName = layer.name.length > 20 ? safeName : `<span style="white-space: nowrap;">${safeName}</span>`;
        label.innerHTML = `
            <div class="label-name" style="max-width: 300px; word-wrap: break-word; white-space: normal; line-height: 1.3;">${displayName}</div>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                <div class="label-type">${escapeHtml(layer.type)}</div>
                ${substackPreview}
            </div>
        `;
        
        card.appendChild(label);
        
        // Create cost badge as a separate element with pointer-events: auto
        const costBadge = document.createElement('span');
        costBadge.id = `cost-badge-${layer.id}`;
        
        // Only enable pointer-events and cursor for selected badge
        const pointerEvents = isSelected ? 'auto' : 'none';
        const cursor = isSelected ? 'help' : 'default';
        
        costBadge.style.cssText = `
            position: absolute;
            left: 250px;
            top: 85px;
            font-size: 11px;
            background: rgba(16, 185, 129, 0.2);
            color: #10b981;
            padding: 4px 6px;
            border-radius: 3px;
            pointer-events: ${pointerEvents};
            cursor: ${cursor};
            display: inline-block;
            line-height: 1.5;
            white-space: nowrap;
            opacity: ${isSelected ? '1' : '0'};
            transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        `;
        // Replace pipes with line breaks for clean display
        const costText = formatCostBadge(layer);
        costBadge.innerHTML = costText.replace(/ \| /g, '<br>');
        
        // Attach tooltip event listeners to cost badge ONLY if selected and has substacks
        if (!inSubstack && isSelected && layer.substacks && layer.substacks.length > 0) {
            const components = getLayerCostComponents(layer);
            if (components.length > 0) {
                const groupedComponents = groupCostsByPeriod(components);
                const totalCost = calculateTotalLayerCost(layer);
                
                // Apply color coding
                let bgColor = 'rgba(16, 185, 129, 0.2)'; // green
                let textColor = '#10b981';
                if (totalCost > 500) {
                    bgColor = 'rgba(239, 68, 68, 0.2)'; // red
                    textColor = '#ef4444';
                } else if (totalCost > 200) {
                    bgColor = 'rgba(245, 158, 11, 0.2)'; // yellow
                    textColor = '#f59e0b';
                }
                costBadge.style.background = bgColor;
                costBadge.style.color = textColor;
                
                // Build tooltip content - only line breaks between items
                let tooltipContent = '<div style="font-weight: 500; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 6px;">Cost Breakdown:</div>';
                
                // Layer's own costs
                if (layer.costModel && (layer.costModel.fixedCost > 0 || layer.costModel.variableCost > 0)) {
                    tooltipContent += `<div style="margin-bottom: 4px;"><strong>${escapeHtml(layer.name)}</strong>`;
                    if (layer.costModel.fixedCost > 0) {
                        const symbol = layer.costModel.currency === 'USD' ? '$' : layer.costModel.currency === 'EUR' ? '€' : layer.costModel.currency === 'GBP' ? '£' : layer.costModel.currency;
                        const period = layer.costModel.period === 'month' ? '/mo' : layer.costModel.period === 'year' ? '/yr' : `/${layer.costModel.period}`;
                        tooltipContent += `<div style="margin-left: 12px; color: #cbd5e1; font-size: 12px; white-space: nowrap;">Fixed: ${symbol}${layer.costModel.fixedCost}${period}</div>`;
                    }
                    if (layer.costModel.variableCost > 0) {
                        const symbol = layer.costModel.currency === 'USD' ? '$' : layer.costModel.currency === 'EUR' ? '€' : layer.costModel.currency === 'GBP' ? '£' : layer.costModel.currency;
                        tooltipContent += `<div style="margin-left: 12px; color: #cbd5e1; font-size: 12px; white-space: nowrap;">Variable: ${symbol}${layer.costModel.variableCost} ${layer.costModel.variableUnit}</div>`;
                    }
                    tooltipContent += '</div>';
                }
                
                // Substack costs
                layer.substacks.forEach(substack => {
                    if (substack.costModel && (substack.costModel.fixedCost > 0 || substack.costModel.variableCost > 0)) {
                        tooltipContent += `<div style="margin-bottom: 4px;"><strong style="color: #e2e8f0;">${escapeHtml(substack.name)}</strong>`;
                        if (substack.costModel.fixedCost > 0) {
                            const symbol = substack.costModel.currency === 'USD' ? '$' : substack.costModel.currency === 'EUR' ? '€' : substack.costModel.currency === 'GBP' ? '£' : substack.costModel.currency;
                            const period = substack.costModel.period === 'month' ? '/mo' : substack.costModel.period === 'year' ? '/yr' : `/${substack.costModel.period}`;
                            tooltipContent += `<div style="margin-left: 12px; color: #cbd5e1; font-size: 12px; white-space: nowrap;">Fixed: ${symbol}${substack.costModel.fixedCost}${period}</div>`;
                        }
                        if (substack.costModel.variableCost > 0) {
                            const symbol = substack.costModel.currency === 'USD' ? '$' : substack.costModel.currency === 'EUR' ? '€' : substack.costModel.currency === 'GBP' ? '£' : substack.costModel.currency;
                            tooltipContent += `<div style="margin-left: 12px; color: #cbd5e1; font-size: 12px; white-space: nowrap;">Variable: ${symbol}${substack.costModel.variableCost} ${substack.costModel.variableUnit}</div>`;
                        }
                        tooltipContent += '</div>';
                    }
                });
                
                costBadge.setAttribute('data-tooltip-content', tooltipContent);
                
                costBadge.addEventListener('mouseenter', function() { showCostTooltip(this); });
                costBadge.addEventListener('mouseleave', function() { hideCostTooltip(); });
            }
        }
        
        card.appendChild(costBadge);
        card.addEventListener('click', () => selectLayer(index));
        container.appendChild(card);
    });
}
