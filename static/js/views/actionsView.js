/**
 * Actions View Module
 * Handles the actions/flows visualization and management
 */

function renderActionsView() {
    const container = document.getElementById('actions-view');
    
    // Check if we need to do a full render or just update the list
    const existingFilterContainer = container.querySelector('[data-filter-container]');
    const isFullRender = !existingFilterContainer;
    
    if (isFullRender) {
        container.innerHTML = '';
    }
    
    // Header with buttons (only render on full render)
    if (isFullRender) {
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 32px;
            padding-bottom: 16px;
            border-bottom: 2px solid #334155;
            flex-wrap: wrap;
            gap: 12px;
        `;
        
        const title = document.createElement('h2');
        title.textContent = 'Actions & Flows';
        title.style.cssText = `
            margin: 0;
            color: #e2e8f0;
            font-size: 20px;
            font-weight: 700;
            letter-spacing: -0.5px;
            flex: 1;
        `;
        
        const buttonGroup = document.createElement('div');
        buttonGroup.style.cssText = `
            display: flex;
            gap: 8px;
        `;
        
        const helpBtn = document.createElement('button');
        helpBtn.textContent = '🛈';
        helpBtn.style.cssText = `
            background: #2b4a76ff;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s;
        `;
        helpBtn.onmouseover = () => helpBtn.style.background = '#466da4ff';
        helpBtn.onmouseout = () => helpBtn.style.background = '#2b4a76ff';
        helpBtn.onclick = () => showBestPracticesModal();
        
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
            transition: all 0.2s;
        `;
        importBtn.onmouseover = () => importBtn.style.background = '#7c3aed';
        importBtn.onmouseout = () => importBtn.style.background = '#8b5cf6';
        importBtn.onclick = () => importActionsFromConnections();
        
        const addBtn = document.createElement('button');
        addBtn.textContent = '+ New Action';
        addBtn.style.cssText = `
            background: #3b82f6;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s;
        `;
        addBtn.onmouseover = () => addBtn.style.background = '#2563eb';
        addBtn.onmouseout = () => addBtn.style.background = '#3b82f6';
        addBtn.onclick = () => createNewAction();
        
        buttonGroup.appendChild(helpBtn);
        buttonGroup.appendChild(importBtn);
        buttonGroup.appendChild(addBtn);
        header.appendChild(title);
        header.appendChild(buttonGroup);
        container.appendChild(header);
    }
    
    // Initialize filter state if not exists
    if (!window.actionsFilterState) {
        window.actionsFilterState = {
            searchText: '',
            selectedLayerTypes: [],
            sortBy: 'name'
        };
    }
    
    // Create or preserve filter container
    let filterContainer = container.querySelector('[data-filter-container]');
    if (!filterContainer) {
        filterContainer = document.createElement('div');
        filterContainer.setAttribute('data-filter-container', 'true');
        filterContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-bottom: 24px;
            padding: 16px;
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 6px;
        `;
        
        // Top row: Search and Sort
        const topRow = document.createElement('div');
        topRow.style.cssText = `
            display: flex;
            gap: 12px;
            align-items: center;
        `;
        
        // Search input
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search actions...';
        searchInput.value = window.actionsFilterState.searchText;
        searchInput.setAttribute('data-search-input', 'true');
        searchInput.style.cssText = `
            flex: 1;
            background: #0f172a;
            border: 1px solid #334155;
            color: #e2e8f0;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            transition: all 0.2s;
        `;
        searchInput.onfocus = () => {
            searchInput.style.borderColor = '#3b82f6';
            searchInput.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.1)';
        };
        searchInput.onblur = () => {
            searchInput.style.borderColor = '#334155';
            searchInput.style.boxShadow = 'none';
        };
        
        // Debounced search handler - only update list, not entire view
        let searchDebounceTimer;
        searchInput.oninput = (e) => {
            window.actionsFilterState.searchText = e.target.value;
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                updateActionsListOnly();
            }, 300);
        };
        
        // Sort dropdown
        const sortSelect = document.createElement('select');
        sortSelect.style.cssText = `
            background: #0f172a;
            border: 1px solid #334155;
            color: #e2e8f0;
            padding: 8px 10px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
        `;
        
        const sortOptions = [
            { value: 'name', label: 'Name (A-Z)' },
            { value: 'cost', label: 'Cost (High to Low)' },
            { value: 'steps', label: 'Steps (Most to Least)' }
        ];
        
        sortOptions.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            sortSelect.appendChild(option);
        });
        
        sortSelect.value = window.actionsFilterState.sortBy;
        sortSelect.onchange = (e) => {
            window.actionsFilterState.sortBy = e.target.value;
            renderActionsView();
        };
        
        topRow.appendChild(searchInput);
        topRow.appendChild(sortSelect);
        
        // Bottom row: Layer type filters
        const bottomRow = document.createElement('div');
        bottomRow.style.cssText = `
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            align-items: center;
        `;
        
        const layerTypeLabel = document.createElement('span');
        layerTypeLabel.textContent = 'Layer Types:';
        layerTypeLabel.style.cssText = `
            color: #94a3b8;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            white-space: nowrap;
        `;
        bottomRow.appendChild(layerTypeLabel);
        
        const layerTypes = ['Frontend', 'API', 'Backend', 'Database', 'DevOps'];
        const typeColors = {
            'Frontend': '#06b6d4',
            'API': '#8b5cf6',
            'Backend': '#10b981',
            'Database': '#f59e0b',
            'DevOps': '#ef4444'
        };
        
        layerTypes.forEach(type => {
            const isSelected = window.actionsFilterState.selectedLayerTypes.includes(type);
            
            const badge = document.createElement('button');
            badge.textContent = type;
            badge.style.cssText = `
                background: ${isSelected ? typeColors[type] : typeColors[type] + '20'};
                border: 1px solid ${typeColors[type]};
                color: ${isSelected ? '#ffffff' : typeColors[type]};
                padding: 4px 10px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                transition: all 0.2s;
                white-space: nowrap;
            `;
            
            badge.onmouseover = () => {
                if (!isSelected) {
                    badge.style.background = typeColors[type] + '40';
                }
            };
            badge.onmouseout = () => {
                if (!isSelected) {
                    badge.style.background = typeColors[type] + '20';
                }
            };
            
            badge.onclick = () => {
                if (isSelected) {
                    window.actionsFilterState.selectedLayerTypes = window.actionsFilterState.selectedLayerTypes.filter(t => t !== type);
                } else {
                    window.actionsFilterState.selectedLayerTypes.push(type);
                }
                renderActionsView();
            };
            
            bottomRow.appendChild(badge);
        });
        
        // Clear filters button
        const clearBtn = document.createElement('button');
        clearBtn.textContent = '✕ Clear';
        clearBtn.style.cssText = `
            background: transparent;
            color: #94a3b8;
            border: 1px solid #475569;
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            transition: all 0.2s;
            margin-left: auto;
        `;
        clearBtn.onmouseover = () => {
            clearBtn.style.background = '#475569';
            clearBtn.style.color = '#e2e8f0';
        };
        clearBtn.onmouseout = () => {
            clearBtn.style.background = 'transparent';
            clearBtn.style.color = '#94a3b8';
        };
        clearBtn.onclick = () => {
            window.actionsFilterState = {
                searchText: '',
                selectedLayerTypes: [],
                sortBy: 'name'
            };
            renderActionsView();
        };
        bottomRow.appendChild(clearBtn);
        
        filterContainer.appendChild(topRow);
        filterContainer.appendChild(bottomRow);
        container.appendChild(filterContainer);
    } else {
        // Update search input value if changed externally
        const searchInput = filterContainer.querySelector('[data-search-input]');
        if (searchInput && searchInput !== document.activeElement) {
            searchInput.value = window.actionsFilterState.searchText;
        }
    }
    
    // Clear old actions list but keep filter container
    let actionsListContainer = container.querySelector('[data-actions-list]');
    if (actionsListContainer) {
        actionsListContainer.remove();
    }
    
    actionsListContainer = document.createElement('div');
    actionsListContainer.setAttribute('data-actions-list', 'true');
    container.appendChild(actionsListContainer);
    
    // Render the actions list
    renderActionsListContent(actionsListContainer);
}

function updateActionsListOnly() {
    const container = document.getElementById('actions-view');
    let actionsListContainer = container.querySelector('[data-actions-list]');
    
    if (actionsListContainer) {
        actionsListContainer.innerHTML = '';
    } else {
        actionsListContainer = document.createElement('div');
        actionsListContainer.setAttribute('data-actions-list', 'true');
        container.appendChild(actionsListContainer);
    }
    
    renderActionsListContent(actionsListContainer);
}
