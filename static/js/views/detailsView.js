/**
 * Details View Module
 * Renders the right-hand panel for the selected layer/substack.
 *
 * All interpolated values are passed through escapeHtml()/escapeJsString()
 * (see utils.js). Real stack data — e.g. sample-saas.json — contains quotes,
 * backticks and angle brackets in descriptions/responsibilities that would
 * otherwise break the markup or inject script.
 */

function renderLayerDetails(layer) {
    const detailsDiv = document.getElementById('layer-details');
    const availableTargets = getAvailableConnectionTargets(layer);

    // Canonical { targetId, type } connection objects.
    const normalizedConnections = getConnections(layer);

    // Preserve the currently-open tab across rebuilds so editing a field or
    // re-selecting doesn't yank the user back to Properties.
    const previouslyActive = detailsDiv.querySelector('.detail-tab.active');
    const activeTab = previouslyActive ? previouslyActive.getAttribute('data-tab') : 'properties';

    const searchInputId = `conn-search-${escapeHtml(layer.id)}`;

    const substackList = layer.substacks && layer.substacks.length > 0 ? `
        <div class="substack-list">
            ${layer.substacks.map((sub, idx) => `
                <div class="substack-row" onclick="enterSubstack(); selectLayer(${idx})">
                    <div class="substack-row-main">
                        <div class="substack-row-name">${escapeHtml(sub.name)}</div>
                        <div class="substack-row-meta">${escapeHtml(sub.type)} • ${escapeHtml(sub.status)}</div>
                    </div>
                    <div class="substack-row-arrow">→</div>
                </div>
            `).join('')}
        </div>
    ` : `
        <div class="empty-hint">No substacks yet. Add one below.</div>
    `;

    const substackSection = !inSubstack ? `
        <div class="detail-section detail-section-flush">
            <div class="detail-label">Substacks (${layer.substacks ? layer.substacks.length : 0})</div>
            ${substackList}
            <button class="btn btn-secondary btn-full" onclick="addSubstackLayer()">+ Add Substack Layer</button>
        </div>
    ` : '';

    detailsDiv.innerHTML = `
        <div class="details-shell">
            <!-- Tab Navigation -->
            <div class="detail-tabs">
                <button class="detail-tab" data-tab="properties" onclick="switchDetailTab('properties')">
                    Properties
                </button>
                <button class="detail-tab" data-tab="connections" onclick="switchDetailTab('connections')">
                    Connections <span class="tab-count">${normalizedConnections.length}</span>
                </button>
                <button class="detail-tab" data-tab="cost" onclick="switchDetailTab('cost')">
                    Cost
                </button>
                ${!inSubstack ? `
                    <button class="detail-tab" data-tab="substacks" onclick="switchDetailTab('substacks')">
                        Substacks <span class="tab-count">${layer.substacks ? layer.substacks.length : 0}</span>
                    </button>
                ` : ''}
            </div>

            <!-- Tab Content -->
            <div class="detail-tab-body">
                <!-- Properties Tab -->
                <div class="detail-tab-content" data-tab="properties">
                    <div class="detail-section detail-section-flush">
                        <div class="detail-label">Layer Name</div>
                        <input type="text" class="detail-input" value="${escapeHtml(layer.name)}"
                               onchange="updateLayerField('name', this.value)">
                    </div>

                    <div class="detail-grid-2">
                        <div class="detail-section detail-section-flush">
                            <div class="detail-label">Type</div>
                            <select class="detail-select" onchange="updateLayerField('type', this.value)">
                                ${Object.keys(LAYER_TYPES).map(type =>
                                    `<option value="${escapeHtml(type)}" ${layer.type === type ? 'selected' : ''}>${escapeHtml(type)}</option>`
                                ).join('')}
                            </select>
                        </div>

                        <div class="detail-section detail-section-flush">
                            <div class="detail-label">Status</div>
                            <select class="detail-select" onchange="updateLayerField('status', this.value)">
                                ${LAYER_STATUSES.map(s =>
                                    `<option value="${escapeHtml(s)}" ${layer.status === s ? 'selected' : ''}>${escapeHtml(s)}</option>`
                                ).join('')}
                            </select>
                        </div>
                    </div>

                    <div class="detail-section detail-section-flush">
                        <div class="detail-label">Technology</div>
                        <input type="text" class="detail-input" value="${escapeHtml(layer.technology || '')}"
                               placeholder="e.g., React, Node.js, PostgreSQL"
                               onchange="updateLayerField('technology', this.value)">
                    </div>

                    <div class="detail-grid-2">
                        <div class="detail-section detail-section-flush">
                            <div class="detail-label">Description</div>
                            <textarea class="detail-textarea"
                                      onchange="updateLayerField('description', this.value)">${escapeHtml(layer.description || '')}</textarea>
                        </div>

                        <div class="detail-section detail-section-flush">
                            <div class="detail-label">Responsibilities</div>
                            <textarea class="detail-textarea"
                                      placeholder="What does this component do?"
                                      onchange="updateLayerField('responsibilities', this.value)">${escapeHtml(layer.responsibilities || '')}</textarea>
                        </div>
                    </div>

                    <div class="detail-actions">
                        <button class="btn btn-secondary" onclick="moveLayer(-1)" title="Move layer up">↑ Move Up</button>
                        <button class="btn btn-secondary" onclick="moveLayer(1)" title="Move layer down">↓ Move Down</button>
                    </div>

                    <button class="btn btn-danger btn-full" onclick="deleteLayer()">Delete ${inSubstack ? 'Substack Component' : 'Layer'}</button>
                </div>

                <!-- Connections Tab -->
                <div class="detail-tab-content" data-tab="connections">
                    <div class="detail-section detail-section-fill">
                        <div class="detail-row-between">
                            <div class="detail-label detail-label-inline">Connections ${inSubstack ? '(Substack)' : '(Layer)'}</div>
                            <span class="muted-sm">${normalizedConnections.length}/${availableTargets.length}</span>
                        </div>
                        <div class="muted-sm detail-hint">
                            ${inSubstack ? 'Connections from this substack component' : 'Connections from this layer'}
                        </div>
                        <input type="text" id="${searchInputId}" class="detail-input detail-input-sm" placeholder="Search connections..."
                               onkeyup="filterConnections('${escapeJsString(searchInputId)}', '${escapeJsString(layer.id)}')">
                        <div class="connections-list">
                            ${availableTargets.length === 0 ? '<span class="muted-sm">No available targets</span>' : ''}
                            ${availableTargets.map(target => {
                                const existingConnection = normalizedConnections.find(c => c.targetId == target.id);
                                const connectionType = existingConnection ? existingConnection.type : 'HTTP';
                                const connectionLabel = existingConnection && existingConnection.label ? existingConnection.label : '';
                                const tid = escapeJsString(target.id);
                                return `
                                <div class="connection-item connection-item-stacked" data-search="${escapeHtml((target.name + target.type).toLowerCase())}">
                                    <div class="connection-item-row">
                                        <input type="checkbox" ${existingConnection ? 'checked' : ''}
                                               onchange="toggleConnection('${tid}', this.checked, '${escapeJsString(connectionType)}')">
                                        <div class="connection-item-main">
                                            <div class="connection-item-name">${escapeHtml(target.name)}</div>
                                            <div class="connection-item-type">${escapeHtml(target.type)}${target.isSubstack ? ' • substack' : ''}</div>
                                        </div>
                                        <select id="type-${escapeHtml(target.id)}" class="detail-select detail-select-sm"
                                                onchange="updateConnectionType('${tid}', this.value)" ${!existingConnection ? 'disabled' : ''}>
                                            ${Object.entries(CONNECTION_TYPES).map(([key, val]) =>
                                                `<option value="${escapeHtml(key)}" ${connectionType === key ? 'selected' : ''}>${escapeHtml(val.label)}</option>`
                                            ).join('')}
                                        </select>
                                    </div>
                                    <input type="text" class="detail-input connection-label-input"
                                           id="label-${escapeHtml(target.id)}"
                                           placeholder="What flows here? (e.g. custom_id + amount only)"
                                           value="${escapeHtml(connectionLabel)}"
                                           ${!existingConnection ? 'style="display:none;"' : ''}
                                           onchange="updateConnectionLabel('${tid}', this.value)">
                                </div>
                            `}).join('')}
                        </div>
                    </div>
                </div>

                <!-- Cost Tab -->
                <div class="detail-tab-content" data-tab="cost">
                    <div class="cost-explainer">
                        <strong>Cost Model</strong><br>
                        • <strong>Fixed:</strong> recurring infrastructure cost (e.g., $80/month)<br>
                        • <strong>Variable:</strong> per-use cost (e.g., $0.0000001/request)<br>
                        • <strong>% of Transaction:</strong> percentage + flat fee per txn (e.g., 3.49% + $0.49 for PayPal)
                    </div>

                    <div class="detail-grid-2">
                        <div class="detail-section detail-section-flush">
                            <div class="detail-label">Currency</div>
                            <select class="detail-select" onchange="updateCostField('currency', this.value)">
                                ${COST_CURRENCIES.map(curr =>
                                    `<option value="${escapeHtml(curr)}" ${(layer.costModel?.currency || 'USD') === curr ? 'selected' : ''}>${escapeHtml(curr)}</option>`
                                ).join('')}
                            </select>
                        </div>

                        <div class="detail-section detail-section-flush">
                            <div class="detail-label">Period</div>
                            <select class="detail-select" onchange="updateCostField('period', this.value)">
                                ${COST_PERIODS.map(period =>
                                    `<option value="${escapeHtml(period)}" ${(layer.costModel?.period || 'month') === period ? 'selected' : ''}>${escapeHtml(period)}</option>`
                                ).join('')}
                            </select>
                        </div>
                    </div>

                    <div class="detail-grid-2">
                        <div class="detail-section detail-section-flush">
                            <div class="detail-label">Fixed Cost (Monthly)</div>
                            <div class="input-affix">
                                <span class="affix">${currencySymbol(layer.costModel?.currency || 'USD')}</span>
                                <input type="number" class="detail-input" step="0.01" value="${escapeHtml(layer.costModel?.fixedCost || 0)}"
                                       onchange="updateCostField('fixedCost', parseFloat(this.value))">
                                <span class="affix">/mo</span>
                            </div>
                        </div>

                        <div class="detail-section detail-section-flush">
                            <div class="detail-label">Variable Cost</div>
                            <div class="input-affix">
                                <span class="affix">${currencySymbol(layer.costModel?.currency || 'USD')}</span>
                                <input type="number" class="detail-input" step="0.00000001" value="${escapeHtml(layer.costModel?.variableCost || 0)}"
                                       onchange="updateCostField('variableCost', parseFloat(this.value))">
                                <span class="affix">per use</span>
                            </div>
                        </div>
                    </div>

                    <!-- Percentage-of-transaction-value cost (Gap 4) -->
                    <div class="detail-grid-2">
                        <div class="detail-section detail-section-flush">
                            <div class="detail-label">% of Transaction</div>
                            <div class="input-affix">
                                <input type="number" class="detail-input" step="0.01" min="0" value="${escapeHtml(layer.costModel?.percentageCost || 0)}"
                                       onchange="updateCostField('percentageCost', parseFloat(this.value))">
                                <span class="affix">%</span>
                            </div>
                        </div>

                        <div class="detail-section detail-section-flush">
                            <div class="detail-label">+ Flat Per Txn</div>
                            <div class="input-affix">
                                <span class="affix">${currencySymbol(layer.costModel?.currency || 'USD')}</span>
                                <input type="number" class="detail-input" step="0.01" min="0" value="${escapeHtml(layer.costModel?.percentageFixed || 0)}"
                                       onchange="updateCostField('percentageFixed', parseFloat(this.value))">
                            </div>
                        </div>
                    </div>
                    ${(layer.costModel?.percentageCost > 0 || layer.costModel?.percentageFixed > 0) ? `
                        <div class="cost-pct-preview">
                            ${escapeHtml(String(layer.costModel.percentageCost || 0))}% + ${currencySymbol(layer.costModel?.currency || 'USD')}${escapeHtml(String(layer.costModel.percentageFixed || 0))} =
                            <strong>${currencySymbol(layer.costModel?.currency || 'USD')}${(((layer.costModel.percentageCost || 0) / 100) * getAvgTransactionValue(project) + (layer.costModel.percentageFixed || 0)).toFixed(2)}</strong>
                            per transaction at ${currencySymbol(layer.costModel?.currency || 'USD')}${getAvgTransactionValue(project)} AOV
                            <span class="cost-pct-hint">(set AOV in the Cost dashboard)</span>
                        </div>
                    ` : ''}

                    <div class="detail-section detail-section-flush">
                        <div class="detail-label">Notes</div>
                        <textarea class="detail-textarea"
                                  placeholder="Optional documentation about costs"
                                  onchange="updateCostField('notes', this.value)">${escapeHtml(layer.costModel?.notes || '')}</textarea>
                    </div>
                </div>

                <!-- Substacks Tab -->
                ${!inSubstack ? `
                    <div class="detail-tab-content" data-tab="substacks">
                        ${substackSection}
                    </div>
                ` : ''}
            </div>
        </div>
    `;

    // Activate the previously-open tab (defaults to properties).
    switchDetailTab(activeTab);
}
