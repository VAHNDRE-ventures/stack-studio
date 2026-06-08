let project = null;
let selectedLayerIndex = 0;
let inSubstack = false;
let selectedSubstackIndex = 0;
let undoStack = [];
let redoStack = [];
let selectedActionId = null;  // Track selected action in Actions View
let actionsViewCollapsed = false;  // Track if Actions section is collapsed
let pathsViewCollapsed = false;  // Track if Paths section is collapsed
let currentView = 'stack';  // Track current view (stack, diagram, actions, cost-dashboard)
const MAX_HISTORY = 50;

function loadProject() {
    const saved = localStorage.getItem('ztack_project');
    project = saved ? JSON.parse(saved) : SAMPLE_PROJECT;
    document.getElementById('project-title').textContent = project.name;
    renderLayers();
    updateStats();
    selectLayer(0);
}

function saveProject() {
    localStorage.setItem('ztack_project', JSON.stringify(project));
}

// Debug helper function - call from console to log cost badge rendering
function debugCostBadges() {
    console.log('\n========== COST BADGE DEBUG ==========');
    project.layers.forEach((layer, idx) => {
        const components = getLayerCostComponents(layer);
        const totalCost = calculateTotalLayerCost(layer);
        console.log(`\nLayer ${idx}: ${layer.name}`);
        console.log(`  Total Cost: $${totalCost}`);
        console.log(`  Cost Components: ${components.length}`);
        components.forEach(comp => {
            console.log(`    - ${comp.type}: ${comp.currency}${comp.amount} ${comp.unit || comp.period}`);
        });
        
        if (layer.substacks && layer.substacks.length > 0) {
            console.log(`  Substacks: ${layer.substacks.length}`);
            layer.substacks.forEach((sub, subIdx) => {
                if (sub.costModel && (sub.costModel.fixedCost > 0 || sub.costModel.variableCost > 0)) {
                    console.log(`    [${subIdx}] ${sub.name}: $${sub.costModel.fixedCost}${sub.costModel.period === 'month' ? '/mo' : ''}`);
                }
            });
        }
    });
    console.log('========== END DEBUG ==========\n');
}

function saveState() {
    undoStack.push(JSON.stringify(project));
    if (undoStack.length > MAX_HISTORY) {
        undoStack.shift();
    }
    redoStack = [];
}

function undo() {
    if (undoStack.length === 0) return;
    
    redoStack.push(JSON.stringify(project));
    const previousState = undoStack.pop();
    project = JSON.parse(previousState);
    
    document.getElementById('project-title').textContent = project.name;
    saveProject();
    renderLayers();
    updateStats();
    if (selectedLayerIndex >= project.layers.length) {
        selectedLayerIndex = Math.max(0, project.layers.length - 1);
    }
    selectLayer(selectedLayerIndex);
    if (currentView === 'diagram') {
        renderDiagram();
    }
}

function redo() {
    if (redoStack.length === 0) return;
    
    undoStack.push(JSON.stringify(project));
    const nextState = redoStack.pop();
    project = JSON.parse(nextState);
    
    document.getElementById('project-title').textContent = project.name;
    saveProject();
    renderLayers();
    updateStats();
    if (selectedLayerIndex >= project.layers.length) {
        selectedLayerIndex = Math.max(0, project.layers.length - 1);
    }
    selectLayer(selectedLayerIndex);
    if (currentView === 'diagram') {
        renderDiagram();
    }
}

// Toggle details panel
function toggleDetailsPanel() {
    const panel = document.getElementById('details-panel');
    const toggle = document.getElementById('panel-toggle');
    panel.classList.toggle('collapsed');
    toggle.textContent = panel.classList.contains('collapsed') ? '▶' : '◀';
    toggle.style.right = panel.classList.contains('collapsed') ? '0' : '500px';
    
    // Resize canvas when panel toggles
    setTimeout(() => {
        if (currentView === 'diagram' && canvas) {
            resizeCanvas();
        }
    }, 300);
}

// Toggle between different views (stack, diagram, actions, cost-dashboard)
function toggleView(view) {
    currentView = view;

    // Keep the always-visible view switcher tabs in sync.
    document.querySelectorAll('.view-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.view === view);
    });

    // Hide all views
    document.getElementById('stack-view').style.display = 'none';
    document.getElementById('diagram-view').style.display = 'none';
    document.getElementById('actions-view').style.display = 'none';
    document.getElementById('cost-dashboard-view').style.display = 'none';
    
    // Show/hide details panel based on view
    const detailsPanel = document.getElementById('details-panel');
    const panelToggle = document.getElementById('panel-toggle');
    
    // Show selected view
    switch(view) {
        case 'stack':
            document.getElementById('stack-view').style.display = 'flex';
            detailsPanel.style.display = 'flex';
            panelToggle.style.display = 'flex';
            break;
        case 'diagram':
            document.getElementById('diagram-view').style.display = 'flex';
            detailsPanel.style.display = 'flex';
            panelToggle.style.display = 'flex';
            if (typeof initDiagramView === 'function') {
                initDiagramView();
            }
            break;
        case 'actions':
            document.getElementById('actions-view').style.display = 'flex';
            detailsPanel.style.display = 'flex';
            panelToggle.style.display = 'flex';
            renderActionsView();
            // Auto-select first action and show in details frame
            if (project.usePaths && project.usePaths.length > 0) {
                const firstAction = project.usePaths[0];
                selectedActionId = firstAction.id;
                renderActionAssemblyPanel(firstAction);
            }
            break;
        case 'cost-dashboard':
            document.getElementById('cost-dashboard-view').style.display = 'flex';
            detailsPanel.style.display = 'none';
            panelToggle.style.display = 'none';
            renderCostDashboard();
            break;
    }
}

function calculateTotalLayerCost(layer) {
    // Calculate total cost including substacks
    let totalCost = layer.costModel?.fixedCost || 0;
    
    // Add costs from all substacks
    if (layer.substacks && layer.substacks.length > 0) {
        layer.substacks.forEach(substack => {
            totalCost += substack.costModel?.fixedCost || 0;
        });
    }
    
    return totalCost;
}

function getLayerCostComponents(layer) {
    // Collect all cost components (layer + substacks) with their periods
    const components = [];
    
    // Add layer's own costs
    if (layer.costModel) {
        if (layer.costModel.fixedCost > 0) {
            components.push({
                amount: layer.costModel.fixedCost,
                period: layer.costModel.period,
                currency: layer.costModel.currency,
                type: 'fixed',
                source: layer.name
            });
        }
        if (layer.costModel.variableCost > 0) {
            components.push({
                amount: layer.costModel.variableCost,
                period: layer.costModel.period,
                currency: layer.costModel.currency,
                unit: layer.costModel.variableUnit,
                type: 'variable',
                source: layer.name
            });
        }
    }
    
    // Add substack costs
    if (layer.substacks && layer.substacks.length > 0) {
        layer.substacks.forEach(substack => {
            if (substack.costModel) {
                if (substack.costModel.fixedCost > 0) {
                    components.push({
                        amount: substack.costModel.fixedCost,
                        period: substack.costModel.period,
                        currency: substack.costModel.currency,
                        type: 'fixed',
                        source: substack.name
                    });
                }
                if (substack.costModel.variableCost > 0) {
                    components.push({
                        amount: substack.costModel.variableCost,
                        period: substack.costModel.period,
                        currency: substack.costModel.currency,
                        unit: substack.costModel.variableUnit,
                        type: 'variable',
                        source: substack.name
                    });
                }
            }
        });
    }
    
    return components;
}

function groupCostsByPeriod(components) {
    // Group costs by period and type, aggregating amounts
    const grouped = {};
    
    components.forEach(comp => {
        // Create key from period and type (variable costs also include unit)
        const key = comp.type === 'variable' && comp.unit 
            ? `${comp.period}|${comp.type}|${comp.unit}`
            : `${comp.period}|${comp.type}`;
        
        if (!grouped[key]) {
            grouped[key] = {
                amount: 0,
                period: comp.period,
                currency: comp.currency,
                type: comp.type,
                unit: comp.unit
            };
        }
        
        grouped[key].amount += comp.amount;
    });
    
    // Convert to array and sort by period (fixed first, then by period name)
    return Object.values(grouped).sort((a, b) => {
        if (a.type !== b.type) return a.type === 'fixed' ? -1 : 1;
        return a.period.localeCompare(b.period);
    });
}

function formatCostComponent(component) {
    const currency = component.currency || 'USD';
    const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency;
    
    let periodLabel = '';
    if (component.period === 'month') periodLabel = '/mo';
    else if (component.period === 'year') periodLabel = '/yr';
    else if (component.period === 'per-request') periodLabel = '/req';
    else if (component.period === 'per-gb') periodLabel = '/GB';
    else if (component.period === 'per-hour') periodLabel = '/hr';
    else periodLabel = `/${component.period}`;
    
    if (component.type === 'variable' && component.unit) {
        return `${symbol}${component.amount} ${component.unit}`;
    }
    
    return `${symbol}${component.amount}${periodLabel}`;
}

function aggregateStackCosts(layers) {
    // Aggregate all costs from all layers and substacks
    const allComponents = [];
    
    layers.forEach(layer => {
        const components = getLayerCostComponents(layer);
        allComponents.push(...components);
    });
    
    // Group by period and variable unit (combine similar variable costs)
    const grouped = {};
    
    allComponents.forEach(comp => {
        // For variable costs, group by unit; for fixed, group by period
        const key = comp.type === 'variable' && comp.unit 
            ? `${comp.type}|${comp.unit}`
            : `${comp.period}|${comp.type}`;
        
        if (!grouped[key]) {
            grouped[key] = {
                amount: 0,
                period: comp.period,
                currency: comp.currency,
                type: comp.type,
                unit: comp.unit,
                contributors: []
            };
        }
        
        grouped[key].amount += comp.amount;
        grouped[key].contributors.push(comp);
    });
    
    // Convert to array and sort
    return Object.values(grouped).sort((a, b) => {
        if (a.type !== b.type) return a.type === 'fixed' ? -1 : 1;
        return a.period.localeCompare(b.period);
    });
}

