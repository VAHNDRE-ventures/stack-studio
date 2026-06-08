/**
 * Cost Dashboard View Module
 * Handles the cost analysis and visualization
 */

function renderCostDashboard() {
    const container = document.getElementById('cost-dashboard-view');
    container.innerHTML = '';
    
    // Ensure container has proper layout
    container.style.cssText = `
        display: flex;
        flex-direction: column;
        flex: 1;
        background: #0f172a;
        overflow-y: auto;
        padding: 24px;
    `;
    
    try {
        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 32px;
            padding-bottom: 16px;
            border-bottom: 2px solid #334155;
        `;
        
        const title = document.createElement('h2');
        title.textContent = 'Cost Dashboard';
        title.style.cssText = `
            margin: 0;
            color: #e2e8f0;
            font-size: 20px;
            font-weight: 700;
            letter-spacing: -0.5px;
        `;
        header.appendChild(title);
        container.appendChild(header);
        
        // Summary section
        const summarySection = document.createElement('div');
        summarySection.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 32px;
        `;
        
        // Calculate total costs
        const aggregated = aggregateStackCosts(project.layers);
        const consolidated = consolidateVariableCosts(aggregated);
        
        // Separate fixed and variable from consolidated array
        const totalFixed = consolidated
            .filter(c => c.type === 'fixed')
            .reduce((sum, c) => sum + c.amount, 0);
        const totalVariable = consolidated
            .filter(c => c.type === 'variable')
            .reduce((sum, c) => sum + c.amount, 0);
        const totalCost = totalFixed + totalVariable;
        
        // Total cost card
        const totalCard = document.createElement('div');
        totalCard.style.cssText = `
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 8px;
            padding: 16px;
        `;
        totalCard.innerHTML = `
            <div style="color: #94a3b8; font-size: 12px; font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">Total Monthly Cost</div>
            <div style="color: #10b981; font-size: 24px; font-weight: 700;">${formatCost(totalCost)}</div>
            <div style="color: #64748b; font-size: 11px; margin-top: 8px;">Fixed: ${formatCost(totalFixed)} | Variable: ${formatCost(totalVariable, 'USD', true)}</div>
        `;
        summarySection.appendChild(totalCard);
        
        // Fixed cost card
        const fixedCard = document.createElement('div');
        fixedCard.style.cssText = `
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 8px;
            padding: 16px;
        `;
        fixedCard.innerHTML = `
            <div style="color: #94a3b8; font-size: 12px; font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">Fixed Costs</div>
            <div style="color: #3b82f6; font-size: 24px; font-weight: 700;">${formatCost(totalFixed)}</div>
            <div style="color: #64748b; font-size: 11px; margin-top: 8px;">Infrastructure base</div>
        `;
        summarySection.appendChild(fixedCard);
        
        // Variable cost card
        const variableCard = document.createElement('div');
        variableCard.style.cssText = `
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 8px;
            padding: 16px;
        `;
        variableCard.innerHTML = `
            <div style="color: #94a3b8; font-size: 12px; font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">Variable Costs</div>
            <div style="color: #f59e0b; font-size: 24px; font-weight: 700;">${formatCost(totalVariable, 'USD', true)}</div>
            <div style="color: #64748b; font-size: 11px; margin-top: 8px;">Usage-based</div>
        `;
        summarySection.appendChild(variableCard);
        
        // Actions count card
        const actionsCard = document.createElement('div');
        actionsCard.style.cssText = `
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 8px;
            padding: 16px;
        `;
        actionsCard.innerHTML = `
            <div style="color: #94a3b8; font-size: 12px; font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">Total Actions</div>
            <div style="color: #e2e8f0; font-size: 24px; font-weight: 700;">${project.usePaths ? project.usePaths.length : 0}</div>
            <div style="color: #64748b; font-size: 11px; margin-top: 8px;">User journeys defined</div>
        `;
        summarySection.appendChild(actionsCard);
        
        container.appendChild(summarySection);
        
        // Side-by-side section for layers and actions
        const comparisonSection = document.createElement('div');
        comparisonSection.style.cssText = `
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
            margin-bottom: 32px;
        `;
        
        // Most expensive layers section
        const expensiveLayersSection = document.createElement('div');
        
        const expensiveTitle = document.createElement('h3');
        expensiveTitle.textContent = 'Most Expensive Layers';
        expensiveTitle.style.cssText = `
            color: #e2e8f0;
            font-size: 14px;
            font-weight: 600;
            margin: 0 0 16px 0;
        `;
        expensiveLayersSection.appendChild(expensiveTitle);
        
        const allLayers = getAllLayers();
        const layerCosts = allLayers.map(layer => ({
            layer,
            cost: calculateTotalLayerCost(layer)
        })).sort((a, b) => b.cost - a.cost).slice(0, 5);
        
        const layerTable = document.createElement('div');
        layerTable.style.cssText = `
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 8px;
            overflow: hidden;
        `;
        
        layerCosts.forEach((item, idx) => {
            const row = document.createElement('div');
            row.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                border-bottom: ${idx < layerCosts.length - 1 ? '1px solid #334155' : 'none'};
            `;
            
            const nameDiv = document.createElement('div');
            nameDiv.style.cssText = `
                flex: 1;
            `;
            nameDiv.innerHTML = `
                <div style="color: #e2e8f0; font-weight: 600; font-size: 13px;">${item.layer.name}</div>
                <div style="color: #94a3b8; font-size: 11px;">${item.layer.type}</div>
            `;
            
            const costDiv = document.createElement('div');
            costDiv.style.cssText = `
                text-align: right;
            `;
            costDiv.innerHTML = `
                <div style="color: #e2e8f0; font-weight: 600; font-size: 13px;">${formatCost(item.cost)}</div>
                <div style="color: #94a3b8; font-size: 11px;">per month</div>
            `;
            
            row.appendChild(nameDiv);
            row.appendChild(costDiv);
            layerTable.appendChild(row);
        });
        
        expensiveLayersSection.appendChild(layerTable);
        comparisonSection.appendChild(expensiveLayersSection);
        
        // Most expensive actions section (by variable cost per use)
        if (project.usePaths && project.usePaths.length > 0) {
            const expensiveActionsSection = document.createElement('div');
            
            const expensiveActionsTitle = document.createElement('h3');
            expensiveActionsTitle.textContent = 'Most Expensive Actions (by Variable Cost)';
            expensiveActionsTitle.style.cssText = `
                color: #e2e8f0;
                font-size: 14px;
                font-weight: 600;
                margin: 0 0 16px 0;
            `;
            expensiveActionsSection.appendChild(expensiveActionsTitle);
            
            const actionCosts = project.usePaths
                .filter(action => action.layersInvolved && action.layersInvolved.length > 0)
                .map(action => {
                    try {
                        const costs = calculateActionCost(action, allLayers);
                        // Use variable cost per use (not monthly total)
                        const variableCostPerUse = costs.costPerUse.variable;
                        return { action, cost: variableCostPerUse };
                    } catch (e) {
                        console.warn(`Failed to calculate cost for action ${action.name}:`, e);
                        return { action, cost: 0 };
                    }
                })
                .sort((a, b) => b.cost - a.cost)
                .slice(0, 5);
            
            const actionTable = document.createElement('div');
            actionTable.style.cssText = `
                background: #1e293b;
                border: 1px solid #334155;
                border-radius: 8px;
                overflow: hidden;
            `;
            
            actionCosts.forEach((item, idx) => {
                const row = document.createElement('div');
                row.style.cssText = `
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 16px;
                    border-bottom: ${idx < actionCosts.length - 1 ? '1px solid #334155' : 'none'};
                `;
                
                const nameDiv = document.createElement('div');
                nameDiv.style.cssText = `
                    flex: 1;
                `;
                nameDiv.innerHTML = `
                    <div style="color: #e2e8f0; font-weight: 600; font-size: 13px;">${item.action.name}</div>
                    <div style="color: #94a3b8; font-size: 11px;">${item.action.layersInvolved.length} steps</div>
                `;
                
                const costDiv = document.createElement('div');
                costDiv.style.cssText = `
                    text-align: right;
                `;
                costDiv.innerHTML = `
                    <div style="color: #f59e0b; font-weight: 600; font-size: 13px;">${formatCost(item.cost, 'USD', true)}</div>
                    <div style="color: #94a3b8; font-size: 11px;">per use</div>
                `;
                
                row.appendChild(nameDiv);
                row.appendChild(costDiv);
                actionTable.appendChild(row);
            });
            
            expensiveActionsSection.appendChild(actionTable);
            comparisonSection.appendChild(expensiveActionsSection);
        }
        
        container.appendChild(comparisonSection);
        
        // Recommendations section
        const recommendations = generateRecommendations();
        if (recommendations.length > 0) {
            const recsSection = document.createElement('div');
            recsSection.style.cssText = `
                margin-bottom: 32px;
            `;
            
            const recsTitle = document.createElement('h3');
            recsTitle.textContent = 'Optimization Recommendations';
            recsTitle.style.cssText = `
                color: #e2e8f0;
                font-size: 14px;
                font-weight: 600;
                margin: 0 0 16px 0;
            `;
            recsSection.appendChild(recsTitle);
            
            recommendations.slice(0, 3).forEach(rec => {
                const severityColors = {
                    high: '#ef4444',
                    medium: '#f59e0b',
                    low: '#3b82f6'
                };
                
                const recCard = document.createElement('div');
                recCard.style.cssText = `
                    background: #1e293b;
                    border-left: 4px solid ${severityColors[rec.severity]};
                    border-radius: 4px;
                    padding: 12px 16px;
                    margin-bottom: 8px;
                `;
                recCard.innerHTML = `
                    <div style="color: ${severityColors[rec.severity]}; font-weight: 600; font-size: 12px; text-transform: uppercase; margin-bottom: 4px;">${rec.severity}</div>
                    <div style="color: #e2e8f0; font-weight: 600; font-size: 13px; margin-bottom: 4px;">${rec.title}</div>
                    <div style="color: #94a3b8; font-size: 12px;">${rec.description}</div>
                `;
                recsSection.appendChild(recCard);
            });
            
            container.appendChild(recsSection);
        }
        
        // Navigation buttons
        const navSection = document.createElement('div');
        navSection.style.cssText = `
            display: flex;
            gap: 12px;
            margin-top: 32px;
            padding-top: 16px;
            border-top: 1px solid #334155;
        `;
        
        const compareBtn = document.createElement('button');
        compareBtn.innerHTML = '📈 Compare Actions';
        compareBtn.style.cssText = `
            flex: 1;
            background: #06b6d4;
            color: #0f172a;
            border: none;
            padding: 12px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            font-size: 13px;
            transition: background 0.2s;
        `;
        compareBtn.onmouseover = () => compareBtn.style.background = '#0891b2';
        compareBtn.onmouseout = () => compareBtn.style.background = '#06b6d4';
        compareBtn.onclick = renderCostComparison;
        navSection.appendChild(compareBtn);
        
        const forecastBtn = document.createElement('button');
        forecastBtn.innerHTML = '🔮 Forecast';
        forecastBtn.style.cssText = `
            flex: 1;
            background: #a855f7;
            color: #fff;
            border: none;
            padding: 12px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            font-size: 13px;
            transition: background 0.2s;
        `;
        forecastBtn.onmouseover = () => forecastBtn.style.background = '#9333ea';
        forecastBtn.onmouseout = () => forecastBtn.style.background = '#a855f7';
        forecastBtn.onclick = renderCostForecasting;
        navSection.appendChild(forecastBtn);
        
        container.appendChild(navSection);
        
    } catch (error) {
        console.error('[renderCostDashboard] Error:', error);
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            color: #ef4444;
            padding: 20px;
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 8px;
            margin-top: 16px;
        `;
        errorDiv.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 8px;">Error rendering cost dashboard:</div>
            <div style="font-size: 12px; font-family: monospace; white-space: pre-wrap;">${error.message}</div>
        `;
        container.appendChild(errorDiv);
    }
}


/**
 * Render cost comparison view with sortable table
 */
function renderCostComparison() {
    const container = document.getElementById('cost-dashboard-view');
    container.innerHTML = '';
    
    container.style.cssText = `
        display: flex;
        flex-direction: column;
        flex: 1;
        background: #0f172a;
        overflow-y: auto;
        padding: 24px;
    `;
    
    try {
        // Header with back button
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 32px;
            padding-bottom: 16px;
            border-bottom: 2px solid #334155;
        `;
        
        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = `
            display: flex;
            align-items: center;
            gap: 12px;
        `;
        
        const backBtn = document.createElement('button');
        backBtn.textContent = '← Back';
        backBtn.style.cssText = `
            background: #334155;
            color: #e2e8f0;
            border: none;
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
        `;
        backBtn.onclick = renderCostDashboard;
        titleDiv.appendChild(backBtn);
        
        const title = document.createElement('h2');
        title.textContent = 'Cost Comparison';
        title.style.cssText = `
            margin: 0;
            color: #e2e8f0;
            font-size: 20px;
            font-weight: 700;
        `;
        titleDiv.appendChild(title);
        header.appendChild(titleDiv);
        container.appendChild(header);
        
        // Sort dropdown
        const sortDiv = document.createElement('div');
        sortDiv.style.cssText = `
            margin-bottom: 16px;
            display: flex;
            gap: 8px;
            align-items: center;
        `;
        
        const sortLabel = document.createElement('label');
        sortLabel.textContent = 'Sort by:';
        sortLabel.style.cssText = `
            color: #94a3b8;
            font-size: 12px;
            font-weight: 600;
        `;
        sortDiv.appendChild(sortLabel);
        
        const sortSelect = document.createElement('select');
        sortSelect.style.cssText = `
            background: #1e293b;
            color: #e2e8f0;
            border: 1px solid #334155;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
        `;
        
        const sortOptions = [
            { value: 'variable-desc', label: 'Variable Cost Per Use (High to Low)' },
            { value: 'variable-asc', label: 'Variable Cost Per Use (Low to High)' },
            { value: 'monthly-desc', label: 'Monthly Cost (High to Low)' },
            { value: 'monthly-asc', label: 'Monthly Cost (Low to High)' },
            { value: 'layers-desc', label: 'Steps (Most to Least)' },
            { value: 'name-asc', label: 'Name (A to Z)' }
        ];
        
        sortOptions.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            sortSelect.appendChild(option);
        });
        
        sortSelect.onchange = () => {
            renderComparisonTable(sortSelect.value);
        };
        
        sortDiv.appendChild(sortSelect);
        container.appendChild(sortDiv);
        
        // Render table
        renderComparisonTable('variable-desc');
        
    } catch (error) {
        console.error('[renderCostComparison] Error:', error);
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            color: #ef4444;
            padding: 20px;
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 8px;
        `;
        errorDiv.textContent = `Error: ${error.message}`;
        container.appendChild(errorDiv);
    }
}

/**
 * Render comparison table with sorting
 */
function renderComparisonTable(sortBy = 'variable-desc') {
    const container = document.getElementById('cost-dashboard-view');
    const existingTable = container.querySelector('[data-comparison-table]');
    if (existingTable) existingTable.remove();
    
    if (!project.usePaths || project.usePaths.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = `
            color: #94a3b8;
            padding: 32px;
            text-align: center;
        `;
        emptyDiv.textContent = 'No actions defined yet';
        container.appendChild(emptyDiv);
        return;
    }
    
    const allLayers = getAllLayers();
    let actions = project.usePaths
        .filter(a => a.layersInvolved && a.layersInvolved.length > 0)
        .map(action => {
            try {
                const costs = calculateActionCost(action, allLayers);
                return {
                    action,
                    variableCostPerUse: costs.costPerUse.variable,
                    monthlyCost: costs.monthlyCost.total,
                    costPerUser: costs.costPerUser.total,
                    steps: action.layersInvolved.length
                };
            } catch (e) {
                return {
                    action,
                    variableCostPerUse: 0,
                    monthlyCost: 0,
                    costPerUser: 0,
                    steps: action.layersInvolved.length
                };
            }
        });
    
    // Sort
    switch (sortBy) {
        case 'variable-asc':
            actions.sort((a, b) => a.variableCostPerUse - b.variableCostPerUse);
            break;
        case 'monthly-desc':
            actions.sort((a, b) => b.monthlyCost - a.monthlyCost);
            break;
        case 'monthly-asc':
            actions.sort((a, b) => a.monthlyCost - b.monthlyCost);
            break;
        case 'layers-desc':
            actions.sort((a, b) => b.steps - a.steps);
            break;
        case 'name-asc':
            actions.sort((a, b) => a.action.name.localeCompare(b.action.name));
            break;
        default: // variable-desc
            actions.sort((a, b) => b.variableCostPerUse - a.variableCostPerUse);
    }
    
    const table = document.createElement('div');
    table.setAttribute('data-comparison-table', 'true');
    table.style.cssText = `
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 8px;
        overflow: hidden;
    `;
    
    // Header
    const headerRow = document.createElement('div');
    headerRow.style.cssText = `
        display: grid;
        grid-template-columns: 2fr 1.2fr 1.2fr 1fr 0.8fr;
        gap: 16px;
        padding: 12px 16px;
        background: #0f172a;
        border-bottom: 1px solid #334155;
        font-weight: 600;
        font-size: 12px;
        color: #94a3b8;
        text-transform: uppercase;
    `;
    headerRow.innerHTML = `
        <div>Action</div>
        <div style="text-align: right;">Variable/Use</div>
        <div style="text-align: right;">Monthly</div>
        <div style="text-align: right;">Per User</div>
        <div style="text-align: right;">Steps</div>
    `;
    table.appendChild(headerRow);
    
    // Rows
    actions.forEach((item, idx) => {
        const row = document.createElement('div');
        row.style.cssText = `
            display: grid;
            grid-template-columns: 2fr 1.2fr 1.2fr 1fr 0.8fr;
            gap: 16px;
            padding: 12px 16px;
            border-bottom: ${idx < actions.length - 1 ? '1px solid #334155' : 'none'};
            cursor: pointer;
            transition: background 0.2s;
            align-items: center;
        `;
        row.onmouseover = () => row.style.background = '#0f172a';
        row.onmouseout = () => row.style.background = 'transparent';
        row.onclick = () => {
            selectedActionId = item.action.id;
            renderActionAssemblyPanel(item.action);
        };
        
        row.innerHTML = `
            <div style="color: #e2e8f0; font-weight: 600; font-size: 13px;">${item.action.name}</div>
            <div style="color: #f59e0b; font-weight: 600; text-align: right;">${formatCost(item.variableCostPerUse, 'USD', true)}</div>
            <div style="color: #10b981; font-weight: 600; text-align: right;">${formatCost(item.monthlyCost)}</div>
            <div style="color: #3b82f6; font-weight: 600; text-align: right;">${formatCost(item.costPerUser)}</div>
            <div style="color: #94a3b8; text-align: right;">${item.steps}</div>
        `;
        
        table.appendChild(row);
    });
    
    const container2 = document.getElementById('cost-dashboard-view');
    container2.appendChild(table);
}

/**
 * Render cost forecasting view
 */
function renderCostForecasting() {
    const container = document.getElementById('cost-dashboard-view');
    container.innerHTML = '';
    
    container.style.cssText = `
        display: flex;
        flex-direction: column;
        flex: 1;
        background: #0f172a;
        overflow-y: auto;
        padding: 24px;
    `;
    
    try {
        // Header with back button
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 32px;
            padding-bottom: 16px;
            border-bottom: 2px solid #334155;
        `;
        
        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = `
            display: flex;
            align-items: center;
            gap: 12px;
        `;
        
        const backBtn = document.createElement('button');
        backBtn.textContent = '← Back';
        backBtn.style.cssText = `
            background: #334155;
            color: #e2e8f0;
            border: none;
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
        `;
        backBtn.onclick = renderCostDashboard;
        titleDiv.appendChild(backBtn);
        
        const title = document.createElement('h2');
        title.textContent = 'Cost Forecasting';
        title.style.cssText = `
            margin: 0;
            color: #e2e8f0;
            font-size: 20px;
            font-weight: 700;
        `;
        titleDiv.appendChild(title);
        header.appendChild(titleDiv);
        container.appendChild(header);
        
        // Scenario cards
        const scenarios = [
            { label: 'Current', multiplier: 1, color: '#3b82f6' },
            { label: '2x Growth', multiplier: 2, color: '#06b6d4' },
            { label: '5x Growth', multiplier: 5, color: '#f59e0b' },
            { label: '10x Growth', multiplier: 10, color: '#ef4444' },
            { label: '50% Reduction', multiplier: 0.5, color: '#10b981' }
        ];
        
        const aggregated = aggregateStackCosts(project.layers);
        const consolidated = consolidateVariableCosts(aggregated);
        
        const totalFixed = consolidated
            .filter(c => c.type === 'fixed')
            .reduce((sum, c) => sum + c.amount, 0);
        const totalVariable = consolidated
            .filter(c => c.type === 'variable')
            .reduce((sum, c) => sum + c.amount, 0);
        
        const scenariosDiv = document.createElement('div');
        scenariosDiv.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 32px;
        `;
        
        scenarios.forEach(scenario => {
            const projectedVariable = totalVariable * scenario.multiplier;
            const projectedTotal = totalFixed + projectedVariable;
            
            const card = document.createElement('div');
            card.style.cssText = `
                background: #1e293b;
                border: 2px solid ${scenario.color};
                border-radius: 8px;
                padding: 16px;
            `;
            card.innerHTML = `
                <div style="color: ${scenario.color}; font-size: 12px; font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">${scenario.label}</div>
                <div style="color: #e2e8f0; font-size: 20px; font-weight: 700; margin-bottom: 8px;">${formatCost(projectedTotal)}</div>
                <div style="color: #64748b; font-size: 11px;">
                    Fixed: ${formatCost(totalFixed)}<br>
                    Variable: ${formatCost(projectedVariable, 'USD', true)}
                </div>
            `;
            scenariosDiv.appendChild(card);
        });
        
        container.appendChild(scenariosDiv);
        
        // Explanation
        const explanation = document.createElement('div');
        explanation.style.cssText = `
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 8px;
            padding: 16px;
            color: #94a3b8;
            font-size: 12px;
            line-height: 1.6;
        `;
        explanation.innerHTML = `
            <div style="font-weight: 600; color: #e2e8f0; margin-bottom: 8px;">Forecasting Scenarios</div>
            <div>These scenarios show how your costs would change under different growth conditions:</div>
            <ul style="margin: 8px 0; padding-left: 20px;">
                <li><strong>Current:</strong> Your baseline monthly cost</li>
                <li><strong>2x/5x/10x Growth:</strong> Variable costs scale with usage</li>
                <li><strong>50% Reduction:</strong> Optimization scenario</li>
            </ul>
            <div style="margin-top: 8px;">Fixed costs remain constant. Variable costs scale with the multiplier.</div>
        `;
        container.appendChild(explanation);
        
    } catch (error) {
        console.error('[renderCostForecasting] Error:', error);
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            color: #ef4444;
            padding: 20px;
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 8px;
        `;
        errorDiv.textContent = `Error: ${error.message}`;
        container.appendChild(errorDiv);
    }
}

