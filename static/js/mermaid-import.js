/**
 * Mermaid flowchart → StackStudio project converter.
 *
 * Parses a Mermaid `flowchart` / `graph` definition into the StackStudio
 * project schema (see SCHEMA.md). The mapping:
 *
 *   - `subgraph ID["Title"] … end`  → a top-level layer; nodes declared inside
 *     it become its substacks. The subgraph title becomes the layer name.
 *   - bare nodes declared outside any subgraph → top-level layers.
 *   - node shape →  layer `type` (best-effort, see SHAPE_TYPE):
 *       [(db)] cylinder→Database, {rhombus}→API, ([stadium])/[[subroutine]]→Core,
 *       ((circle))→Actor, (rounded)→Backend, [rect]/default→Other.
 *   - edges `A --> B`, `A -- text --> B`, `A -. text .-> B`, `A ==> B`, chained
 *     `A --> B --> C`, and fan-out `A --> B & C` → connections. A dotted edge
 *     (`-.->`) maps to an Async connection; everything else to HTTP. The edge
 *     text becomes the connection `label`.
 *   - an edge endpoint that is a subgraph id connects at the layer level.
 *
 * Pure and dependency-free so it can run in the browser and under Node for
 * tests. Throws on input with no recognizable nodes.
 */
(function (global) {
    'use strict';

    // Decode the handful of HTML entities Mermaid labels commonly carry. Does
    // NOT collapse <br/> — that's handled by callers that decide whether to
    // keep the break structure (name vs description) or flatten.
    function decodeEntities(s) {
        const entities = {
            '&larr;': '←', '&rarr;': '→', '&uarr;': '↑', '&darr;': '↓',
            '&times;': '×', '&amp;': '&', '&lt;': '<', '&gt;': '>',
            '&quot;': '"', '&#39;': "'", '&nbsp;': ' '
        };
        return String(s).replace(/&[a-z#0-9]+;/gi, m => entities[m.toLowerCase()] || m);
    }

    // Strip surrounding quotes Mermaid allows inside shape brackets.
    function stripQuotes(s) {
        let t = String(s).trim();
        if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
            t = t.slice(1, -1);
        }
        return t;
    }

    // Flatten a label to a single line (decode entities, drop <br/>, collapse
    // whitespace). Used for edge labels and anywhere a one-liner is wanted.
    function cleanLabel(raw) {
        if (raw == null) return '';
        let s = stripQuotes(raw);
        s = s.replace(/<br\s*\/?>/gi, ' ');
        s = decodeEntities(s);
        return s.replace(/\s+/g, ' ').trim();
    }

    // Split a label on <br/> into trimmed segments, preserving the break
    // structure. The first segment is the node's name; the rest become its
    // description (so a Mermaid label like "Cache<br/>session store<br/>8h TTL"
    // yields name "Cache" + a multi-line description rather than one giant name
    // that overflows the node).
    function splitLabel(raw) {
        if (raw == null) return { name: '', description: '' };
        const s = stripQuotes(raw);
        const parts = s.split(/<br\s*\/?>/gi)
            .map(p => decodeEntities(p).replace(/\s+/g, ' ').trim())
            .filter(p => p.length > 0);
        if (parts.length === 0) return { name: '', description: '' };
        return { name: parts[0], description: parts.slice(1).join('\n') };
    }

    // Shape detection: returns { type, label } given the text following a node
    // id. Order matters — test the most specific delimiters first.
    const SHAPE_TESTS = [
        { re: /^\(\[(.*)\]\)$/s, type: 'Core' },        // ([stadium])
        { re: /^\[\[(.*)\]\]$/s, type: 'Core' },        // [[subroutine]]
        { re: /^\[\((.*)\)\]$/s, type: 'Database' },    // [(database)]
        { re: /^\(\((.*)\)\)$/s, type: 'Actor' },       // ((circle))
        { re: /^\{\{(.*)\}\}$/s, type: 'API' },         // {{hexagon}}
        { re: /^\{(.*)\}$/s,     type: 'API' },         // {rhombus}
        { re: /^\[\/(.*)\/\]$/s, type: 'Other' },       // [/parallelogram/]
        { re: /^\[\\(.*)\\\]$/s, type: 'Other' },       // [\trapezoid\]
        { re: /^\((.*)\)$/s,     type: 'Backend' },     // (rounded)
        { re: /^\[(.*)\]$/s,     type: 'Other' }        // [rect]
    ];

    function parseNodeBody(body) {
        const t = body.trim();
        for (const s of SHAPE_TESTS) {
            const m = t.match(s.re);
            if (m) {
                const split = splitLabel(m[1]);
                return { type: s.type, label: split.name, description: split.description };
            }
        }
        return null; // not a shaped declaration (bare id reference)
    }

    // Split a string on top-level `&` (fan-out) so `B & C` → ['B','C']. We don't
    // need bracket-awareness here because fan-out only joins node ids/refs.
    function splitAmp(s) {
        return s.split('&').map(x => x.trim()).filter(Boolean);
    }

    // An edge connector regex: matches -->, ---, -.->, ==>, --x, --o, with an
    // optional inline label using either `-- text -->` or `-->|text|` forms.
    // Captures: [full, dottedFlag, pipeLabel].
    // We handle the two label styles by pre-extracting them in tokenizeEdges.

    /**
     * Parse a single logical edge line into a list of { from, to, label, dotted }.
     * Handles chains (A-->B-->C) and fan-out on either side (A & B --> C & D).
     */
    function parseEdgeLine(line, addEdge) {
        // Normalize the two label syntaxes to a single internal marker. First
        // the pipe form: `-->|label|`  and  `-. label .->` / `-- label -->`.
        // We walk the line splitting on connector tokens.
        // Connector token regex (global). Group 1 = label via `|...|` form is
        // handled separately; here we capture dotted vs solid.
        const connector = /\s*(<?(?:-{2,}|-\.-?|={2,})>?|-{2,}[xo]|-\.->)\s*/;

        // Pull out `|label|` labels by attaching them to the preceding connector.
        // Easiest robust approach: tokenize by scanning.
        const tokens = [];
        let rest = line;
        // Regex matching a connector optionally followed by |label|, OR a
        // `-- label -->` / `-. label .->` middle-label form.
        const edgeRe = /(-\.->|-\.-|<-->|-->|---|==>|===|--[xo]|<==>)/;

        // Handle middle-text labels: `A -- text --> B` and `A -. text .-> B`.
        // Convert them to pipe form so the splitter below is uniform.
        let normalized = line
            .replace(/--\s+([^->|][^-]*?)\s+-->/g, '-->|$1|')
            .replace(/--\s+([^->|][^-]*?)\s+---/g, '---|$1|')
            .replace(/-\.\s+([^.|][^.]*?)\s+\.->/g, '-.->|$1|')
            .replace(/==\s+([^=|][^=]*?)\s+==>/g, '==>|$1|');

        // Now split into segments by connectors, capturing the connector and an
        // optional trailing |label|.
        const segRe = /(-\.->|-->|---|==>|===|--[xo]|<-->|<==>)\s*(?:\|([^|]*)\|)?/g;
        const parts = [];
        let lastIndex = 0;
        let m;
        const nodesAndConns = [];
        while ((m = segRe.exec(normalized)) !== null) {
            const nodeChunk = normalized.slice(lastIndex, m.index).trim();
            nodesAndConns.push({ node: nodeChunk });
            nodesAndConns.push({ conn: m[1], label: m[2] ? cleanLabel(m[2]) : '' });
            lastIndex = segRe.lastIndex;
        }
        const tail = normalized.slice(lastIndex).trim();
        if (nodesAndConns.length === 0) return; // no connector → not an edge
        nodesAndConns.push({ node: tail });

        // Walk node/conn/node/conn/node… emitting edges between consecutive
        // node groups, expanding fan-out on both sides.
        for (let i = 0; i + 2 < nodesAndConns.length; i += 2) {
            const fromGroup = splitAmp(nodesAndConns[i].node);
            const connInfo = nodesAndConns[i + 1];
            const toGroup = splitAmp(nodesAndConns[i + 2].node);
            const dotted = connInfo.conn.includes('.');
            fromGroup.forEach(f => toGroup.forEach(t => {
                // Strip any shape body from an inline-declared endpoint id.
                const fid = extractId(f), tid = extractId(t);
                if (fid && tid) addEdge(fid, tid, connInfo.label, dotted, f, t);
            }));
        }
    }

    // From an endpoint token that may carry an inline shape declaration
    // (e.g. `FETCH["fetchAllData()"]`), return just the node id.
    function extractId(token) {
        const t = token.trim();
        const m = t.match(/^([A-Za-z0-9_]+)\s*[\[\(\{]/);
        if (m) return m[1];
        const id = t.match(/^([A-Za-z0-9_]+)$/);
        return id ? id[1] : null;
    }

    // From an endpoint token that may carry an inline shape declaration, return
    // { id, body } so inline-declared nodes are registered.
    function extractDecl(token) {
        const t = token.trim();
        const m = t.match(/^([A-Za-z0-9_]+)\s*([\[\(\{].*[\]\)\}])\s*$/s);
        if (m) return { id: m[1], body: m[2] };
        return null;
    }

    /**
     * Convert a Mermaid flowchart string into a StackStudio project object.
     * @param {string} text  the .mmd source
     * @param {string} [name] project name (defaults to a title from the source)
     * @returns {object} project ready for migrateProject()
     */
    function mermaidToProject(text, name) {
        if (!text || !String(text).trim()) throw new Error('Empty Mermaid source');

        const rawLines = String(text).replace(/\r\n/g, '\n').split('\n');
        // Strip comments (%%) and blank lines; keep order.
        const lines = rawLines
            .map(l => l.replace(/%%.*$/, '').replace(/\t/g, ' '))
            .map(l => l.replace(/\s+$/,''))
            .filter(l => l.trim().length > 0);

        // Registry of all nodes: id → { id, name, type, container }, where
        // container is the subgraph id (or null for top level).
        const nodes = new Map();
        // Subgraphs: id → { id, name, type, children:[ids] }
        const subgraphs = new Map();
        const subgraphStack = [];
        const edges = [];

        const ensureNode = (id, body, container) => {
            if (!nodes.has(id)) {
                const parsed = body ? parseNodeBody(body) : null;
                nodes.set(id, {
                    id,
                    name: parsed ? (parsed.label || id) : id,
                    type: parsed ? parsed.type : 'Other',
                    description: parsed ? (parsed.description || '') : '',
                    container: container !== undefined ? container : currentContainer()
                });
            } else if (body) {
                // Upgrade a previously-referenced bare id with its real label.
                const parsed = parseNodeBody(body);
                if (parsed) {
                    const n = nodes.get(id);
                    if (n.name === id && parsed.label) n.name = parsed.label;
                    if (n.type === 'Other') n.type = parsed.type;
                    if (!n.description && parsed.description) n.description = parsed.description;
                }
            }
            return nodes.get(id);
        };

        function currentContainer() {
            return subgraphStack.length ? subgraphStack[subgraphStack.length - 1] : null;
        }

        let title = name || null;

        const subgraphRe = /^subgraph\s+(?:([A-Za-z0-9_]+)\s*)?(?:\[(.*)\]|"(.*)"|(.*))?$/;
        const nodeDeclRe = /^([A-Za-z0-9_]+)\s*([\[\(\{].*[\]\)\}])\s*$/s;

        for (let raw of lines) {
            const line = raw.trim();

            // Diagram header: flowchart TD / graph LR …
            const head = line.match(/^(flowchart|graph)\s+(\w+)?/i);
            if (head) continue;

            if (/^end\b/i.test(line)) {
                if (subgraphStack.length) subgraphStack.pop();
                continue;
            }

            if (/^subgraph\b/i.test(line)) {
                const m = line.match(/^subgraph\s+(.*)$/i);
                let id = null, label = null;
                const body = m ? m[1].trim() : '';
                // Forms: `subgraph ID["Title"]`, `subgraph ID[Title]`,
                // `subgraph "Title"`, `subgraph Title`.
                const withId = body.match(/^([A-Za-z0-9_]+)\s*(?:\[(.*)\]|\["?(.*?)"?\])?\s*$/s);
                const bracket = body.match(/^([A-Za-z0-9_]+)\s*\[(.*)\]\s*$/s);
                if (bracket) {
                    id = bracket[1]; label = cleanLabel(bracket[2]);
                } else if (/^[A-Za-z0-9_]+$/.test(body)) {
                    id = body; label = body;
                } else {
                    // Quoted/plain title with no id — synthesize an id.
                    label = cleanLabel(body.replace(/^\[|\]$/g, ''));
                    id = 'sg_' + (subgraphs.size + 1);
                }
                if (!subgraphs.has(id)) {
                    subgraphs.set(id, { id, name: label || id, type: 'Core', children: [] });
                }
                subgraphStack.push(id);
                if (!title) title = label;
                continue;
            }

            // Node declaration on its own line.
            const nd = line.match(nodeDeclRe);
            if (nd && !segLooksLikeEdge(line)) {
                ensureNode(nd[1], nd[2]);
                continue;
            }

            // Otherwise: an edge line (possibly with inline-declared endpoints).
            if (segLooksLikeEdge(line)) {
                // Register inline-declared endpoints first.
                registerInlineDecls(line, ensureNode);
                parseEdgeLine(line, (from, to, label, dotted) => {
                    ensureNode(from);
                    ensureNode(to);
                    edges.push({ from, to, label, dotted });
                });
                continue;
            }

            // A bare id on its own line inside a subgraph → a node.
            const bare = line.match(/^([A-Za-z0-9_]+)$/);
            if (bare) { ensureNode(bare[1]); continue; }
        }

        // Assign group (phase/lane) membership to each node from its subgraph.
        const groupOf = new Map();        // nodeId → group display name
        const groupMembers = new Map();   // subgraphId → [nodeId]
        nodes.forEach(n => {
            if (n.container && subgraphs.has(n.container)) {
                const sg = subgraphs.get(n.container);
                groupOf.set(n.id, sg.name);
                if (!groupMembers.has(n.container)) groupMembers.set(n.container, []);
                groupMembers.get(n.container).push(n.id);
            }
        });

        // Build FLAT layers — one per real node. Subgraphs are NOT turned into
        // nodes; they become the `group` tag (a phase/lane). This avoids the
        // phantom container nodes the old composition mapping created and keeps
        // the diagram's flow axis intact for the Flow layout.
        const layers = [];
        const idToLayer = new Map(); // nodeId → layer object
        nodes.forEach(n => {
            if (subgraphs.has(n.id)) return; // a subgraph id is never a node
            const layer = {
                id: n.id,
                name: n.name,
                type: n.type,
                status: 'Active',
                technology: '',
                description: n.description || '',
                connections: [],
                substacks: []
            };
            if (groupOf.has(n.id)) layer.group = groupOf.get(n.id);
            layers.push(layer);
            idToLayer.set(n.id, layer);
        });

        if (layers.length === 0) throw new Error('No nodes found in Mermaid source');

        // Resolve an edge endpoint to one or more real node ids. A bare node id
        // resolves to itself; a subgraph id expands to all its member nodes
        // (so a phase-level edge like `SRC --> COOKIE` funnels every source node
        // into the target — more faithful than one opaque cluster edge).
        const resolveEndpoint = (id) => {
            if (idToLayer.has(id)) return [id];
            if (groupMembers.has(id)) return groupMembers.get(id).slice();
            return [];
        };

        // Attach edges as connections on the source node. Expand group
        // endpoints, drop self-loops from expansion, and dedupe.
        const seen = new Set();
        edges.forEach(e => {
            const froms = resolveEndpoint(e.from);
            const tos = resolveEndpoint(e.to);
            froms.forEach(f => tos.forEach(t => {
                if (f === t) return;
                const src = idToLayer.get(f);
                if (!src || !idToLayer.has(t)) return;
                const key = `${f}->${t}:${e.label || ''}`;
                if (seen.has(key)) return;
                seen.add(key);
                const conn = { targetId: t, type: e.dotted ? 'Async' : 'HTTP' };
                if (e.label) conn.label = e.label;
                src.connections.push(conn);
            }));
        });

        // Ordered phase names (subgraph declaration order) so the Flow view can
        // band them in source order when ranks tie.
        const groupOrder = [];
        subgraphs.forEach(sg => { if (!groupOrder.includes(sg.name)) groupOrder.push(sg.name); });

        const proj = { name: title || 'Imported Diagram', layers };
        if (groupOrder.length) proj.groupOrder = groupOrder;
        return proj;
    }

    // Quick test: does a line contain an edge connector? Covers solid, thick,
    // circle/cross, and dotted forms — including the dotted middle-label form
    // `-. text .->` whose connector is split around the label.
    function segLooksLikeEdge(line) {
        return /(-\.->|-->|---|==>|===|--[xo]|<-->|<==>|-\.-|-\.\s|\.->)/.test(line);
    }

    // Register any `ID["label"]` shaped declarations that appear inline within
    // an edge line so their labels/types are captured.
    function registerInlineDecls(line, ensureNode) {
        const re = /([A-Za-z0-9_]+)\s*([\[\(\{][^\]\)\}]*[\]\)\}])/g;
        let m;
        while ((m = re.exec(line)) !== null) {
            ensureNode(m[1], m[2]);
        }
    }

    const api = { mermaidToProject };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    global.MermaidImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