function consolidateVariableCosts(aggregated) {
    // Consolidate variable costs into semantic buckets
    const fixed = aggregated.filter(a => a.type === 'fixed');
    const variable = aggregated.filter(a => a.type === 'variable');
    
    // Group variable costs by semantic category
    const buckets = {
        'requests': [],
        'storage': [],
        'data': [],
        'compute': [],
        'other': []
    };
    
    variable.forEach(v => {
        const unit = (v.unit || '').toLowerCase();
        
        if (unit.includes('request') || unit.includes('call') || unit.includes('api')) {
            buckets.requests.push(v);
        } else if (unit.includes('gb') || unit.includes('storage') || unit.includes('disk')) {
            buckets.storage.push(v);
        } else if (unit.includes('log') || unit.includes('indexed') || unit.includes('scan')) {
            buckets.data.push(v);
        } else if (unit.includes('cpu') || unit.includes('memory') || unit.includes('hour') || unit.includes('compute')) {
            buckets.compute.push(v);
        } else {
            buckets.other.push(v);
        }
    });
    
    // Build consolidated result
    const consolidated = [...fixed];
    
    // Add consolidated variable buckets
    Object.entries(buckets).forEach(([category, items]) => {
        if (items.length > 0) {
            // Sum amounts for this bucket and flatten all contributors
            const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
            
            // Flatten contributors from all items in this bucket
            const allContributors = [];
            items.forEach(item => {
                if (item.contributors && Array.isArray(item.contributors)) {
                    allContributors.push(...item.contributors);
                }
            });
            
            consolidated.push({
                amount: totalAmount,
                period: null,
                currency: items[0].currency,
                type: 'variable',
                unit: category,
                isBucket: true,
                contributors: allContributors
            });
        }
    });
    
    return consolidated;
}

function formatStackCostBanner() {
    // Format the aggregated costs for display in banner, separating fixed and variable
    const aggregated = aggregateStackCosts(project.layers);
    const consolidated = consolidateVariableCosts(aggregated);
    
    if (consolidated.length === 0) {
        return 'Total: Free';
    }
    
    // Separate fixed and variable costs
    const fixedCosts = consolidated.filter(c => c.type === 'fixed');
    const variableCosts = consolidated.filter(c => c.type === 'variable');
    
    let bannerText = 'Total: ';
    
    // Format fixed costs
    if (fixedCosts.length > 0) {
        const fixedFormatted = fixedCosts.map((comp, idx) => {
            const currency = comp.currency || 'USD';
            const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency;
            
            let periodLabel = '';
            if (comp.period === 'month') periodLabel = '/mo';
            else if (comp.period === 'year') periodLabel = '/yr';
            else if (comp.period) periodLabel = `/${comp.period}`;
            
            return `${symbol}${comp.amount}${periodLabel}`;
        }).join(' + ');
        
        bannerText += `<strong>Fixed:</strong> ${fixedFormatted}`;
    }
    
    // Format variable costs
    if (variableCosts.length > 0) {
        const variableFormatted = variableCosts.map((comp, idx) => {
            const currency = comp.currency || 'USD';
            const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency;
            
            if (comp.unit) {
                // Format bucket name nicely
                const bucketName = comp.unit.charAt(0).toUpperCase() + comp.unit.slice(1);
                const bucketId = `cost-bucket-var-${idx}`;
                // Use variable-specific index for bucket ID
                return `<span id="${bucketId}" style="cursor: help; text-decoration: underline dotted; text-decoration-color: rgba(148, 163, 184, 0.5);">${symbol}${comp.amount} ${bucketName}</span>`;
            }
            
            return `${symbol}${comp.amount}`;
        }).join(' + ');
        
        if (fixedCosts.length > 0) {
            bannerText += ` || <strong>Variable:</strong> ${variableFormatted}`;
        } else {
            bannerText += `<strong>Variable:</strong> ${variableFormatted}`;
        }
    }
    
    return bannerText;
}

function buildStackCostTooltip() {
    // Build detailed tooltip showing cost breakdown grouped by layer with substacks
    if (project.layers.length === 0) {
        return '<div style="font-weight: 500;">No costs configured</div>';
    }
    
    let tooltip = '<div style="font-weight: 500; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 8px;">Stack Cost Breakdown:</div>';
    
    // Build layer breakdown with substacks
    const layerBreakdown = [];
    
    project.layers.forEach(layer => {
        const layerTotal = calculateTotalLayerCost(layer);
        const layerEntry = {
            name: layer.name,
            total: layerTotal,
            substacks: []
        };
        
        // Add substack costs
        if (layer.substacks && layer.substacks.length > 0) {
            layer.substacks.forEach(substack => {
                const substackCost = substack.costModel?.fixedCost || 0;
                if (substackCost > 0) {
                    layerEntry.substacks.push({
                        name: substack.name,
                        cost: substackCost
                    });
                }
            });
            
            // Sort substacks by cost descending
            layerEntry.substacks.sort((a, b) => b.cost - a.cost);
        }
        
        if (layerTotal > 0) {
            layerBreakdown.push(layerEntry);
        }
    });
    
    // Sort layers by total cost descending
    layerBreakdown.sort((a, b) => b.total - a.total);
    
    // Calculate total lines needed
    const linesPerColumn = 20;
    let totalLines = 0;
    layerBreakdown.forEach(layer => {
        totalLines += 1 + layer.substacks.length; // 1 for header + substacks
    });
    
    // Calculate optimal number of columns
    let numColumns = Math.ceil(totalLines / linesPerColumn);
    
    // Distribute layers evenly across columns
    const columns = Array.from({ length: numColumns }, () => []);
    let columnLineCount = Array(numColumns).fill(0);
    
    layerBreakdown.forEach(layer => {
        const layerLines = 1 + layer.substacks.length;
        
        // Find the column with the least lines
        let minColumn = 0;
        let minLines = columnLineCount[0];
        
        for (let i = 1; i < numColumns; i++) {
            if (columnLineCount[i] < minLines) {
                minLines = columnLineCount[i];
                minColumn = i;
            }
        }
        
        // Add layer to the column with least lines
        columns[minColumn].push(layer);
        columnLineCount[minColumn] += layerLines;
    });
    
    // Build HTML for columns
    tooltip += '<div style="display: flex; gap: 24px;">';
    
    columns.forEach(column => {
        tooltip += '<div style="flex: 0 0 auto;">';
        
        column.forEach((layer, layerIdx) => {
            const symbol = '$';
            const marginTop = layerIdx > 0 ? '8px' : '0';
            tooltip += `<div style="color: #e2e8f0; font-weight: 500; font-size: 11px; margin-bottom: 4px; margin-top: ${marginTop};">${layer.name} - ${symbol}${layer.total}/mo</div>`;
            
            // Add substacks
            layer.substacks.forEach(substack => {
                tooltip += `<div style="color: #cbd5e1; font-size: 11px; margin-bottom: 2px; white-space: nowrap; margin-left: 12px;">- ${substack.name}: ${symbol}${substack.cost}/mo</div>`;
            });
        });
        
        tooltip += '</div>';
    });
    
    tooltip += '</div>';
    
    return tooltip;
}


function selectLayer(index, skipDetailsUpdate = false) {
    const layers = inSubstack && project.layers[selectedLayerIndex].substacks 
        ? project.layers[selectedLayerIndex].substacks 
        : project.layers;
    
    if (layers.length === 0) return;
    
    if (index < 0) {
        index = layers.length - 1;
    } else if (index >= layers.length) {
        index = 0;
    }
    
    if (inSubstack) {
        selectedSubstackIndex = index;
    } else {
        selectedLayerIndex = index;
    }
    
    if (inSubstack) {
        // Vertical stack layout for substacks
        const CARD_SPACING = 60;
        document.querySelectorAll('.layer-card:not(.parent-layer)').forEach((card, i) => {
            card.classList.toggle('selected', i === index);
            const label = card.querySelector('.layer-label');
            if (label) {
                label.classList.toggle('selected', i === index);
            }
            
            // Toggle badge opacity to match label fade
            const badge = card.querySelector('[id^="cost-badge-"]');
            if (badge) {
                badge.style.opacity = i === index ? '1' : '0';
            }
            
            const yOffset = (i - index) * CARD_SPACING;
            const zOffset = (layers.length - i - 1) * 20;
            
            if (i !== index) {
                card.style.transform = `translateZ(${zOffset}px) translateY(${yOffset}px) translateX(150px)`;
            } else {
                card.style.transform = `translateZ(${zOffset}px) translateY(${yOffset}px) translateX(150px) scale(1.5)`;
            }
        });
    } else {
        // Circular carousel for main stack
        const containerHeight = document.getElementById('stack-container').clientHeight;
        const radius = containerHeight * 0.4;
        
        document.querySelectorAll('.layer-card').forEach((card, i) => {
            card.classList.toggle('selected', i === index);
            const label = card.querySelector('.layer-label');
            if (label) {
                label.classList.toggle('selected', i === index);
            }
            
            // Toggle badge opacity to match label fade
            const badge = card.querySelector('[id^="cost-badge-"]');
            if (badge) {
                badge.style.opacity = i === index ? '1' : '0';
            }
            
            const anglePerCard = (Math.PI * 2) / layers.length;
            const angle = (i - index) * anglePerCard;
            
            const x = Math.cos(angle) * radius - radius * 0.7;
            const y = Math.sin(angle) * radius;
            const zOffset = (layers.length - i - 1) * 20;
            
            if (i !== index) {
                card.style.transform = `translateZ(${zOffset}px) translateX(${x}px) translateY(${y}px)`;
            } else {
                card.style.transform = `translateZ(${zOffset}px) translateX(${x}px) translateY(${y}px) scale(1.5)`;
            }
        });
    }
    
    if (!skipDetailsUpdate) {
        const currentLayer = inSubstack 
            ? project.layers[selectedLayerIndex].substacks[selectedSubstackIndex]
            : project.layers[selectedLayerIndex];
        renderLayerDetails(currentLayer);
    }
}

function enterSubstack() {
    if (!project.layers[selectedLayerIndex].substacks || 
        project.layers[selectedLayerIndex].substacks.length === 0) {
        return;
    }
    inSubstack = true;
    selectedSubstackIndex = 0;
    renderLayers();
    selectLayer(0);
}

function exitSubstack() {
    if (!inSubstack) return;
    inSubstack = false;
    renderLayers();
    selectLayer(selectedLayerIndex);
}


function getAllLayers() {
    const layers = [];
    project.layers.forEach(layer => {
        layers.push(layer);
        if (layer.substacks) {
            layer.substacks.forEach(sub => layers.push(sub));
        }
    });
    return layers;
}