/**
 * Generate optimization recommendations
 */
function generateRecommendations() {
    const recommendations = [];
    const allLayers = getAllLayers();
    
    // Check for expensive single-layer actions (by variable cost)
    if (project.usePaths) {
        project.usePaths.forEach(action => {
            if (action.layersInvolved && action.layersInvolved.length === 1) {
                try {
                    const costs = calculateActionCost(action, allLayers);
                    const variableCostPerUse = costs.costPerUse.variable;
                    // Flag if variable cost per use is high (>$0.001)
                    if (variableCostPerUse > 0.001) {
                        recommendations.push({
                            severity: 'high',
                            title: `High Variable Cost Action: ${action.name}`,
                            description: `This action has ${formatCost(variableCostPerUse, 'USD', true)}/use variable cost. Consider optimization.`,
                            type: 'single-layer'
                        });
                    }
                } catch (e) {
                    // Skip if calculation fails
                }
            }
        });
    }
    
    // Check for underutilized expensive layers (by fixed cost)
    allLayers.forEach(layer => {
        const fixedCost = layer.costModel?.fixedCost || 0;
        if (fixedCost > 500) {
            const usageCount = (project.usePaths || []).filter(action =>
                action.layersInvolved && action.layersInvolved.includes(layer.id)
            ).length;
            
            if (usageCount < 2) {
                recommendations.push({
                    severity: 'medium',
                    title: `Underutilized Expensive Layer: ${layer.name}`,
                    description: `This layer costs ${formatCost(fixedCost)}/month fixed but is only used in ${usageCount} action(s).`,
                    type: 'underutilized'
                });
            }
        }
    });
    
    // Check for actions with high variable cost proportion
    if (project.usePaths) {
        project.usePaths.forEach(action => {
            try {
                const costs = calculateActionCost(action, allLayers);
                const variablePercent = (costs.monthlyCost.variable / costs.monthlyCost.total) * 100;
                if (variablePercent > 80 && costs.costPerUse.variable > 0.0001) {
                    recommendations.push({
                        severity: 'low',
                        title: `High Variable Cost Proportion: ${action.name}`,
                        description: `${variablePercent.toFixed(0)}% of this action's cost is variable. Consider caching.`,
                        type: 'variable'
                    });
                }
            } catch (e) {
                // Skip if calculation fails
            }
        });
    }
    
    return recommendations;
}
