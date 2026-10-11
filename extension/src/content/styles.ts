export const SIDEBAR_CSS = `
:host {
    all: initial;
}

.pcn-panel {
    position: fixed;
    top: 12px;
    right: 0;
    z-index: 2147483000;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: min(380px, 92vw);
    max-height: calc(100vh - 24px);
    color: #e6e2d8;
    background: rgba(24, 24, 28, 0.92);
    border: 1px solid #3a3a42;
    border-right: none;
    border-radius: 8px 0 0 8px;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
    font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    pointer-events: auto;
    transform: translateX(0);
    transition: transform 160ms ease-out;
}

.pcn-panel.pcn-collapsed {
    transform: translateX(calc(100% - 36px));
}

.pcn-panel.pcn-collapsed .pcn-body {
    visibility: hidden;
}

.pcn-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid #3a3a42;
}

.pcn-title {
    flex: 1;
    margin: 0;
    font-size: 14px;
    font-weight: 600;
}

.pcn-body {
    overflow-y: auto;
    padding: 8px 10px 10px;
}

.pcn-panel button {
    font: inherit;
    color: inherit;
    background: #2c2c34;
    border: 1px solid #4a4a54;
    border-radius: 4px;
    padding: 3px 8px;
    cursor: pointer;
}

.pcn-panel button:hover {
    background: #383842;
}

.pcn-panel button:focus-visible {
    outline: 2px solid #d9b45a;
    outline-offset: 2px;
}

.pcn-panel button[aria-pressed="true"] {
    border-color: #d9b45a;
    background: #3d3726;
}

.pcn-status {
    margin: 0 0 8px;
    padding: 4px 8px;
    border-left: 3px solid #777;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.04);
}

.pcn-status-active { border-left-color: #5fae6b; }
.pcn-status-fallback { border-left-color: #d9a441; }
.pcn-status-unsupported { border-left-color: #c95b5b; }

.pcn-reason {
    display: block;
    color: #a9a59c;
    font-size: 12px;
}

.pcn-creatures {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0 0 8px;
}

.pcn-creature-name {
    margin: 4px 0 6px;
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
}

.pcn-defenses {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 8px;
}

.pcn-defenses th,
.pcn-defenses td {
    padding: 3px 4px;
    text-align: left;
    border-bottom: 1px solid #2f2f36;
}

.pcn-provenance {
    display: inline-block;
    padding: 0 6px;
    border-radius: 9px;
    font-size: 11px;
    border: 1px solid currentColor;
}

.pcn-prov-exact-client { color: #7cc4f0; }
.pcn-prov-observed { color: #8fd18f; }
.pcn-prov-inferred { color: #e0c070; }
.pcn-prov-possible { color: #b0aaa0; }

.pcn-panel details {
    margin: 6px 0;
}

.pcn-panel summary {
    cursor: pointer;
    font-weight: 600;
}

.pcn-panel ul {
    margin: 4px 0;
    padding-left: 18px;
}

.pcn-disputed summary {
    color: #e08a7a;
}

.pcn-empty,
.pcn-diagnostics {
    color: #a9a59c;
    font-size: 12px;
}

.pcn-actions {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 10px;
}

@media (prefers-reduced-motion: reduce) {
    .pcn-panel {
        transition: none;
    }
}
`;