// Generate intelligent, semantic names for flows based on layers involved
function generateFlowName(path) {
    if (!path.layersInvolved || path.layersInvolved.length === 0) {
        return 'Unknown Flow';
    }
    
    const layers = path.layersInvolved.map(id => {
        const layer = getAllLayers().find(l => l.id === id);
        return layer ? { id, name: layer.name, type: layer.type } : null;
    }).filter(l => l !== null);
    
    if (layers.length === 0) return 'Unknown Flow';
    
    // Single layer - just the layer name
    if (layers.length === 1) {
        return layers[0].name;
    }
    
    // Infer function from layer sequence
    const layerTypes = layers.map(l => l.type);
    const layerNames = layers.map(l => l.name);
    
    // Pattern: Frontend → API → Backend → Database
    if (layerTypes[0] === 'Frontend' && layerTypes[layerTypes.length - 1] === 'Database') {
        const backendService = layers.find(l => l.type === 'Backend');
        if (backendService) {
            return `${layerNames[0]} → ${backendService.name}`;
        }
    }
    
    // Pattern: Frontend → API → Backend (no database)
    if (layerTypes[0] === 'Frontend' && layerTypes[layerTypes.length - 1] === 'Backend') {
        return `${layerNames[0]} → ${layerNames[layerNames.length - 1]}`;
    }
    
    // Pattern: Frontend → API → Notification
    if (layerNames[layerNames.length - 1].includes('Notification')) {
        return `${layerNames[0]} Notifications`;
    }
    
    // Pattern: Frontend → API → Payment
    if (layerNames[layerNames.length - 1].includes('Payment')) {
        return `${layerNames[0]} Checkout`;
    }
    
    // Pattern: Frontend → API → User
    if (layerNames[layerNames.length - 1].includes('User')) {
        return `${layerNames[0]} Auth`;
    }
    
    // Pattern: Frontend → API → Product
    if (layerNames[layerNames.length - 1].includes('Product')) {
        return `${layerNames[0]} Catalog`;
    }
    
    // Pattern: Backend → Database
    if (layerTypes[0] === 'Backend' && layerTypes[layerTypes.length - 1] === 'Database') {
        return `${layerNames[0]} Storage`;
    }
    
    // Pattern: Backend → Message Queue
    if (layerNames[layerNames.length - 1].includes('Message') || layerNames[layerNames.length - 1].includes('Queue')) {
        return `${layerNames[0]} Events`;
    }
    
    // Pattern: Service → Service → Database
    if (layerTypes[layerTypes.length - 1] === 'Database') {
        const service = layers[layers.length - 2];
        return `${service.name} Data`;
    }
    
    // Pattern: Service → Service → Message Queue
    if (layerNames[layerNames.length - 1].includes('Message') || layerNames[layerNames.length - 1].includes('Queue')) {
        const service = layers[layers.length - 2];
        return `${service.name} Async`;
    }
    
    // Fallback: use first and last layer
    return `${layerNames[0]} → ${layerNames[layerNames.length - 1]}`;
}

// Generate intelligent description based on flow function
function generateFlowDescription(path) {
    if (!path.layersInvolved || path.layersInvolved.length === 0) {
        return '';
    }
    
    const layers = path.layersInvolved.map(id => {
        const layer = getAllLayers().find(l => l.id === id);
        return layer ? { id, name: layer.name, type: layer.type } : null;
    }).filter(l => l !== null);
    
    if (layers.length === 0) return '';
    
    const layerNames = layers.map(l => l.name);
    const layerTypes = layers.map(l => l.type);
    
    // Infer description from pattern
    if (layerNames[layerNames.length - 1].includes('Notification')) {
        return 'Send notifications to users';
    }
    if (layerNames[layerNames.length - 1].includes('Payment')) {
        return 'Process payments and transactions';
    }
    if (layerNames[layerNames.length - 1].includes('User')) {
        return 'Manage user authentication and profiles';
    }
    if (layerNames[layerNames.length - 1].includes('Product')) {
        return 'Browse and search products';
    }
    if (layerTypes[layerTypes.length - 1] === 'Database') {
        return `Store and retrieve ${layerNames[layerNames.length - 1].toLowerCase()}`;
    }
    if (layerNames[layerNames.length - 1].includes('Message') || layerNames[layerNames.length - 1].includes('Queue')) {
        return 'Asynchronous event processing';
    }
    
    return '';
}

function getAvailableConnectionTargets(layer) {
    const targets = [];
    
    if (inSubstack) {
        // When editing a substack, show:
        // 1. All main layers (except parent)
        // 2. Substacks from other parents
        // 3. Sibling substacks
        const parentLayer = project.layers[selectedLayerIndex];
        
        project.layers.forEach(mainLayer => {
            if (mainLayer.id !== parentLayer.id) {
                targets.push({
                    id: mainLayer.id,
                    name: mainLayer.name,
                    type: mainLayer.type,
                    isSubstack: false
                });
            }
            
            // Add substacks from other parents
            if (mainLayer.substacks && mainLayer.substacks.length > 0) {
                mainLayer.substacks.forEach(sub => {
                    if (sub.id !== layer.id) { // Don't connect to self
                        targets.push({
                            id: sub.id,
                            name: `${sub.name} (${mainLayer.name})`,
                            type: sub.type,
                            isSubstack: true
                        });
                    }
                });
            }
        });
        
        // Add sibling substacks
        if (parentLayer.substacks) {
            parentLayer.substacks.forEach(sub => {
                if (sub.id !== layer.id) {
                    targets.push({
                        id: sub.id,
                        name: `${sub.name} (sibling)`,
                        type: sub.type,
                        isSubstack: true
                    });
                }
            });
        }
    } else {
        // When editing a main layer, show all other main layers
        project.layers.forEach(mainLayer => {
            if (mainLayer.id !== layer.id) {
                targets.push({
                    id: mainLayer.id,
                    name: mainLayer.name,
                    type: mainLayer.type,
                    isSubstack: false
                });
            }
        });
    }
    
    return targets;
}

function filterConnections(searchInputId, layerId) {
    const searchInput = document.getElementById(searchInputId);
    const searchTerm = searchInput.value.toLowerCase();
    const connectionItems = document.querySelectorAll('.connection-item');
    
    connectionItems.forEach(item => {
        const searchText = item.getAttribute('data-search');
        if (searchText.includes(searchTerm)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function switchDetailTab(tabName) {
    // If the requested tab doesn't exist in the current context (e.g.
    // "substacks" while editing a substack), fall back to properties.
    if (!document.querySelector(`.detail-tab[data-tab="${tabName}"]`)) {
        tabName = 'properties';
    }

    // Hide all tabs
    document.querySelectorAll('.detail-tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Remove active class from all tab buttons
    document.querySelectorAll('.detail-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab
    const selectedTab = document.querySelector(`.detail-tab-content[data-tab="${tabName}"]`);
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
    
    // Add active class to clicked button
    const selectedBtn = document.querySelector(`.detail-tab[data-tab="${tabName}"]`);
    if (selectedBtn) {
        selectedBtn.classList.add('active');
    }
}

function toggleConnection(targetId, isConnected, connectionType = 'HTTP') {
    const currentLayer = inSubstack 
        ? project.layers[selectedLayerIndex].substacks[selectedSubstackIndex]
        : project.layers[selectedLayerIndex];
    
    // Ensure targetId is a number if it's a main layer, or string if it's a substack
    const allLayers = getAllLayers();
    const targetLayer = allLayers.find(l => l.id == targetId);
    if (targetLayer) {
        targetId = targetLayer.id; // Use the actual ID type from the layer
    }
    
    if (!currentLayer.connections) {
        currentLayer.connections = [];
    }
    
    // Normalize connections to object format
    currentLayer.connections = currentLayer.connections.map(c => 
        typeof c === 'object' ? c : { targetId: c, type: 'HTTP' }
    );
    
    saveState();
    
    if (isConnected) {
        // Check if connection already exists (compare with proper type)
        const existingConnection = currentLayer.connections.find(c => c.targetId == targetId);
        if (!existingConnection) {
            currentLayer.connections.push({ targetId, type: connectionType });
        }
    } else {
        currentLayer.connections = currentLayer.connections.filter(c => c.targetId != targetId);
    }
    
    saveProject();
    
    // Enable/disable the type dropdown
    const typeSelect = document.getElementById(`type-${targetId}`);
    if (typeSelect) {
        typeSelect.disabled = !isConnected;
    }
    
    if (currentView === 'diagram') {
        renderDiagram();
    }
}

function updateConnectionType(targetId, newType) {
    const currentLayer = inSubstack 
        ? project.layers[selectedLayerIndex].substacks[selectedSubstackIndex]
        : project.layers[selectedLayerIndex];
    
    // Ensure targetId is a number if it's a main layer, or string if it's a substack
    const allLayers = getAllLayers();
    const targetLayer = allLayers.find(l => l.id == targetId);
    if (targetLayer) {
        targetId = targetLayer.id; // Use the actual ID type from the layer
    }
    
    if (!currentLayer.connections) {
        return;
    }
    
    // Normalize connections to object format
    currentLayer.connections = currentLayer.connections.map(c => 
        typeof c === 'object' ? c : { targetId: c, type: 'HTTP' }
    );
    
    saveState();
    
    const connectionIndex = currentLayer.connections.findIndex(c => c.targetId == targetId);
    
    if (connectionIndex !== -1) {
        currentLayer.connections[connectionIndex].type = newType;
    }
    
    saveProject();
    
    // Re-render diagram to reflect changes
    if (currentView === 'diagram') {
        renderDiagram();
    }
    
    // Update the type selector to reflect the change without re-rendering entire panel
    const typeSelect = document.getElementById(`type-${targetId}`);
    if (typeSelect) {
        typeSelect.value = newType;
    }
}

function addSubstackLayer() {
    const parentLayer = project.layers[selectedLayerIndex];
    if (!parentLayer.substacks) {
        parentLayer.substacks = [];
    }
    
    saveState();
    
    const substackIndex = parentLayer.substacks.length + 1;
    const newSubstack = {
        id: `${parentLayer.id}_${substackIndex}`,
        name: 'New Substack',
        type: parentLayer.type,
        status: 'Active',
        description: '',
        technology: '',
        responsibilities: '',
        connections: [],
        dependencies: [],
        visible: true,
        locked: false
    };
    
    parentLayer.substacks.push(newSubstack);
    saveProject();
    renderLayerDetails(parentLayer);
    renderLayers();
    // New substack needs a layout slot; ensureNodePositions places it lazily,
    // but a relayout keeps it grouped under its parent.
    if (currentView === 'diagram') {
        refreshDiagramLayout();
    }
}

function updateLayerField(field, value) {
    saveState();
    
    const currentLayer = inSubstack 
        ? project.layers[selectedLayerIndex].substacks[selectedSubstackIndex]
        : project.layers[selectedLayerIndex];
    currentLayer[field] = value;
    saveProject();

    // Fields that change how the layer is labeled elsewhere need the stack
    // cards / diagram refreshed; plain text fields (description, etc.) don't.
    const affectsOtherViews = field === 'name' || field === 'type' || field === 'status';
    if (affectsOtherViews) {
        renderLayers();
        const currentIndex = inSubstack ? selectedSubstackIndex : selectedLayerIndex;
        // skipDetailsUpdate: the details panel already shows the edited value;
        // rebuilding it would discard the user's open tab / scroll position.
        selectLayer(currentIndex, true);
        updateStats();
        if (currentView === 'diagram') {
            renderDiagram();
        }
    }
}

function updateCostField(field, value) {
    saveState();
    
    const currentLayer = inSubstack 
        ? project.layers[selectedLayerIndex].substacks[selectedSubstackIndex]
        : project.layers[selectedLayerIndex];
    
    // Initialize costModel if it doesn't exist
    if (!currentLayer.costModel) {
        currentLayer.costModel = JSON.parse(JSON.stringify(DEFAULT_COST_MODEL));
    }
    
    currentLayer.costModel[field] = value;
    saveProject();
    
    // Update cost badge in stack view without re-rendering entire details panel
    const currentIndex = inSubstack ? selectedSubstackIndex : selectedLayerIndex;
    const layers = inSubstack && project.layers[selectedLayerIndex].substacks 
        ? project.layers[selectedLayerIndex].substacks 
        : project.layers;
    
    // Update the cost badge text for the current layer
    const costBadgeId = `cost-badge-${currentLayer.id}`;
    const costBadge = document.getElementById(costBadgeId);
    if (costBadge) {
        // Recalculate cost display
        const components = !inSubstack ? getLayerCostComponents(currentLayer) : 
            (currentLayer.costModel ? getLayerCostComponents({ costModel: currentLayer.costModel, substacks: [] }) : []);
        
        if (components.length === 0) {
            costBadge.textContent = 'Free';
        } else {
            const groupedComponents = groupCostsByPeriod(components);
            const costText = groupedComponents.map(comp => formatCostComponent(comp)).join(' | ');
            // Replace pipes with line breaks for clean display
            costBadge.innerHTML = costText.replace(/ \| /g, '<br>');
        }
        
        // Update color coding
        const totalCost = calculateTotalLayerCost(currentLayer);
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
    }
    
    updateStats();
    if (currentView === 'diagram') {
        renderDiagram();
    }
}

function moveLayer(direction) {
    const layers = inSubstack && project.layers[selectedLayerIndex].substacks 
        ? project.layers[selectedLayerIndex].substacks 
        : project.layers;
    const currentIndex = inSubstack ? selectedSubstackIndex : selectedLayerIndex;
    const newIndex = currentIndex + direction;
    if (newIndex < 0 || newIndex >= layers.length) return;
    
    saveState();
    
    [layers[currentIndex], layers[newIndex]] = 
    [layers[newIndex], layers[currentIndex]];
    
    saveProject();
    renderLayers();
    selectLayer(newIndex);
}

function deleteLayer() {
    const layers = inSubstack && project.layers[selectedLayerIndex].substacks 
        ? project.layers[selectedLayerIndex].substacks 
        : project.layers;
    const currentIndex = inSubstack ? selectedSubstackIndex : selectedLayerIndex;
    
    // Only prevent deletion if it's a main layer and it's the last one
    if (!inSubstack && layers.length === 1) {
        alert('Cannot delete the last layer');
        return;
    }
    
    const itemType = inSubstack ? 'substack component' : 'layer';
    if (!confirm(`Delete this ${itemType}?`)) {
        return;
    }
    
    saveState();
    
    layers.splice(currentIndex, 1);
    saveProject();
    renderLayers();
    
    if (layers.length > 0) {
        selectLayer(Math.max(0, currentIndex - 1));
    } else if (inSubstack) {
        // If all substacks deleted, exit to parent
        exitSubstack();
    }
    
    updateStats();
    if (currentView === 'diagram') {
        renderDiagram();
    }
}

function updateStats() {
    document.getElementById('total-layers').textContent = project.layers.length;
    document.getElementById('active-layers').textContent = 
        project.layers.filter(l => l.status === 'Active').length;
    document.getElementById('inactive-layers').textContent = 
        project.layers.filter(l => l.status === 'Inactive' || l.status === 'Deprecated').length;
}

function showCostTooltip(element) {
    // Remove any existing tooltip
    hideCostTooltip();
    
    const tooltipContent = element.getAttribute('data-tooltip-content');
    if (!tooltipContent) {
        console.log('[COST TOOLTIP] No tooltip content found');
        return;
    }
    
    console.log('[COST TOOLTIP] Creating tooltip element');
    
    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.id = 'cost-tooltip';
    tooltip.innerHTML = tooltipContent;
    tooltip.style.cssText = `
        position: fixed;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 6px;
        padding: 12px 16px;
        font-size: 12px;
        color: #e2e8f0;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        max-width: 90vw;
        max-height: 80vh;
        overflow: auto;
        pointer-events: none;
        white-space: nowrap;
    `;
    
    document.body.appendChild(tooltip);
    console.log('[COST TOOLTIP] Tooltip element added to DOM');
    
    // Position tooltip near the element, accounting for viewport
    const rect = element.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tooltip.offsetWidth / 2;
    let top = rect.bottom + 8;
    
    // Adjust if tooltip goes off-screen
    if (left + tooltip.offsetWidth > window.innerWidth) {
        left = window.innerWidth - tooltip.offsetWidth - 8;
    }
    if (left < 0) {
        left = 8;
    }
    if (top + tooltip.offsetHeight > window.innerHeight) {
        top = rect.top - tooltip.offsetHeight - 8;
    }
    
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
    
    console.log(`[COST TOOLTIP] Positioned at: left=${tooltip.style.left}, top=${tooltip.style.top}`);
}

function hideCostTooltip() {
    const tooltip = document.getElementById('cost-tooltip');
    if (tooltip) {
        console.log('[COST TOOLTIP] Removing tooltip element');
        tooltip.remove();
    }
}

function exportProject() {
    const dataStr = JSON.stringify(project, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.name.replace(/\s+/g, '_')}.json`;
    link.click();
    URL.revokeObjectURL(url);
}

function importProject() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                project = JSON.parse(event.target.result);
                document.getElementById('project-title').textContent = project.name;
                saveProject();
                renderLayers();
                updateStats();
                selectLayer(0);
            } catch (error) {
                alert('Error loading project file');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function newProject() {
    if (confirm('Create new project? Unsaved changes will be lost.')) {
        project = {
            name: 'New Project',
            layers: []
        };
        document.getElementById('project-title').textContent = project.name;
        saveProject();
        renderLayers();
        updateStats();
    }
}

function loadTemplate(templateName) {
    if (confirm('Load template? Unsaved changes will be lost.')) {
        const template = TEMPLATES[templateName];
        if (template) {
            project = JSON.parse(JSON.stringify(template));
            // Migrate template data to new format
            project = migrateProject(project);
            document.getElementById('project-title').textContent = project.name;
            saveProject();
            renderLayers();
            updateStats();
            selectLayer(0);
        } else {
            alert('Template not found: ' + templateName);
        }
    }
}

function editProjectName() {
    const currentName = project.name;
    const newName = prompt('Enter project name:', currentName);
    if (newName && newName.trim() !== '') {
        saveState();
        project.name = newName.trim();
        document.getElementById('project-title').textContent = project.name;
        saveProject();
    }
}

function sortLayers(criteria) {
    const layers = inSubstack && project.layers[selectedLayerIndex].substacks 
        ? project.layers[selectedLayerIndex].substacks 
        : project.layers;
    
    if (criteria === 'manual') return;
    
    const currentLayer = layers[inSubstack ? selectedSubstackIndex : selectedLayerIndex];
    
    if (criteria === 'name') {
        layers.sort((a, b) => a.name.localeCompare(b.name));
    } else if (criteria === 'type') {
        layers.sort((a, b) => a.type.localeCompare(b.type));
    } else if (criteria === 'status') {
        const statusOrder = { 'Active': 0, 'Inactive': 1, 'Deprecated': 2 };
        layers.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
    }
    
    const newIndex = layers.indexOf(currentLayer);
    if (inSubstack) {
        selectedSubstackIndex = newIndex;
    } else {
        selectedLayerIndex = newIndex;
    }
    
    renderLayers();
    selectLayer(newIndex);
}

document.getElementById('add-layer-btn').addEventListener('click', () => {
    saveState();
    
    const newLayer = {
        id: Date.now(),
        name: 'New Layer',
        type: 'Other',
        status: 'Active',
        description: '',
        technology: '',
        responsibilities: '',
        connections: [],
        dependencies: [],
        visible: true,
        locked: false,
        substacks: []
    };
    
    project.layers.unshift(newLayer);
    saveProject();
    renderLayers();
    selectLayer(0);
    updateStats();
    if (currentView === 'diagram') {
        refreshDiagramLayout();
    }
});

document.getElementById('sort-select').addEventListener('change', (e) => {
    sortLayers(e.target.value);
});

let isAnimating = false;

document.addEventListener('keydown', (e) => {
    // Undo/Redo shortcuts
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
    }
    
    if (isAnimating) return;
    
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        isAnimating = true;
        const currentIndex = inSubstack ? selectedSubstackIndex : selectedLayerIndex;
        selectLayer(currentIndex - 1);
        setTimeout(() => { isAnimating = false; }, 250);
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        isAnimating = true;
        const currentIndex = inSubstack ? selectedSubstackIndex : selectedLayerIndex;
        selectLayer(currentIndex + 1);
        setTimeout(() => { isAnimating = false; }, 250);
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        enterSubstack();
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        exitSubstack();
    }
});

let wheelTimeout;
document.getElementById('stack-container').addEventListener('wheel', (e) => {
    e.preventDefault();
    clearTimeout(wheelTimeout);
    wheelTimeout = setTimeout(() => {
        const currentIndex = inSubstack ? selectedSubstackIndex : selectedLayerIndex;
        if (e.deltaY > 0) {
            selectLayer(currentIndex + 1);
        } else {
            selectLayer(currentIndex - 1);
        }
    }, 50);
}, { passive: false });

loadProject();

// Touch/swipe support for mobile
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;

function handleSwipe() {
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    
    if (Math.abs(deltaX) < 50 && Math.abs(deltaY) < 50) return;
    
    if (Math.abs(deltaY) > Math.abs(deltaX)) {
        const currentIndex = inSubstack ? selectedSubstackIndex : selectedLayerIndex;
        if (deltaY < 0) {
            selectLayer(currentIndex + 1);
        } else {
            selectLayer(currentIndex - 1);
        }
    } else {
        if (deltaX < 0) {
            enterSubstack();
        } else {
            exitSubstack();
        }
    }
}

document.getElementById('stack-container').addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

document.getElementById('stack-container').addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleSwipe();
}, { passive: true });


// File menu dropdown toggle
document.addEventListener('DOMContentLoaded', () => {
    // Update navigation instructions for mobile
    if ('ontouchstart' in window) {
        document.getElementById('nav-instructions').textContent = 'Swipe Up/Down • Swipe Left/Right for Substacks';
    }
    
    document.querySelectorAll('.menu-item').forEach(menuItem => {
        const dropdown = menuItem.querySelector('.dropdown-menu');
        if (dropdown) {
            menuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = dropdown.classList.contains('open');
                document.querySelectorAll('.dropdown-menu.open').forEach(d => d.classList.remove('open'));
                if (!isOpen) dropdown.classList.add('open');
            });
        }
    });

    // Submenus (e.g. Templates) open on hover via CSS; no JS needed.

    document.addEventListener('click', () => {
        document.querySelectorAll('.dropdown-menu.open').forEach(d => d.classList.remove('open'));
    });
    
    // Touch support for diagram canvas
    const canvas = document.getElementById('diagram-canvas');
    let touchStartXDiagram = 0;
    let touchStartYDiagram = 0;
    
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            touchStartXDiagram = touch.clientX - rect.left;
            touchStartYDiagram = touch.clientY - rect.top;
            handleCanvasMouseDown({ offsetX: touchStartXDiagram, offsetY: touchStartYDiagram });
        }
    }, { passive: true });
    
    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1) {
            e.preventDefault();
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            handleCanvasMouseMove({ offsetX: x, offsetY: y });
        }
    }, { passive: false });
    
    canvas.addEventListener('touchend', (e) => {
        handleCanvasMouseUp();
        if (e.changedTouches.length === 1) {
            const touch = e.changedTouches[0];
            const rect = canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            if (Math.abs(x - touchStartXDiagram) < 10 && Math.abs(y - touchStartYDiagram) < 10) {
                handleCanvasClick({ offsetX: x, offsetY: y });
            }
        }
    }, { passive: true });
});


// ============================================================================
// ACTIONS VIEW FUNCTIONS
// ============================================================================

function renderActionsListContent(container) {
    
    // Actions list
    if (!project.usePaths || project.usePaths.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = `
            text-align: center;
            color: #64748b;
            padding: 60px 20px;
        `;
        empty.innerHTML = `
            <div style="font-size: 15px; margin-bottom: 12px; color: #94a3b8;">No actions defined yet</div>
            <div style="font-size: 13px; line-height: 1.6;">Click <strong>"New Action"</strong> to create your first user journey<br>or <strong>"Import from Connections"</strong> to auto-generate from your diagram</div>
        `;
        container.appendChild(empty);
        return;
    }
    
    // Apply search and layer type filters
    const searchLower = window.actionsFilterState.searchText.toLowerCase();
    const filterBySearch = (item) => {
        if (!searchLower) return true;
        return item.name.toLowerCase().includes(searchLower) || 
               (item.description && item.description.toLowerCase().includes(searchLower));
    };
    
    const filterByLayerTypes = (item) => {
        if (window.actionsFilterState.selectedLayerTypes.length === 0) return true;
        return window.actionsFilterState.selectedLayerTypes.every(type => {
            return item.layersInvolved.some(layerId => {
                const layer = getAllLayers().find(l => l.id === layerId);
                return layer && layer.type === type;
            });
        });
    };
    
    // Filter all paths
    const filteredAll = project.usePaths.filter(p => filterBySearch(p) && filterByLayerTypes(p));
    
    // Show no results if all filtered out
    if (filteredAll.length === 0) {
        const noResults = document.createElement('div');
        noResults.style.cssText = `
            text-align: center;
            color: #64748b;
            padding: 60px 20px;
        `;
        noResults.innerHTML = `
            <div style="font-size: 15px; margin-bottom: 12px; color: #94a3b8;">No actions match your filters</div>
            <div style="font-size: 13px; line-height: 1.6;">Try adjusting your search or filters</div>
        `;
        container.appendChild(noResults);
        return;
    }
    
    // Separate by source (manual first, then imported)
    const manualAll = filteredAll.filter(p => !p.source || p.source === 'manual');
    const importedAll = filteredAll.filter(p => p.source === 'imported');
    
    // Separate actions and paths within each source
    const manualActions = manualAll.filter(p => p.layersInvolved.length === 1);
    const manualPaths = manualAll.filter(p => p.layersInvolved.length > 1);
    const importedActions = importedAll.filter(p => p.layersInvolved.length === 1);
    const importedPaths = importedAll.filter(p => p.layersInvolved.length > 1);
    
    // Apply sorting
    const sortBy = window.actionsFilterState.sortBy;
    const calculateCost = (path) => {
        let total = 0;
        path.layersInvolved.forEach(layerId => {
            const layer = getAllLayers().find(l => l.id === layerId);
            if (layer && layer.costModel) {
                total += (layer.costModel.fixedCost || 0);
            }
        });
        return total;
    };
    
    const sortItems = (items) => {
        if (sortBy === 'cost') {
            return items.sort((a, b) => calculateCost(b) - calculateCost(a));
        } else if (sortBy === 'steps') {
            return items.sort((a, b) => b.layersInvolved.length - a.layersInvolved.length);
        } else {
            return items.sort((a, b) => a.name.localeCompare(b.name));
        }
    };
    
    sortItems(manualActions);
    sortItems(manualPaths);
    sortItems(importedActions);
    sortItems(importedPaths);
    
    // Helper function to create section header
    function createSectionHeader(title, count, isCollapsed, toggleCallback) {
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
            padding: 12px 0;
            user-select: none;
            transition: all 0.2s;
            margin-bottom: 16px;
        `;
        
        const toggleIcon = document.createElement('span');
        toggleIcon.textContent = '▼';
        toggleIcon.style.cssText = `
            color: #94a3b8;
            font-size: 11px;
            font-weight: 600;
            transition: transform 0.2s;
            transform: ${isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};
            display: flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 16px;
        `;
        
        const titleSpan = document.createElement('span');
        titleSpan.textContent = title;
        titleSpan.style.cssText = `
            color: #e2e8f0;
            font-weight: 600;
            font-size: 14px;
            letter-spacing: 0.3px;
            flex: 1;
        `;
        
        const countBadge = document.createElement('span');
        countBadge.textContent = count;
        countBadge.style.cssText = `
            background: #334155;
            color: #cbd5e1;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            min-width: 24px;
            text-align: center;
        `;
        
        header.appendChild(toggleIcon);
        header.appendChild(titleSpan);
        header.appendChild(countBadge);
        
        header.onclick = toggleCallback;
        
        return { header, toggleIcon };
    }
    
    // Helper to render a subsection (Single Actions or Multi-Step Flows)
    function renderSubsection(items, title, collapsedKey) {
        if (items.length === 0) return null;
        
        const section = document.createElement('div');
        section.style.cssText = `
            margin-bottom: 24px;
        `;
        
        const isCollapsed = window[collapsedKey];
        const { header, toggleIcon } = createSectionHeader(
            title,
            items.length,
            isCollapsed,
            () => {
                window[collapsedKey] = !window[collapsedKey];
                itemsContainer.style.display = window[collapsedKey] ? 'none' : 'grid';
                toggleIcon.style.transform = window[collapsedKey] ? 'rotate(-90deg)' : 'rotate(0deg)';
            }
        );
        
        const itemsContainer = document.createElement('div');
        itemsContainer.style.cssText = `
            display: ${isCollapsed ? 'none' : 'grid'};
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 16px;
            animation: fadeIn 0.3s ease;
        `;
        
        items.forEach(item => {
            const card = createActionCard(item);
            itemsContainer.appendChild(card);
        });
        
        section.appendChild(header);
        section.appendChild(itemsContainer);
        return section;
    }
    
    // Render Manual section
    if (manualActions.length > 0 || manualPaths.length > 0) {
        const manualSection = document.createElement('div');
        manualSection.style.cssText = `
            margin-bottom: 40px;
        `;
        
        const manualTitle = document.createElement('div');
        manualTitle.style.cssText = `
            color: #e2e8f0;
            font-size: 16px;
            font-weight: 700;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 2px solid #334155;
        `;
        manualTitle.textContent = 'Manual';
        manualSection.appendChild(manualTitle);
        
        if (manualActions.length > 0) {
            const actionsSubsection = renderSubsection(manualActions, 'Single Actions', 'manualActionsCollapsed');
            if (actionsSubsection) manualSection.appendChild(actionsSubsection);
        }
        
        if (manualPaths.length > 0) {
            const pathsSubsection = renderSubsection(manualPaths, 'Multi-Step Flows', 'manualPathsCollapsed');
            if (pathsSubsection) manualSection.appendChild(pathsSubsection);
        }
        
        container.appendChild(manualSection);
    }
    
    // Render Imported section
    if (importedActions.length > 0 || importedPaths.length > 0) {
        const importedSection = document.createElement('div');
        importedSection.style.cssText = `
            margin-bottom: 40px;
        `;
        
        const importedTitle = document.createElement('div');
        importedTitle.style.cssText = `
            color: #e2e8f0;
            font-size: 16px;
            font-weight: 700;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 2px solid #334155;
        `;
        importedTitle.textContent = 'Imported';
        importedSection.appendChild(importedTitle);
        
        if (importedActions.length > 0) {
            const actionsSubsection = renderSubsection(importedActions, 'Single Actions', 'importedActionsCollapsed');
            if (actionsSubsection) importedSection.appendChild(actionsSubsection);
        }
        
        if (importedPaths.length > 0) {
            const pathsSubsection = renderSubsection(importedPaths, 'Multi-Step Flows', 'importedPathsCollapsed');
            if (pathsSubsection) importedSection.appendChild(pathsSubsection);
        }
        
        container.appendChild(importedSection);
    }
}

/**
 * Create an action/path card
 */
function createActionCard(path) {
    const actionCard = document.createElement('div');
    const isSelected = selectedActionId === path.id;
    
    actionCard.style.cssText = `
        background: ${isSelected ? '#1e293b' : '#0f172a'};
        border: 2px solid ${isSelected ? '#3b82f6' : '#334155'};
        border-radius: 8px;
        padding: 14px 16px;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        flex-direction: column;
        gap: 10px;
    `;
    actionCard.onmouseover = () => {
        if (!isSelected) {
            actionCard.style.background = '#1e293b';
            actionCard.style.borderColor = '#475569';
        }
    };
    actionCard.onmouseout = () => {
        if (!isSelected) {
            actionCard.style.background = '#0f172a';
            actionCard.style.borderColor = '#334155';
        }
    };
    
    // Helper to get layer type color
    function getLayerTypeColor(layerId) {
        const layer = getAllLayers().find(l => l.id === layerId);
        if (!layer) return '#64748b';
        
        const typeColors = {
            'Frontend': '#06b6d4',   // cyan
            'API': '#8b5cf6',        // purple
            'Backend': '#10b981',    // emerald
            'Database': '#f59e0b',   // amber
            'DevOps': '#ef4444'      // red
        };
        return typeColors[layer.type] || '#64748b';
    }
    
    // Header with title and delete button
    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
    `;
    
    const nameSpan = document.createElement('div');
    nameSpan.style.cssText = `
        flex: 1;
    `;
    const displayName = generateFlowName(path);
    const displayDesc = generateFlowDescription(path) || path.description;
    nameSpan.innerHTML = `
        <div style="color: #e2e8f0; font-weight: 600; font-size: 13px; letter-spacing: 0.2px; margin-bottom: 4px;">${displayName}</div>
        <div style="color: #94a3b8; font-size: 11px; line-height: 1.4;">${displayDesc || '<em style="color: #64748b;">No description</em>'}</div>
    `;
    
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '✕';
    deleteBtn.style.cssText = `
        background: #ef4444;
        color: white;
        border: none;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 600;
        transition: all 0.2s;
        flex-shrink: 0;
        padding: 0;
    `;
    deleteBtn.onmouseover = () => deleteBtn.style.background = '#dc2626';
    deleteBtn.onmouseout = () => deleteBtn.style.background = '#ef4444';
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deleteAction(path.id);
    };
    
    nameDiv.appendChild(nameSpan);
    nameDiv.appendChild(deleteBtn);
    
    // Layer flow visualization with color coding
    const flowDiv = document.createElement('div');
    flowDiv.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
    `;
    
    const pathLayers = path.layersInvolved.map(layerId => {
        const layer = getAllLayers().find(l => l.id === layerId);
        return { id: layerId, name: layer ? layer.name : `Layer ${layerId}`, type: layer ? layer.type : 'Unknown' };
    });
    
    pathLayers.forEach((layer, index) => {
        // Layer badge
        const badge = document.createElement('div');
        const color = getLayerTypeColor(layer.id);
        badge.style.cssText = `
            background: ${color}20;
            border: 1px solid ${color};
            color: ${color};
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 600;
            white-space: nowrap;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        `;
        badge.textContent = layer.type;
        flowDiv.appendChild(badge);
        
        // Arrow between layers
        if (index < pathLayers.length - 1) {
            const arrow = document.createElement('div');
            arrow.style.cssText = `
                color: #64748b;
                font-size: 10px;
                font-weight: 600;
            `;
            arrow.textContent = '→';
            flowDiv.appendChild(arrow);
        }
    });
    
    // Stats row
    const statsDiv = document.createElement('div');
    statsDiv.style.cssText = `
        display: flex;
        gap: 12px;
        font-size: 11px;
        color: #94a3b8;
        padding-top: 6px;
        border-top: 1px solid #334155;
    `;
    
    const stepCount = document.createElement('div');
    stepCount.innerHTML = `<span style="color: #cbd5e1; font-weight: 600;">${path.layersInvolved.length}</span> step${path.layersInvolved.length !== 1 ? 's' : ''}`;
    
    const totalCalls = Object.values(path.avgCallsPerLayer || {}).reduce((a, b) => a + b, 0);
    const callCount = document.createElement('div');
    callCount.innerHTML = `<span style="color: #cbd5e1; font-weight: 600;">${totalCalls}</span> call${totalCalls !== 1 ? 's' : ''}`;
    
    statsDiv.appendChild(stepCount);
    statsDiv.appendChild(callCount);
    
    actionCard.appendChild(nameDiv);
    actionCard.appendChild(flowDiv);
    actionCard.appendChild(statsDiv);
    
    // Click to select action
    actionCard.onclick = () => {
        selectedActionId = path.id;
        renderActionsView();
        renderActionAssemblyPanel(path);
    };
    
    return actionCard;
}

/**
 * Create a new action with blank slate
 */
function createNewAction() {
    saveState();
    
    // Create blank action with default values
    const actionIndex = (project.usePaths?.length || 0) + 1;
    const newAction = {
        id: `action-${actionIndex}`,
        name: 'New Action',
        description: '',
        layersInvolved: [],
        avgCallsPerLayer: {},
        notes: '',
        source: 'manual'  // Track that this was manually created
    };
    
    if (!project.usePaths) {
        project.usePaths = [];
    }
    
    project.usePaths.push(newAction);
    saveProject();
    
    // Select the new action and show assembly panel
    selectedActionId = newAction.id;
    renderActionsView();
    renderActionAssemblyPanel(newAction);
}

/**
 * Edit an action
 */
function editAction(pathId) {
    const path = project.usePaths.find(p => p.id === pathId);
    if (!path) return;
    
    selectedActionId = pathId;
    renderActionsView();
    renderActionAssemblyPanel(path);
}

/**
 * Delete an action
 */
function deleteAction(pathId) {
    const path = project.usePaths.find(p => p.id === pathId);
    if (!path) return;
    
    if (!confirm(`Delete action "${path.name}"?`)) return;
    
    saveState();
    project.usePaths = project.usePaths.filter(p => p.id !== pathId);
    saveProject();
    selectedActionId = null;
    renderActionsView();
}

function showBestPracticesModal() {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.2s ease;
    `;
    
    // Create modal container
    const modal = document.createElement('div');
    modal.style.cssText = `
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 8px;
        max-width: 700px;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        animation: slideUp 0.3s ease;
    `;
    
    // Header
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 24px;
        border-bottom: 1px solid #334155;
        background: #1e293b;
        position: sticky;
        top: 0;
        z-index: 10001;
    `;
    
    const title = document.createElement('h2');
    title.textContent = 'Best Practices for Building Flows';
    title.style.cssText = `
        margin: 0;
        color: #e2e8f0;
        font-size: 18px;
        font-weight: 700;
    `;
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 20px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
    `;
    closeBtn.onmouseover = () => closeBtn.style.color = '#e2e8f0';
    closeBtn.onmouseout = () => closeBtn.style.color = '#94a3b8';
    closeBtn.onclick = () => overlay.remove();
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    
    // Content
    const content = document.createElement('div');
    content.style.cssText = `
        padding: 24px;
        color: #cbd5e1;
        line-height: 1.6;
    `;
    
    const practices = [
        {
            title: '1. Keep Flows Focused',
            description: 'Each flow should represent a single user journey or business process. Avoid creating flows that try to do too much.',
            example: '✓ "Mobile App → API → Database" (clear path)\n✗ "Mobile App → API → Database → Cache → Message Queue" (too complex)'
        },
        {
            title: '2. Use Meaningful Names',
            description: 'Give flows descriptive names that clearly indicate their purpose. The system auto-generates names based on layer types, but you can customize them.',
            example: '✓ "User Authentication"\n✗ "Flow 1" or "Process A"'
        },
        {
            title: '3. Document the Purpose',
            description: 'Add descriptions explaining what the flow does, why it exists, and any important context. This helps team members understand the flow\'s role.',
            example: 'e.g., "Handles user login with OAuth2 integration and session management"'
        },
        {
            title: '4. Respect Layer Hierarchy',
            description: 'Flows should generally follow the natural layer hierarchy: Frontend → API → Backend → Database. Avoid jumping layers or creating circular dependencies.',
            example: '✓ Frontend → Backend → Database\n✗ Frontend → Database (skips API layer)'
        },
        {
            title: '5. Track Call Counts',
            description: 'Specify how many times each layer is called in the flow. This helps with performance analysis and cost estimation.',
            example: 'e.g., "API called 2 times, Database called 1 time per user request"'
        },
        {
            title: '6. Identify Connection Types',
            description: 'Specify the type of connection between layers (HTTP, gRPC, Database Query, etc.). This clarifies communication protocols and helps with architecture decisions.',
            example: 'HTTP for REST APIs, gRPC for high-performance services, Database Query for data access'
        },
        {
            title: '7. Group Related Flows',
            description: 'Organize flows by feature or domain. Single Actions (one layer) are typically atomic operations, while Multi-Step Flows are complete user journeys.',
            example: 'Group: "Authentication" (login, logout, refresh token)\nGroup: "Shopping" (browse, add to cart, checkout)'
        },
        {
            title: '8. Review and Refine',
            description: 'Regularly review your flows to ensure they accurately represent your system. Update them as your architecture evolves.',
            example: 'When adding new services or changing communication patterns, update the relevant flows'
        }
    ];
    
    practices.forEach((practice, index) => {
        const section = document.createElement('div');
        section.style.cssText = `
            margin-bottom: 24px;
            padding-bottom: 24px;
            border-bottom: 1px solid #334155;
        `;
        if (index === practices.length - 1) {
            section.style.borderBottom = 'none';
            section.style.marginBottom = '0';
            section.style.paddingBottom = '0';
        }
        
        const practiceTitle = document.createElement('h3');
        practiceTitle.textContent = practice.title;
        practiceTitle.style.cssText = `
            margin: 0 0 8px 0;
            color: #3b82f6;
            font-size: 14px;
            font-weight: 600;
            letter-spacing: 0.3px;
        `;
        
        const practiceDesc = document.createElement('p');
        practiceDesc.textContent = practice.description;
        practiceDesc.style.cssText = `
            margin: 0 0 12px 0;
            color: #cbd5e1;
            font-size: 13px;
        `;
        
        const practiceExample = document.createElement('div');
        practiceExample.style.cssText = `
            background: #1e293b;
            border-left: 3px solid #8b5cf6;
            padding: 10px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-family: 'Monaco', 'Courier New', monospace;
            color: #cbd5e1;
            white-space: pre-wrap;
            word-break: break-word;
        `;
        practiceExample.textContent = practice.example;
        
        section.appendChild(practiceTitle);
        section.appendChild(practiceDesc);
        section.appendChild(practiceExample);
        content.appendChild(section);
    });
    
    // Footer with tips
    const footer = document.createElement('div');
    footer.style.cssText = `
        padding: 16px 24px;
        background: #1e293b;
        border-top: 1px solid #334155;
        font-size: 12px;
        color: #94a3b8;
    `;
    footer.innerHTML = `
        <strong style="color: #cbd5e1;">💡 Pro Tip:</strong> Use the "Import from Connections" button to auto-generate flows from your diagram, then refine them with meaningful names and descriptions.
    `;
    
    modal.appendChild(header);
    modal.appendChild(content);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Close on overlay click
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    };
    
    // Close on Escape key
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
}

/**
 * Render the action assembly panel in the details frame
 */
function renderActionAssemblyPanel(path) {
    const detailsDiv = document.getElementById('layer-details');
    const allLayers = getAllLayers();
    
    detailsDiv.innerHTML = `
        <div style="display: flex; flex-direction: column; height: 100%; gap: 0;">
            <!-- Header - Editable -->
            <div style="padding-bottom: 16px; border-bottom: 1px solid #334155; margin-bottom: 16px; flex-shrink: 0;">
                <input type="text" id="action-name-input" value="${path.name}" 
                       style="width: 100%; background: #1e293b; border: 1px solid #334155; color: #e2e8f0; 
                              padding: 8px 12px; border-radius: 4px; font-size: 14px; font-weight: 600; 
                              margin-bottom: 8px; box-sizing: border-box;"
                       onchange="updateActionName('${path.id}', this.value)">
                <textarea id="action-desc-input" placeholder="Add description..." 
                          style="width: 100%; background: #1e293b; border: 1px solid #334155; color: #e2e8f0; 
                                 padding: 8px 12px; border-radius: 4px; font-size: 12px; 
                                 resize: vertical; min-height: 50px; box-sizing: border-box;"
                          onchange="updateActionDescription('${path.id}', this.value)">${path.description || ''}</textarea>
            </div>
            
            <!-- Tab Navigation -->
            <div style="display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid #334155; flex-shrink: 0;">
                <button class="action-tab active" data-tab="assembly" onclick="switchActionTab('assembly')" 
                        style="flex: 1; background: transparent; color: #e2e8f0; border: none; border-bottom: 2px solid #3b82f6; 
                               padding: 8px 12px; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s;">
                    Assembly
                </button>
                <button class="action-tab" data-tab="path" onclick="switchActionTab('path')" 
                        style="flex: 1; background: transparent; color: #94a3b8; border: none; border-bottom: 2px solid transparent; 
                               padding: 8px 12px; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s;">
                    Path (${path.layersInvolved.length})
                </button>
                <button class="action-tab" data-tab="costs" onclick="switchActionTab('costs')" 
                        style="flex: 1; background: transparent; color: #94a3b8; border: none; border-bottom: 2px solid transparent; 
                               padding: 8px 12px; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s;">
                    Costs
                </button>
            </div>
            
            <!-- Tab Content -->
            <div style="flex: 1; display: flex; flex-direction: column; min-height: 0; margin-bottom: 16px;">
                <!-- Assembly Tab -->
                <div class="action-tab-content active" data-tab="assembly" style="display: flex; flex-direction: column; gap: 12px; overflow-y: auto; padding-right: 8px;">
                    <!-- Search Box -->
                    <div style="flex-shrink: 0;">
                        <input type="text" id="assembly-search" placeholder="Search layers..." 
                               style="width: 100%; background: #1e293b; border: 1px solid #334155; color: #e2e8f0; 
                                      padding: 8px 12px; border-radius: 4px; font-size: 12px; box-sizing: border-box;"
                               onkeyup="filterAssemblyLayers()">
                    </div>
                    
                    <!-- Available Layers -->
                    <div style="flex-shrink: 0;">
                        <div style="color: #94a3b8; font-size: 11px; margin-bottom: 8px; font-weight: 500;">
                            Available Layers
                        </div>
                        <div id="assembly-layers" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; max-height: 150px; overflow-y: auto;">
                            <!-- Layers will be populated here -->
                        </div>
                    </div>
                </div>
                
                <!-- Path Tab -->
                <div class="action-tab-content" data-tab="path" style="display: none; flex-direction: column; gap: 8px; overflow-y: auto; padding-right: 8px;">
                    <div id="assembly-path" style="display: flex; flex-direction: column; gap: 8px;">
                        <!-- Path steps will be populated here -->
                    </div>
                </div>
                
                <!-- Costs Tab -->
                <div class="action-tab-content" data-tab="costs" style="display: none; flex-direction: column; gap: 8px; overflow-y: auto; padding-right: 8px;">
                    <div id="action-costs-breakdown" style="display: flex; flex-direction: column; gap: 8px;">
                        <!-- Cost breakdown will be populated here -->
                    </div>
                </div>
            </div>
            
            <!-- Action Buttons -->
            <div style="display: flex; gap: 8px; flex-shrink: 0; padding-top: 16px; border-top: 1px solid #334155;">
                <button onclick="saveActionPath()" style="flex: 1; background: #10b981; color: white; border: none; 
                                                          padding: 8px 16px; border-radius: 4px; cursor: pointer; 
                                                          font-size: 12px; font-weight: 500; transition: background 0.2s;"
                        onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">
                    Save
                </button>
                <button onclick="clearActionSelection()" style="flex: 1; background: #64748b; color: white; border: none; 
                                                                padding: 8px 16px; border-radius: 4px; cursor: pointer; 
                                                                font-size: 12px; font-weight: 500; transition: background 0.2s;"
                        onmouseover="this.style.background='#475569'" onmouseout="this.style.background='#64748b'">
                    Close
                </button>
            </div>
        </div>
    `;
    
    // Populate available layers
    populateAssemblyLayers(path, allLayers);
    
    // Populate current path
    populateAssemblyPath(path);
    
    // Populate cost breakdown
    populateActionCostBreakdown(path, allLayers);
}

/**
 * Switch between action assembly tabs
 */
function switchActionTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.action-tab-content').forEach(tab => {
        tab.style.display = 'none';
        tab.classList.remove('active');
    });
    
    // Remove active state from all tab buttons
    document.querySelectorAll('.action-tab').forEach(btn => {
        btn.style.color = '#94a3b8';
        btn.style.borderBottom = '2px solid transparent';
        btn.classList.remove('active');
    });
    
    // Show selected tab
    const selectedTab = document.querySelector(`.action-tab-content[data-tab="${tabName}"]`);
    if (selectedTab) {
        selectedTab.style.display = 'flex';
        selectedTab.classList.add('active');
    }
    
    // Highlight selected tab button
    const selectedBtn = document.querySelector(`.action-tab[data-tab="${tabName}"]`);
    if (selectedBtn) {
        selectedBtn.style.color = '#e2e8f0';
        selectedBtn.style.borderBottom = '2px solid #3b82f6';
        selectedBtn.classList.add('active');
    }
}

/**
 * Populate action cost breakdown in the costs tab
 */
function populateActionCostBreakdown(path, allLayers) {
    const container = document.getElementById('action-costs-breakdown');
    if (!container) return;
    
    try {
        // Get cost analysis for this action
        const costAnalysis = getActionCostAnalysis(path, allLayers);
        
        if (!costAnalysis || !costAnalysis.layerBreakdown) {
            container.innerHTML = '<div style="color: #64748b; font-size: 12px; text-align: center; padding: 20px;">No cost data available</div>';
            return;
        }
        
        container.innerHTML = '';
        
        // Summary cards
        const summaryDiv = document.createElement('div');
        summaryDiv.style.cssText = `
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 12px;
        `;
        
        // Cost per use
        const perUseCard = document.createElement('div');
        perUseCard.style.cssText = `
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 4px;
            padding: 10px;
        `;
        perUseCard.innerHTML = `
            <div style="color: #94a3b8; font-size: 10px; margin-bottom: 4px;">Per Use</div>
            <div style="color: #f59e0b; font-size: 13px; font-weight: 600;">${formatCost(costAnalysis.costPerUse.variable, 'USD', true)}</div>
            <div style="color: #64748b; font-size: 10px; margin-top: 2px;">Variable only</div>
        `;
        summaryDiv.appendChild(perUseCard);
        
        // Monthly cost
        const monthlyCard = document.createElement('div');
        monthlyCard.style.cssText = `
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 4px;
            padding: 10px;
        `;
        monthlyCard.innerHTML = `
            <div style="color: #94a3b8; font-size: 10px; margin-bottom: 4px;">Monthly</div>
            <div style="color: #10b981; font-size: 13px; font-weight: 600;">${formatCost(costAnalysis.monthlyCost.total)}</div>
            <div style="color: #64748b; font-size: 10px; margin-top: 2px;">Fixed + Variable</div>
        `;
        summaryDiv.appendChild(monthlyCard);
        
        container.appendChild(summaryDiv);
        
        // Layer breakdown
        const breakdownTitle = document.createElement('div');
        breakdownTitle.style.cssText = `
            color: #94a3b8;
            font-size: 11px;
            font-weight: 500;
            margin-bottom: 8px;
            margin-top: 8px;
        `;
        breakdownTitle.textContent = 'Cost by Layer';
        container.appendChild(breakdownTitle);
        
        // Layer breakdown items
        Object.entries(costAnalysis.layerBreakdown).forEach(([layerId, breakdown]) => {
            const layerItem = document.createElement('div');
            layerItem.style.cssText = `
                background: #0f172a;
                border: 1px solid #334155;
                border-radius: 4px;
                padding: 10px;
                margin-bottom: 8px;
            `;
            
            const layerName = document.createElement('div');
            layerName.style.cssText = `
                color: #e2e8f0;
                font-size: 12px;
                font-weight: 500;
                margin-bottom: 6px;
            `;
            layerName.textContent = breakdown.layerName;
            layerItem.appendChild(layerName);
            
            // Cost details grid
            const detailsGrid = document.createElement('div');
            detailsGrid.style.cssText = `
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
                font-size: 11px;
            `;
            
            // Fixed cost
            const fixedDiv = document.createElement('div');
            fixedDiv.innerHTML = `
                <div style="color: #94a3b8; margin-bottom: 2px;">Fixed</div>
                <div style="color: #3b82f6; font-weight: 500;">${formatCost(breakdown.fixedCostMonthly)}</div>
            `;
            detailsGrid.appendChild(fixedDiv);
            
            // Variable cost per use
            const varDiv = document.createElement('div');
            varDiv.innerHTML = `
                <div style="color: #94a3b8; margin-bottom: 2px;">Variable/Use</div>
                <div style="color: #f59e0b; font-weight: 500;">${formatCost(breakdown.variableCostPerUse, 'USD', true)}</div>
            `;
            detailsGrid.appendChild(varDiv);
            
            layerItem.appendChild(detailsGrid);
            
            // Allocation note
            if (breakdown.allocationNote) {
                const noteDiv = document.createElement('div');
                noteDiv.style.cssText = `
                    color: #64748b;
                    font-size: 10px;
                    margin-top: 6px;
                    padding-top: 6px;
                    border-top: 1px solid #334155;
                `;
                noteDiv.textContent = breakdown.allocationNote;
                layerItem.appendChild(noteDiv);
            }
            
            container.appendChild(layerItem);
        });
        
    } catch (error) {
        console.error('Error populating action cost breakdown:', error);
        container.innerHTML = `<div style="color: #ef4444; font-size: 12px;">Error loading cost data</div>`;
    }
}

/**
 * Update action name
 */
function updateActionName(actionId, newName) {
    const action = project.usePaths.find(p => p.id === actionId);
    if (action && newName.trim()) {
        action.name = newName.trim();
        saveProject();
    }
}

/**
 * Update action description
 */
function updateActionDescription(actionId, newDescription) {
    const action = project.usePaths.find(p => p.id === actionId);
    if (action) {
        action.description = newDescription.trim();
        saveProject();
    }
}

/**
 * Populate the available layers list in the assembly panel
 */
function populateAssemblyLayers(path, allLayers) {
    const container = document.getElementById('assembly-layers');
    if (!container) return;
    
    container.innerHTML = '';
    
    allLayers.forEach(layer => {
        const isInPath = path.layersInvolved.includes(layer.id);
        
        const layerBtn = document.createElement('button');
        layerBtn.className = 'assembly-layer-btn';
        layerBtn.dataset.layerId = layer.id;
        layerBtn.style.cssText = `
            background: ${isInPath ? '#3b82f6' : '#1e293b'};
            color: ${isInPath ? 'white' : '#cbd5e1'};
            border: 1px solid ${isInPath ? '#2563eb' : '#334155'};
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
            text-align: left;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        `;
        
        layerBtn.textContent = layer.name;
        
        layerBtn.onmouseover = () => {
            if (!isInPath) {
                layerBtn.style.background = '#334155';
                layerBtn.style.borderColor = '#475569';
            }
        };
        
        layerBtn.onmouseout = () => {
            if (!isInPath) {
                layerBtn.style.background = '#1e293b';
                layerBtn.style.borderColor = '#334155';
            }
        };
        
        layerBtn.onclick = () => {
            addLayerToPath(path, layer.id);
        };
        
        container.appendChild(layerBtn);
    });
}

/**
 * Populate the current path visualization in the assembly panel
 */
function populateAssemblyPath(path) {
    const container = document.getElementById('assembly-path');
    if (!container) return;
    
    if (path.layersInvolved.length === 0) {
        container.innerHTML = '<div style="color: #64748b; font-size: 12px; text-align: center; padding: 20px;">Click layers to add them to the path</div>';
        return;
    }
    
    container.innerHTML = '';
    
    path.layersInvolved.forEach((layerId, index) => {
        const layer = getAllLayers().find(l => l.id === layerId);
        const layerName = layer ? layer.name : `Layer ${layerId}`;
        const calls = path.avgCallsPerLayer[layerId] || 1;
        
        const stepDiv = document.createElement('div');
        stepDiv.style.cssText = `
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 4px;
            padding: 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        `;
        
        const stepInfo = document.createElement('div');
        stepInfo.style.cssText = `
            flex: 1;
            min-width: 0;
        `;
        
        stepInfo.innerHTML = `
            <div style="color: #e2e8f0; font-size: 12px; font-weight: 500; margin-bottom: 4px;">
                ${index + 1}. ${layerName}
            </div>
            <div style="color: #94a3b8; font-size: 11px;">
                Calls: <input type="number" value="${calls}" min="1" style="width: 40px; background: #0f172a; 
                             border: 1px solid #334155; color: #e2e8f0; padding: 4px; border-radius: 3px; font-size: 11px;"
                       onchange="updateLayerCalls('${path.id}', ${layerId}, this.value)">
            </div>
        `;
        
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '✕';
        removeBtn.style.cssText = `
            background: #ef4444;
            color: white;
            border: none;
            width: 24px;
            height: 24px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
            transition: background 0.2s;
            flex-shrink: 0;
        `;
        
        removeBtn.onmouseover = () => removeBtn.style.background = '#dc2626';
        removeBtn.onmouseout = () => removeBtn.style.background = '#ef4444';
        removeBtn.onclick = () => removeLayerFromPath(path, layerId);
        
        stepDiv.appendChild(stepInfo);
        stepDiv.appendChild(removeBtn);
        container.appendChild(stepDiv);
        
        // Add arrow between steps
        if (index < path.layersInvolved.length - 1) {
            const arrow = document.createElement('div');
            arrow.style.cssText = `
                text-align: center;
                color: #64748b;
                font-size: 12px;
                padding: 4px 0;
            `;
            arrow.textContent = '↓';
            container.appendChild(arrow);
        }
    });
}

/**
 * Add a layer to the action path
 */
function addLayerToPath(path, layerId) {
    if (!path.layersInvolved.includes(layerId)) {
        path.layersInvolved.push(layerId);
        path.avgCallsPerLayer[layerId] = 1;
        populateAssemblyLayers(path, getAllLayers());
        populateAssemblyPath(path);
    }
}

/**
 * Remove a layer from the action path
 */
function removeLayerFromPath(path, layerId) {
    path.layersInvolved = path.layersInvolved.filter(id => id !== layerId);
    delete path.avgCallsPerLayer[layerId];
    populateAssemblyLayers(path, getAllLayers());
    populateAssemblyPath(path);
}

/**
 * Update the call count for a layer in the path
 */
function updateLayerCalls(pathId, layerId, value) {
    const path = project.usePaths.find(p => p.id === pathId);
    if (path) {
        path.avgCallsPerLayer[layerId] = parseInt(value) || 1;
    }
}

/**
 * Filter assembly layers by search term
 */
function filterAssemblyLayers() {
    const searchInput = document.getElementById('assembly-search');
    const searchTerm = searchInput.value.toLowerCase();
    const layerBtns = document.querySelectorAll('.assembly-layer-btn');
    
    layerBtns.forEach(btn => {
        const layerName = btn.textContent.toLowerCase();
        btn.style.display = layerName.includes(searchTerm) ? 'block' : 'none';
    });
}

/**
 * Save the action path and close the assembly panel
 */
function saveActionPath() {
    saveState();
    saveProject();
    selectedActionId = null;
    renderActionsView();
    renderLayerDetails(project.layers[selectedLayerIndex]);
}

/**
 * Clear action selection and return to details panel
 */
function clearActionSelection() {
    selectedActionId = null;
    renderActionsView();
    renderLayerDetails(project.layers[selectedLayerIndex]);
}


// ============================================================================
// CONNECTION PATH ANALYSIS & ACTION GENERATION
// ============================================================================

/**
 * Generate action templates from all connection paths in the diagram
 * Analyzes the connection graph and creates actions for all possible paths
 */
function generateActionsFromConnections() {
    const allLayers = getAllLayers();
    const generatedActions = [];
    const visited = new Set();
    
    // Find all starting points (layers with no incoming connections)
    const startingLayers = allLayers.filter(layer => {
        const hasIncoming = allLayers.some(other => {
            const connections = other.connections || [];
            return connections.some(conn => {
                const connId = typeof conn === 'object' ? conn.targetId : conn;
                return connId === layer.id;
            });
        });
        return !hasIncoming;
    });
    
    // If no starting points found, use all layers as potential starts
    const starts = startingLayers.length > 0 ? startingLayers : allLayers;
    
    // Generate paths from each starting point
    starts.forEach(startLayer => {
        const paths = findAllPathsFrom(startLayer, allLayers, new Set(), []);
        paths.forEach(path => {
            const pathKey = path.map(l => l.id).join('->');
            if (!visited.has(pathKey)) {
                visited.add(pathKey);
                generatedActions.push(createActionFromPath(path));
            }
        });
    });
    
    return generatedActions;
}

/**
 * Find all possible paths starting from a given layer
 * Uses depth-first search to explore all connection paths
 */
function findAllPathsFrom(currentLayer, allLayers, visited, currentPath) {
    const paths = [];
    const newPath = [...currentPath, currentLayer];
    const newVisited = new Set(visited);
    newVisited.add(currentLayer.id);
    
    // Add current path as a valid path
    paths.push(newPath);
    
    // Explore connections
    const connections = currentLayer.connections || [];
    connections.forEach(conn => {
        const targetId = typeof conn === 'object' ? conn.targetId : conn;
        
        // Avoid cycles
        if (!newVisited.has(targetId)) {
            const targetLayer = allLayers.find(l => l.id === targetId);
            if (targetLayer) {
                const subPaths = findAllPathsFrom(targetLayer, allLayers, newVisited, newPath);
                paths.push(...subPaths);
            }
        }
    });
    
    return paths;
}

/**
 * Create an action from a path of layers
 */
function createActionFromPath(layerPath) {
    const layerNames = layerPath.map(l => l.name).join(' → ');
    const layerIds = layerPath.map(l => l.id);
    
    // Create action name from path
    const actionName = layerNames;
    
    // Create action ID from layer IDs
    const actionId = `path-${layerIds.join('-')}`;
    
    // Initialize call counts (1 per layer by default)
    const avgCallsPerLayer = {};
    layerIds.forEach(id => {
        avgCallsPerLayer[id] = 1;
    });
    
    return {
        id: actionId,
        name: actionName,
        description: `Auto-generated path: ${layerNames}`,
        layersInvolved: layerIds,
        avgCallsPerLayer: avgCallsPerLayer,
        notes: 'Generated from connection paths'
    };
}

/**
 * Import generated actions from connections
 * Shows a dialog to select which paths to import
 */
function importActionsFromConnections() {
    const generatedActions = generateActionsFromConnections();
    
    if (generatedActions.length === 0) {
        alert('No connection paths found. Create connections between layers first.');
        return;
    }
    
    // Count existing actions
    const existingCount = project.usePaths?.length || 0;
    
    // Ask user if they want to import
    const message = `Found ${generatedActions.length} possible paths through your stack.\n\nImport these as action templates?\n\nYou can edit them after import.`;
    
    if (!confirm(message)) {
        return;
    }
    
    saveState();
    
    // Add generated actions to project
    if (!project.usePaths) {
        project.usePaths = [];
    }
    
    // Filter out duplicates (by path)
    const existingPaths = new Set(project.usePaths.map(p => p.layersInvolved.join('->')));
    
    let importedCount = 0;
    generatedActions.forEach(action => {
        const pathKey = action.layersInvolved.join('->');
        if (!existingPaths.has(pathKey)) {
            action.source = 'imported';  // Track that this was imported from connections
            project.usePaths.push(action);
            existingPaths.add(pathKey);
            importedCount++;
        }
    });
    
    saveProject();
    
    // Show result
    alert(`Imported ${importedCount} new action paths.\n\nTotal actions: ${project.usePaths.length}`);
    
    // Refresh actions view if visible
    if (currentView === 'actions') {
        renderActionsView();
    }
}

/**
 * Add import button to actions view header
 * This function is called from renderActionsView
 */
function addImportConnectionsButton(header) {
    const importBtn = document.createElement('button');
    importBtn.textContent = '⚡ Import from Connections';
    importBtn.style.cssText = `
        background: #8b5cf6;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: background 0.2s;
        margin-left: 8px;
    `;
    importBtn.onmouseover = () => importBtn.style.background = '#7c3aed';
    importBtn.onmouseout = () => importBtn.style.background = '#8b5cf6';
    importBtn.onclick = () => importActionsFromConnections();
    
    return importBtn;
}
